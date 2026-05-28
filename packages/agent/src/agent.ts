/**
 * Conversational agent layer — channel-agnostic.
 *
 * Built on Glove (`glove-core` + `glove-mcp`):
 * - Persistent `ConversationStore` per (channel, handle) pair (rows in
 *   `agent_conversations`).
 * - One Glove instance per (channel, handle), cached in-process (slow
 *   rebuild and per-turn `mountMcp` removed — first message warms;
 *   subsequent messages reuse).
 * - MCP tools come from the robot at `mcpUrl` via `mountMcp`, so the
 *   tool list updates whenever the robot redeploys.
 * - Confirmation-required tools (spec §13) are intercepted before
 *   `executor.executeTool` runs, the call is stashed in
 *   `agent_conversations.pending_confirmation`, and the model is handed
 *   a "waiting for operator confirmation" stub result so its turn
 *   finishes cleanly. On the next user message the gate is checked: `y`
 *   re-issues the same MCP tool call, `n` drops it, anything else
 *   cancels and falls through into a regular turn.
 *
 * The executor monkey-patch is the smallest narrow shim we can use
 * today — glove-core 3.0 doesn't expose a public ToolMiddleware API.
 * The shim is documented in code and contained to this file; if a
 * public middleware ships, swap it in here without touching anything
 * else.
 */
import {
  Glove,
  Displaymanager,
  createAdapter,
  type IGloveRunnable,
  type Message,
} from 'glove-core';
import { mountMcp, type McpAdapter, type McpCatalogueEntry } from 'glove-mcp';
import { newId, schema } from '@overwatch/shared-ts';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { ConversationStore } from './store.js';
import type {
  AgentChannel,
  AgentReplyMeta,
  PendingConfirmation,
} from './types.js';
import type { AgentProviderConfig } from './env.js';

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

/**
 * Default system prompt for the Overwatch Patrol agent.
 *
 * Telegram and dashboard share most of the prompt; the trailing
 * paragraph differs because the surfaces have different formatting
 * constraints (Telegram caps messages at 4096 chars; the dashboard
 * doesn't but still prefers short paragraphs).
 */
export function defaultSystemPrompt(nowIsoStr: string, channel: AgentChannel): string {
  const head = `\
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
- Keep replies tight. Status before sentiment. No exclamation marks.`;
  if (channel === 'telegram') {
    return `${head}
- The operator is reaching you via Telegram. Keep messages under Telegram's
  4096-character limit; paginate or summarize if needed.`;
  }
  return `${head}
- The operator is reaching you via the dashboard. Keep replies tight; long responses are fine but use short paragraphs.`;
}

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

export function isConfirmTool(tool: string, args: Record<string, unknown>): boolean {
  // Tool names are MCP-namespaced as `robot__<name>`.
  const base = tool.split('__').pop() ?? tool;
  if (CONFIRM_TOOLS.has(base)) return true;
  if (base === 'execute_sport_command') {
    const cmd = (args.command_name ?? args.command ?? '') as string;
    return CONFIRM_SPORT_COMMANDS.has(cmd);
  }
  return false;
}

export function describeAction(tool: string, args: Record<string, unknown>): string {
  const base = tool.split('__').pop() ?? tool;
  if (base === 'execute_sport_command') return `execute ${args.command_name ?? 'sport command'}`;
  if (base === 'stop_surveillance') return 'stop surveillance';
  if (base === 'delete_waypoint') return `delete waypoint ${args.name ?? ''}`;
  return base;
}

export interface AgentLogger {
  info: (msg: string, fields?: Record<string, unknown>) => void;
  warn: (msg: string, fields?: Record<string, unknown>) => void;
  error: (msg: string, fields?: Record<string, unknown>) => void;
}

export interface AgentOptions {
  channel: AgentChannel;
  handle: string;
  db: BetterSQLite3Database<typeof schema>;
  mcpUrl: string;
  provider: AgentProviderConfig;
  systemPrompt: string;
  clientInfo?: { name: string; version: string };
  logger?: AgentLogger;
}

export interface AgentCacheEntry {
  store: ConversationStore;
  agent: IGloveRunnable;
  /** Mutable slot the executor shim writes into when it intercepts a
   *  confirmation-required tool call mid-turn. Read once after
   *  `processRequest` resolves; cleared per-turn. */
  pendingTrap: { tool: string; args: Record<string, unknown> } | null;
}

const NOOP_LOGGER: AgentLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

function cacheKey(channel: AgentChannel, handle: string): string {
  return `${channel}:${handle}`;
}

const agentCache = new Map<string, AgentCacheEntry>();

/** Reset the cached agent for (channel, handle) — used by /reset hook + tests. */
export function resetAgent(channel: AgentChannel, handle: string): void {
  agentCache.delete(cacheKey(channel, handle));
}

