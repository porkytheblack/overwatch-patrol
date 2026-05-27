import { config as loadDotenv } from 'dotenv';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { accessSync, constants, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Auto-load .env from the repo root for local dev. In Docker compose the
// env comes from the `environment:` section and .env isn't mounted — dotenv
// silently no-ops then.
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..', '..');
const dotenvPath = join(repoRoot, '.env');
if (existsSync(dotenvPath)) loadDotenv({ path: dotenvPath });

// Compose env vars come through as empty strings when unset
// (`VAR: ${VAR:-}` expands to `VAR=`). zod's `.optional()` only accepts
// `undefined`, so we strip empty-string env values up front.
const stripped: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(process.env)) {
  stripped[k] = v === '' ? undefined : v;
}

/** See services/ov-api/src/env.ts — same remap logic. */
function resolveDataPath(raw: string, fallbackName: string): string {
  const input = raw || join(repoRoot, 'data', fallbackName);
  const isInDataRoot = input.startsWith('/data/') || input === '/data';
  if (isInDataRoot && !canWrite('/data')) {
    return join(repoRoot, 'data', basename(input));
  }
  if (!isAbsolute(input)) return resolve(repoRoot, input);
  return input;
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

/** See services/ov-api/src/env.ts — same host-remap logic. */
const IN_CONTAINER = canWrite('/data');
let hostRemapWarned = false;
function remapDockerHost(url: string, label: string): string {
  if (IN_CONTAINER || !url.includes('host.docker.internal')) return url;
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

const raw = z
  .object({
    SQLITE_PATH: z.string().default('/data/overwatch.db'),
    BRIDGE_WS_URL: z.string().default('ws://host.docker.internal:7001/events'),
    MCP_URL: z.string().default('http://host.docker.internal:9990/mcp'),

    // ── Agent provider selection ────────────────────────────────────────────
    // PROVIDER is optional. When unset, we auto-pick:
    //   1. openrouter — if OPENROUTER_API_KEY is set
    //   2. anthropic  — if ANTHROPIC_API_KEY is set
    //   3. (none)     — agent replies "agent offline · no provider configured"
    PROVIDER: z.enum(['openrouter', 'anthropic', 'openai', 'gemini', 'bedrock']).optional(),
    OPENROUTER_API_KEY: z.string().min(1).optional(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GEMINI_API_KEY: z.string().min(1).optional(),

    // Model name. Accepts any string the chosen provider understands.
    // Examples:
    //   openrouter  → anthropic/claude-sonnet-4, openai/gpt-4.1, meta-llama/llama-3.3-70b-instruct
    //   anthropic   → claude-sonnet-4-6, claude-opus-4-7, claude-haiku-4-5
    //   openai      → gpt-4.1, gpt-4o
    // Left blank, the provider's `defaultModel` is used.
    MODEL: z.string().default(''),

    DASHBOARD_BASE_URL: z.string().default('http://localhost:3001'),
    DEEP_LINK_SECRET: z.string().min(16),
    DEEP_LINK_TTL_HOURS: z.coerce.number().int().positive().default(24),
    OV_API_URL: z.string().default('http://ov-api:3000'),
    LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    STATION_DB_PATH: z.string().default('/data/station.db'),
  })
  .parse(stripped);

/** Resolve which LLM provider to use this boot. */
function resolveProvider(): {
  provider: string;
  apiKey: string;
  model: string;
} | null {
  const defaults: Record<string, string> = {
    openrouter: 'anthropic/claude-sonnet-4',
    anthropic: 'claude-sonnet-4-6',
    openai: 'gpt-4.1',
    gemini: 'gemini-2.5-flash',
    bedrock: 'anthropic.claude-sonnet-4-20250514-v1:0',
  };

  // Explicit selection takes precedence.
  if (raw.PROVIDER) {
    const key = pickKey(raw.PROVIDER);
    if (!key && raw.PROVIDER !== 'bedrock') return null;
    return {
      provider: raw.PROVIDER,
      apiKey: key ?? '',
      model: raw.MODEL || defaults[raw.PROVIDER],
    };
  }
  // Auto-pick: prefer OpenRouter as the default when its key is present.
  if (raw.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      apiKey: raw.OPENROUTER_API_KEY,
      model: raw.MODEL || defaults.openrouter,
    };
  }
  if (raw.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: raw.ANTHROPIC_API_KEY,
      model: raw.MODEL || defaults.anthropic,
    };
  }
  if (raw.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: raw.OPENAI_API_KEY,
      model: raw.MODEL || defaults.openai,
    };
  }
  if (raw.GEMINI_API_KEY) {
    return {
      provider: 'gemini',
      apiKey: raw.GEMINI_API_KEY,
      model: raw.MODEL || defaults.gemini,
    };
  }
  return null;
}

function pickKey(provider: string): string | undefined {
  switch (provider) {
    case 'openrouter':
      return raw.OPENROUTER_API_KEY;
    case 'anthropic':
      return raw.ANTHROPIC_API_KEY;
    case 'openai':
      return raw.OPENAI_API_KEY;
    case 'gemini':
      return raw.GEMINI_API_KEY;
    case 'bedrock':
      return undefined; // Bedrock uses AWS creds, not an API key
    default:
      return undefined;
  }
}

export const ENV = {
  ...raw,
  SQLITE_PATH: resolveDataPath(raw.SQLITE_PATH, 'overwatch.db'),
  STATION_DB_PATH: resolveDataPath(raw.STATION_DB_PATH, 'station.db'),
  BRIDGE_WS_URL: remapDockerHost(raw.BRIDGE_WS_URL, 'BRIDGE_WS_URL'),
  MCP_URL: remapDockerHost(raw.MCP_URL, 'MCP_URL'),
  /** Resolved LLM config — null if no provider is configured. */
  AGENT: resolveProvider(),
};
