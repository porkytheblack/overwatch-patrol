import { z } from 'zod';

const env = z
  .object({
    SQLITE_PATH: z.string().default('/data/overwatch.db'),
    BRIDGE_WS_URL: z.string().default('ws://host.docker.internal:7001/events'),
    MCP_URL: z.string().default('http://host.docker.internal:9990/mcp'),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    MODEL: z.string().default('claude-sonnet-4-6'),
    DASHBOARD_BASE_URL: z.string().default('http://localhost:3001'),
    DEEP_LINK_SECRET: z.string().min(16),
    DEEP_LINK_TTL_HOURS: z.coerce.number().int().positive().default(24),
    OV_API_URL: z.string().default('http://ov-api:3000'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    STATION_DB_PATH: z.string().default('/data/station.db'),
  })
  .parse(process.env);

export const ENV = env;
