/**
 * Surveillance control routes.
 *
 * Thin proxies over the robot's dimos MCP server. The dashboard uses
 * these for the START/STOP/PAUSE/RESUME patrol buttons (spec DoD
 * step 5). The Telegram agent has its own MCP path; this duplication is
 * intentional — keeping ov-api as the single source of truth for the
 * browser means no MCP creds or URLs leak to the client.
 */
import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { newId } from '@overwatch/shared-ts';
import { ENV } from '../env.js';
import { requireAuth } from '../middleware.js';
import { log } from '../log.js';

const app = new Hono();

interface McpToolCallResult {
  result?: { content?: Array<{ text?: string }>; isError?: boolean };
  error?: { message?: string };
}

async function callMcp(name: string, args: Record<string, unknown> = {}): Promise<{
  ok: boolean;
  text: string;
  status: number;
}> {
  let res: Response;
  try {
    res = await fetch(ENV.MCP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: newId(),
        method: 'tools/call',
        params: { name, arguments: args },
      }),
    });
  } catch (e) {
    log.warn('mcp.unreachable', { name, err: String(e) });
    return { ok: false, text: 'robot unreachable', status: 502 };
  }
  if (!res.ok) {
    return { ok: false, text: `mcp ${res.status}`, status: 502 };
  }
  const body = (await res.json()) as McpToolCallResult;
  if (body.error?.message) {
    return { ok: false, text: body.error.message, status: 502 };
  }
  const text =
    body.result?.content
      ?.map((c) => c.text)
      .filter(Boolean)
      .join(' ') ?? 'ok';
  return { ok: !body.result?.isError, text: text.slice(0, 400), status: 200 };
}

/**
 * Patrol state-machine commands. Routed through the bridge's
 * `/patrol` endpoint (LCM `/ow/patrol_command`) — SurveillanceModule
 * subscribes and pokes its core directly.
 *
 * We used to call MCP `start_surveillance` / `stop_surveillance` /
 * `pause_patrol` / `resume_patrol` here, but the dimos RPC backplane
 * hangs for up to 120s on the cellular relay path, freezing the
 * dashboard's PatrolControls button until the operator refreshes.
 * The MCP @skills still exist for the Telegram agent — the dashboard
 * just doesn't go through them anymore.
 */
async function patrolAction(c: any, action: 'start' | 'stop' | 'pause' | 'resume') {
  // Same 3s ceiling as /sport — bridge is fire-and-forget.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${ENV.BRIDGE_HTTP_URL}/patrol`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return c.json({ error: 'bridge_error', detail: text.slice(0, 200) }, 502);
    }
    return c.json({ ok: true, message: `${action} sent` });
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    log.warn('patrol.bridge_unreachable', { err: String(e), aborted, action });
    return c.json(
      { error: aborted ? 'bridge_timeout' : 'bridge_unreachable' },
      502,
    );
  } finally {
    clearTimeout(t);
  }
}

app.post('/start', requireAuth, (c) => patrolAction(c, 'start'));
app.post('/stop', requireAuth, (c) => patrolAction(c, 'stop'));
app.post('/pause', requireAuth, (c) => patrolAction(c, 'pause'));
app.post('/resume', requireAuth, (c) => patrolAction(c, 'resume'));

const MoveBody = z.object({
  forward: z.number().min(-2).max(2).default(0),
  left: z.number().min(-2).max(2).default(0),
  degrees: z.number().min(-360).max(360).default(0),
});

const CmdVelBody = z.object({
  linear_x: z.number().min(-2).max(2).default(0),
  linear_y: z.number().min(-2).max(2).default(0),
  angular_z: z.number().min(-3).max(3).default(0),
});

/**
 * Velocity teleop — proxies to ov-bridge which publishes an LCM Twist.
 * The dashboard streams at ~10 Hz while a key is held; Go2's
 * `cmd_vel_timeout=0.2s` auto-halts the moment we stop publishing, so
 * there's no `release` event to handle.
 */
