# apb-catalog-ts — agent rules

The closest `AGENTS.md` wins. Explicit user instructions override this file. The workspace [AGENTS.md](../AGENTS.md) applies where this file is silent.

## What this package is

apb-catalog's API in TypeScript for the web apps, published as `@anndata-omics-bridge/apb-catalog`. It reimplements the catalog on the bundle apb-catalog releases, never apb2's conversion. The plan is TODO_catalog_typescript.md under the apb-catalog planning folder.

- The bundle is served with the data and fetched by `Bundle.load(url)`; the package ships no bundle
- `DataCatalog.load` starts from a result's provenance JSON (the Parquet result's `manifest.json`); lookups never fetch Parquet, data calls fetch one file once
- `tests/catalog.test.ts`, `tests/data-catalog.test.ts` and `tests/tables.test.ts` run every answer the test bundle records; a change that makes TypeScript answer differently from Python is a bug here, or a change that belongs in apb-catalog first
- Each source file mirrors one apb-catalog module and one apbCatalogR file: `source.ts`, `rules.ts`, `resolver.ts`, `catalog.ts`, `coverage.ts`, `table.ts`; `provenance.ts` replaces the R Parquet reader
- `src/index.ts` is the only public module; `src/generated/` is written by `make types`, never by hand

## Conventions

As apb-export-ui's `web/` and APB Studio's `viewer/`: TypeScript 7, strict; tests with `tsx --test`; exact pinned versions; no semicolons, single quotes.

- Python's names and classes: `Catalog`, `DataCatalog`, `Reference`, `catalogues`, `rule_coverage`, `catalogue_table`; keyword arguments become an options object
- No browser-only or Node-only API in `src/`: it runs in both

## Commands

| Task | Command |
| --- | --- |
| Install | `npm ci` |
| Type check | `make typecheck` |
| Tests | `make test` |
| Gate | `make check` |
| Build `dist/` | `make build` |
| Regenerate types | `make types` |
