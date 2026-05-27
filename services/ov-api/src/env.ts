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

/**
 * `host.docker.internal` resolves only inside Docker containers. On a bare
 * macOS / Linux host (e.g. `make dev-host`), any URL pointing at it would
 * raise ENOTFOUND. We use the same in-container heuristic as the SQLITE
 * remap (writable `/data`) and rewrite the host portion to `localhost` so
 * outbound fetches/WS connects work without forcing the operator to keep
 * two .env files in sync.
 */
const IN_CONTAINER = canWrite('/data');
let hostRemapWarned = false;
function remapDockerHost(url: string | undefined, label: string): string | undefined {
  if (!url || IN_CONTAINER) return url;
  if (!url.includes('host.docker.internal')) return url;
  const remapped = url.replace(/host\.docker\.internal/g, 'localhost');
  if (!hostRemapWarned) {
    process.stderr.write(
      `[env] host.docker.internal unreachable on this host; remapping URLs to localhost ` +
        `(${label}: ${url} → ${remapped}). Set explicit URLs in .env to silence.\n`,
    );
    hostRemapWarned = true;
  }
  return remapped;
}

const env = z
  .object({
    SQLITE_PATH: z.string().optional(),
    SESSION_SECRET: z.string().min(16),
    BRIDGE_WS_URL: z.string().default('ws://host.docker.internal:7001/events'),
    // The ov-bridge subscribes to the robot's `/color_image` LCM topic
    // (already JPEG-encoded by `_with_jpeglcm`) and re-serves the frames as
    // an MJPEG stream — keeping the spec's plane boundary intact (only
    // ov-bridge ever speaks LCM). Override in .env if you ever wire the
    // robot's dimos FastAPI video server directly.
    ROBOT_MJPEG_URL: z
      .string()
      .default('http://host.docker.internal:7001/video_feed/color_image'),
    MCP_URL: z.string().default('http://host.docker.internal:9990/mcp'),
    BRIDGE_HTTP_URL: z.string().default('http://host.docker.internal:7001'),
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
  BRIDGE_WS_URL: remapDockerHost(env.BRIDGE_WS_URL, 'BRIDGE_WS_URL') ?? env.BRIDGE_WS_URL,
  ROBOT_MJPEG_URL:
    remapDockerHost(env.ROBOT_MJPEG_URL, 'ROBOT_MJPEG_URL') ?? env.ROBOT_MJPEG_URL,
  MCP_URL: remapDockerHost(env.MCP_URL, 'MCP_URL') ?? env.MCP_URL,
  BRIDGE_HTTP_URL:
    remapDockerHost(env.BRIDGE_HTTP_URL, 'BRIDGE_HTTP_URL') ?? env.BRIDGE_HTTP_URL,
};
export type Env = typeof ENV;
