import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import { schema, nowIso, signDeepLink, verifyDeepLink } from '@overwatch/shared-ts';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';
import { ENV } from '../env.js';

const app = new Hono();

const List = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  status: z.enum(['open', 'closed', 'suppressed', 'acknowledged', 'all']).default('all'),
  waypoint_id: z.string().optional(),
  cursor: z.string().optional(),
  // Calendar view loads a full month of incident metadata in one shot
  // (spec §10.4: 1000 incidents / month in <500ms). 5000 leaves
  // operator-defined retention some headroom; smaller default still
  // protects /incidents pagination.
  limit: z.coerce.number().int().positive().max(5000).default(50),
});

app.get('/', requireAuth, zValidator('query', List), (c) => {
  const q = c.req.valid('query');
  const filters: any[] = [];
  if (q.from) filters.push(gte(schema.incidents.opened_at, q.from));
  if (q.to) filters.push(lte(schema.incidents.opened_at, q.to));
  if (q.status !== 'all') filters.push(eq(schema.incidents.status, q.status));
  if (q.waypoint_id) filters.push(eq(schema.incidents.waypoint_id, q.waypoint_id));
  if (q.cursor) filters.push(sql`${schema.incidents.opened_at} < ${q.cursor}`);

  const rows = db
    .select({
      i: schema.incidents,
      waypoint_name: schema.waypoints.name,
    })
    .from(schema.incidents)
    .leftJoin(schema.waypoints, eq(schema.waypoints.id, schema.incidents.waypoint_id))
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(desc(schema.incidents.opened_at))
    .limit(q.limit + 1)
    .all();

  const has_more = rows.length > q.limit;
  const slice = rows.slice(0, q.limit);
  const next_cursor = has_more ? slice[slice.length - 1].i.opened_at : null;

  return c.json({
    incidents: slice.map((r) => ({
      ...r.i,
      classes: JSON.parse(r.i.classes),
      waypoint_name: r.waypoint_name,
    })),
    next_cursor,
  });
});

app.get('/:id', requireAuth, (c) => {
  const id = c.req.param('id');
  const row = db
    .select({ i: schema.incidents, waypoint_name: schema.waypoints.name })
    .from(schema.incidents)
    .leftJoin(schema.waypoints, eq(schema.waypoints.id, schema.incidents.waypoint_id))
    .where(eq(schema.incidents.id, id))
    .get();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const detections = db
    .select()
    .from(schema.detections)
    .where(eq(schema.detections.incident_id, id))
    .orderBy(schema.detections.ts)
    .all();
  return c.json({
    incident: {
      ...row.i,
      classes: JSON.parse(row.i.classes),
      waypoint_name: row.waypoint_name,
      deep_link_token: signDeepLink(id, ENV.DEEP_LINK_SECRET, ENV.DEEP_LINK_TTL_HOURS),
    },
    detections: detections.map((d) => ({ ...d, bbox: JSON.parse(d.bbox) })),
  });
});

app.post('/:id/acknowledge', requireAuth, (c) => {
  const id = c.req.param('id');
  const user = c.get('user');
  const r = db
    .update(schema.incidents)
    .set({
      status: 'acknowledged',
      acknowledged_by: user.id,
      acknowledged_at: nowIso(),
    })
    .where(eq(schema.incidents.id, id))
    .run();
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

/** Public: signed-token-gated incident playback page payload. */
app.get('/:id/playback', (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');
  if (!token) return c.json({ error: 'missing_token' }, 401);
  const payload = verifyDeepLink(token, ENV.DEEP_LINK_SECRET);
  if (!payload || payload.incident_id !== id) return c.json({ error: 'invalid_token' }, 401);
  const row = db
    .select({ i: schema.incidents, waypoint_name: schema.waypoints.name })
    .from(schema.incidents)
    .leftJoin(schema.waypoints, eq(schema.waypoints.id, schema.incidents.waypoint_id))
    .where(eq(schema.incidents.id, id))
    .get();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({
    incident: {
      ...row.i,
      classes: JSON.parse(row.i.classes),
      waypoint_name: row.waypoint_name,
    },
    clip_url: `/api/incidents/${id}/clip?token=${encodeURIComponent(token)}`,
    poster_url: `/api/incidents/${id}/poster?token=${encodeURIComponent(token)}`,
  });
});

function streamFile(c: any, path: string, mime: string) {
  if (!existsSync(path)) return c.notFound();
  const stat = statSync(path);
  c.header('Content-Type', mime);
  c.header('Content-Length', String(stat.size));
  c.header('Accept-Ranges', 'bytes');
  // Node-style stream → web stream
  const node = createReadStream(path);
  return c.body(Readable.toWeb(node) as unknown as ReadableStream);
}

app.get('/:id/clip', (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');
  if (token) {
    const payload = verifyDeepLink(token, ENV.DEEP_LINK_SECRET);
    if (!payload || payload.incident_id !== id) return c.json({ error: 'invalid_token' }, 401);
  } else {
    // require auth if no token
    const hdr = c.req.header('Authorization');
    if (!hdr) return c.json({ error: 'unauthorized' }, 401);
  }
  const row = db.select().from(schema.incidents).where(eq(schema.incidents.id, id)).get();
  if (!row?.clip_path) return c.json({ error: 'not_ready' }, 404);
  return streamFile(c, row.clip_path, 'video/mp4');
});

app.get('/:id/poster', (c) => {
  const id = c.req.param('id');
  const token = c.req.query('token');
  if (token) {
    const payload = verifyDeepLink(token, ENV.DEEP_LINK_SECRET);
    if (!payload || payload.incident_id !== id) return c.json({ error: 'invalid_token' }, 401);
  }
  const row = db.select().from(schema.incidents).where(eq(schema.incidents.id, id)).get();
  if (!row?.poster_path) return c.json({ error: 'not_ready' }, 404);
  return streamFile(c, row.poster_path, 'image/jpeg');
});

export default app;
