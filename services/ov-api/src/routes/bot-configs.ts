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
  const cfg = JSON.parse(row.config) as { bot_token?: string; bot_username?: string };
  // Don't ship the raw token to the client — just whether it's set, plus
  // the bot's @username (not secret) so the dashboard can render the
  // "search @YourBotUsername" instruction in the claim-code flow.
  return c.json({
    channel,
    enabled: !!row.enabled,
    config: {
      bot_token_set: !!cfg.bot_token,
      bot_username: cfg.bot_username ?? null,
    },
  });
});

app.put('/:channel', zValidator('json', Telegram), (c) => {
  const channel = c.req.param('channel');
  if (channel !== 'telegram') return c.json({ error: 'unsupported_channel' }, 400);
  const body = c.req.valid('json');

  // Preserve any non-secret config fields (notably `bot_username`) that
  // ov-telegram wrote back via getMe(); the dashboard only sends the
  // token + enabled flag.
  const existing = db
    .select()
    .from(schema.botConfigs)
    .where(eq(schema.botConfigs.channel, channel))
    .get();
  const prev = existing?.config ? (JSON.parse(existing.config) as Record<string, unknown>) : {};
  const merged = { ...prev, ...body.config };
  const cfgJson = JSON.stringify(merged);

  db.insert(schema.botConfigs)
    .values({ channel, config: cfgJson, enabled: body.enabled ? 1 : 0 })
    .onConflictDoUpdate({
      target: schema.botConfigs.channel,
      set: { config: cfgJson, enabled: body.enabled ? 1 : 0 },
    })
    .run();
  return c.json({ ok: true });
});

export default app;
