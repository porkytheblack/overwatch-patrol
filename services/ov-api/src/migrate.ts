import Database from 'better-sqlite3';
import { readFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ENV } from './env.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations');

const direction = process.argv[2] === 'down' ? 'down' : 'up';

mkdirSync(dirname(ENV.SQLITE_PATH), { recursive: true });
const sqlite = new Database(ENV.SQLITE_PATH);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

sqlite.exec(`
  CREATE TABLE IF NOT EXISTS _migrations (
    id TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  )
`);

const upFiles = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql') && !f.endsWith('.down.sql'))
  .sort();

if (direction === 'up') {
  const applied = new Set(
    sqlite.prepare('SELECT id FROM _migrations').all().map((r: any) => r.id as string),
  );
  for (const f of upFiles) {
    if (applied.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    console.log(`▸ applying ${f}`);
    const trx = sqlite.transaction(() => {
      sqlite.exec(sql);
      sqlite
        .prepare('INSERT INTO _migrations (id, applied_at) VALUES (?, ?)')
        .run(f, new Date().toISOString());
    });
    trx();
  }

  const rcount = (sqlite.prepare('SELECT COUNT(*) AS n FROM retention_policies').get() as { n: number }).n;
  if (rcount === 0) {
    const stmt = sqlite.prepare(
      'INSERT INTO retention_policies (id, kind, retention_days) VALUES (?, ?, ?)',
    );
    const { uuidv7 } = await import('uuidv7');
    stmt.run(uuidv7(), 'clip_incident', 90);
    stmt.run(uuidv7(), 'clip_regular', 3);
    stmt.run(uuidv7(), 'detection', 14);
    console.log('▸ seeded default retention policies');
  }
  console.log('✓ migrations complete');
} else {
  // Down: roll back the most recently applied migration.
  const last = sqlite
    .prepare('SELECT id FROM _migrations ORDER BY applied_at DESC LIMIT 1')
    .get() as { id: string } | undefined;
  if (!last) {
    console.log('no migrations to roll back');
    sqlite.close();
    process.exit(0);
  }
  const downFile = last.id.replace(/\.sql$/, '.down.sql');
  const downPath = join(MIGRATIONS_DIR, downFile);
  console.log(`▸ rolling back ${last.id}`);
  const sql = readFileSync(downPath, 'utf8');
  const trx = sqlite.transaction(() => {
    sqlite.exec(sql);
    sqlite.prepare('DELETE FROM _migrations WHERE id = ?').run(last.id);
  });
  trx();
  console.log(`✓ rolled back ${last.id}`);
}

sqlite.close();
