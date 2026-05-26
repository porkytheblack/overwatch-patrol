import { Lucia, TimeSpan } from 'lucia';
import { BetterSqlite3Adapter } from '@lucia-auth/adapter-sqlite';
import Database from 'better-sqlite3';
import argon2 from 'argon2';
import { ENV } from './env.js';

const sqlite = new Database(ENV.SQLITE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

const adapter = new BetterSqlite3Adapter(sqlite, {
  user: 'users',
  session: 'sessions',
});

export const lucia = new Lucia(adapter, {
  sessionExpiresIn: new TimeSpan(30, 'd'),
  sessionCookie: {
    name: 'ov_session',
    attributes: {
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
    expires: false,
  },
  getUserAttributes: (user: any) => ({
    username: user.username as string,
    role: user.role as string,
  }),
});

declare module 'lucia' {
  interface Register {
    Lucia: typeof lucia;
    DatabaseUserAttributes: { username: string; role: string };
  }
}

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, { type: argon2.argon2id });
}

export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}
