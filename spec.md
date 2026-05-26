# Overwatch Patrol — Build Specification v1
> Autonomous single-robot surveillance built on dimos. A Unitree Go2 patrols defined world waypoints, autonomously deviates to inspect detections, opens incidents, alerts via Telegram with deep-link playback, and accepts both conversational queries ("what happened in the last hour") and direct movement commands ("go to the front gate") through the same chat.

**Status:** Ready for implementation handover
**Built on:** [dimos](https://github.com/dimensionalOS/dimos) — vendored as a git submodule
**Brand:** Inherits Overwatch v1 (amber accent, mono numerics, zero-radius UI, terse voice)

---

## Table of contents

0. Brand
1. Goals & non-goals
2. Architecture overview
3. Workspace setup (clone, submodule, build)
4. Repo layout
5. Data model (SQLite)
6. Event contracts (LCM topics + Zod/Pydantic)
7. Services
8. State machine
9. Core flows
10. Dashboard
11. Authentication
12. Notification format
13. Agent / MCP tools
14. Deployment
15. Definition of done
16. Testing
17. Out of scope
18. Implementation order
19. Appendix: scaffolding hints

---

## 0. Brand

Inherited verbatim from Overwatch v1.

**Voice.** Terse, informational, status before sentiment. No marketing language, no celebratory copy, no exclamation marks in UI strings. Numbers and IDs in mono.

**Palette.** Single accent — amber (`#F59E0B`).

| Token | Hex | Use |
|---|---|---|
| `--bg` | `#0A0A0A` | Page background |
| `--surface` | `#141414` | Cards |
| `--surface-elev` | `#1F1F1F` | Hover / focused row |
| `--border` | `#262626` | Hairline dividers |
| `--border-strong` | `#404040` | Outlines, active |
| `--text` | `#E5E5E5` | Primary text |
| `--text-muted` | `#A3A3A3` | Secondary |
| `--text-dim` | `#525252` | Labels, metadata |
| `--accent` | `#F59E0B` | Live state, primary CTA, open-incident indicator |
| `--accent-strong` | `#FBBF24` | Accent hover |
| `--accent-dim` | `#7C2D12` | Text on accent fills |
| `--success` | `#10B981` | Resolved / acknowledged only |
| `--danger` | `#EF4444` | Connection lost / robot offline / critical only |

**Type.** Inter 400/500 for UI prose. JetBrains Mono 400/500 for all numeric, ID, timestamp, duration, address, and table data. No italics. Self-host both fonts in `services/ov-dashboard/public/fonts/`.

**Geometry.** `border-radius: 0` everywhere, including form controls. 1px solid borders. No drop shadows, no gradients, no glow.

**Mark.** Wordmark `OVERWATCH PATROL` in JetBrains Mono 500 uppercase, `letter-spacing: 0.08em`. Followed by a 6×6px amber square that pulses (full ↔ 0.5 opacity, 2s interval) while LCM events are flowing from the robot, and goes solid `var(--danger)` when the robot is offline.

**Component primitives.** Button height 32px, mono uppercase label `letter-spacing: 0.04em`, primary = amber fill on black text. Input height 32px, `var(--surface)` fill. Borderless tables with `var(--border)` row separators, mono data columns. Status pills: 1px outline, no fill except `OPEN` which uses amber fill. States: `OPEN`, `INSPECTING`, `RESOLVED`, `ACK'D`, `SUPPRESSED`.

---

## 1. Goals & non-goals

### The v1 demo

A fresh clone + the steps in §3 produces a working system where the operator can:

1. Bring the robot up with `make robot` and the app stack up with `make dev`.
2. Drive the robot manually to ≥3 locations, naming each as a waypoint from the dashboard or Telegram.
3. Configure targets (`person`, `vehicle`) and a scene description per waypoint.
4. Paste a Telegram bot token in settings.
5. Press "START PATROL". The robot cycles waypoints autonomously.
6. When a person is detected within the active waypoint zone for longer than the linger threshold, the robot autonomously deviates, computes a safe standoff pose, approaches with visual servoing, holds for inspection dwell, then resumes patrol from the saved cursor.
7. Operator receives a Telegram message within 30 seconds of the linger threshold, containing classes detected, waypoint name, a signed deep-link to playback, and inline `View` / `Acknowledge` buttons.
8. Operator replies "what happened in the last hour" → coherent answer from real incident data.
9. Operator replies "go to the front gate" → robot moves there. Patrol pauses, resumes after 60s of idle or explicit `resume patrol`.
10. Operator replies "stop" → robot stops. "sit" → robot sits. "backflip" → bot asks for confirmation first.

If all ten work end-to-end on a fresh deploy, v1 ships.

### Non-goals (v1)

- Multi-robot fleet
- WhatsApp (Telegram only)
- Cloud TTS / cloud VLM (use local or skip)
- WebRTC live view (MJPEG is enough)
- Face recognition / person ID
- Postgres / MinIO (SQLite + local disk; swappable later)
- Multi-tenant
- Mobile native apps
- Audio analysis
- Push notifications via APNs/FCM
- SSO / SAML
- Encrypted-at-rest storage (infra responsibility)

---

## 2. Architecture overview

Two planes connected by LCM and one bridge.

**Robot plane** (single Python process, runs on the robot host):
- dimos `unitree_go2_spatial` blueprint (gives nav + spatial memory + odom + camera)
- `SurveillanceModule` — `IDLE / PATROLLING / INSPECTING / COOLDOWN / MANUAL_OVERRIDE` state machine
- `ClipRecorderModule` — ring buffer + MP4 writer with bbox overlays
- `SurveillanceQueryModule` — read-only `@skill`s wrapping SQLite for the agent
- `WaypointPatrolRouter` — new sibling of `coverage / random / frontier` routers
- dimos `McpServer` — exposes all `@skill`s at `http://robot:9990/mcp`
- dimos FastAPI server — exposes `GET /video_feed/color_image` (MJPEG)

**App plane** (Docker compose, runs anywhere reachable to robot + Telegram):
- `ov-bridge` — subscribes to LCM `/ow/*` topics, writes to SQLite, broadcasts to WS
- `ov-api` — Hono HTTP + WS for the dashboard
- `ov-telegram` — Telegram long-poll bot; agent flow via MCP client to robot
- `ov-dashboard` — Next.js 14
- `caddy` — TLS termination + reverse proxy

**Storage:**
- SQLite at `./data/overwatch.db` (mounted into bridge, api, telegram)
- Clips at `./data/clips/{incident_id}.mp4` + `.jpg` posters

**Boundary rules:**
- Robot plane writes nothing to SQLite directly. Bridge owns all writes.
- App plane never speaks LCM directly. Only `ov-bridge` does.
- Dashboard talks only to `ov-api` (HTTP + WS).
- `ov-telegram` is the only app-plane service that calls the MCP server directly, and only for agent tool calls.

```
┌────────────────────────────────────────────┐
│ dimos process — runs on robot host         │
│  ┌──────────────────────────────────────┐  │
│  │ SurveillanceModule                   │  │
│  │  ├─ WaypointPatrolRouter             │  │
│  │  ├─ YOLO detector (triage)           │  │
│  │  └─ Visual servo approach            │  │
│  └────────┬─────────────────────────────┘  │
│           │ LCM publish:                   │
│           │   /ow/detections               │
│           │   /ow/robot_state              │
│           │   /ow/incident_opened          │
│           │   /ow/incident_closed          │
│  ┌────────▼─────────────────────────────┐  │
│  │ ClipRecorderModule                   │  │
│  │  ring buffer → mp4 + jpg poster      │  │
│  │  publish /ow/clip_ready              │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ SurveillanceQueryModule (@skill)     │  │
│  │ McpServer ◄── MCP tools/call         │  │
│  └──────────────────────────────────────┘  │
│  ┌──────────────────────────────────────┐  │
│  │ FastAPI /video_feed/color_image      │  │
│  └──────────────────────────────────────┘  │
└────────┬─────────────────────────┬─────────┘
         │ LCM                     │ HTTP MJPEG + MCP
┌────────▼──────────────┐          │
│ ov-bridge             │          │
│  → SQLite             │          │
│  → WS ws://…/events   │          │
└────────┬──────────────┘          │
         │                         │
   ┌─────┴────────┐                │
   │              │                │
┌──▼─────┐ ┌──────▼──────┐ ┌───────▼───────┐
│ ov-api │ │ ov-telegram │ │  ov-dashboard │
└────────┘ └─────┬───────┘ └───────────────┘
                 │
                 └──► MCP tools/call (read + control)
```

---

## 3. Workspace setup

This is its own repository. Dimos is vendored as a git submodule so each commit pins a specific dimos version, the whole stack clones with one command, and the workspace is shareable.

### Clone & build

```bash
git clone --recurse-submodules https://github.com/<you>/overwatch-patrol.git
cd overwatch-patrol
make setup
```

`make setup` performs:

```bash
# 1. install dimos editable from the submodule
uv pip install -e ./vendor/dimos[misc]
# 2. install our extension package (depends on `dimos`)
uv pip install -e ./dimos_ext
# 3. install TS workspaces
pnpm install
# 4. codegen Pydantic events from zod schemas
pnpm -F @overwatch/schemas codegen
# 5. apply SQLite migrations
pnpm -F @overwatch/api migrate
```

### Run

```bash
# robot host (terminal 1, needs hardware + ROS env)
make robot         # python -m overwatch_patrol.blueprints.go2_overwatch

# app stack (terminal 2, anywhere)
make dev           # docker compose up -d
# dashboard at http://localhost:3000
```

### Update dimos

```bash
cd vendor/dimos && git fetch && git checkout <new-sha> && cd ../..
git add vendor/dimos && git commit -m "bump dimos to <new-sha>"
```

### Escape hatch — develop dimos and overwatch-patrol side-by-side

```bash
make link-dimos PATH=../dimos     # symlinks vendor/dimos → your sibling checkout
make unlink-dimos                 # restores the submodule
```

### Prerequisites

- Python 3.11+, `uv`
- Node 20+, `pnpm`
- Docker + Docker Compose v2
- A Go2 (or dimos Mujoco sim — see §16)
- LCM installed and on multicast group reachable from where `ov-bridge` runs
- A Telegram bot token (BotFather)
- An Anthropic API key (or local LLM endpoint compatible with the Claude SDK)

---

## 4. Repo layout

```
overwatch-patrol/
├── README.md
├── Makefile
├── .env.example
├── docker-compose.yml
├── docker-compose.dev.yml
│
├── vendor/
│   └── dimos/                          # git submodule
│
├── dimos_ext/                          # Python extension package
│   ├── pyproject.toml
│   └── overwatch_patrol/
│       ├── __init__.py
│       ├── events.py                   # generated Pydantic mirrors of zod
│       ├── surveillance_module.py
│       ├── waypoint_patrol_router.py
│       ├── clip_recorder.py
│       ├── query_module.py
│       └── blueprints/
│           └── go2_overwatch.py
│
├── packages/
│   ├── schemas/                        # SINGLE SOURCE OF TRUTH
│   │   ├── src/
│   │   │   ├── events.ts               # zod
│   │   │   └── tables.ts               # drizzle
│   │   ├── pygen/                      # generated → dimos_ext/.../events.py
│   │   └── build.ts
│   └── shared-ts/                      # Effect helpers, LCM client, Drizzle client
│
├── services/
│   ├── ov-bridge/                      # Python · LCM → SQLite + WS
│   ├── ov-api/                         # TS · Hono
│   ├── ov-telegram/                    # TS · bot + MCP client
│   └── ov-dashboard/                   # Next.js 14 App Router
│
├── infra/
│   └── caddy/Caddyfile
│
└── scripts/
    ├── setup.sh
    ├── seed.ts
    ├── gen-schemas.sh
    └── e2e.sh
```

**Tooling**
- TypeScript: pnpm workspaces + Turborepo, Effect, Zod, Drizzle (better-sqlite3 driver), Hono, Lucia v3
- Python: uv per service, FastAPI (where HTTP needed), Ultralytics (YOLO11L), Pydantic, redis-py (only if you graduate from SQLite later), opencv-python, ffmpeg-python
- Frontend: Next.js 14 App Router, Tailwind configured to the §0 palette, hand-built components from the design system (no UI framework)
- Agent: Anthropic SDK (TS) with MCP transport pointing at `http://robot:9990/mcp`

---

## 5. Data model (SQLite)

All IDs UUID v7 (time-ordered). All timestamps ISO-8601 UTC strings.

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  created_at TEXT NOT NULL
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL
);

