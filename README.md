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

- Python 3.12+, [uv](https://github.com/astral-sh/uv) — `curl -LsSf https://astral.sh/uv/install.sh | sh`
- Node 20+, pnpm 9+
- Docker + Docker Compose v2 (or OrbStack)
- **git-lfs** — `brew install git-lfs && git lfs install` (macOS) / `sudo apt-get install -y git-lfs && git lfs install` (Ubuntu). dimos fetches CLIP + YOLO weights through git-lfs on first launch.
- A Unitree Go2 (or dimos Mujoco sim — use `make setup-sim` and `make sim`)
- LCM on a reachable multicast group
- A Telegram bot token (BotFather)
- An OpenRouter API key (recommended — covers Anthropic, OpenAI, Google, Meta, etc.) or any single-provider key

> **Note on dimos.** This repo installs `dimos` directly from PyPI (`dimos[base,unitree]`) per the upstream [recommended install path](https://github.com/dimensionalOS/dimos#installation). No git submodule, no vendoring. This is a deliberate deviation from `spec.md §3` which described an older submodule-based workflow.

## Quickstart

```bash
git clone <repo>
cd overwatch-patrol
cp .env.example .env             # fill in secrets

make setup                       # uv venv + dimos[base,unitree] + dimos_ext + pnpm + migrate
make dev                         # app stack (docker compose)
make robot                       # robot stack on the robot host
```

For the Mujoco sim path (no hardware):

```bash
make setup-sim                   # adds dimos[sim]
make sim
```

Dashboard: <http://localhost:3001>
API: <http://localhost:3000>
First-boot wizard creates the initial operator.

## Layout

```
overwatch-patrol/
├── dimos_ext/                    # python extension package (depends on dimos via PyPI)
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

| Target              | Description                                                    |
|---------------------|----------------------------------------------------------------|
| `make setup`        | venv + `dimos[base,unitree]` + extension + pnpm + migrate      |
| `make setup-sim`    | as above, plus `dimos[sim]` for Mujoco                         |
| `make robot`        | run extension blueprint on the robot host                      |
| `make sim`          | same blueprint via Mujoco                                      |
| `make dev`          | docker compose up -d                                           |
| `make logs SVC=...` | tail one service                                               |
| `make seed`         | seed admin user, subscribers, retention                        |
| `make reset`        | nuke `./data`                                                  |
| `make codegen`      | regenerate Pydantic events from zod                            |
| `make migrate`      | apply SQLite migrations                                        |
| `make e2e`          | synthetic-detector smoke test                                  |
| `make dev-dimos DIMOS_PATH=../dimos` | editable install from a sibling dimos checkout    |

## Brand

Inherited from Overwatch v1. Single accent (`#F59E0B` amber), JetBrains Mono numerics, zero-radius UI, terse voice. See [`spec.md` §0](./spec.md#0-brand).

## Troubleshooting

- **`dimos` import errors** — make sure your venv is active (`source .venv/bin/activate`) and `uv pip install 'dimos[base,unitree]'` succeeded. The bridge can run without dimos (it gracefully degrades with no LCM ingestion); the robot blueprint requires it.
- **`IP address must be provided`** (sim path) — set `OV_SIM=1` (or use `make sim` which does it) so the blueprint sets `global_config.simulation = True` and dimos swaps in MujocoConnection.
- **`Missing required tools: git-lfs`** — install git-lfs (see prereqs). dimos's SpatialMemory and SecurityModule download model weights through git-lfs on first launch.
- **LCM events not flowing into the bridge** — check that `LCM_URL`'s multicast group is reachable from the bridge container. On Linux you may need `network_mode: host` (already set in compose).
- **No video on macOS (`make sim` runs but the dashboard tile is blank)** — macOS doesn't route multicast (`239.255.76.67`) over loopback by default, so the blueprint's JPEG frames never reach ov-bridge. Fix once per boot with `make mac-multicast-route`.
- **Telegram bot idle** — set a token in *Settings → Telegram*; the bot polls SQLite for it and hot-reloads within 30s.
- **Dashboard shows OFFLINE** — bridge is not seeing `/ow/robot_state` events. Check `make logs SVC=ov-bridge`.
- **MCP tool calls failing** — the bot's `MCP_URL` must reach the robot's `:9990/mcp` endpoint. From inside Docker that's usually `http://host.docker.internal:9990/mcp`.

## License

See `LICENSE`.
