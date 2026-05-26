import type { MiddlewareHandler } from 'hono';
import { ENV } from './env.js';

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };

function emit(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (ORDER[level] < ORDER[ENV.LOG_LEVEL as Level]) return;
  process.stdout.write(
    JSON.stringify({ ts: new Date().toISOString(), level, msg, ...fields }) + '\n',
  );
}

export const log = {
  debug: (msg: string, f?: Record<string, unknown>) => emit('debug', msg, f),
  info: (msg: string, f?: Record<string, unknown>) => emit('info', msg, f),
  warn: (msg: string, f?: Record<string, unknown>) => emit('warn', msg, f),
  error: (msg: string, f?: Record<string, unknown>) => emit('error', msg, f),
};

/** Hono middleware: structured JSON request log respecting LOG_LEVEL. */
export const httpLogger: MiddlewareHandler = async (c, next) => {
  const t0 = Date.now();
  await next();
  log.info('request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration_ms: Date.now() - t0,
  });
};
