/**
 * SQLite-backed StoreAdapter for the Glove agent — channel-agnostic.
 *
 * Persists conversation messages to `agent_conversations.messages` keyed
 * by (channel, handle). On construction the row is loaded into memory;
 * every `appendMessages` writes back the last 20 turns.
 *
 * Two compatibility notes carried over from the original ov-telegram
 * implementation:
 *
 *  1. The original ov-telegram persistence used `{role, content}`
 *     Anthropic-style records. Glove uses `{sender: 'user'|'agent',
 *     text}`. We auto-convert old rows on load so existing chats
 *     survive the refactor.
 *
 *  2. `pending_confirmation` JSON lives in the same row but is read /
 *     written directly via `getPendingConfirmation` /
 *     `setPendingConfirmation` rather than through the StoreAdapter
 *     surface — confirmation is an ov-agent concern, not Glove's.
 *
 * The package no longer owns a `db` handle. Callers construct one with
 * `openDb()` (from `@overwatch/shared-ts`) and inject it. That lets
 * ov-api reuse its session-scoped db handle instead of opening a
 * second SQLite connection.
 */
import { and, eq } from 'drizzle-orm';
import type {
  StoreAdapter,
  Task,
  PermissionStatus,
  InboxItem,
  TokenConsumptionCounter,
} from 'glove-core';
import { schema, newId, nowIso } from '@overwatch/shared-ts';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AgentChannel, Message, PendingConfirmation } from './types.js';

const MAX_TURNS = 20;

type Db = BetterSQLite3Database<typeof schema>;

interface PersistedMessage {
  sender?: 'user' | 'agent';
  // Legacy Anthropic-style shape: {role: 'user'|'assistant', content: string}
  role?: 'user' | 'assistant';
  text?: string;
  content?: string | Message['content'];
  tool_calls?: Message['tool_calls'];
  tool_results?: Message['tool_results'];
  id?: string;
}

function normalize(raw: PersistedMessage): Message {
  if (raw.sender) {
    return {
      sender: raw.sender,
      text: raw.text ?? '',
      ...(typeof raw.content !== 'string' && raw.content ? { content: raw.content } : {}),
      ...(raw.tool_calls ? { tool_calls: raw.tool_calls } : {}),
      ...(raw.tool_results ? { tool_results: raw.tool_results } : {}),
      ...(raw.id ? { id: raw.id } : {}),
    };
  }
  // Legacy {role, content} shape — promote to glove's {sender, text}.
  const sender: 'user' | 'agent' = raw.role === 'user' ? 'user' : 'agent';
  const text = typeof raw.content === 'string' ? raw.content : raw.text ?? '';
  return { sender, text };
}

export class ConversationStore implements StoreAdapter {
  public readonly identifier: string;
  private rowId: string;
  private messages: Message[] = [];
  // In-memory token/turn counters — the SQL schema has no columns for these
  // and the agent doesn't need them to survive restarts.
  private tokensIn = 0;
  private tokensOut = 0;
  private turnCount = 0;

  constructor(
    private readonly db: Db,
    private readonly channel: AgentChannel,
    private readonly handle: string,
  ) {
    this.identifier = `${channel}-${handle}`;
    const row = db
      .select()
      .from(schema.agentConversations)
      .where(
        and(
          eq(schema.agentConversations.handle, handle),
          eq(schema.agentConversations.channel, channel),
        ),
      )
      .get();
    if (row) {
      this.rowId = row.id;
      try {
        const parsed = JSON.parse(row.messages) as PersistedMessage[];
        this.messages = parsed.map(normalize);
      } catch {
        this.messages = [];
      }
    } else {
      this.rowId = newId();
      db.insert(schema.agentConversations)
        .values({
          id: this.rowId,
          channel,
          handle,
          messages: '[]',
          pending_confirmation: null,
          last_active: nowIso(),
        })
        .run();
    }
  }

  // ── StoreAdapter required surface ──────────────────────────────────

  async getMessages(): Promise<Message[]> {
    // Return a defensive copy so callers can't mutate our internal array.
    return this.messages.slice();
  }

