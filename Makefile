.PHONY: setup robot sim dev down logs seed reset codegen migrate e2e link-dimos unlink-dimos

SVC ?=

setup:
	@echo "▸ installing dimos (editable, from submodule)"
	@if [ -d vendor/dimos ]; then uv pip install -e ./vendor/dimos; else echo "  vendor/dimos missing — clone with --recurse-submodules"; fi
	@echo "▸ installing dimos_ext (editable)"
	@uv pip install -e ./dimos_ext || true
	@echo "▸ installing TS workspaces"
	pnpm install
	@echo "▸ codegen Pydantic events from zod"
	pnpm -F @overwatch/schemas codegen
	@echo "▸ apply SQLite migrations"
	pnpm -F @overwatch/api migrate
	@echo "✓ setup complete"

robot:
	python -m overwatch_patrol.blueprints.go2_overwatch

sim:
	OV_SIM=1 python -m overwatch_patrol.blueprints.go2_overwatch

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

link-dimos:
	@test -n "$(DIMOS_PATH)" || (echo "usage: make link-dimos DIMOS_PATH=../dimos" && exit 1)
	rm -rf vendor/dimos
	ln -s $(DIMOS_PATH) vendor/dimos
	@echo "✓ vendor/dimos → $(DIMOS_PATH)"

unlink-dimos:
	@test -L vendor/dimos && rm vendor/dimos && git submodule update --init vendor/dimos || true
	@echo "✓ vendor/dimos restored to submodule"
