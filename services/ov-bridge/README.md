# ov-bridge

The only thing that crosses planes. Subscribes to `/ow/*` LCM topics, persists to SQLite, broadcasts every received event over WebSocket at `ws://bridge:7001/events`.

- LCM is optional at runtime — if the `lcm` Python package isn't available, the bridge still serves WS/HTTP (no ingestion). Install `lcm` on the robot host.
- All writes are owned here; ov-api and ov-telegram only read SQLite (or write via API routes).
