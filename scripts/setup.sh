#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "▸ creating .env from .env.example — fill in your secrets before continuing"
  cp .env.example .env
fi

# Submodule (skip silently if not configured)
if [ -f .gitmodules ]; then
  git submodule update --init --recursive || true
fi

if [ -d vendor/dimos ]; then
  echo "▸ installing dimos (editable)"
  uv pip install -e ./vendor/dimos[misc] || pip install -e ./vendor/dimos
fi

echo "▸ installing dimos_ext"
uv pip install -e ./dimos_ext || pip install -e ./dimos_ext || true

echo "▸ installing TS workspaces"
pnpm install

echo "▸ codegen Pydantic events"
pnpm -F @overwatch/schemas codegen

echo "▸ applying SQLite migrations"
mkdir -p ./data
SQLITE_PATH=$(pwd)/data/overwatch.db pnpm -F @overwatch/api migrate

echo "✓ setup complete"
