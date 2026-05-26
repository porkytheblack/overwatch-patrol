# ov-dashboard

Next.js 14 App Router · operator UI for Overwatch Patrol. Brand: amber accent on near-black, mono numerics, zero-radius geometry.

## Pages

| Path                                | Description                                     |
|-------------------------------------|-------------------------------------------------|
| `/login`                            | sign in                                         |
| `/setup`                            | first-boot operator creation                    |
| `/`                                 | overview · live tile + recent incidents         |
| `/patrol`                           | waypoint list/edit                              |
| `/incidents`                        | timeline grouped by day                         |
| `/incidents/[id]`                   | clip player, detections, ack                    |
| `/incidents/[id]/playback?token=`   | signed-token public clip page                   |
| `/calendar`                         | month grid with daily counts + 24h sparklines   |
| `/settings`                         | telegram token, subscribers, system status      |

All pages except `/login`, `/setup`, and `/incidents/[id]/playback` are auth-gated. The dashboard speaks only to `ov-api` (HTTP + WS).
