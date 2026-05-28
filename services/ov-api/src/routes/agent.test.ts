/**
 * /api/agent route smoke tests.
 *
 * Mirrors `routes.test.ts`: bootstrap an operator, capture a session id,
 * exercise the agent routes without any real LLM provider configured.
 * The 503 shape (`{ error: 'agent_offline' }`) and the pending-
 * confirmation cancel flow are load-bearing for Chunk C's dashboard.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(join(tmpdir(), 'ov-api-agent-test-'));
const dbPath = join(tmp, 'test.db');

// Set env BEFORE importing the app so env.ts picks it up.
//
// We force every provider key to an empty string (not `delete`, not
// `undefined`) so the repo-root `.env` that dotenv loads inside env.ts
// cannot override us — dotenv only fills holes; an existing empty
// string blocks it, and env.ts's stripper turns the empty string into
// `undefined` for zod. Net effect: `ENV.AGENT` resolves to null and
// the `agent_offline` path is exercised.
process.env.SQLITE_PATH = dbPath;
process.env.SESSION_SECRET = 'test-session-secret-1234567890';
process.env.DEEP_LINK_SECRET = 'test-deep-link-secret-1234567';
process.env.LOG_LEVEL = 'error';
process.env.PROVIDER = '';
process.env.OPENROUTER_API_KEY = '';
process.env.ANTHROPIC_API_KEY = '';
process.env.OPENAI_API_KEY = '';
process.env.GEMINI_API_KEY = '';

// Apply migrations before anything reads from the db.
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
for (const f of ['0001_init.sql', '0002_claim_codes.sql']) {
  const sql = readFileSync(join(__dirname, '..', '..', 'migrations', f), 'utf8');
  sqlite.exec(sql);
}
sqlite.exec(
  `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
);
sqlite.close();

const { Hono } = await import('hono');
const authRoutes = (await import('./auth.js')).default;
const agentRoutes = (await import('./agent.js')).default;

const app = new Hono();
app.route('/api/auth', authRoutes);
app.route('/api/agent', agentRoutes);

let sessionId = '';
let userId = '';

beforeAll(async () => {
  const res = await app.request('/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test1234' }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    session_id: string;
    user: { id: string };
  };
  sessionId = body.session_id;
  userId = body.user.id;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('agent auth', () => {
  it('POST /api/agent/message without cookie returns 401', async () => {
    const res = await app.request('/api/agent/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'hi' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('agent without configured provider', () => {
  it('POST /api/agent/message returns 503 agent_offline', async () => {
    const res = await app.request('/api/agent/message', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; detail?: string };
    expect(body.error).toBe('agent_offline');
    expect(typeof body.detail).toBe('string');
  });

  it('POST /api/agent/stream returns 503 agent_offline (no stream opened)', async () => {
    const res = await app.request('/api/agent/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ text: 'hello' }),
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('agent_offline');
  });

  it('POST /api/agent/reset works regardless of provider', async () => {
    const res = await app.request('/api/agent/reset', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });
});

describe('agent history', () => {
  it('returns empty messages + null pending for a fresh operator', async () => {
    const res = await app.request('/api/agent/history', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      messages: unknown[];
      pending_confirmation: unknown;
    };
    expect(body.messages).toEqual([]);
    expect(body.pending_confirmation).toBeNull();
  });

  it('rejects out-of-range limit (zod 400)', async () => {
    const res = await app.request('/api/agent/history?limit=0', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(400);
  });
});

describe('agent confirm', () => {
  // Seed pending rows via raw SQL so we don't need an LLM. The router's
  // confirm path is independent of `handleMessage` by design.
  function seedPending(handle: string, pending: { tool: string; args: unknown }) {
    const s = new Database(dbPath);
    // The store creates the row lazily on first message; we either
    // INSERT it ourselves, or UPDATE if a prior test already created
    // it. Use INSERT OR REPLACE keyed by the unique (channel, handle).
    const now = new Date().toISOString();
    s.prepare(
      `INSERT INTO agent_conversations (id, channel, handle, messages, pending_confirmation, last_active)
       VALUES (?, 'dashboard', ?, '[]', ?, ?)
       ON CONFLICT(channel, handle) DO UPDATE SET pending_confirmation = excluded.pending_confirmation, last_active = excluded.last_active`,
    ).run(`row-${handle}`, handle, JSON.stringify(pending), now);
    s.close();
  }

  function clearPending(handle: string) {
    const s = new Database(dbPath);
    s.prepare(
      `UPDATE agent_conversations SET pending_confirmation = NULL WHERE channel = 'dashboard' AND handle = ?`,
    ).run(handle);
    s.close();
  }

  it('returns 404 when nothing is pending', async () => {
    clearPending(userId);
    const res = await app.request('/api/agent/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ answer: 'n' }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('no_pending_confirmation');
  });

  it('cancels (n) a seeded pending confirmation', async () => {
    seedPending(userId, {
      tool: 'execute_sport_command',
      args: { command_name: 'Backflip' },
    });
    const res = await app.request('/api/agent/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ answer: 'n' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(true);
    expect(body.message.startsWith('cancelled · ')).toBe(true);
    expect(body.message).toContain('execute Backflip');

    // Second call with the same answer returns 404 — pending was cleared.
    const again = await app.request('/api/agent/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ answer: 'n' }),
    });
    expect(again.status).toBe(404);
  });

  it('rejects malformed answer (zod 400)', async () => {
    const res = await app.request('/api/agent/confirm', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ answer: 'maybe' }),
    });
    expect(res.status).toBe(400);
  });
});
