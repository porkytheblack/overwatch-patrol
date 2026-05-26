import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '@overwatch/schemas/tables';

export type Db = BetterSQLite3Database<typeof schema>;

export function openDb(path: string, opts: { readonly?: boolean } = {}): Db {
  const sqlite = new Database(path, { readonly: opts.readonly ?? false });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  return drizzle(sqlite, { schema });
}

export { schema };
