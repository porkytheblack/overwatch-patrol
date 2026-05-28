/**
 * /api/voice route smoke tests.
 *
 * Covers the 401 / 503 paths without an ELEVENLABS_API_KEY. The happy
 * path (real mint against `api.elevenlabs.io`) is intentionally not
 * covered here — operators do that manually after wiring the key.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';

const tmp = mkdtempSync(join(tmpdir(), 'ov-api-voice-test-'));
const dbPath = join(tmp, 'test.db');

process.env.SQLITE_PATH = dbPath;
process.env.SESSION_SECRET = 'test-session-secret-1234567890';
process.env.DEEP_LINK_SECRET = 'test-deep-link-secret-1234567';
process.env.LOG_LEVEL = 'error';
// Force empty so dotenv (which only fills holes) cannot supply a real
// key from the repo-root .env; env.ts strips empty strings to
// undefined and the voice routes then take the 503 path.
process.env.ELEVENLABS_API_KEY = '';

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
const voiceRoutes = (await import('./voice.js')).default;

const app = new Hono();
app.route('/api/auth', authRoutes);
app.route('/api/voice', voiceRoutes);

let sessionId = '';

beforeAll(async () => {
  const res = await app.request('/api/auth/bootstrap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'test1234' }),
  });
  expect(res.status).toBe(200);
  sessionId = ((await res.json()) as { session_id: string }).session_id;
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('voice auth', () => {
  it('GET /api/voice/stt-token without cookie returns 401', async () => {
    const res = await app.request('/api/voice/stt-token');
    expect(res.status).toBe(401);
  });

  it('GET /api/voice/tts-token without cookie returns 401', async () => {
    const res = await app.request('/api/voice/tts-token');
    expect(res.status).toBe(401);
  });
});

describe('voice without ELEVENLABS_API_KEY', () => {
  it('GET /api/voice/stt-token returns 503 voice_offline', async () => {
    const res = await app.request('/api/voice/stt-token', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error.startsWith('voice_offline')).toBe(true);
  });

  it('GET /api/voice/tts-token returns 503 voice_offline', async () => {
    const res = await app.request('/api/voice/tts-token', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error.startsWith('voice_offline')).toBe(true);
  });
});
