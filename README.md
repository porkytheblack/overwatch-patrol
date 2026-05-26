# OVERWATCH PATROL

Autonomous single-robot surveillance built on [dimos](https://github.com/dimensionalOS/dimos). A Unitree Go2 patrols defined waypoints, autonomously deviates to inspect detections, opens incidents, alerts via Telegram with deep-link playback, and accepts both conversational queries and direct movement commands through the same chat.

See [`spec.md`](./spec.md) for the full v1 specification.

```
┌──────────────────────────────┐
│ dimos (robot host)           │
│  ├─ SurveillanceModule       │
│  ├─ WaypointPatrolRouter     │
│  ├─ ClipRecorderModule       │
│  └─ SurveillanceQueryModule  │── LCM ──┐
└──────────────────────────────┘         │
                                    ┌────▼─────────┐
                                    │ ov-bridge    │
                                    │ → SQLite     │
                                    │ → WS         │
                                    └────┬─────────┘
                                         │
        ┌────────────┬───────────────────┤
        ▼            ▼                   ▼
   ┌────────┐  ┌──────────────┐  ┌─────────────┐
   │ ov-api │  │ ov-telegram  │  │ ov-dashboard│
   └────────┘  └──────────────┘  └─────────────┘
                     │
                     └── MCP ──► dimos McpServer
```

## Prereqs

- Python 3.11+, [uv](https://github.com/astral-sh/uv)
- Node 20+, pnpm 9+
- Docker + Docker Compose v2
- A Unitree Go2 (or dimos Mujoco sim)
- LCM on a reachable multicast group
- A Telegram bot token (BotFather)
- An Anthropic API key

## Quickstart

```bash
git clone --recurse-submodules <repo>
cd overwatch-patrol
cp .env.example .env             # fill in secrets
make setup                       # install dimos + dimos_ext + pnpm + migrate
make dev                         # app stack
make robot                       # robot stack (on the robot host)
```

Dashboard: <http://localhost:3001>
API: <http://localhost:3000>
First-boot wizard creates the initial operator.

## Layout

```
overwatch-patrol/
├── vendor/dimos/                 # git submodule
├── dimos_ext/                    # python extension package
├── packages/
│   ├── schemas/                  # single source of truth (zod → pydantic)
│   └── shared-ts/                # shared TS utilities
├── services/
│   ├── ov-bridge/                # python · LCM → SQLite + WS
│   ├── ov-api/                   # ts · hono · auth, CRUD, ws fan-out
│   ├── ov-telegram/              # ts · telegram bot, glove agent w/ MCP
│   └── ov-dashboard/             # next.js 14 · operator UI
├── infra/caddy/
└── scripts/
```

## Make targets

| Target              | Description                                         |
|---------------------|-----------------------------------------------------|
| `make setup`        | install dimos + extension + pnpm + migrate          |
| `make robot`        | run dimos blueprint on robot host                   |
| `make sim`          | same blueprint, Mujoco sim                          |
| `make dev`          | docker compose up -d                                |
| `make logs SVC=...` | tail one service                                    |
| `make seed`         | seed admin user, subscribers, retention             |
| `make reset`        | nuke `./data`                                       |
| `make codegen`      | regenerate Pydantic events from zod                 |
| `make migrate`      | apply SQLite migrations                             |
| `make e2e`          | synthetic-detector smoke test                       |
| `make link-dimos`   | symlink vendor/dimos → sibling checkout             |
| `make unlink-dimos` | restore submodule                                   |

## Brand

Inherited from Overwatch v1. Single accent (`#F59E0B` amber), JetBrains Mono numerics, zero-radius UI, terse voice. See [`spec.md` §0](./spec.md#0-brand).

## Troubleshooting

- **LCM events not flowing into the bridge** — check that `LCM_URL`'s multicast group is reachable from the bridge container. On Linux you may need `network_mode: host` (already set in compose).
- **Telegram bot idle** — set a token in *Settings → Telegram*; the bot polls SQLite for it and hot-reloads.
- **Dashboard shows OFFLINE** — bridge is not seeing `/ow/robot_state` events. Check `make logs SVC=ov-bridge`.
- **MCP tool calls failing** — the bot's `MCP_URL` must reach the robot's `:9990/mcp` endpoint. From inside Docker that's usually `http://host.docker.internal:9990/mcp`.

## License

See `LICENSE`.
