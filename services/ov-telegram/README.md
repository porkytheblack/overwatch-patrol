# ov-telegram

Telegram bot + agent layer. Loads its token from `bot_configs.telegram` in SQLite (set via the dashboard) and hot-reloads on change.

## Architecture

- **Outbound** — subscribes to ov-bridge WS, queues a notification on `incident.opened`, fires when `clip.ready` arrives (or after a 120s fallback). Sends the §12 formatted message to every enabled `subscribers` row with `View` / `Acknowledge` inline buttons.
- **Inbound (agent)** — long-polls Telegram. Each message goes through a [Glove](https://glove.dterminal.net) agent with the dimos MCP server mounted as a single static catalogue entry. Read-only queries (`search_incidents`, …) and control skills (`go_to_waypoint`, `execute_sport_command`, …) are presented to the LLM as ordinary Glove tools. Conversation history persists in `agent_conversations`.
- **Confirmation gate** — sport commands (FrontFlip, Backflip, LeftFlip, RightFlip, Handstand, FrontJump, FrontPounce, Scrape, Bound, MoonWalk), `stop_surveillance`, and `delete_waypoint` are intercepted at the Glove executor seam. The agent stores `{tool, args}` in `agent_conversations.pending_confirmation` and prompts "Reply y to confirm". A subsequent `y` calls the MCP tool directly; `n` clears the pending state.
