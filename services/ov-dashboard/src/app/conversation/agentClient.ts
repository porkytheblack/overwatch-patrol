'use client';
/**
 * Browser-side wrappers for the `/api/agent/*` routes.
 *
 * Every helper throws a plain `Error` with an extra `.status` property
 * so callers can branch on the HTTP code (503 for `agent_offline`, 500
 * for `agent_error`, 404 for `no_pending_confirmation`, ...) without
 * having to parse the message string.
 *
 * v1 uses the buffered `/api/agent/message` endpoint — one round-trip
 * per turn. The upgrade path is `/api/agent/stream` (SSE), already
 * wired on the server side; flip this file when the UI grows tolerance
 * for partial bubbles. The server's `/stream` route emits `text_delta`
 * and `done` events that map cleanly onto an EventSource consumer.
 */
import type { Message, PendingConfirmation } from '@overwatch/agent';

export interface AgentApiError extends Error {
  status: number;
}

function makeError(status: number, body: unknown): AgentApiError {
  const err = new Error(
    (body as { error?: string })?.error ?? `HTTP ${status}`,
  ) as AgentApiError;
  err.status = status;
  return err;
}

async function readJson(r: Response): Promise<unknown> {
  // Some 5xx bodies are HTML; tolerate that and surface a sane error.
  try {
    return await r.json();
  } catch {
    return {};
  }
}

export interface SendMessageReply {
  text: string;
  meta: { pending_confirmation?: PendingConfirmation };
}

/** POST /api/agent/message — buffered one-shot turn. */
export async function sendMessage(text: string): Promise<SendMessageReply> {
  const r = await fetch('/api/agent/message', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!r.ok) throw makeError(r.status, await readJson(r));
  return (await r.json()) as SendMessageReply;
}

export interface ConfirmReply {
  ok: true;
  message: string;
}

/** POST /api/agent/confirm — resolves a pending y/n. */
export async function confirm(answer: 'y' | 'n'): Promise<ConfirmReply> {
  const r = await fetch('/api/agent/confirm', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  if (!r.ok) throw makeError(r.status, await readJson(r));
  return (await r.json()) as ConfirmReply;
}

/** POST /api/agent/reset — clears the in-process Glove cache. */
export async function reset(): Promise<void> {
  const r = await fetch('/api/agent/reset', {
    method: 'POST',
    credentials: 'include',
  });
  if (!r.ok) throw makeError(r.status, await readJson(r));
}

export type { Message, PendingConfirmation };
