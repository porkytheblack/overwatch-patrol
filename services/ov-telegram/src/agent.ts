/**
 * Telegram-side agent adapter.
 *
 * The real agent loop (Glove, MCP mount, executor confirmation shim, in-process
 * cache) now lives in `@overwatch/agent`. This file keeps the existing public
 * surface (`handleMessage`, `resetAgentForChat`) so `src/index.ts` doesn't need
 * to know about the package switch.
 */
import { db } from './db.js';
import { ENV } from './env.js';
import { log } from './log.js';
import {
  handleMessage as agentHandleMessage,
  resetAgent,
  defaultSystemPrompt,
} from '@overwatch/agent';

export async function handleMessage(chat_id: string, text: string): Promise<string> {
  if (!ENV.AGENT) {
    return 'agent offline · no provider configured (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY)';
  }
  const reply = await agentHandleMessage(
    {
      channel: 'telegram',
      handle: chat_id,
      db,
      mcpUrl: ENV.MCP_URL,
      provider: ENV.AGENT,
      systemPrompt: defaultSystemPrompt(new Date().toISOString(), 'telegram'),
      clientInfo: { name: 'overwatch-patrol/telegram', version: '0.1.0' },
      logger: log,
    },
    text,
  );
  return reply.text;
}

export function resetAgentForChat(chat_id: string): void {
  resetAgent('telegram', chat_id);
}
