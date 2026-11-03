.DEFAULT_GOAL := help

# The bundles apb-catalog builds; CI downloads them from apb-catalog's latest release into build/.
APB_CATALOG_BUILD ?= ../apb-catalog/build

.PHONY: help install typecheck test check build docs docs-serve clean

help:  ## Show the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

install:  ## Install the pinned dependencies
	npm ci

typecheck:  ## Type-check sources and tests
	npx tsc --noEmit

test:  ## Run every test against the bundles in APB_CATALOG_BUILD
	APB_CATALOG_BUILD=$(APB_CATALOG_BUILD) npx tsx --test tests/*.test.ts

check: typecheck test docs  ## The gate: type check, tests and the docs site

build:  ## Compile src/ into dist/
	rm -rf dist
	npx tsc -p tsconfig.build.json

docs:  ## Build the documentation site into docs/.vitepress/dist
	npx vitepress build docs

docs-serve:  ## Serve the documentation locally, rebuilt on every change
	npx vitepress dev docs

clean:  ## Remove build output
	rm -rf dist docs/.vitepress/dist docs/.vitepress/cache
