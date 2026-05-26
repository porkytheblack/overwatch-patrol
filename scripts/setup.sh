#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f .env ]; then
  echo "▸ creating .env from .env.example — fill in your secrets before continuing"
  cp .env.example .env
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "▸ uv not found — install via: curl -LsSf https://astral.sh/uv/install.sh | sh"
  exit 1
fi

# Python venv + dimos from PyPI (per dimos's recommended install path).
echo "▸ creating venv (Python 3.12) if missing"
[ -d .venv ] || uv venv --python "3.12"
# shellcheck disable=SC1091
source .venv/bin/activate

echo "▸ installing dimos[base,unitree]"
uv pip install 'dimos[base,unitree]'

echo "▸ installing dimos_ext (editable)"
uv pip install -e ./dimos_ext

echo "▸ installing TS workspaces"
pnpm install

echo "▸ codegen Pydantic events"
pnpm -F @overwatch/schemas codegen

echo "▸ applying SQLite migrations"
mkdir -p ./data
SQLITE_PATH=$(pwd)/data/overwatch.db pnpm -F @overwatch/api migrate

echo "✓ setup complete"
