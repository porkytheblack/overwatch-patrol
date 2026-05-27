import { config as loadDotenv } from 'dotenv';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load .env from the repo root so `pnpm migrate`, `pnpm seed`, and `tsx watch`
// all see operator-supplied secrets without any extra flags. In Docker
// compose the env comes from the `environment:` section and the repo-root
// .env is absent — dotenv silently no-ops.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const dotenvPath = join(repoRoot, '.env');
if (existsSync(dotenvPath)) loadDotenv({ path: dotenvPath });

const env = z
  .object({
    SQLITE_PATH: z.string().default('/data/overwatch.db'),
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
  .parse(process.env);

export const ENV = env;
export type Env = typeof env;
