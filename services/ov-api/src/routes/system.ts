import { Hono } from 'hono';
import { schema } from '@overwatch/shared-ts';
import { db } from '../db.js';
import { ENV } from '../env.js';
import { requireAuth } from '../middleware.js';
import { fanout } from '../ws.js';

const app = new Hono();

app.get('/status', requireAuth, (c) => {
  const robot = db.select().from(schema.robotStatus).get();
  return c.json({
    robot: robot ?? null,
    bridge_connected: fanout.connected,
    last_lcm_event_at: fanout.lastEventAt,
    mjpeg_url: ENV.ROBOT_MJPEG_URL,
    bridge_ws_url: ENV.BRIDGE_WS_URL,
    deep_link_ttl_hours: ENV.DEEP_LINK_TTL_HOURS,
  });
});

app.get('/health', (c) => c.json({ status: 'ok' }));

export default app;
