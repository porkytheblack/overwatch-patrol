import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema, newId, nowIso } from '@overwatch/shared-ts';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';

const app = new Hono();
app.use('*', requireAuth);

const Create = z.object({
  channel: z.literal('telegram'),
  handle: z.string().min(1).max(128),
  enabled: z.boolean().optional(),
});

app.get('/', (c) => {
  const rows = db.select().from(schema.subscribers).all();
  return c.json({ subscribers: rows.map((r) => ({ ...r, enabled: !!r.enabled })) });
});

app.post('/', zValidator('json', Create), (c) => {
  const body = c.req.valid('json');
  const id = newId();
  db.insert(schema.subscribers)
    .values({
      id,
      channel: body.channel,
      handle: body.handle,
      enabled: body.enabled === false ? 0 : 1,
      created_at: nowIso(),
    })
    .run();
  return c.json({ id }, 201);
});

app.delete('/:id', (c) => {
  const id = c.req.param('id');
  const r = db.delete(schema.subscribers).where(eq(schema.subscribers.id, id)).run();
  if (r.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.json({ ok: true });
});

export default app;
