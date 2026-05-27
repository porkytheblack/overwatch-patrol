import { Hono } from 'hono';
import { schema } from '@overwatch/shared-ts';
import { db } from '../db.js';
import { ENV } from '../env.js';
import { requireAuth } from '../middleware.js';
import { fanout } from '../ws.js';
import { log } from '../log.js';

const app = new Hono();

app.get('/status', requireAuth, (c) => {
  const robot = db.select().from(schema.robotStatus).get();
  return c.json({
    robot: robot ?? null,
    bridge_connected: fanout.connected,
    last_lcm_event_at: fanout.lastEventAt,
    // Same-origin proxy URL: the browser can't reach the robot's MJPEG
    // host directly (host.docker.internal doesn't resolve outside Docker,
    // and even on a LAN the robot may sit behind auth). The proxy below
    // streams ROBOT_MJPEG_URL through ov-api with the operator's session.
    mjpeg_url: '/api/system/mjpeg',
    bridge_ws_url: ENV.BRIDGE_WS_URL,
    deep_link_ttl_hours: ENV.DEEP_LINK_TTL_HOURS,
  });
});

/**
 * Live MJPEG proxy.
 *
 * Upstream is `multipart/x-mixed-replace; boundary=...` and stays open for
 * the lifetime of the viewer. We pipe `response.body` (a Web ReadableStream)
 * back to the client, forwarding the upstream Content-Type so the browser
 * keeps parsing frames, and abort the upstream fetch if the client closes
 * the connection (otherwise we'd leak sockets to the robot).
 */
app.get('/mjpeg', requireAuth, async (c) => {
  const upstream = ENV.ROBOT_MJPEG_URL;
  const ctrl = new AbortController();
  c.req.raw.signal?.addEventListener('abort', () => ctrl.abort(), { once: true });

  let upstreamRes: Response;
  try {
    upstreamRes = await fetch(upstream, { signal: ctrl.signal });
  } catch (err) {
    log.warn('mjpeg.upstream_unreachable', { upstream, err: String(err) });
    return c.json({ error: 'robot_unreachable', upstream }, 502);
  }

  if (!upstreamRes.ok || !upstreamRes.body) {
    log.warn('mjpeg.upstream_status', { upstream, status: upstreamRes.status });
    return c.json({ error: 'upstream_error', status: upstreamRes.status }, 502);
  }

  const contentType =
    upstreamRes.headers.get('content-type') ?? 'multipart/x-mixed-replace';
  c.header('Content-Type', contentType);
  c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
  c.header('Pragma', 'no-cache');
  return c.body(upstreamRes.body);
});

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
