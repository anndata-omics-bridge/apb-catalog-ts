.DEFAULT_GOAL := help

# The bundles apb-catalog builds; CI downloads them from apb-catalog's latest release into build/.
APB_CATALOG_BUILD ?= ../apb-catalog/build

.PHONY: help install typecheck test check build clean

help:  ## Show the targets
	@grep -E '^[a-z-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  make %-10s %s\n", $$1, $$2}'

install:  ## Install the pinned dependencies
	npm ci

typecheck:  ## Type-check sources and tests
	npx tsc --noEmit

test:  ## Run every test against the bundles in APB_CATALOG_BUILD
	APB_CATALOG_BUILD=$(APB_CATALOG_BUILD) npx tsx --test tests/*.test.ts

check: typecheck test  ## The gate: type check and tests

build:  ## Compile src/ into dist/
	rm -rf dist
	npx tsc -p tsconfig.build.json

clean:  ## Remove build output
	rm -rf dist
