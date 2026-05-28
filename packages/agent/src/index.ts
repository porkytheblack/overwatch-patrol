/**
 * `@overwatch/agent` — channel-agnostic Glove agent layer.
 *
 * Consumers (ov-telegram, ov-api) own their own dotenv loading and
 * `openDb` handle and inject them via `AgentOptions`. This package
 * supplies the executor shim, MCP mount, in-process cache, and the
 * `ConversationStore` that persists turns to `agent_conversations`.
 */
export * from './types.js';
export * from './env.js';
export * from './store.js';
export * from './agent.js';
