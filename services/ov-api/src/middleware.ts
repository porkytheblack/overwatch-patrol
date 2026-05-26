import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { lucia } from './auth.js';

export const requireAuth: MiddlewareHandler = async (c, next) => {
  const bearer = c.req.header('Authorization')?.replace(/^Bearer\s+/, '');
  const cookie = getCookie(c, lucia.sessionCookieName);
  const token = bearer ?? cookie;
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const { session, user } = await lucia.validateSession(token);
  if (!session || !user) return c.json({ error: 'unauthorized' }, 401);
  c.set('session', session);
  c.set('user', user);
  await next();
};

declare module 'hono' {
  interface ContextVariableMap {
    session: import('lucia').Session;
    user: import('lucia').User;
  }
}
