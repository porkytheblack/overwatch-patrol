# ov-api

Hono + Lucia + Drizzle (better-sqlite3) HTTP service. Owns auth, waypoint/incident/subscriber CRUD, signed deep-link verification, and the dashboard's WebSocket fan-out from `ov-bridge`.

## Routes

| Method | Path                              | Notes |
|--------|-----------------------------------|-------|
| POST   | `/api/auth/login`                 | session cookie + bearer |
| POST   | `/api/auth/logout`                | |
| GET    | `/api/auth/me`                    | |
| GET    | `/api/auth/needs-setup`           | first-boot check |
| POST   | `/api/auth/bootstrap`             | one-shot first user |
| GET    | `/api/waypoints`                  | |
| POST   | `/api/waypoints`                  | |
| PATCH  | `/api/waypoints/:id`              | |
| DELETE | `/api/waypoints/:id`              | |
| POST   | `/api/waypoints/reorder`          | |
| GET    | `/api/incidents`                  | filters via query |
| GET    | `/api/incidents/:id`              | |
| POST   | `/api/incidents/:id/acknowledge`  | |
| GET    | `/api/incidents/:id/playback`     | signed-token public |
| GET    | `/api/incidents/:id/clip`         | mp4 stream |
| GET    | `/api/incidents/:id/poster`       | jpg |
| GET    | `/api/subscribers`                | |
| POST   | `/api/subscribers`                | |
| DELETE | `/api/subscribers/:id`            | |
| GET    | `/api/bot-configs/:channel`       | |
| PUT    | `/api/bot-configs/:channel`       | |
| GET    | `/api/system/status`              | |
| GET    | `/openapi.json`                   | |
| WS     | `/ws` / `/api/ws`                 | fan-out from bridge |
