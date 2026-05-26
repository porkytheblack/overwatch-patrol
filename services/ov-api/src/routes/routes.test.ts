/**
 * Smoke tests for the principal API routes.
 *
 * Runs against an in-memory SQLite via better-sqlite3 by pointing
 * SQLITE_PATH at a tmpfile before importing the app modules.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const tmp = mkdtempSync(join(tmpdir(), 'ov-api-test-'));
const dbPath = join(tmp, 'test.db');

// Set env BEFORE importing the app so env.ts picks it up.
process.env.SQLITE_PATH = dbPath;
process.env.SESSION_SECRET = 'test-session-secret-1234567890';
process.env.DEEP_LINK_SECRET = 'test-deep-link-secret-1234567';
process.env.LOG_LEVEL = 'error';

// Apply migrations
const sqlite = new Database(dbPath);
sqlite.pragma('foreign_keys = ON');
const sql = readFileSync(
  join(__dirname, '..', '..', 'migrations', '0001_init.sql'),
  'utf8',
);
sqlite.exec(sql);
sqlite.exec(
  `CREATE TABLE IF NOT EXISTS _migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)`,
);
sqlite.close();

const { Hono } = await import('hono');
const authRoutes = (await import('./auth.js')).default;
const waypointRoutes = (await import('./waypoints.js')).default;
const incidentRoutes = (await import('./incidents.js')).default;
const subscriberRoutes = (await import('./subscribers.js')).default;
const botConfigRoutes = (await import('./bot-configs.js')).default;
const systemRoutes = (await import('./system.js')).default;

const app = new Hono();
app.get('/health', (c) => c.json({ status: 'ok' }));
app.route('/api/auth', authRoutes);
app.route('/api/waypoints', waypointRoutes);
app.route('/api/incidents', incidentRoutes);
app.route('/api/subscribers', subscriberRoutes);
app.route('/api/bot-configs', botConfigRoutes);
app.route('/api/system', systemRoutes);

let sessionId = '';

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('auth', () => {
  it('returns needs_setup=true before bootstrap', async () => {
    const res = await app.request('/api/auth/needs-setup');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { needs_setup: boolean };
    expect(body.needs_setup).toBe(true);
  });

  it('bootstrap creates the initial operator', async () => {
    const res = await app.request('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test1234' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { session_id: string };
    sessionId = body.session_id;
    expect(sessionId.length).toBeGreaterThan(20);
  });

  it('bootstrap twice returns 409', async () => {
    const res = await app.request('/api/auth/bootstrap', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin2', password: 'test1234' }),
    });
    expect(res.status).toBe(409);
  });

  it('login returns a session', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'test1234' }),
    });
    expect(res.status).toBe(200);
  });

  it('login with wrong password returns 401', async () => {
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrongpass' }),
    });
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me requires auth', async () => {
    const res = await app.request('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /api/auth/me works with bearer', async () => {
    const res = await app.request('/api/auth/me', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('waypoints CRUD', () => {
  let waypointId = '';

  it('list is empty', async () => {
    const res = await app.request('/api/waypoints', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { waypoints: any[] };
    expect(body.waypoints).toEqual([]);
  });

  it('creates a waypoint', async () => {
    const res = await app.request('/api/waypoints', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({
        name: 'front_gate',
        pose_x: 1.0,
        pose_y: 2.0,
        pose_yaw: 0.0,
        targets: ['person'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    waypointId = body.id;
  });

  it('patches a waypoint', async () => {
    const res = await app.request(`/api/waypoints/${waypointId}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ linger_threshold_seconds: 10 }),
    });
    expect(res.status).toBe(200);
  });

  it('lists with the new waypoint', async () => {
    const res = await app.request('/api/waypoints', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    const body = (await res.json()) as { waypoints: any[] };
    expect(body.waypoints).toHaveLength(1);
    expect(body.waypoints[0].linger_threshold_seconds).toBe(10);
  });

  it('deletes a waypoint', async () => {
    const res = await app.request(`/api/waypoints/${waypointId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('incidents', () => {
  it('empty list returns empty array', async () => {
    const res = await app.request('/api/incidents', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { incidents: any[] };
    expect(body.incidents).toEqual([]);
  });

  it('detail returns 404 for missing id', async () => {
    const res = await app.request('/api/incidents/missing-id', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(404);
  });

  it('playback requires a token', async () => {
    const res = await app.request('/api/incidents/x/playback');
    expect(res.status).toBe(401);
  });

  it('playback with bad token returns 401', async () => {
    const res = await app.request('/api/incidents/x/playback?token=invalid');
    expect(res.status).toBe(401);
  });
});

describe('subscribers', () => {
  let id = '';
  it('creates a subscriber', async () => {
    const res = await app.request('/api/subscribers', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ channel: 'telegram', handle: '12345678', enabled: true }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    id = body.id;
  });

  it('lists subscribers', async () => {
    const res = await app.request('/api/subscribers', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    const body = (await res.json()) as { subscribers: any[] };
    expect(body.subscribers.length).toBeGreaterThan(0);
  });

  it('deletes a subscriber', async () => {
    const res = await app.request(`/api/subscribers/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('bot-configs', () => {
  it('stores a telegram bot config', async () => {
    const res = await app.request('/api/bot-configs/telegram', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionId}`,
      },
      body: JSON.stringify({ config: { bot_token: 'fake-token-1234567890' }, enabled: true }),
    });
    expect(res.status).toBe(200);
  });

  it('does not leak the raw token on GET', async () => {
    const res = await app.request('/api/bot-configs/telegram', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    const body = (await res.json()) as { config: { bot_token_set: boolean } | null };
    expect(body.config?.bot_token_set).toBe(true);
    expect(JSON.stringify(body)).not.toContain('fake-token-1234567890');
  });
});

describe('system', () => {
  it('status returns aggregated info', async () => {
    const res = await app.request('/api/system/status', {
      headers: { Authorization: `Bearer ${sessionId}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty('bridge_connected');
    expect(body).toHaveProperty('last_lcm_event_at');
    expect(body).toHaveProperty('mjpeg_url');
  });

  it('health is unauthenticated', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
  });
});
