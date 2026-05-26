import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { asc, eq, sql } from 'drizzle-orm';
import { schema, newId, nowIso } from '@overwatch/shared-ts';
import { DetectionWindow } from '@overwatch/schemas';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';

const app = new Hono();
app.use('*', requireAuth);

const Create = z.object({
  name: z.string().min(1).max(80),
  pose_x: z.number(),
  pose_y: z.number(),
  pose_yaw: z.number(),
  scene_description: z.string().optional(),
  targets: z.array(z.string()).default([]),
  detection_window: DetectionWindow.optional(),
  linger_threshold_seconds: z.number().int().positive().optional(),
  inspection_dwell_seconds: z.number().int().positive().optional(),
  min_standoff_m: z.number().positive().optional(),
  enabled: z.boolean().optional(),
});

const Patch = Create.partial();

app.get('/', (c) => {
  const rows = db.select().from(schema.waypoints).orderBy(asc(schema.waypoints.order_index)).all();
  return c.json({
    waypoints: rows.map((w) => ({
      ...w,
      targets: JSON.parse(w.targets),
      detection_window: JSON.parse(w.detection_window),
      enabled: !!w.enabled,
    })),
  });
});

app.post('/', zValidator('json', Create), (c) => {
  const body = c.req.valid('json');
  const id = newId();
  const max = db
    .select({ m: sql<number>`COALESCE(MAX(${schema.waypoints.order_index}), -1)` })
    .from(schema.waypoints)
    .get();
  const next_idx = (max?.m ?? -1) + 1;
  db.insert(schema.waypoints)
    .values({
      id,
      name: body.name,
      pose_x: body.pose_x,
      pose_y: body.pose_y,
      pose_yaw: body.pose_yaw,
      scene_description: body.scene_description ?? '',
      targets: JSON.stringify(body.targets),
      detection_window: JSON.stringify(body.detection_window ?? { type: 'always' }),
      linger_threshold_seconds: body.linger_threshold_seconds ?? 5,
      inspection_dwell_seconds: body.inspection_dwell_seconds ?? 4,
      min_standoff_m: body.min_standoff_m ?? 1.5,
      order_index: next_idx,
      enabled: body.enabled === false ? 0 : 1,
      created_at: nowIso(),
    })
    .run();
  return c.json({ id }, 201);
});

app.patch('/:id', zValidator('json', Patch), (c) => {
  const id = c.req.param('id');
  const body = c.req.valid('json');
  const update: Record<string, any> = {};
  for (const k of [
    'name',
    'pose_x',
    'pose_y',
    'pose_yaw',
    'scene_description',
    'linger_threshold_seconds',
    'inspection_dwell_seconds',
    'min_standoff_m',
  ] as const) {
    if (body[k] !== undefined) update[k] = body[k];
  }
  if (body.targets !== undefined) update.targets = JSON.stringify(body.targets);
  if (body.detection_window !== undefined)
    update.detection_window = JSON.stringify(body.detection_window);
  if (body.enabled !== undefined) update.enabled = body.enabled ? 1 : 0;

  if (Object.keys(update).length === 0) return c.json({ ok: true });
  const r = db.update(schema.waypoints).set(update).where(eq(schema.waypoints.id, id)).run();
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const r = db.delete(schema.waypoints).where(eq(schema.waypoints.id, id)).run();
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

app.post('/reorder', zValidator('json', z.object({ ids: z.array(z.string()) })), (c) => {
  const { ids } = c.req.valid('json');
  const stmt = db.update(schema.waypoints);
  // Run inside a manual transaction for atomicity.
  // drizzle better-sqlite3 sync transactions:
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (db as any).transaction((tx: typeof db) => {
    ids.forEach((id, idx) => {
      tx.update(schema.waypoints).set({ order_index: idx }).where(eq(schema.waypoints.id, id)).run();
    });
  });
  void stmt;
  return c.json({ ok: true });
});

export default app;