CREATE TABLE waypoints (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,            -- mirrored into dimos SpatialMemory
  pose_x REAL NOT NULL,
  pose_y REAL NOT NULL,
  pose_yaw REAL NOT NULL,
  scene_description TEXT NOT NULL DEFAULT '',
  targets TEXT NOT NULL,                -- JSON array of class names
  detection_window TEXT NOT NULL DEFAULT '{"type":"always"}',
                                        -- {type:'always'} | {type:'time', start, end, tz, days[]}
  linger_threshold_seconds INTEGER NOT NULL DEFAULT 5,
  inspection_dwell_seconds INTEGER NOT NULL DEFAULT 4,
  min_standoff_m REAL NOT NULL DEFAULT 1.5,
  order_index INTEGER NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY,
  waypoint_id TEXT NOT NULL REFERENCES waypoints(id),
  track_id TEXT,
  classes TEXT NOT NULL,                -- JSON array
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  status TEXT NOT NULL DEFAULT 'open',  -- open | closed | suppressed | acknowledged
  inspection_pose_x REAL,
  inspection_pose_y REAL,
  clip_path TEXT,
  poster_path TEXT,
  clip_status TEXT NOT NULL DEFAULT 'pending',  -- pending | ready | failed
  summary TEXT,
  acknowledged_by TEXT REFERENCES users(id),
  acknowledged_by_handle TEXT,          -- for Telegram acks
  acknowledged_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX idx_incidents_opened ON incidents (opened_at DESC);
CREATE INDEX idx_incidents_status ON incidents (status);

CREATE TABLE detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  class TEXT NOT NULL,
  confidence REAL NOT NULL,
  bbox TEXT NOT NULL,                   -- JSON [x,y,w,h]
  track_id TEXT,
  incident_id TEXT REFERENCES incidents(id) ON DELETE CASCADE
);
CREATE INDEX idx_detections_incident ON detections (incident_id);
CREATE INDEX idx_detections_ts ON detections (ts);

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,                -- 'telegram'
  handle TEXT NOT NULL,                 -- telegram chat_id as string
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  UNIQUE (channel, handle)
);

