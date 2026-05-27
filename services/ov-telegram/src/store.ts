/**
 * SQLite-backed StoreAdapter for the Glove agent.
 *
 * Persists conversation messages to `agent_conversations.messages` keyed by
 * (channel='telegram', handle=chat_id). On construction the row is loaded
 * into memory; every `appendMessages` writes back the last 20 turns.
 *
 * Two compatibility notes:
 *
 *  1. The original ov-telegram persistence used `{role, content}` Anthropic-
 *     style records. Glove uses `{sender: 'user'|'agent', text}`. We
 *     auto-convert old rows on load so existing chats survive the
 *     refactor.
 *
 *  2. `pending_confirmation` JSON lives in the same row but is read /
 *     written directly via `getPendingConfirmation` /
 *     `setPendingConfirmation` rather than through the StoreAdapter
 *     surface — confirmation is an ov-telegram concern, not Glove's.
 */
import { eq } from 'drizzle-orm';
import type {
  StoreAdapter,
  Message,
  Task,
  PermissionStatus,
  InboxItem,
  TokenConsumptionCounter,
} from 'glove-core';
import { schema, newId, nowIso } from '@overwatch/shared-ts';
import { db } from './db.js';

const MAX_TURNS = 20;

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

export interface PendingConfirmation {
  tool: string;
  args: Record<string, unknown>;
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

export class TelegramStore implements StoreAdapter {
  public readonly identifier: string;
  private rowId: string;
  private messages: Message[] = [];
  // In-memory token/turn counters — the SQL schema has no columns for these
  // and the agent doesn't need them to survive restarts.
  private tokensIn = 0;
  private tokensOut = 0;
  private turnCount = 0;

  constructor(private readonly chat_id: string) {
    this.identifier = `telegram-${chat_id}`;
    const row = db
      .select()
      .from(schema.agentConversations)
      .where(eq(schema.agentConversations.handle, chat_id))
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
          channel: 'telegram',
          handle: chat_id,
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
    db.update(schema.agentConversations)
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

  // ── ov-telegram-specific helpers ───────────────────────────────────

  /** Read the pending-confirmation slot for this chat (null when none). */
  getPendingConfirmation(): PendingConfirmation | null {
    const row = db
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

  /** Write or clear the pending-confirmation slot for this chat. */
  setPendingConfirmation(pending: PendingConfirmation | null): void {
    db.update(schema.agentConversations)
      .set({
        pending_confirmation: pending ? JSON.stringify(pending) : null,
        last_active: nowIso(),
      })
      .where(eq(schema.agentConversations.id, this.rowId))
      .run();
  }
}
