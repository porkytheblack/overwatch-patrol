/**
 * Provider resolver — pure function.
 *
 * Callers (ov-telegram, ov-api) own their own dotenv loading and
 * empty-string stripping; this module is intentionally a thin pure
 * helper so the same auto-pick logic applies wherever the agent runs.
 *
 * The auto-pick order matches `services/ov-telegram/src/env.ts` so the
 * Telegram service keeps the exact behaviour it had before the package
 * extraction. Explicit `PROVIDER=` always wins.
 */

export interface AgentProviderConfig {
  provider: string;
  apiKey: string;
  model: string;
}

const DEFAULT_MODELS: Record<string, string> = {
  openrouter: 'anthropic/claude-sonnet-4',
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4.1',
  gemini: 'gemini-2.5-flash',
  bedrock: 'anthropic.claude-sonnet-4-20250514-v1:0',
};

function pickKey(
  env: Record<string, string | undefined>,
  provider: string,
): string | undefined {
  switch (provider) {
    case 'openrouter':
      return env.OPENROUTER_API_KEY;
    case 'anthropic':
      return env.ANTHROPIC_API_KEY;
    case 'openai':
      return env.OPENAI_API_KEY;
    case 'gemini':
      return env.GEMINI_API_KEY;
    case 'bedrock':
      return undefined; // Bedrock uses AWS creds, not an API key
    default:
      return undefined;
  }
}

/**
 * Resolve which LLM provider to use this boot.
 *
 * Returns `null` when no provider is configured — callers surface this
 * as "agent offline · no provider configured" to the operator rather
 * than crashing.
 *
 * Auto-pick order (when `PROVIDER` is unset):
 *   1. openrouter — if OPENROUTER_API_KEY is set
 *   2. anthropic  — if ANTHROPIC_API_KEY is set
 *   3. openai     — if OPENAI_API_KEY is set
 *   4. gemini     — if GEMINI_API_KEY is set
 *   5. (none)     — return null
 */
export function resolveAgentProvider(
  env: Record<string, string | undefined>,
): AgentProviderConfig | null {
  const explicit = env.PROVIDER;
  const model = env.MODEL ?? '';

  // Explicit selection takes precedence.
  if (explicit) {
    const key = pickKey(env, explicit);
    if (!key && explicit !== 'bedrock') return null;
    return {
      provider: explicit,
      apiKey: key ?? '',
      model: model || DEFAULT_MODELS[explicit] || '',
    };
  }
  // Auto-pick: prefer OpenRouter as the default when its key is present.
  if (env.OPENROUTER_API_KEY) {
    return {
      provider: 'openrouter',
      apiKey: env.OPENROUTER_API_KEY,
      model: model || DEFAULT_MODELS.openrouter,
    };
  }
  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: 'anthropic',
      apiKey: env.ANTHROPIC_API_KEY,
      model: model || DEFAULT_MODELS.anthropic,
    };
  }
  if (env.OPENAI_API_KEY) {
    return {
      provider: 'openai',
      apiKey: env.OPENAI_API_KEY,
      model: model || DEFAULT_MODELS.openai,
    };
  }
  if (env.GEMINI_API_KEY) {
    return {
      provider: 'gemini',
      apiKey: env.GEMINI_API_KEY,
      model: model || DEFAULT_MODELS.gemini,
    };
  }
  return null;
}
