.PHONY: setup setup-sim ensure-env robot sim dev down logs seed reset codegen migrate e2e dev-dimos

SVC ?=

# Ensure a .env exists with sane secrets. Generates one from .env.example
# and fills in SESSION_SECRET / DEEP_LINK_SECRET via openssl if they're
# still the placeholders.
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
	@echo "✓ .env ready"

# ---- Python ---------------------------------------------------------------

setup: ensure-env
	@echo "▸ creating uv venv (Python 3.12)"
	@uv venv --python "3.12" || true
	@echo "▸ installing dimos[base,unitree] from PyPI"
	uv pip install 'dimos[base,unitree]'
	@echo "▸ installing dimos_ext (editable)"
	uv pip install -e ./dimos_ext
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
