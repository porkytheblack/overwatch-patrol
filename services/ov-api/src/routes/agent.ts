/**
 * Dashboard agent routes — wraps `@overwatch/agent` for the browser UI.
 *
 * One conversation per authenticated operator. The handle is the user's
 * Lucia id, the channel is hardcoded `'dashboard'`. The persistence row
 * lives in `agent_conversations` (shared with the Telegram surface but
 * keyed by (channel, handle) so the two histories never collide).
 *
 * The 503 contract here is load-bearing: Chunk C's dashboard renders a
 * dedicated "agent offline" banner when `error === 'agent_offline'`.
 */
import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { stream } from 'hono/streaming';
import {
  ConversationStore,
  type AgentOptions,
  defaultSystemPrompt,
  describeAction,
  executeToolDirectly,
  handleMessage,
  handleMessageStream,
  resetAgent,
} from '@overwatch/agent';
import { ENV } from '../env.js';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';
import { log } from '../log.js';

const app = new Hono();

/** Build the channel-agnostic AgentOptions for the current request. */
function buildOpts(c: Context): AgentOptions {
  const user = c.get('user');
  return {
    channel: 'dashboard' as const,
    handle: user.id,
    db,
    mcpUrl: ENV.MCP_URL,
    // Guarded by `requireProvider` at every call site that hits the LLM.
    provider: ENV.AGENT!,
    systemPrompt: defaultSystemPrompt(new Date().toISOString(), 'dashboard'),
    clientInfo: { name: 'overwatch-patrol/api', version: '0.1.0' },
    logger: log,
  };
}

/**
 * Returns a 503 response when no LLM provider is configured; null
 * otherwise. Callers should `return r;` when non-null, then proceed.
 */
function requireProvider(c: Context): Response | null {
  if (!ENV.AGENT) {
    return c.json(
      {
        error: 'agent_offline',
        detail:
          'no provider configured (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY)',
      },
      503,
    );
  }
  return null;
}

const MessageBody = z.object({ text: z.string().min(1).max(8000) });

/** Buffered request/reply turn. */
app.post('/message', requireAuth, zValidator('json', MessageBody), async (c) => {
  const offline = requireProvider(c);
  if (offline) return offline;
  const { text } = c.req.valid('json');
  try {
    const reply = await handleMessage(buildOpts(c), text);
    return c.json({ text: reply.text, meta: reply.meta });
  } catch (e) {
    log.error('agent.message_failed', {
      handle: c.get('user').id,
      err: String(e),
    });
    return c.json({ error: 'agent_error', detail: String(e).slice(0, 200) }, 500);
  }
});

/**
 * SSE streaming variant of /message.
 *
 * Events emitted:
 *   - `text_delta` — partial text (v1: single chunk == full text)
 *   - `done`       — final message + meta (echoes the buffered shape so
 *                    the dashboard's optimistic UI can settle even when
 *                    the stream ends with an empty body)
 *   - `error`      — surfaced when iteration throws mid-stream
 */
app.post('/stream', requireAuth, zValidator('json', MessageBody), async (c) => {
  const offline = requireProvider(c);
  if (offline) return offline;
  const { text } = c.req.valid('json');

  c.header('Content-Type', 'text/event-stream');
  c.header('Cache-Control', 'no-cache, no-transform');
  c.header('Connection', 'keep-alive');
  // Nginx / Vercel edge sometimes coalesces SSE without this header.
  c.header('X-Accel-Buffering', 'no');

  return stream(c, async (s) => {
    // v1: handleMessageStream buffers and emits once. Real token streaming
    // requires hooking Glove's subscriber API; see
    // packages/agent/src/agent.ts for the v1 contract.
    try {
      let finalText = '';
      let finalMeta: Record<string, unknown> = {};
      for await (const event of handleMessageStream(buildOpts(c), text)) {
        if (event.type === 'message') {
          finalText = event.text;
          finalMeta = event.meta as Record<string, unknown>;
          await s.write(
            `data: ${JSON.stringify({ type: 'text_delta', text: event.text })}\n\n`,
          );
        }
      }
      await s.write(
        `data: ${JSON.stringify({
          type: 'done',
          message: { sender: 'agent', text: finalText },
          meta: finalMeta,
        })}\n\n`,
      );
    } catch (e) {
      log.error('agent.stream_failed', {
        handle: c.get('user').id,
        err: String(e),
      });
      await s.write(
        `data: ${JSON.stringify({
          type: 'error',
          message: String(e).slice(0, 200),
        })}\n\n`,
      );
    }
  });
});

const ConfirmBody = z.object({ answer: z.enum(['y', 'n']) });

/**
 * Resolve a pending confirmation outside the LLM loop.
 *
 * This intentionally mirrors `handleConfirmation` in @overwatch/agent
 * (which Telegram routes through `handleMessage`) but talks to the
 * store directly so the dashboard's y/n buttons don't burn a turn or
 * require a configured LLM provider. Matches the Telegram path
 * verbatim — same `describeAction` output, same prefixes.
 */
app.post('/confirm', requireAuth, zValidator('json', ConfirmBody), async (c) => {
  const { answer } = c.req.valid('json');
  const user = c.get('user');
  const store = new ConversationStore(db, 'dashboard', user.id);
  const pending = store.getPendingConfirmation();
  if (!pending) {
    return c.json({ error: 'no_pending_confirmation' }, 404);
  }
  const action = describeAction(pending.tool, pending.args);
  if (answer === 'y') {
    store.setPendingConfirmation(null);
    const result = await executeToolDirectly(ENV.MCP_URL, pending.tool, pending.args);
    return c.json({ ok: true, message: `confirmed · ${action} · ${result}` });
  }
  store.setPendingConfirmation(null);
  return c.json({ ok: true, message: `cancelled · ${action}` });
});

const HistoryQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/**
 * Conversation history + any pending confirmation. Returned even when
 * the provider is unset so the operator can re-read what they
 * previously sent.
 */
app.get('/history', requireAuth, zValidator('query', HistoryQuery), (c) => {
  const { limit } = c.req.valid('query');
  const user = c.get('user');
  const { messages, pending_confirmation } = ConversationStore.loadHistory(
    db,
    'dashboard',
    user.id,
  );
  const sliced = messages.length > limit ? messages.slice(-limit) : messages;
  return c.json({ messages: sliced, pending_confirmation });
});

/**
 * Cache eviction — matches Telegram's `/reset` hook semantics. The
 * persisted row stays so history is recoverable; only the in-process
 * Glove instance is discarded so the next message warms a fresh one.
 */
app.post('/reset', requireAuth, (c) => {
  const user = c.get('user');
  resetAgent('dashboard', user.id);
  return c.json({ ok: true });
});

export default app;
