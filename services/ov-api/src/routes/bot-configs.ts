import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@overwatch/shared-ts';
import { db } from '../db.js';
import { requireAuth } from '../middleware.js';

const app = new Hono();
app.use('*', requireAuth);

const Telegram = z.object({
  config: z.object({
    bot_token: z.string().min(10),
  }),
  enabled: z.boolean().default(true),
});

app.get('/:channel', (c) => {
  const channel = c.req.param('channel');
  const row = db.select().from(schema.botConfigs).where(eq(schema.botConfigs.channel, channel)).get();
  if (!row) return c.json({ channel, config: null, enabled: false });
  const cfg = JSON.parse(row.config) as { bot_token?: string };
  // Don't ship the raw token to the client — just whether it's set.
  return c.json({
    channel,
    enabled: !!row.enabled,
    config: { bot_token_set: !!cfg.bot_token },
  });
});

app.put('/:channel', zValidator('json', Telegram), (c) => {
  const channel = c.req.param('channel');
  if (channel !== 'telegram') return c.json({ error: 'unsupported_channel' }, 400);
  const body = c.req.valid('json');
  db.insert(schema.botConfigs)
    .values({ channel, config: JSON.stringify(body.config), enabled: body.enabled ? 1 : 0 })
    .onConflictDoUpdate({
      target: schema.botConfigs.channel,
      set: { config: JSON.stringify(body.config), enabled: body.enabled ? 1 : 0 },
    })
    .run();
  return c.json({ ok: true });
});

export default app;
