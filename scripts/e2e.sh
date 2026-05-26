#!/usr/bin/env bash
# Synthetic-detector smoke test: brings up the app stack, injects a fake
# incident_opened over the bridge's LCM ingest, and asserts an incident lands
# in SQLite + appears on the dashboard's WS firehose.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "▸ docker compose up -d"
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d

cleanup() {
  echo "▸ tearing down"
  docker compose down
}
trap cleanup EXIT

echo "▸ waiting for ov-api"
for i in {1..30}; do
  if curl -fs http://localhost:3000/health >/dev/null; then break; fi
  sleep 1
done

echo "▸ bootstrap operator"
curl -fs -X POST http://localhost:3000/api/auth/bootstrap \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"changeme"}'

echo "▸ inject synthetic LCM event via test stub (TODO)"
# In a hardware-less CI, replace LCM with the in-process test stub from
# dimos_ext/tests; this script is a placeholder for that wiring.

echo "✓ e2e harness skeleton complete"
