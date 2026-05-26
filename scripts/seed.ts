#!/usr/bin/env tsx
/**
 * End-to-end seeding: admin user, a couple of waypoints, a default subscriber,
 * default retention policies (migrations seed those, but this is idempotent).
 *
 * Usage:
 *   SQLITE_PATH=./data/overwatch.db tsx scripts/seed.ts \
 *     --username=admin --password=changeme --telegram-chat=123456789
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSeed = join(__dirname, '..', 'services', 'ov-api', 'src', 'seed.ts');

const args = process.argv.slice(2);
const r = spawnSync('pnpm', ['--filter', '@overwatch/api', 'seed', '--', ...args], {
  stdio: 'inherit',
  cwd: join(__dirname, '..'),
});
process.exit(r.status ?? 1);
