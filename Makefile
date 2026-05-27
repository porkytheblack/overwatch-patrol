.PHONY: setup setup-sim robot sim dev down logs seed reset codegen migrate e2e dev-dimos

SVC ?=

# ---- Python ---------------------------------------------------------------

setup:
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

setup-sim:
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

dev:
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

migrate:
	pnpm -F @overwatch/api migrate

e2e:
	bash ./scripts/e2e.sh
