# ov-site

Public landing page for Overwatch installation and provisioning: custom control software, WhatsApp integration, and Telegram with smart monitoring. Next.js 14 (App Router) + Tailwind, sharing the dashboard's brand tokens (spec §0).

```bash
pnpm -F @overwatch/site dev      # http://localhost:3002  (or: make site)
pnpm -F @overwatch/site build && pnpm -F @overwatch/site start
```

The homepage is prerendered static. The only server code is `POST /api/enquiry`, behind the survey form.

## Configuration

All optional. Set them in the hosting environment, or in `services/ov-site/.env.local` for local dev.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_SITE_URL` | Canonical URL, used for Open Graph metadata |
| `NEXT_PUBLIC_CONTACT_EMAIL` | Shown in the contact section and footer, and as the fallback if the form can't send |
| `NEXT_PUBLIC_CONTACT_WHATSAPP_URL` | Full `https://wa.me/<number>` link |
| `NEXT_PUBLIC_CONTACT_TELEGRAM_URL` | Full `https://t.me/<handle>` link |
| `ENQUIRY_TELEGRAM_BOT_TOKEN` + `ENQUIRY_TELEGRAM_CHAT_ID` | Deliver survey requests to a Telegram chat as plain text |
| `ENQUIRY_WEBHOOK_URL` | Deliver survey requests as JSON (`type: "survey_request"`) to any webhook |

Contact fields that are left empty are not rendered. If no enquiry sink is configured, the endpoint returns `503` and the form tells the visitor to use the contact email.

`NEXT_PUBLIC_*` values are inlined at build time, so rebuild after changing them.

### Enquiry endpoint

| Case | Response |
|---|---|
| Valid request, delivered to at least one sink | `200 {ok, reference}` |
| Missing or invalid fields | `422 {error: "invalid", fields}` |
| Body isn't JSON | `400` |
| Honeypot field filled (bots) | `200`, nothing delivered |
| No sink configured | `503 {error: "not_configured"}` |
| Every configured sink failed | `502` |

There is no rate limiting. If the page gets spam beyond what the honeypot catches, put the route behind your host's firewall or bot protection.

## Layout

```
src/
├── app/                 layout, page, globals.css, api/enquiry
├── components/          one file per section, plus shared pieces:
│   ├── ConsoleMock      hero operator console (animated patrol map, camera, incidents)
│   ├── Showcase         scripted WhatsApp/Telegram demo, synced with robot state + tool calls
│   ├── SiteMap          shared compound map SVG and waypoints
│   └── CameraView       schematic camera frames (dock/person, fence/vehicle, gate/clear)
└── lib/
    ├── scripts.ts       demo conversations: edit here to change the "In action" scenarios
    └── site.ts          nav + contact config
```

The demo scripts in `src/lib/scripts.ts` mirror the production message format, states and MCP tool names (spec §12–13). Keep them in sync if those change.

## Copy notes

- WhatsApp integration and alert escalation are sold as provisioned services. Neither is in this repo yet (Telegram is the only shipped channel), so the page presents them as part of an installation, not as existing product features.
- Figures on the page come from the spec and defaults: a 30 s incident-to-alert target, 5 s clip pre-roll, and 24 h signed-link TTL (`DEEP_LINK_TTL_HOURS`). Update the copy if those change.
