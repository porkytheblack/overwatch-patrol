/**
 * Public type surface for `@overwatch/agent`.
 *
 * Consumers (ov-telegram today, ov-api dashboard tomorrow) import from
 * here rather than reaching into glove-core directly, so the shape of a
 * "channel" or a "pending confirmation" stays in one place.
 */
import type { Message } from 'glove-core';

export type { Message };

/**
 * Which front-end the operator is talking to us through.
 *
 * The persisted conversation row uses (channel, handle) as a unique key,
 * so the same operator chatting via Telegram and via the dashboard ends
 * up with two distinct conversation histories. That is intentional —
 * different surfaces want different formatting, and merging them would
 * confuse the model about which medium it's on.
 */
export type AgentChannel = 'telegram' | 'dashboard';

/**
 * A tool call the agent wanted to run that requires explicit operator
 * confirmation before being dispatched (spec §13). When set on a
 * conversation row, the next user message is interpreted as a y/n on
 * this pending action.
 */
export interface PendingConfirmation {
  tool: string;
  args: Record<string, unknown>;
}

/**
 * Side-band data returned from `handleMessage` alongside the reply text.
 * `pending_confirmation` is populated for the turn in which the executor
 * shim trapped a confirmation-required tool call.
 */
export interface AgentReplyMeta {
  pending_confirmation?: PendingConfirmation;
}
