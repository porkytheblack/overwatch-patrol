import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { setCookie, deleteCookie } from 'hono/cookie';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { schema } from '@overwatch/shared-ts';
import { newId, nowIso } from '@overwatch/shared-ts';
import { db } from '../db.js';
import { lucia, hashPassword, verifyPassword } from '../auth.js';
import { requireAuth } from '../middleware.js';

const app = new Hono();

const credentials = z.object({
  username: z.string().min(2).max(64),
  password: z.string().min(8).max(256),
});

/** First-boot wizard: returns whether any user exists. */
app.get('/needs-setup', (c) => {
  const row = db
    .select({ id: schema.users.id })
    .from(schema.users)
    .limit(1)
    .all();
  return c.json({ needs_setup: row.length === 0 });
});

/** Create the very first operator (only callable when no users exist). */
app.post('/bootstrap', zValidator('json', credentials), async (c) => {
  const row = db.select({ id: schema.users.id }).from(schema.users).limit(1).all();
  if (row.length > 0) return c.json({ error: 'already_initialised' }, 409);

  const { username, password } = c.req.valid('json');
  const hash = await hashPassword(password);
  const id = newId();
  db.insert(schema.users)
    .values({
      id,
      username,
      password_hash: hash,
      role: 'operator',
      created_at: nowIso(),
    })
    .run();

  const session = await lucia.createSession(id, {});
  const cookie = lucia.createSessionCookie(session.id);
  setCookie(c, cookie.name, cookie.value, cookie.attributes as any);
  return c.json({ session_id: session.id, user: { id, username, role: 'operator' } });
});

app.post('/login', zValidator('json', credentials), async (c) => {
  const { username, password } = c.req.valid('json');
  const rows = db
    .select()
    .from(schema.users)
    .where(eq(schema.users.username, username))
    .all();
  const user = rows[0];
  if (!user) return c.json({ error: 'invalid_credentials' }, 401);
  if (!(await verifyPassword(user.password_hash, password))) {
    return c.json({ error: 'invalid_credentials' }, 401);
  }
  const session = await lucia.createSession(user.id, {});
  const cookie = lucia.createSessionCookie(session.id);
  setCookie(c, cookie.name, cookie.value, cookie.attributes as any);
  return c.json({
    session_id: session.id,
    user: { id: user.id, username: user.username, role: user.role },
  });
});

app.post('/logout', requireAuth, async (c) => {
  const session = c.get('session');
  await lucia.invalidateSession(session.id);
  const blank = lucia.createBlankSessionCookie();
  deleteCookie(c, blank.name, blank.attributes as any);
  return c.json({ ok: true });
});

app.get('/me', requireAuth, (c) => {
  const user = c.get('user');
  return c.json({ user });
});

export default app;
