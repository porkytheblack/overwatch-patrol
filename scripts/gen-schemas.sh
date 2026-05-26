#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm -F @overwatch/schemas codegen