app.post('/cmd_vel', requireAuth, zValidator('json', CmdVelBody), async (c) => {
  const body = c.req.valid('json');
  try {
    const res = await fetch(`${ENV.BRIDGE_HTTP_URL}/cmd_vel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return c.json({ error: 'bridge_error', detail: text.slice(0, 200) }, 502);
    }
    return c.json({ ok: true });
  } catch (e) {
    log.warn('cmd_vel.bridge_unreachable', { err: String(e) });
    return c.json({ error: 'bridge_unreachable' }, 502);
  }
});

/** Manual drive — small relative_move steps so click-spam stays safe. */
app.post('/move', requireAuth, zValidator('json', MoveBody), async (c) => {
  const args = c.req.valid('json');
  const r = await callMcp('relative_move', args);
  if (!r.ok) return c.json({ error: r.text }, r.status as 200 | 502);
  return c.json({ ok: true, message: r.text });
});

app.post('/halt', requireAuth, async (c) => {
  const r = await callMcp('stop_navigation');
  if (!r.ok) return c.json({ error: r.text }, r.status as 200 | 502);
  return c.json({ ok: true, message: r.text });
});

const SportBody = z.object({
  command: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9]+$/, 'alphanumeric only'),
});

/**
 * Run a Go2 sport-mode skill. The common ones: RecoveryStand (get up
 * after a fall), BalanceStand (re-engage active stance), Sit, StandUp,
 * Stretch, Hello, FreeWalk.
 *
 * Goes through the bridge's `/sport` endpoint rather than MCP — the
 * dimos RPC backplane on the 4G relay can hang for up to 120s on
 * `execute_sport_command`, which made the dashboard's SportPanel
 * buttons feel broken. The bridge publishes an `/ow/sport_request`
 * LCM event; SurveillanceModule subscribes and pokes the WebRTC
 * channel directly via its GO2ConnectionSpec injection. Round-trip
 * is sub-second.
 */
app.post('/sport', requireAuth, zValidator('json', SportBody), async (c) => {
  const { command } = c.req.valid('json');
  // Hard 3s ceiling on the bridge call. The bridge endpoint itself
  // is fire-and-forget (just publishes to LCM), so a healthy roundtrip
  // is <50ms. Anything longer means the bridge is wedged and we don't
  // want to hold the dashboard's HTTP connection waiting.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${ENV.BRIDGE_HTTP_URL}/sport`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return c.json({ error: 'bridge_error', detail: text.slice(0, 200) }, 502);
    }
    return c.json({ ok: true, message: `${command} sent` });
  } catch (e) {
    const aborted = (e as { name?: string })?.name === 'AbortError';
    log.warn('sport.bridge_unreachable', { err: String(e), aborted });
    return c.json(
      { error: aborted ? 'bridge_timeout' : 'bridge_unreachable' },
      502,
    );
  } finally {
    clearTimeout(t);
  }
});

const AddWaypointBody = z.object({
  name: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9 _-]+$/, 'letters, digits, space, _ or - only'),
});

/** Captures current odom pose into dimos SpatialMemory + ov-bridge SQLite. */
app.post(
  '/waypoints',
  requireAuth,
  zValidator('json', AddWaypointBody),
  async (c) => {
    const { name } = c.req.valid('json');
    const r = await callMcp('add_waypoint', { name });
    if (!r.ok) return c.json({ error: r.text }, r.status as 200 | 502);
    return c.json({ ok: true, message: r.text });
  },
);

app.get('/state', requireAuth, async (c) => {
  const r = await callMcp('get_robot_state');
  if (!r.ok) return c.json({ error: r.text }, r.status as 200 | 502);
  // The skill returns a JSON string; pass it through as-is so the client
  // can render whatever the robot reports today.
  try {
    return c.json(JSON.parse(r.text));
  } catch {
    return c.json({ raw: r.text });
  }
});

export default app;
