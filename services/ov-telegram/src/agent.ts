/**
 * Conversational agent layer.
 *
 * The agent IS the dimos MCP server — the Glove instance loads its tool list
 * dynamically each turn via `mountMcp`. Read-only queries (search_incidents,
 * etc.) and control skills (go_to_waypoint, execute_sport_command) are exposed
 * to the LLM through the same MCP transport.
 *
 * Confirmation-required tools (sport flips, stop_surveillance, delete_waypoint)
 * are intercepted via a Glove hook that stashes `{tool, args}` into
 * `agent_conversations.pending_confirmation` and short-circuits the turn with a
 * one-line "Reply y to confirm" prompt.
 */
import { Glove, MemoryStore, Displaymanager, createAdapter, type Message } from 'glove-core';
import { mountMcp, type McpAdapter, type McpCatalogueEntry } from 'glove-mcp';
import { eq } from 'drizzle-orm';
import { schema, newId, nowIso } from '@overwatch/shared-ts';
import { db } from './db.js';
import { ENV } from './env.js';
import { log } from './log.js';

export const CONFIRM_TOOLS = new Set<string>([
  'stop_surveillance',
  'delete_waypoint',
  // execute_sport_command is intercepted by inspecting args.command_name
]);

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

interface ConvoState {
  id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  pending_confirmation: { tool: string; args: Record<string, unknown> } | null;
}

function loadConvo(handle: string): ConvoState {
  const row = db
    .select()
    .from(schema.agentConversations)
    .where(eq(schema.agentConversations.handle, handle))
    .get();
  if (row) {
    return {
      id: row.id,
      messages: JSON.parse(row.messages),
      pending_confirmation: row.pending_confirmation ? JSON.parse(row.pending_confirmation) : null,
    };
  }
  const id = newId();
  db.insert(schema.agentConversations)
    .values({
      id,
      channel: 'telegram',
      handle,
      messages: '[]',
      pending_confirmation: null,
      last_active: nowIso(),
    })
    .run();
  return { id, messages: [], pending_confirmation: null };
}

function saveConvo(state: ConvoState) {
  // Keep last 20 turns
  const trimmed = state.messages.slice(-20);
  db.update(schema.agentConversations)
    .set({
      messages: JSON.stringify(trimmed),
      pending_confirmation: state.pending_confirmation
        ? JSON.stringify(state.pending_confirmation)
        : null,
      last_active: nowIso(),
    })
    .where(eq(schema.agentConversations.id, state.id))
    .run();
}

/**
 * Minimal MCP adapter — single static server (the robot's MCP endpoint), no
 * per-conversation activation needed.
 */
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

function requiresConfirmation(tool: string, args: Record<string, unknown>): boolean {
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

export async function handleMessage(handle: string, text: string): Promise<string> {
  const state = loadConvo(handle);

  // Confirmation gate
  if (state.pending_confirmation) {
    const lower = text.trim().toLowerCase();
    if (['y', 'yes', 'confirm', 'ok'].includes(lower)) {
      const pending = state.pending_confirmation;
      state.pending_confirmation = null;
      saveConvo(state);
      // Execute via a fresh agent turn that immediately calls the tool.
      const result = await executeToolDirectly(pending.tool, pending.args);
      const reply = `confirmed · ${describeAction(pending.tool, pending.args)} · ${result}`;
      state.messages.push({ role: 'user', content: text });
      state.messages.push({ role: 'assistant', content: reply });
      saveConvo(state);
      return reply;
    }
    if (['n', 'no', 'cancel'].includes(lower)) {
      const pending = state.pending_confirmation;
      state.pending_confirmation = null;
      const reply = `cancelled · ${describeAction(pending.tool, pending.args)}`;
      state.messages.push({ role: 'user', content: text });
      state.messages.push({ role: 'assistant', content: reply });
      saveConvo(state);
      return reply;
    }
    // Anything else → clear pending and fall through.
    state.pending_confirmation = null;
  }

  if (!ENV.ANTHROPIC_API_KEY) {
    return 'agent offline · ANTHROPIC_API_KEY not set';
  }

  state.messages.push({ role: 'user', content: text });

  const store = new MemoryStore(`telegram-${handle}`);
  // Replay history so the model has context
  for (const m of state.messages) {
    await store.appendMessages?.([
      { sender: m.role === 'user' ? 'user' : 'agent', text: m.content },
    ] as never);
  }

  let confirmationCaptured: { tool: string; args: Record<string, unknown> } | null = null;

  const glove = new Glove({
    store,
    model: createAdapter({
      provider: 'anthropic',
      model: ENV.MODEL,
      apiKey: ENV.ANTHROPIC_API_KEY,
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

  try {
    // mountMcp's signature accepts the runnable form; the builder is structurally compatible.
    await mountMcp(glove as never, {
      adapter: new RobotMcpAdapter(),
      entries: CATALOGUE,
      clientInfo: { name: 'overwatch-patrol/telegram', version: '0.1.0' },
    });
  } catch (e) {
    log.error('mcp.mount_failed', { error: String(e) });
    return 'agent offline · cannot reach robot MCP server';
  }

  const built = glove.build();

  // Wrap executor: intercept confirmation-required tool calls.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const exec = (built as any).executor;
  const origExec = exec?.executeTool?.bind(exec);
  if (origExec) {
    exec.executeTool = async (call: { name: string; input: Record<string, unknown> }) => {
      if (requiresConfirmation(call.name, call.input)) {
        confirmationCaptured = { tool: call.name, args: call.input };
        return {
          status: 'success',
          data: `Waiting for operator confirmation to ${describeAction(call.name, call.input)}. Tell them to reply y to confirm.`,
        };
      }
      return origExec(call);
    };
  }

  let result: Message | { messages: Message[] };
  try {
    result = await built.processRequest(text);
  } catch (e) {
    log.error('agent.error', { error: String(e) });
    return `agent error · ${String(e).slice(0, 200)}`;
  }

  const msgs: Message[] = 'messages' in result ? result.messages : [result];
  const reply = msgs.find((m) => m.sender === 'agent')?.text ?? '…';

  if (confirmationCaptured) {
    state.pending_confirmation = confirmationCaptured;
  }
  state.messages.push({ role: 'assistant', content: reply });
  saveConvo(state);
  return reply;
}

/** Confirmed-tool execution path: a one-shot MCP call. */
async function executeToolDirectly(tool: string, args: Record<string, unknown>): Promise<string> {
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
    return (j.result?.content?.map((c) => c.text).filter(Boolean).join(' ') ?? 'ok').slice(0, 400);
  } catch (e) {
    return `error: ${String(e).slice(0, 200)}`;
  }
}