export async function getOrCreateAgent(
  opts: AgentOptions,
): Promise<AgentCacheEntry | null> {
  const log = opts.logger ?? NOOP_LOGGER;
  const key = cacheKey(opts.channel, opts.handle);
  const cached = agentCache.get(key);
  if (cached) return cached;
  if (!opts.provider) return null;

  const store = new ConversationStore(opts.db, opts.channel, opts.handle);
  const glove = new Glove({
    store,
    model: createAdapter({
      provider: opts.provider.provider,
      model: opts.provider.model,
      apiKey: opts.provider.apiKey,
      stream: true,
    }),
    displayManager: new Displaymanager(),
    systemPrompt: opts.systemPrompt,
    serverMode: true,
    compaction_config: {
      compaction_instructions:
        "Summarise the conversation tightly. Preserve waypoint names, incident ids, and the user's open questions.",
    },
  });

  // `/reset` hook — operator can clear conversation memory mid-chat via
  // the chat surface. Persisted messages stay (the next turn just starts
  // fresh because we drop the cache); the hook short-circuits the
  // current turn.
  glove.defineHook('reset', async () => ({
    shortCircuit: {
      message: { sender: 'agent', text: 'memory cleared · /reset' },
    },
  }));

  const built = glove.build();
  const catalogue: McpCatalogueEntry[] = [
    {
      id: 'robot',
      name: 'Overwatch Patrol Robot',
      description: 'dimos MCP server: surveillance control, navigation, sport commands, queries.',
      url: opts.mcpUrl,
    },
  ];
  try {
    await mountMcp(built, {
      adapter: new RobotMcpAdapter(),
      entries: catalogue,
      clientInfo: opts.clientInfo ?? { name: 'overwatch-patrol/agent', version: '0.1.0' },
    });
  } catch (e) {
    log.error('mcp.mount_failed', {
      error: String(e),
      channel: opts.channel,
      handle: opts.handle,
    });
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
    log.warn('agent.executor_shim_unavailable', {
      channel: opts.channel,
      handle: opts.handle,
    });
  }

  agentCache.set(key, entry);
  log.info('agent.cached', {
    channel: opts.channel,
    handle: opts.handle,
    provider: opts.provider.provider,
    model: opts.provider.model,
  });
  return entry;
}

/** Direct one-shot MCP `tools/call` — used to fire a confirmed tool without
 *  spinning the agent loop back up. Keeps the confirm path cheap and
 *  deterministic. */
export async function executeToolDirectly(
  mcpUrl: string,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const res = await fetch(mcpUrl, {
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
export async function handleConfirmation(
  store: ConversationStore,
  text: string,
  mcpUrl: string,
): Promise<string | null> {
  const pending = store.getPendingConfirmation();
  if (!pending) return null;
  const lower = text.trim().toLowerCase();
  if (['y', 'yes', 'confirm', 'ok'].includes(lower)) {
    store.setPendingConfirmation(null);
    const result = await executeToolDirectly(mcpUrl, pending.tool, pending.args);
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

export interface AgentReply {
  text: string;
  meta: AgentReplyMeta;
}

export async function handleMessage(
  opts: AgentOptions,
  text: string,
): Promise<AgentReply> {
  const log = opts.logger ?? NOOP_LOGGER;

  // The store handles its own per-(channel, handle) row; constructing
  // one here is cheap and gives us the pending-confirmation accessors
  // regardless of whether the cached agent exists yet.
  const tmpStore = new ConversationStore(opts.db, opts.channel, opts.handle);
  const confirm = await handleConfirmation(tmpStore, text, opts.mcpUrl);
  if (confirm !== null) return { text: confirm, meta: {} };

  const entry = await getOrCreateAgent(opts);
  if (!entry) {
    return { text: 'agent offline · cannot reach robot MCP server', meta: {} };
  }
  // Reset the per-turn pending trap before processRequest fires.
  entry.pendingTrap = null;

  let result: Message | { messages: Message[] };
  try {
    result = await entry.agent.processRequest(text);
  } catch (e) {
    log.error('agent.error', {
      channel: opts.channel,
      handle: opts.handle,
      error: String(e),
    });
    return { text: `agent error · ${String(e).slice(0, 200)}`, meta: {} };
  }

  const msgs: Message[] = 'messages' in result ? result.messages : [result];
  const reply = msgs.find((m) => m.sender === 'agent')?.text ?? '…';

  // Snapshot the executor-shim trap before clearing — callers want to
  // know whether this turn produced a confirmation-required tool call.
  // We widen the type explicitly because the earlier `entry.pendingTrap
  // = null` narrows the property to `null` in TS's control-flow graph,
  // even though the shim could (and does) reassign it during the await
  // above.
  const trap: PendingConfirmation | null =
    (entry.pendingTrap as PendingConfirmation | null) ?? null;

  // If the executor shim trapped a confirmation-required call mid-turn,
  // persist it so the next user message can resolve it.
  if (trap) {
    entry.store.setPendingConfirmation(trap);
    entry.pendingTrap = null;
  }

  const meta: AgentReplyMeta = trap ? { pending_confirmation: trap } : {};
  return { text: reply, meta };
}

/**
 * Streaming wrapper around `handleMessage`.
 *
 * v1: buffered emit. Glove 3.0 has no public token-stream API; replace
 * with a real subscription when one ships.
 */
export async function* handleMessageStream(
  opts: AgentOptions,
  text: string,
): AsyncIterable<
  | { type: 'message'; text: string; meta: AgentReplyMeta }
  | { type: 'done' }
> {
  // v1: buffered emit. Glove 3.0 has no public token-stream API; replace with a real subscription when one ships.
  const reply = await handleMessage(opts, text);
  yield { type: 'message', text: reply.text, meta: reply.meta };
  yield { type: 'done' };
}