  async appendMessages(msgs: Array<Message>): Promise<void> {
    if (msgs.length === 0) return;
    this.messages.push(...msgs);
    // Cap at the last MAX_TURNS messages — keeps the row small without
    // dropping data mid-turn (Glove batches related messages in one
    // appendMessages call, so slicing at the end of the call is safe).
    if (this.messages.length > MAX_TURNS) {
      this.messages = this.messages.slice(-MAX_TURNS);
    }
    this.db
      .update(schema.agentConversations)
      .set({
        messages: JSON.stringify(this.messages),
        last_active: nowIso(),
      })
      .where(eq(schema.agentConversations.id, this.rowId))
      .run();
  }

  async getTokenCount(): Promise<number> {
    return this.tokensIn + this.tokensOut;
  }

  async addTokens(args: TokenConsumptionCounter): Promise<void> {
    this.tokensIn += args.tokens_in;
    this.tokensOut += args.tokens_out;
  }

  async getTurnCount(): Promise<number> {
    return this.turnCount;
  }

  async incrementTurn(): Promise<void> {
    this.turnCount += 1;
  }

  async resetCounters(): Promise<void> {
    this.tokensIn = 0;
    this.tokensOut = 0;
    this.turnCount = 0;
  }

  // ── Optional surfaces — not used here, kept as no-ops to avoid
  //    accidental `undefined.call` if Glove probes them. ─────────────

  async getTasks(): Promise<Task[]> {
    return [];
  }
  async addTasks(): Promise<void> {}
  async updateTask(): Promise<void> {}

  async getPermission(): Promise<PermissionStatus> {
    return 'granted';
  }
  async setPermission(): Promise<void> {}

  async getInboxItems(): Promise<InboxItem[]> {
    return [];
  }
  async addInboxItem(): Promise<void> {}
  async updateInboxItem(): Promise<void> {}
  async getResolvedInboxItems(): Promise<InboxItem[]> {
    return [];
  }

  // ── Confirmation helpers ───────────────────────────────────────────

  /** Read the pending-confirmation slot for this conversation (null when none). */
  getPendingConfirmation(): PendingConfirmation | null {
    const row = this.db
      .select({ pending: schema.agentConversations.pending_confirmation })
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.id, this.rowId))
      .get();
    if (!row?.pending) return null;
    try {
      return JSON.parse(row.pending) as PendingConfirmation;
    } catch {
      return null;
    }
  }

  /** Write or clear the pending-confirmation slot for this conversation. */
  setPendingConfirmation(pending: PendingConfirmation | null): void {
    this.db
      .update(schema.agentConversations)
      .set({
        pending_confirmation: pending ? JSON.stringify(pending) : null,
        last_active: nowIso(),
      })
      .where(eq(schema.agentConversations.id, this.rowId))
      .run();
  }

  /**
   * Read a (channel, handle) conversation without creating a row.
   *
   * Used by ov-api's dashboard panel to render the previous turns before
   * any new user message arrives. Returns empty when no row exists.
   */
  static loadHistory(
    db: Db,
    channel: AgentChannel,
    handle: string,
  ): { messages: Message[]; pending_confirmation: PendingConfirmation | null } {
    const row = db
      .select()
      .from(schema.agentConversations)
      .where(
        and(
          eq(schema.agentConversations.handle, handle),
          eq(schema.agentConversations.channel, channel),
        ),
      )
      .get();
    if (!row) return { messages: [], pending_confirmation: null };
    let messages: Message[] = [];
    try {
      const parsed = JSON.parse(row.messages) as PersistedMessage[];
      messages = parsed.map(normalize);
    } catch {
      messages = [];
    }
    let pending_confirmation: PendingConfirmation | null = null;
    if (row.pending_confirmation) {
      try {
        pending_confirmation = JSON.parse(row.pending_confirmation) as PendingConfirmation;
      } catch {
        pending_confirmation = null;
      }
    }
    return { messages, pending_confirmation };
  }
}
