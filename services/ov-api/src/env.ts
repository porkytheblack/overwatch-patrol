import { config as loadDotenv } from 'dotenv';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { accessSync, constants, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load .env from the repo root so `pnpm migrate`, `pnpm seed`, and `tsx watch`
// all see operator-supplied secrets without any extra flags. In Docker
// compose the env comes from the `environment:` section and the repo-root
// .env is absent — dotenv silently no-ops.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const dotenvPath = join(repoRoot, '.env');
if (existsSync(dotenvPath)) loadDotenv({ path: dotenvPath });

// Compose env vars unset on the host come through as empty strings via
// `${VAR:-}`. zod's `.optional()` only accepts `undefined`, so normalize.
const stripped: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(process.env)) {
  stripped[k] = v === '' ? undefined : v;
}

/**
 * Resolve SQLITE_PATH to something the current process can actually write.
 *
 * - Inside Docker compose, `/data` is mounted as a tmpfs/bind volume and is
 *   writable; honour the path as-is.
 * - On a host (Mac/Linux) without root, `/data` doesn't exist and can't be
 *   created. Remap any such path to `<repoRoot>/data/<basename>` and log
 *   a warning the operator can spot.
 * - Relative paths resolve against the repo root for predictability.
 */
function resolveSqlitePath(input: string | undefined): string {
  const raw = input ?? join(repoRoot, 'data', 'overwatch.db');
  const isInDataRoot = raw.startsWith('/data/') || raw === '/data';
  if (isInDataRoot && !canWrite('/data')) {
    const remapped = join(repoRoot, 'data', basename(raw));
    process.stderr.write(
      `[env] SQLITE_PATH ${JSON.stringify(raw)} not writable on this host; ` +
        `using ${JSON.stringify(remapped)} instead. Set SQLITE_PATH in .env ` +
        `to silence this notice.\n`,
    );
    return remapped;
  }
  if (!isAbsolute(raw)) return resolve(repoRoot, raw);
  return raw;
}

function canWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    try {
      accessSync(dirname(path), constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}

const env = z
  .object({
    SQLITE_PATH: z.string().optional(),
    SESSION_SECRET: z.string().min(16),
    BRIDGE_WS_URL: z.string().default('ws://host.docker.internal:7001/events'),
    ROBOT_MJPEG_URL: z
      .string()
      .default('http://host.docker.internal:8080/video_feed/color_image'),
    DEEP_LINK_SECRET: z.string().min(16),
    DEEP_LINK_TTL_HOURS: z.coerce.number().int().positive().default(24),
    DASHBOARD_BASE_URL: z.string().default('http://localhost:3001'),
    PORT: z.coerce.number().int().positive().default(3000),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    DATA_DIR: z.string().default('/data'),
  })
  .parse(stripped);

export const ENV = {
  ...env,
  SQLITE_PATH: resolveSqlitePath(env.SQLITE_PATH),
};
export type Env = typeof ENV;
