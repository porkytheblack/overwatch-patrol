/**
 * Conversational agent layer.
 *
 * Built on Glove (`glove-core` + `glove-mcp`):
 * - Persistent `TelegramStore` per chat_id (rows in `agent_conversations`).
 * - One Glove instance per chat_id, cached in-process (slow rebuild and
 *   per-turn `mountMcp` removed — first message warms; subsequent messages
 *   reuse).
 * - MCP tools come from the robot at `MCP_URL` via `mountMcp`, so the
 *   tool list updates whenever the robot redeploys.
 * - Confirmation-required tools (spec §13) are intercepted before
 *   `executor.executeTool` runs, the call is stashed in
 *   `agent_conversations.pending_confirmation`, and the model is handed a
 *   "waiting for operator confirmation" stub result so its turn finishes
 *   cleanly. On the next user message the gate is checked: `y` re-issues
 *   the same MCP tool call, `n` drops it, anything else cancels and falls
 *   through into a regular turn.
 *
 * The executor monkey-patch is the smallest narrow shim we can use
 * today — glove-core 3.0 doesn't expose a public ToolMiddleware API. The
 * shim is documented in code and contained to this file; if a public
 * middleware ships, swap it in here without touching anything else.
 */
import {
  Glove,
  Displaymanager,
  createAdapter,
  type IGloveRunnable,
  type Message,
} from 'glove-core';
import { mountMcp, type McpAdapter, type McpCatalogueEntry } from 'glove-mcp';
import { newId } from '@overwatch/shared-ts';
import { ENV } from './env.js';
import { log } from './log.js';
import { TelegramStore } from './store.js';

export const CONFIRM_TOOLS = new Set<string>(['stop_surveillance', 'delete_waypoint']);

export const CONFIRM_SPORT_COMMANDS = new Set<string>([
  'FrontFlip',
  'Backflip',
  'LeftFlip',
  'RightFlip',
  'Handstand',
  'FrontJump',
  'FrontPounce',
  'Scrape',
  'Bound',
  'MoonWalk',
]);

const SYSTEM_PROMPT = (nowIsoStr: string) => `\
You are the Overwatch Patrol agent for an autonomous surveillance robot. You
answer questions about waypoints, incidents, and robot status concisely and
factually. You can also control the robot: move it, navigate to a waypoint,
stop, follow a person, speak, or perform sport commands.

Rules:
- Use tools to look up data. Never fabricate incident details.
- Time references ("last hour", "today", "yesterday") resolve against ${nowIsoStr}.
- Prefer go_to_waypoint over navigate_with_text when the destination is a
  named waypoint.
- Always announce what you are about to do in one short sentence BEFORE
  calling a control tool.
- For sport commands in {FrontFlip, Backflip, LeftFlip, RightFlip, Handstand,
  FrontJump, FrontPounce, Scrape, Bound, MoonWalk}, the operator will need to
  confirm. Tell them what you're about to do and that they should reply y to
  confirm.
- Keep replies tight. Status before sentiment. No exclamation marks.
- The operator is reaching you via Telegram. Keep messages under Telegram's
  4096-character limit; paginate or summarize if needed.`;

/** Minimal McpAdapter — single static server, no per-conversation activation. */
class RobotMcpAdapter implements McpAdapter {
  identifier = 'robot';
  async getActive() {
    return ['robot'];
  }
  async activate() {}
  async deactivate() {}
  async getAccessToken() {
    return '';
  }
}

const CATALOGUE: McpCatalogueEntry[] = [
  {
    id: 'robot',
    name: 'Overwatch Patrol Robot',
    description: 'dimos MCP server: surveillance control, navigation, sport commands, queries.',
    url: ENV.MCP_URL,
  },
];

function isConfirmTool(tool: string, args: Record<string, unknown>): boolean {
  // Tool names are MCP-namespaced as `robot__<name>`.
  const base = tool.split('__').pop() ?? tool;
  if (CONFIRM_TOOLS.has(base)) return true;
  if (base === 'execute_sport_command') {
    const cmd = (args.command_name ?? args.command ?? '') as string;
    return CONFIRM_SPORT_COMMANDS.has(cmd);
  }
  return false;
}

function describeAction(tool: string, args: Record<string, unknown>): string {
  const base = tool.split('__').pop() ?? tool;
  if (base === 'execute_sport_command') return `execute ${args.command_name ?? 'sport command'}`;
  if (base === 'stop_surveillance') return 'stop surveillance';
  if (base === 'delete_waypoint') return `delete waypoint ${args.name ?? ''}`;
  return base;
}

interface AgentCacheEntry {
  store: TelegramStore;
  agent: IGloveRunnable;
  /** Mutable slot the executor shim writes into when it intercepts a
   *  confirmation-required tool call mid-turn. Read once after
   *  `processRequest` resolves; cleared per-turn. */
  pendingTrap: { tool: string; args: Record<string, unknown> } | null;
}

const agentCache = new Map<string, AgentCacheEntry>();

/** Reset the cached agent for a chat — used by /reset hook + tests. */
export function resetAgentForChat(chat_id: string): void {
  agentCache.delete(chat_id);
}

