import { config as loadDotenv } from 'dotenv';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Auto-load .env from the repo root for local dev. In Docker compose the
// env comes from the `environment:` section and .env isn't mounted — dotenv
// silently no-ops then.
const __dirname = dirname(fileURLToPath(import.meta.url));
const dotenvPath = join(__dirname, '..', '..', '..', '.env');
if (existsSync(dotenvPath)) loadDotenv({ path: dotenvPath });

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
  .parse(process.env);

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
  /** Resolved LLM config — null if no provider is configured. */
  AGENT: resolveProvider(),
};
