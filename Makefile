.PHONY: setup setup-sim ensure-env robot sim dev dev-host down host-down logs seed reset codegen migrate e2e dev-dimos

SVC ?=

# Ensure a .env exists with sane secrets. Generates one from .env.example
# and fills in SESSION_SECRET / DEEP_LINK_SECRET via openssl if they're
# still the placeholders. Also migrates old container-style data paths
# (/data/...) to repo-relative paths on host runs.
ensure-env:
	@if [ ! -f .env ]; then \
		echo "▸ creating .env from .env.example"; \
		cp .env.example .env; \
	fi
	@if grep -q '^SESSION_SECRET=change-me' .env 2>/dev/null; then \
		echo "▸ generating SESSION_SECRET"; \
		secret="$$(openssl rand -hex 32)"; \
		sed -i.bak "s|^SESSION_SECRET=.*|SESSION_SECRET=$$secret|" .env && rm -f .env.bak; \
	fi
	@if grep -q '^DEEP_LINK_SECRET=change-me' .env 2>/dev/null; then \
		echo "▸ generating DEEP_LINK_SECRET"; \
		secret="$$(openssl rand -hex 32)"; \
		sed -i.bak "s|^DEEP_LINK_SECRET=.*|DEEP_LINK_SECRET=$$secret|" .env && rm -f .env.bak; \
	fi
	@if grep -q '^SQLITE_PATH=/data/' .env 2>/dev/null; then \
		echo "▸ migrating SQLITE_PATH /data/... → ./data/... (host-friendly)"; \
		sed -i.bak 's|^SQLITE_PATH=/data/|SQLITE_PATH=./data/|' .env && rm -f .env.bak; \
	fi
	@if grep -q '^STATION_DB_PATH=/data/' .env 2>/dev/null; then \
		echo "▸ migrating STATION_DB_PATH /data/... → ./data/..."; \
		sed -i.bak 's|^STATION_DB_PATH=/data/|STATION_DB_PATH=./data/|' .env && rm -f .env.bak; \
	fi
	@mkdir -p ./data
	@echo "✓ .env ready"

# ---- Python ---------------------------------------------------------------

setup: ensure-env
	@echo "▸ creating uv venv (Python 3.12)"
	@uv venv --python "3.12" || true
	@echo "▸ installing dimos[base,unitree] from PyPI"
	uv pip install 'dimos[base,unitree]'
	@echo "▸ installing dimos_ext (editable)"
	uv pip install -e ./dimos_ext
	@echo "▸ installing ov-bridge runtime deps"
	uv pip install -r services/ov-bridge/requirements.txt
	@echo "▸ installing TS workspaces"
	pnpm install
	@echo "▸ codegen Pydantic events from zod"
	pnpm -F @overwatch/schemas codegen
	@echo "▸ apply SQLite migrations"
	pnpm -F @overwatch/api migrate
	@echo "✓ setup complete"

setup-sim: ensure-env
	@echo "▸ creating uv venv (Python 3.12)"
	@uv venv --python "3.12" || true
	@echo "▸ installing dimos[base,unitree,sim] (Mujoco backend)"
	uv pip install 'dimos[base,unitree,sim]'
	uv pip install -e ./dimos_ext[sim]
	uv pip install -r services/ov-bridge/requirements.txt
	pnpm install
	pnpm -F @overwatch/schemas codegen
	pnpm -F @overwatch/api migrate
	@echo "✓ sim setup complete"

# Develop dimos and overwatch-patrol side-by-side (editable install of a
# local checkout). Usage: `make dev-dimos DIMOS_PATH=../dimos`
dev-dimos:
	@test -n "$(DIMOS_PATH)" || (echo "usage: make dev-dimos DIMOS_PATH=../dimos" && exit 1)
	uv pip install -e $(DIMOS_PATH)
	@echo "✓ dimos editable from $(DIMOS_PATH)"

robot:
	python -m overwatch_patrol.blueprints.go2_overwatch

sim:
	OV_SIM=1 python -m overwatch_patrol.blueprints.go2_overwatch

# ---- App plane ------------------------------------------------------------

dev: ensure-env
	docker compose up -d --build

down:
	docker compose down

# ---- Docker-less ----------------------------------------------------------
# Run the app plane directly on the host (no Docker). Useful on macOS when
# you don't want to install Docker Desktop / OrbStack. Logs to ./logs/*.log
# and writes pids to ./logs/*.pid. Use `make host-down` to stop everything.
HOST_LOGS := ./logs

dev-host: ensure-env
	@mkdir -p $(HOST_LOGS)
	@echo "▸ starting ov-bridge on :7001"
	@PYTHONPATH=services/ov-bridge \
		.venv/bin/python -m bridge > $(HOST_LOGS)/ov-bridge.log 2>&1 & \
		echo $$! > $(HOST_LOGS)/ov-bridge.pid
	@echo "▸ starting ov-api on :3000"
	@cd services/ov-api && PORT=3000 pnpm dev > ../../$(HOST_LOGS)/ov-api.log 2>&1 & \
		echo $$! > $(HOST_LOGS)/ov-api.pid
	@echo "▸ starting ov-telegram (no port; /health on :7100)"
	@cd services/ov-telegram && pnpm dev > ../../$(HOST_LOGS)/ov-telegram.log 2>&1 & \
		echo $$! > $(HOST_LOGS)/ov-telegram.pid
	@echo "▸ starting ov-dashboard on :3001"
	@cd services/ov-dashboard && OV_API_URL=http://localhost:3000 pnpm dev -p 3001 > ../../$(HOST_LOGS)/ov-dashboard.log 2>&1 & \
		echo $$! > $(HOST_LOGS)/ov-dashboard.pid
	@sleep 1
	@echo ""
	@echo "✓ app plane up (host mode)"
	@echo "  dashboard:  http://localhost:3001"
	@echo "  api:        http://localhost:3000"
	@echo "  bridge ws:  ws://localhost:7001/events"
	@echo "  telegram /health: http://localhost:7100/health"
	@echo ""
	@echo "  logs: tail -f $(HOST_LOGS)/*.log"
	@echo "  stop: make host-down"

host-down:
	@for f in $(HOST_LOGS)/*.pid; do \
		[ -f "$$f" ] && kill "$$(cat $$f)" 2>/dev/null && echo "▸ stopped $$(basename $$f .pid)" || true; \
		rm -f "$$f"; \
	done
	@echo "✓ all host services stopped"

logs:
ifeq ($(SVC),)
	docker compose logs -f
else
	docker compose logs -f $(SVC)
endif

seed:
	pnpm -F @overwatch/api seed

reset:
	rm -rf ./data
	@echo "✓ ./data wiped"

codegen:
	pnpm -F @overwatch/schemas codegen

migrate: ensure-env
	pnpm -F @overwatch/api migrate

e2e:
	bash ./scripts/e2e.sh