CREATE TABLE bot_configs (
  channel TEXT PRIMARY KEY,
  config TEXT NOT NULL,                 -- JSON: { bot_token, ... }
  enabled INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE agent_conversations (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  handle TEXT NOT NULL,
  messages TEXT NOT NULL DEFAULT '[]',  -- last 20 turns
  pending_confirmation TEXT,            -- JSON: {tool, args} awaiting y/n
  last_active TEXT NOT NULL,
  UNIQUE (channel, handle)
);

CREATE TABLE robot_status (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  state TEXT NOT NULL,                  -- IDLE | PATROLLING | INSPECTING | COOLDOWN | MANUAL_OVERRIDE | OFFLINE
  current_waypoint_id TEXT REFERENCES waypoints(id),
  patrol_cursor_index INTEGER,
  last_seen_at TEXT NOT NULL,
  pose_x REAL, pose_y REAL, pose_yaw REAL
);

CREATE TABLE retention_policies (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                   -- 'clip_incident' | 'clip_regular' | 'detection'
  retention_days INTEGER NOT NULL
);
```

**Default retention** (seeded on first boot): `clip_incident = 90`, `clip_regular = 3`, `detection = 14`.

---

## 6. Event contracts

Single source of truth: `packages/schemas/src/events.ts`. Codegen produces `dimos_ext/overwatch_patrol/events.py`. **Never hand-edit `events.py`.**

```typescript
import { z } from 'zod';

export const Bbox = z.object({
  x: z.number(), y: z.number(), w: z.number(), h: z.number(),
});

export const Detection = z.object({
  class: z.string(),
  confidence: z.number().min(0).max(1),
  bbox: Bbox,
  track_id: z.string().optional(),
});

export const FrameDetections = z.object({
  type: z.literal('frame.detections'),
  ts: z.string().datetime(),
  detections: z.array(Detection),
});

export const RobotState = z.enum([
  'IDLE','PATROLLING','INSPECTING','COOLDOWN','MANUAL_OVERRIDE','OFFLINE',
]);

export const RobotStateChanged = z.object({
  type: z.literal('robot.state_changed'),
  ts: z.string().datetime(),
  state: RobotState,
  waypoint_id: z.string().uuid().optional(),
  pose: z.object({ x: z.number(), y: z.number(), yaw: z.number() }).optional(),
});

export const IncidentOpened = z.object({
  type: z.literal('incident.opened'),
  incident_id: z.string().uuid(),
  waypoint_id: z.string().uuid(),
  classes: z.array(z.string()),
  opened_at: z.string().datetime(),
  track_id: z.string().optional(),
  inspection_pose: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const IncidentClosed = z.object({
  type: z.literal('incident.closed'),
  incident_id: z.string().uuid(),
  closed_at: z.string().datetime(),
  status: z.enum(['closed','suppressed']),
  duration_ms: z.number(),
});

export const ClipReady = z.object({
  type: z.literal('clip.ready'),
  incident_id: z.string().uuid(),
  clip_path: z.string(),
  poster_path: z.string(),
  duration_ms: z.number(),
});

export const WaypointSync = z.object({
  type: z.literal('waypoint.sync'),
  waypoint_id: z.string().uuid(),
  name: z.string(),
  pose: z.object({ x: z.number(), y: z.number(), yaw: z.number() }),
  action: z.enum(['upsert','delete']),
});
```

**LCM topics** (all `dimos_lcm.std_msgs.String` carrying JSON):

| Topic | Producer | Payload type |
|---|---|---|
| `/ow/detections` | `SurveillanceModule` | `FrameDetections` |
| `/ow/robot_state` | `SurveillanceModule` | `RobotStateChanged` |
| `/ow/incident_opened` | `SurveillanceModule` | `IncidentOpened` |
| `/ow/incident_closed` | `SurveillanceModule` | `IncidentClosed` |
| `/ow/clip_ready` | `ClipRecorderModule` | `ClipReady` |
| `/ow/waypoint_sync` | `SurveillanceModule` | `WaypointSync` |

Plus dimos-native (already published): `/color_image` (JPEG via `_with_jpeg` blueprint), `/odom`, `/global_costmap`.

---

## 7. Services

### 7.1 `SurveillanceModule` (Python, dimos extension)

**Path:** `dimos_ext/overwatch_patrol/surveillance_module.py`
**Template:** Fork of `vendor/dimos/dimos/experimental/security_demo/security_module.py`.

**Responsibility.** The brain. Drives the patrol/inspection state machine. Owns the in-memory linger tracker keyed by `(waypoint_id, track_id)`. Publishes incident lifecycle events.

**Consumes (LCM ins):** `color_image`, `odom`, `goal_reached`, `global_costmap`.
**Produces (LCM outs):** `/ow/detections`, `/ow/robot_state`, `/ow/incident_opened`, `/ow/incident_closed`, `/ow/waypoint_sync`, plus `goal_request` and `cmd_vel` (to drive the robot).

**Configuration (`SurveillanceModuleConfig`):**
```python
camera_info: CameraInfo
detector_period_s: float = 0.2            # 5 fps detection cadence
patrol_grace_seconds: float = 5.0         # lost-track grace before closing incident
manual_override_idle_seconds: float = 60  # auto-return-to-patrol timeout
inspection_timeout_seconds: float = 30
cooldown_seconds: float = 3
```

**Skills exposed via MCP:**

```python
@skill
def start_surveillance() -> str: ...
@skill
def stop_surveillance() -> str: ...
@skill
def pause_patrol() -> str: ...              # → MANUAL_OVERRIDE, no movement
@skill
def resume_patrol() -> str: ...             # → PATROLLING from saved cursor
@skill
def add_waypoint(name: str) -> str: ...     # captures current pose
@skill
def delete_waypoint(name: str) -> str: ...
@skill
def list_waypoints() -> str: ...            # JSON
@skill
def go_to_waypoint(name: str) -> str: ...   # → MANUAL_OVERRIDE, navigate, wait
@skill
def set_targets(classes: list[str]) -> str: ...  # global override
@skill
def force_inspect(query: str) -> str: ...   # interrupt, run VL describe, return prose
@skill
def get_robot_state() -> str: ...           # JSON
```

**Definition of done:**
- [ ] State machine covers all five states with the transitions in §8
- [ ] In-memory linger tracker handles target loss + reacquisition under the same `track_id`
- [ ] Incidents persisted via `/ow/incident_opened` and never duplicated for the same `(waypoint_id, track_id)`
- [ ] Suppressed incidents (target leaves before linger threshold) get `IncidentClosed` with `status='suppressed'`
- [ ] Manual override does not open incidents but still publishes `/ow/detections`
- [ ] Unit tests on the state machine (synthetic detection stream + clock injection)

---

### 7.2 `WaypointPatrolRouter` (Python, dimos extension)

**Path:** `dimos_ext/overwatch_patrol/waypoint_patrol_router.py`
**Template:** Subclass `dimos/navigation/patrolling/routers/patrol_router.py` (sibling to the existing `coverage / random / frontier` routers).

**Responsibility.** Cycle through enabled waypoints from `SpatialMemory.get_robot_locations()` in `order_index` order. `next_goal()` returns the next `PoseStamped`. Supports `reset()`, `reset_to(index)`, and "skip ahead by N" for resuming after inspection.

**Config:** `clearance_radius_m`, `cycle_mode: Literal['loop','pingpong']` (default `loop`).

---

### 7.3 `ClipRecorderModule` (Python, dimos extension)

**Path:** `dimos_ext/overwatch_patrol/clip_recorder.py`

**Responsibility.** Record overlay-rendered MP4 clips around incident windows.

**Implementation.**
- Subscribes to `/color_image` and keeps a rolling deque of the last `pre_roll_s = 5` seconds of decoded frames + timestamps.
- Subscribes to `/ow/detections` and keeps a parallel deque of recent detection lists, indexed by ts.
- On `IncidentOpened(incident_id)`: spawn an ffmpeg subprocess writing to `data/clips/{incident_id}.mp4`. Push the pre-roll frames first, then continue pushing live frames as they arrive — each frame is composited with bboxes from the nearest detection timestamp (`cv2.rectangle` + label text).
- On `IncidentClosed`: continue recording for `post_roll_s = 10` seconds, then close the subprocess.
- Extract a poster JPEG from the middle frame, write to `data/clips/{incident_id}.jpg`.
- Publish `ClipReady`.

**Definition of done:**
- [ ] Clip plays in any standard HTML5 `<video>` (H.264 + `+faststart`)
- [ ] Bboxes accurately overlaid
- [ ] Poster image generated
- [ ] Clips arrive within 30s of `IncidentClosed`

---

### 7.4 `SurveillanceQueryModule` (Python, dimos extension)

**Path:** `dimos_ext/overwatch_patrol/query_module.py`

**Responsibility.** Read-only `@skill`s that wrap SQLite. **These are the agent tools** — there is no separate agent service.

```python
@skill
def search_incidents(time_range_start: str, time_range_end: str,
                     classes: list[str] | None = None,
                     waypoint_id: str | None = None,
                     status: Literal['open','closed','suppressed','acknowledged','all'] = 'all',
                     limit: int = 20) -> str: ...

@skill
def get_incident_details(incident_id: str) -> str: ...

@skill
def get_compound_status() -> str: ...
# returns: open incident count, robot_state, current_waypoint, last_seen_at,
# detector fps, recent activity heatmap

@skill
def get_waypoint_context(waypoint_id: str) -> str: ...

@skill
def summarize_period(start: str, end: str,
                     waypoint_id: str | None = None) -> str: ...

@skill
def acknowledge_incident(incident_id: str, user_handle: str) -> str: ...
```

All return JSON-encoded strings. The LLM client formats prose downstream.

Connection to SQLite is read-only and uses `?mode=ro` URI to avoid locking conflicts with `ov-bridge`'s writes.

---

### 7.5 `ov-bridge` (Python)

**Path:** `services/ov-bridge/`

**Responsibility.** The only thing that crosses planes. Subscribes to all `/ow/*` LCM topics, persists to SQLite, broadcasts a JSON event firehose over WebSocket for the dashboard and Telegram bot.

**Consumes (LCM):** all `/ow/*` topics.
**Produces:** WS messages on `ws://bridge:7001/events`.

**Endpoints:**
- `WS /events` — broadcasts every received LCM event as JSON
- `POST /sync/waypoint` — called by `SurveillanceModule.add_waypoint` via internal RPC, upserts row
- `GET /health`

**Env:**
```
LCM_URL=udpm://239.255.76.67:7667?ttl=1
SQLITE_PATH=/data/overwatch.db
WS_PORT=7001
```

**Behavior:**
- `IncidentOpened` → INSERT incidents row (status `open`, clip_status `pending`)
- `IncidentClosed` → UPDATE incidents row (`closed_at`, `status`, duration)
- `ClipReady` → UPDATE incidents (`clip_path`, `poster_path`, `clip_status='ready'`)
- `RobotStateChanged` → UPSERT `robot_status` (id=1)
- `FrameDetections` → optionally batch-insert recent detections tied to open incident IDs (downsample to 1 row per second to keep volume sane)

**Definition of done:**
- [ ] All LCM events land in SQLite
- [ ] WS broadcasts every event within 100ms
- [ ] Survives bridge restart without losing in-flight events (uses LCM resubscribe + reads any unprocessed `clip_status='pending'` from DB on boot)

---

### 7.6 `ov-api` (TypeScript, Hono)

**Path:** `services/ov-api/`

**Responsibility.** Auth, CRUD, and the dashboard's data layer. Pure HTTP/WS — no LCM.

**Routes:**

```
POST   /auth/login                    {username, password} → {session_id}
POST   /auth/logout
GET    /auth/me

GET    /waypoints
POST   /waypoints                     {name, scene_description, targets[], detection_window?, linger_threshold_seconds?}
PATCH  /waypoints/:id
DELETE /waypoints/:id
POST   /waypoints/reorder             {ids[]}

GET    /incidents                     ?from&to&status&waypoint_id&cursor
GET    /incidents/:id
POST   /incidents/:id/acknowledge
GET    /incidents/:id/clip            streams data/clips/{id}.mp4
GET    /incidents/:id/poster          streams data/clips/{id}.jpg
GET    /incidents/:id/playback        ?token=  (signed deep-link target)

GET    /subscribers
POST   /subscribers
DELETE /subscribers/:id

GET    /bot-configs/:channel
PUT    /bot-configs/:channel

GET    /system/status                 aggregate: bridge connected, robot state, last LCM event ts
WS     /events                        pipes from ov-bridge WS

GET    /openapi.json
```

**Auth.** Lucia v3 with session cookies for browser, `Authorization: Bearer {session_id}` for API clients. Argon2id passwords. First-boot wizard creates the initial operator.

**Definition of done:**
- [ ] All routes Zod-validated I/O
- [ ] WS pipes bridge events to clients
- [ ] OpenAPI spec at `/openapi.json`
- [ ] Integration tests per route

---

### 7.7 `ov-telegram` (TypeScript)

**Path:** `services/ov-telegram/`

**Responsibility.** Telegram bot + the entire agent layer.

**Token loading.** Reads `bot_configs.telegram` from SQLite. If `enabled=false` or missing, the service idles. Tokens updated via `ov-api` take effect on next poll cycle.

**Outbound flow (notifications):**
1. Subscribe to bridge WS.
2. On `incident.opened`: enqueue a pending notification (waiting up to 120s for `clip.ready`).
3. On `clip.ready` for that incident, or on timeout, send `sendMessage` per enabled subscriber with the format in §12 and the inline keyboard.

**Inbound flow (agent):**
1. Long-poll `getUpdates`.
2. On a user message, load `agent_conversations` row for `(telegram, chat_id)`. Limit context to last 20 turns.
3. If `pending_confirmation` is set and the message is `y/yes/confirm/n/no/cancel`, execute or drop the pending tool call, clear the field, post the result.
4. Otherwise, call the LLM with:
   - System prompt (§13)
   - Conversation history
   - MCP transport pointing at `http://robot:9990/mcp` (loads tool list dynamically each turn)
5. On tool calls:
   - **Safe-controlled tools** (any non-confirmation-required): execute, append result to conversation, loop until model emits a text reply.
   - **Confirmation-required tools** (the set in §13): instead of executing, store `{tool, args}` into `pending_confirmation`, post a one-line confirmation prompt, return.
6. Send the model's final text reply via `sendMessage`. If the reply includes a clip URL from any tool result, send as a separate message with link preview.

**Callback handler.** `View` button opens the signed deep link in the browser. `Acknowledge` button issues a `tools/call` for `acknowledge_incident(incident_id, telegram:{chat_id})`, edits the original message to add "ACK'D by @{handle} at {ts}".

**Env:**
```
SQLITE_PATH=/data/overwatch.db
BRIDGE_WS_URL=ws://ov-bridge:7001/events
MCP_URL=http://host.docker.internal:9990/mcp
ANTHROPIC_API_KEY=...
MODEL=claude-sonnet-4-6
DASHBOARD_BASE_URL=https://overwatch.example.com
DEEP_LINK_SECRET=...
DEEP_LINK_TTL_HOURS=24
```

**Definition of done:**
- [ ] Receives bot token via SQLite, hot-reloads
- [ ] Outbound: sends incident notification within 30s of `incident.opened` with working deep link
- [ ] Inbound: forwards messages to MCP-equipped LLM, returns prose responses
- [ ] Confirmation flow blocks destructive sport commands per §13 until explicit `y`
- [ ] Inline keyboard ack works
- [ ] Conversation memory persists across restarts

---

### 7.8 `ov-dashboard` (Next.js 14)

**Path:** `services/ov-dashboard/`

See §10 for pages, components, and UX rules.

---

## 8. State machine

```
                ┌──────────────────────────┐
                │           IDLE           │
                └────────────┬─────────────┘
                             │ start_surveillance
                ┌────────────▼─────────────┐
   ┌────────────►       PATROLLING         ◄──────────┐
   │            └────────────┬─────────────┘          │
   │                         │ target match           │
   │                         │ AND linger ≥ threshold │
   │            ┌────────────▼─────────────┐          │
   │            │       INSPECTING         │          │
   │            └────────────┬─────────────┘          │
   │                         │ dwell done OR          │
   │                         │ target lost OR         │
   │                         │ timeout                │
   │            ┌────────────▼─────────────┐          │
   │            │        COOLDOWN          │──────────┘
   │            └──────────────────────────┘
   │
   │  manual nav skill                pause_patrol
   │  (from MCP)                      ↑
   │            ┌──────────────────────────┐
   └────────────│     MANUAL_OVERRIDE      │
                └────────────┬─────────────┘
                             │ resume_patrol OR
                             │ idle for 60s
                             ▼
                     (back to PATROLLING)

(stop_surveillance from any state → IDLE)
```

**Invariants:**
- Only `PATROLLING` and `INSPECTING` may open new incidents. `MANUAL_OVERRIDE`, `COOLDOWN`, and `IDLE` may not.
- `INSPECTING` blocks new incident creation for other targets until it returns.
- `MANUAL_OVERRIDE` cancels any pending patrol goal and saves the patrol cursor; on resume, picks up from the saved cursor.
- `stop_surveillance` resets the cursor.

---

## 9. Core flows

### 9.1 Incident lifecycle

```
SurveillanceModule (PATROLLING)
  ├─ YOLO on every detector tick → publish /ow/detections
  ├─ At waypoint W with target T matching ≥ linger threshold:
  │    open incident_id
  │    transition INSPECTING
  │    publish /ow/incident_opened
  │
ov-bridge → INSERT incidents (clip_status='pending'), broadcast WS
ov-telegram → enqueue notification, wait for /ow/clip_ready (≤120s)
ClipRecorderModule → write mp4 + poster, publish /ow/clip_ready
ov-bridge → UPDATE incidents.clip_path/poster_path/clip_status='ready', broadcast WS
ov-telegram → send Telegram message with poster preview + deep link + inline keyboard
  │
SurveillanceModule (INSPECTING) → dwell complete → COOLDOWN → PATROLLING
  publish /ow/incident_closed (status='closed' | 'suppressed')
ov-bridge → UPDATE incidents (closed_at, status)
```

### 9.2 Manual control via Telegram

```
User → "go to the front gate"
ov-telegram → LLM with MCP tools
LLM → tools/call go_to_waypoint("front gate")
SurveillanceModule:
  → if state in {PATROLLING, INSPECTING}: cancel current goal, save patrol cursor
  → transition MANUAL_OVERRIDE, publish /ow/robot_state
  → resolve waypoint pose, publish goal_request
  → wait for goal_reached or 30s timeout
  → return result string
LLM → composes "On my way to front gate." then later "Arrived." replies
ov-telegram → sendMessage
SurveillanceModule (MANUAL_OVERRIDE):
  → 60s with no further manual command and no active goal → resume_patrol → PATROLLING
```

### 9.3 Confirmation-required sport command

```
User → "do a backflip"
LLM → tools/call execute_sport_command("Backflip")
ov-telegram intercepts:
  → store pending_confirmation = {tool:"execute_sport_command", args:{command_name:"Backflip"}}
  → send "Confirm Backflip? Reply y or n."
User → "y"
ov-telegram → tools/call execute_sport_command("Backflip")
LLM → "Backflip executed."
```

### 9.4 Agent query

```
User → "what happened in the last hour"
ov-telegram → LLM (now=current ts, last 20 turns)
LLM → tools/call search_incidents(start=now-1h, end=now)
SurveillanceQueryModule → SQLite read, return JSON
LLM → tools/call get_incident_details(id) for each interesting one
LLM → composes prose
ov-telegram → sendMessage
```

### 9.5 Waypoint setup

```
Operator drives Go2 to position 1 (via dashboard joystick or hands-on)
Operator (in dashboard) clicks "ADD WAYPOINT" → name "front_gate"
ov-api → MCP tools/call add_waypoint("front_gate")
SurveillanceModule → captures current odom pose, writes to dimos SpatialMemory,
                     publishes /ow/waypoint_sync
ov-bridge → UPSERT waypoints row
Dashboard → WS event renders new waypoint on map view
Repeat for further locations.
Operator → "START PATROL"
ov-api → MCP tools/call start_surveillance()
```

---

## 10. Dashboard

### 10.1 Pages

```
/login
/                            Overview: robot state pill, live MJPEG tile, last 10 incidents
/patrol                      Map view (occupancy grid) with waypoints; add/edit/reorder/delete
/incidents                   List + filters + calendar toggle
/incidents/[id]              Clip player, detections grouped by track, ack button, summary
/incidents/[id]/playback     Signed deep-link target (no auth required if token valid)
/calendar                    Month view, day cells with incident counts + density sparklines
/settings                    Bot tokens, subscribers, retention, system status
/settings/account
```

### 10.2 Key components

- **LiveTile** — `<img src="${OV_ROBOT_MJPEG}" />` (server proxies through `ov-api` to inject auth) with state pill overlay (`PATROLLING` amber, `INSPECTING` amber-fill, `MANUAL_OVERRIDE` muted, `OFFLINE` danger). Optional `<canvas>` overlay rendering bboxes from WS `/ow/detections`.
- **WaypointMap** — fetches latest `/global_costmap` snapshot from the bridge (a small new bridge endpoint), renders as grayscale image, overlays waypoints as numbered amber dots. Robot pose as filled amber circle, updates from WS. Click empty space → prompt to drive robot here (not v1, but reserve the affordance). Click existing waypoint → edit panel.
- **IncidentTimeline** — vertical list grouped by day. Each row: time, waypoint name, classes, status pill, poster thumbnail.
- **IncidentDetail** — `<video controls>` from `/incidents/:id/clip`. Right rail: summary, detections by track, ack button.
- **Calendar** — month grid; each day cell shows incident count and a 24-bar density sparkline of detection density. Click → drill into day's timeline.

### 10.3 UX rules

- No loading spinners. Skeleton rows in `var(--surface-elev)` that match final shape.
- Numbers and timestamps in JetBrains Mono.
- All action buttons uppercase mono.
- No animation longer than 150ms, easing `ease-out` only.

### 10.4 Definition of done

- [ ] All pages routable; auth gates everything except `/login` and `/incidents/[id]/playback?token=`
- [ ] Live tile reaches < 2s latency over LAN with MJPEG
- [ ] WaypointMap renders occupancy grid + waypoints + live pose
- [ ] Calendar loads a month of data with 1000 incidents in under 500ms
- [ ] Lighthouse perf > 90 on overview
- [ ] Responsive down to 768px (no separate mobile layout)

---

## 11. Authentication

- Lucia v3 with session cookies for browser, bearer tokens for API clients
- Single role `operator` (admin reserved for future)
- Argon2id passwords
- First-boot wizard creates initial operator. No signup endpoint after.
- Password reset via CLI: `pnpm -F @overwatch/api reset-password <username>`
- Deep-link tokens: HMAC-SHA256, 24h TTL, signed payload `{incident_id, exp}`. Verified at `/incidents/[id]/playback` route only.

---

## 12. Notification format (Telegram)

```
[OVERWATCH PATROL] · {waypoint.name}
{classes} detected · {opened_at relative}
{summary or 'Recording…'}

[ View ]  [ Acknowledge ]
```

Poster image attached as a photo where available. Inline buttons carry `callback_data` `view:{incident_id}` and `ack:{incident_id}`.

Subsequent state messages (manual control progress, arrival, etc.) are plain text replies to the originating conversation, prefixed with state, e.g.:

```
PATROLLING → MANUAL_OVERRIDE · heading to front_gate
```
```
arrived · front_gate
```

---

## 13. Agent tools

The agent IS the dimos MCP server. The Telegram bot configures its MCP client with the full tool list, which spans both `SurveillanceQueryModule` (read-only) and the rest of the dimos skill containers exposed in `go2_overwatch` (navigation + sport + speak + surveillance control).

### Available tools (LLM-visible)

**Read-only (SurveillanceQueryModule):**
- `search_incidents`, `get_incident_details`, `get_compound_status`, `get_waypoint_context`, `summarize_period`, `acknowledge_incident`

**Surveillance control (SurveillanceModule):**
- `start_surveillance`, `stop_surveillance`, `pause_patrol`, `resume_patrol`
- `add_waypoint`, `delete_waypoint`, `list_waypoints`
- `set_targets`, `force_inspect`
- `go_to_waypoint`, `get_robot_state`

**Direct movement (dimos NavigationSkillContainer + UnitreeSkillContainer + PersonFollowSkillContainer + SpeakSkill):**
- `navigate_with_text(query)`
- `relative_move(forward, left, degrees)`
- `stop_navigation()`
- `execute_sport_command(command_name)`
- `follow_person(query)`, `stop_following()`
- `speak(text, blocking=False)`
- `wait(seconds)`, `current_time()`

### Confirmation-required tool set

`ov-telegram` intercepts these and requires explicit `y` reply before executing:

```
execute_sport_command in {
  FrontFlip, Backflip, LeftFlip, RightFlip,
  Handstand, FrontJump, FrontPounce, Scrape,
  Bound, MoonWalk
}
stop_surveillance
delete_waypoint
```

All other tools execute immediately.

### System prompt

```
You are the Overwatch Patrol agent for an autonomous surveillance robot. You
answer questions about waypoints, incidents, and robot status concisely and
factually. You can also control the robot: move it, navigate to a waypoint,
stop, follow a person, speak, or perform sport commands.

Rules:
- Use tools to look up data. Never fabricate incident details.
- Time references ("last hour", "today", "yesterday") resolve against {now_iso}.
- Prefer go_to_waypoint over navigate_with_text when the destination is a
  named waypoint.
- Always announce what you are about to do in one short sentence BEFORE
  calling a control tool.
- For sport commands in {FrontFlip, Backflip, LeftFlip, RightFlip, Handstand,
  FrontJump, FrontPounce, Scrape, Bound, MoonWalk}, the operator will need to
  confirm. Tell them what you're about to do and that they should reply y to
  confirm.
- Keep replies tight. Status before sentiment. No exclamation marks.
- The operator is reaching you via Telegram. Keep messages under Telegram's
  4096-character limit; paginate or summarize if needed.
```

### Conversation memory

Stored in `agent_conversations` keyed by `(channel, handle)`. Last 20 turns retained. `pending_confirmation` field holds `{tool, args}` while awaiting `y/n`.

---

## 14. Deployment

### 14.1 `docker-compose.yml`

```yaml
services:
  ov-bridge:
    build: services/ov-bridge
    network_mode: host                # needs LCM multicast
    volumes: [./data:/data]
    environment:
      LCM_URL: udpm://239.255.76.67:7667?ttl=1
      SQLITE_PATH: /data/overwatch.db
      WS_PORT: 7001

  ov-api:
    build: services/ov-api
    depends_on: [ov-bridge]
    volumes: [./data:/data]
    ports: ["3000:3000"]
    environment:
      SQLITE_PATH: /data/overwatch.db
      SESSION_SECRET: ${SESSION_SECRET}
      BRIDGE_WS_URL: ws://host.docker.internal:7001/events

  ov-telegram:
    build: services/ov-telegram
    depends_on: [ov-bridge]
    volumes: [./data:/data]
    environment:
      SQLITE_PATH: /data/overwatch.db
      BRIDGE_WS_URL: ws://host.docker.internal:7001/events
      MCP_URL: http://host.docker.internal:9990/mcp
      ANTHROPIC_API_KEY: ${ANTHROPIC_API_KEY}
      MODEL: claude-sonnet-4-6
      DASHBOARD_BASE_URL: ${DASHBOARD_BASE_URL}
      DEEP_LINK_SECRET: ${DEEP_LINK_SECRET}

  ov-dashboard:
    build: services/ov-dashboard
    depends_on: [ov-api]
    ports: ["3001:3000"]
    environment:
      OV_API_URL: http://ov-api:3000
      OV_ROBOT_MJPEG: http://host.docker.internal:8080/video_feed/color_image

  caddy:
    image: caddy:2-alpine
    ports: ["80:80","443:443"]
    volumes: [./infra/caddy/Caddyfile:/etc/caddy/Caddyfile, caddy-data:/data]

volumes:
  caddy-data:
```

The dimos process runs on the robot host (outside Docker) — it needs LCM, ROS, and hardware access. Compose covers the app plane only.

### 14.2 Makefile

```
make setup           # install dimos + extension + pnpm + migrate
make robot           # python -m overwatch_patrol.blueprints.go2_overwatch
make sim             # same blueprint but with Mujoco sim connection
make dev             # docker compose up -d
make logs SVC=...    # tail one service
make seed            # create admin user, seed default subscribers + retention
make reset           # nuke ./data
make codegen         # regenerate Pydantic events from zod
make migrate         # apply SQLite migrations
make e2e             # synthetic-detector smoke test
make link-dimos PATH=../dimos
make unlink-dimos
```

### 14.3 `.env.example`

Ship a complete file covering every variable referenced in §7 and §14.1. README points to it as the first step after `git clone`.

---

## 15. Definition of done (overall)

### Functional

- [ ] Fresh `git clone --recurse-submodules && make setup && make robot && make dev` brings the system up
- [ ] First-boot wizard creates operator and login works
- [ ] Operator adds ≥3 waypoints from dashboard or Telegram; they appear in SpatialMemory and SQLite
- [ ] Setting a Telegram bot token in settings activates the bot within 30s
- [ ] Starting patrol cycles waypoints in order; state changes reflect live in dashboard and bridge WS
- [ ] A person at a waypoint for ≥ linger threshold triggers an inspection deviation and `incident_opened`
- [ ] Telegram message arrives within 30s of `incident_opened` with deep link + poster + inline keyboard
- [ ] Deep link opens `/incidents/[id]/playback` and the overlay clip plays
- [ ] Acknowledge button updates incident status in dashboard
- [ ] "what happened in the last hour" returns a coherent answer using real incident data
- [ ] "go to the front gate" makes the robot move there; chat receives state updates and "arrived" message
- [ ] "stop" cancels current motion
- [ ] "sit" / "wiggle hips" execute immediately; "backflip" prompts for confirmation first
- [ ] Manual nav from chat pauses patrol; `resume_patrol` (or 60s idle) returns to patrolling from the saved cursor
- [ ] Detector keeps running in MANUAL_OVERRIDE but no new incidents open
- [ ] Suppressed incidents (target leaves before linger threshold) are recorded but not notified

### Non-functional

- [ ] All services have `/health`
- [ ] Structured JSON logs everywhere; respect `LOG_LEVEL`
- [ ] No hardcoded secrets
- [ ] All HTTP endpoints auth-protected except `/auth/login`, `/health`, signed deep-links
- [ ] OpenAPI spec at `/openapi.json` from `ov-api`
- [ ] SQLite migrations reversible
- [ ] Docker images < 1GB each (excluding any model weights baked in)

### Documentation

- [ ] `README.md` covers prereqs, quickstart, env vars, troubleshooting
- [ ] Each service has a one-paragraph `README.md`
- [ ] Architecture diagram in `README.md`
- [ ] First-boot wizard documented

---

## 16. Testing

### Per service
- Unit tests for all pure functions and the state machine (target 80% line coverage on non-IO code)
- Integration tests for service ↔ SQLite and service ↔ LCM interactions
- `pnpm test` (TS) / `uv run pytest` (Python)

### End-to-end

`make e2e` script:
1. `docker compose -f docker-compose.dev.yml up -d`
2. Boot the robot stack with a synthetic detection injector that replaces YOLO with a scripted stream
3. Seed admin user + 2 waypoints + a Telegram test webhook receiver
4. Run Playwright suite:
   - Log in
   - Start patrol
   - Inject a person detection at waypoint 1 → verify incident in dashboard
   - Verify Telegram receiver receives notification
   - Send agent message → verify sensible response
   - Send "go to waypoint 2" → verify robot state transitions and arrives
   - Send "backflip" → verify confirmation prompt, then "y" → verify execution
5. Tear down

Must pass green in CI.

### Sim path

For developers without a Go2: `make sim` boots the blueprint against the dimos Mujoco connection (`MujocoConnection` referenced in `SurveillanceModule._create_visual_servo`). YOLO runs on the sim camera. Everything downstream is identical.

---

## 17. Out of scope (v1)

- Multi-robot fleet
- WhatsApp / Slack / Discord / email
- Face recognition, person ID, cross-camera/cross-room handoff
- Audio analysis
- Mobile native apps
- SSO / SAML / OAuth
- Role-based access beyond `operator`
- Push notifications via APNs/FCM
- Encrypted-at-rest storage (rely on infra-level encryption)
- Postgres / MinIO (deferred until SQLite/local disk show real limits)
- VLM-generated incident summaries (column reserved; fill later)

File future work as GitHub issues with `v2` label.

---

## 18. Implementation order

1. **Workspace bootstrap.** Repo + submodule + `make setup`. Verify `python -c "import dimos"` works against the submodule and the dimos test suite passes (`uv run pytest vendor/dimos/dimos/agents`).
2. **Schema package.** Wire zod → Pydantic codegen end-to-end. A single event round-trips.
3. **`WaypointPatrolRouter`.** Subclass and unit-test against synthetic waypoint lists.
4. **`SurveillanceModule` skeleton.** Fork `SecurityModule`. Implement all five states with logging, no real detection yet. Verify state transitions over LCM.
5. **`go2_overwatch` blueprint.** Compose with `unitree_go2_spatial + McpServer + McpClient + SpeakSkill + SurveillanceModule`. Verify `dimos mcp list-tools` shows expected set.
6. **Sim run.** `make sim` patrol-cycles waypoints in Mujoco.
7. **Real detection inline.** Wire YOLO inside `SurveillanceModule._patrol_step`. Verify `/ow/detections` flows.
8. **`ClipRecorderModule`.** Writes valid MP4s. Verify in a browser.
9. **`SurveillanceQueryModule`.** Tools return correct JSON. Verify via `dimos mcp call`.
10. **`ov-bridge`.** LCM → SQLite + WS. Verify writes for all event types.
11. **`ov-api` + minimal dashboard.** Login, waypoint list, incident list, clip viewer. No map view yet.
12. **`ov-telegram` outbound.** Notifications fire end-to-end.
13. **`ov-telegram` inbound (agent).** MCP client wired. Read-only flow works.
14. **`ov-telegram` control flow.** `go_to_waypoint`, `stop`, `relative_move` work from chat.
15. **Confirmation flow.** Sport commands require `y`.
16. **WaypointMap.** Occupancy grid + waypoints + live pose.
17. **Calendar view + polish + `make e2e`.**

Each step lands green CI before moving on.

---

## 19. Appendix — scaffolding hints

### `dimos_ext/pyproject.toml`

```toml
[project]
name = "overwatch-patrol-ext"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "dimos",                  # provided by vendor submodule, editable install
  "ultralytics>=8.3",
  "opencv-python>=4.10",
  "ffmpeg-python>=0.2",
  "pydantic>=2",
]

[tool.uv.sources]
dimos = { path = "../vendor/dimos", editable = true }
```

### `dimos_ext/overwatch_patrol/blueprints/go2_overwatch.py`

```python
from dimos.agents.mcp.mcp_client import McpClient
from dimos.agents.mcp.mcp_server import McpServer
from dimos.core.coordination.blueprints import autoconnect
from dimos.robot.unitree.go2.blueprints.smart.unitree_go2_spatial import (
    unitree_go2_spatial,
)
from dimos.robot.unitree.go2.blueprints.smart._with_jpeg import _with_jpeglcm
from dimos.agents.skills.navigation import NavigationSkillContainer
from dimos.agents.skills.person_follow import PersonFollowSkillContainer
from dimos.agents.skills.speak_skill import SpeakSkill
from dimos.robot.unitree.unitree_skill_container import UnitreeSkillContainer
from dimos.robot.unitree.go2.connection import GO2Connection

from overwatch_patrol.surveillance_module import SurveillanceModule
from overwatch_patrol.clip_recorder import ClipRecorderModule
from overwatch_patrol.query_module import SurveillanceQueryModule

go2_overwatch = autoconnect(
    _with_jpeglcm,
    unitree_go2_spatial,
    SurveillanceModule.blueprint(camera_info=GO2Connection.camera_info_static),
    ClipRecorderModule.blueprint(output_dir="/data/clips"),
    SurveillanceQueryModule.blueprint(sqlite_path="/data/overwatch.db"),
    NavigationSkillContainer.blueprint(),
    PersonFollowSkillContainer.blueprint(camera_info=GO2Connection.camera_info_static),
    UnitreeSkillContainer.blueprint(),
    SpeakSkill.blueprint(),
    McpServer.blueprint(),
    McpClient.blueprint(),
)
```

### Submodule pinning

`.gitmodules`:
```
[submodule "vendor/dimos"]
    path = vendor/dimos
    url = https://github.com/dimensionalOS/dimos.git
    shallow = true
```

### Bridge skeleton (`services/ov-bridge/bridge.py`, conceptual)

```python
import asyncio, json, sqlite3
import lcm
from aiohttp import web
from dimos_lcm.std_msgs import String
# Pydantic event models generated from packages/schemas:
from overwatch_patrol.events import (
    IncidentOpened, IncidentClosed, ClipReady,
    RobotStateChanged, FrameDetections, WaypointSync,
)

# subscribe to /ow/* topics, dispatch by .type field, write SQLite, broadcast WS.
# (full implementation ~150 LOC)
```