async function getOrCreateAgent(chat_id: string): Promise<AgentCacheEntry | null> {
  const cached = agentCache.get(chat_id);
  if (cached) return cached;
  if (!ENV.AGENT) return null;

  const store = new TelegramStore(chat_id);
  const glove = new Glove({
    store,
    model: createAdapter({
      provider: ENV.AGENT.provider,
      model: ENV.AGENT.model,
      apiKey: ENV.AGENT.apiKey,
      stream: true,
    }),
    displayManager: new Displaymanager(),
    systemPrompt: SYSTEM_PROMPT(new Date().toISOString()),
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Summarise the conversation tightly. Preserve waypoint names, incident ids, and the user's open questions.",
    },
  });

  // `/reset` hook — operator can clear conversation memory mid-chat via
  // Telegram. Persisted messages stay (the next turn just starts fresh
  // because we drop the cache); the hook short-circuits the current turn.
  glove.defineHook('reset', async () => ({
    shortCircuit: {
      message: { sender: 'agent', text: 'memory cleared · /reset' },
    },
  }));

  const built = glove.build();
  try {
    await mountMcp(built, {
      adapter: new RobotMcpAdapter(),
      entries: CATALOGUE,
      clientInfo: { name: 'overwatch-patrol/telegram', version: '0.1.0' },
    });
  } catch (e) {
    log.error('mcp.mount_failed', { error: String(e), chat_id });
    return null;
  }

  const entry: AgentCacheEntry = { store, agent: built, pendingTrap: null };

  // ── Executor shim ────────────────────────────────────────────────
  // Wrap executor.executeTool so confirmation-required calls are stashed
  // rather than dispatched. The model still gets a tool result back, so
  // its turn completes cleanly with a "tell the operator to reply y"
  // sentence (the system prompt nudges this shape).
  //
  // TODO: replace this with a public middleware API when glove-core
  // exposes one. Today (3.0) there's no clean alternative.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exec = (built as any).executor;
  const origExec = exec?.executeTool?.bind(exec);
  if (origExec) {
    exec.executeTool = async (call: { name: string; input: Record<string, unknown> }) => {
      if (isConfirmTool(call.name, call.input)) {
        entry.pendingTrap = { tool: call.name, args: call.input };
        return {
          status: 'success',
          data: `Waiting for operator confirmation to ${describeAction(call.name, call.input)}. Tell them to reply y to confirm.`,
        };
      }
      return origExec(call);
    };
  } else {
    log.warn('agent.executor_shim_unavailable', { chat_id });
  }

  agentCache.set(chat_id, entry);
  log.info('agent.cached', { chat_id, provider: ENV.AGENT.provider, model: ENV.AGENT.model });
  return entry;
}

/** Direct one-shot MCP `tools/call` — used to fire a confirmed tool without
 *  spinning the agent loop back up. Keeps the confirm path cheap and
 *  deterministic. */
async function executeToolDirectly(
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const res = await fetch(ENV.MCP_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: newId(),
        method: 'tools/call',
        params: { name: tool.replace(/^robot__/, ''), arguments: args },
      }),
    });
    if (!res.ok) return `error: ${res.status}`;
    const j = (await res.json()) as { result?: { content?: Array<{ text?: string }> } };
    return (
      j.result?.content?.map((c) => c.text).filter(Boolean).join(' ') ?? 'ok'
    ).slice(0, 400);
  } catch (e) {
    return `error: ${String(e).slice(0, 200)}`;
  }
}

/** Confirmation gate. Returns the reply text if this message landed on a
 *  pending y/n; null when it didn't (caller should run the full agent turn). */
async function handleConfirmation(
  store: TelegramStore,
  text: string,
): Promise<string | null> {
  const pending = store.getPendingConfirmation();
  if (!pending) return null;
  const lower = text.trim().toLowerCase();
  if (['y', 'yes', 'confirm', 'ok'].includes(lower)) {
    store.setPendingConfirmation(null);
    const result = await executeToolDirectly(pending.tool, pending.args);
    return `confirmed · ${describeAction(pending.tool, pending.args)} · ${result}`;
  }
  if (['n', 'no', 'cancel'].includes(lower)) {
    store.setPendingConfirmation(null);
    return `cancelled · ${describeAction(pending.tool, pending.args)}`;
  }
  // Anything else clears the pending slot and falls through to a normal
  // agent turn — spec §7.7: "Anything else → clear pending and fall through."
  store.setPendingConfirmation(null);
  return null;
}

export async function handleMessage(chat_id: string, text: string): Promise<string> {
  if (!ENV.AGENT) {
    return 'agent offline · no provider configured (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY)';
  }

  // The store handles its own per-chat row; constructing one here is
  // cheap and gives us the pending-confirmation accessors regardless of
  // whether the cached agent exists yet.
  const tmpStore = new TelegramStore(chat_id);
  const confirm = await handleConfirmation(tmpStore, text);
  if (confirm !== null) return confirm;

  const entry = await getOrCreateAgent(chat_id);
  if (!entry) {
    return 'agent offline · cannot reach robot MCP server';
  }
  // Reset the per-turn pending trap before processRequest fires.
  entry.pendingTrap = null;

  let result: Message | { messages: Message[] };
  try {
    result = await entry.agent.processRequest(text);
  } catch (e) {
    log.error('agent.error', { chat_id, error: String(e) });
    return `agent error · ${String(e).slice(0, 200)}`;
  }

  const msgs: Message[] = 'messages' in result ? result.messages : [result];
  const reply = msgs.find((m) => m.sender === 'agent')?.text ?? '…';

  // If the executor shim trapped a confirmation-required call mid-turn,
  // persist it so the next user message can resolve it.
  if (entry.pendingTrap) {
    entry.store.setPendingConfirmation(entry.pendingTrap);
    entry.pendingTrap = null;
  }

  return reply;
}
