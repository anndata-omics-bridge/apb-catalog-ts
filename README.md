# @anndata-omics-bridge/apb-catalog

apb-catalog's API in TypeScript: look up the fields of an [APB](https://github.com/anndata-omics-bridge/apb2) result by meaning, such as a PEP or an unnormalized intensity, in the browser, without naming vendor columns.

Documentation: [anndata-omics-bridge.github.io/apb-catalog-ts](https://anndata-omics-bridge.github.io/apb-catalog-ts/), with [Get started](https://anndata-omics-bridge.github.io/apb-catalog-ts/getting-started) and the [API](https://anndata-omics-bridge.github.io/apb-catalog-ts/api).

Catalog viewer: [fgcz-ms.uzh.ch/public/apb-catalog](https://fgcz-ms.uzh.ch/public/apb-catalog/), every catalogue set with its entries, requirements and coverage, in the browser, built on this package.

Contributing: the catalogs can be extended to suit your application, and you are welcome to create your own; see [Contributing](https://anndata-omics-bridge.github.io/apb-catalog/contributing/).

> **New API.** This package is new, and its API may still change between releases. Feedback is very welcome: open an [issue](https://github.com/anndata-omics-bridge/apb-catalog-ts/issues) with what you need, what surprised you, or what broke.

## APB

The AnnData Proteomics Bridge, [apb2](https://anndata-omics-bridge.github.io/apb2/), converts the reports of proteomics quantification software into one result layout. Declarative parse rules describe each vendor table, so one parser reads them all.

- Software: AlphaDIA, DIA-NN, FragPipe, MaxQuant, PEAKS, Sage, Spectronaut and [more](https://anndata-omics-bridge.github.io/apb2/supported_software/)
- Levels: peptidoform ion, peptidoform, peptide, protein, peptidoform fragment
- Per level: one AnnData, runs as `obs`, features as `var`, measurements as layers
- Formats: h5ad, h5mu, Parquet, DuckDB

Columns keep the vendor's names: the posterior error probability is `PEP` in MaxQuant and DIA-NN, `EG_PEP` in Spectronaut.

## apb-catalog

[apb-catalog](https://anndata-omics-bridge.github.io/apb-catalog/) records what those columns mean, in reviewed catalogue sets. A consumer asks a set for a kind, such as `pep` or `intensity`, and gets the column.

| Set | Fields |
| --- | --- |
| `abundance` | Intensities, and whether the software normalizes them across runs |
| `confidence` | PEP and q-values per run and per feature |
| `proteobench_entrapment` | Precursor q-values for ProteoBench's entrapment scoring |
| `apb` | Fields APB writes for every vendor: ProForma identifiers, decoy and contaminant flags, sample annotations |
| `chromatography` | Retention times, peak bounds and widths, with their unit |

A lookup answers one of three ways:

- One field: the column, or its data
- Software does not report it: `null`
- Several fields: an `UnresolvedField` error, never a silent choice

## This package

This is apb-catalog's Python API in TypeScript, with the same classes and methods as Python's apb-catalog and R's [apbCatalogR](https://github.com/anndata-omics-bridge/apbCatalogR). It is built for web apps that plot from APB results in the browser. Snapshots are not ported, as in apbCatalogR.

| Call | Answers |
| --- | --- |
| `Bundle.load(url)` | The catalog bundle, from the URL of its `manifest.json` |
| `new Catalog(bundle, software, version, set)` | From the rules alone, without data: `levels`, each slot holding names |
| `await DataCatalog.load(bundle, provenanceUrl, sets)` | On one result, the sets composed with `apb`: `levels` with AnnData's slots, returning the data |
| `catalogues(bundle)`, `rule_coverage(bundle, set)`, `catalogue_table(bundle)` | The sets, how each rule covers a set, every entry as a table |

Two things differ from Python and R, because a browser fetches everything over HTTP:

- The bundle is not shipped with the package: the app serves it next to the data, and `Bundle.load` fetches it once
- `DataCatalog` starts from a result's provenance JSON, the Parquet result's `manifest.json`. Lookups read only that JSON; a data call fetches only the Parquet file it needs, by HTTP range request, once.

It does not convert vendor files. Convert with apb2, as Parquet:

```bash
apb2 convert DATA --params PARAMETER_FILE --format parquet --output result   # writes result.parquet
```

## Install

```bash
npm install @anndata-omics-bridge/apb-catalog
```

## Use

Ask the rules which column a software version reports:

```ts
import { Bundle, Catalog, DataCatalog } from '@anndata-omics-bridge/apb-catalog'

const bundle = await Bundle.load('catalog/apb-catalog-bundle/manifest.json')
const ion = new Catalog(bundle, 'DIA-NN', '2.2.0', 'abundance').levels.get('peptidoform_ion')
ion?.layers.keys()
// ['intensity', 'ms1_intensity', 'normalized_intensity', 'normalized_ms1_intensity']
ion?.layers.get('intensity')
// 'Precursor_Quantity'
ion?.layers.get('maxlfq')
// null: DIA-NN 2.2.0 reports no MaxLFQ for precursors
```

Get the data of a result:

```ts
const catalog = await DataCatalog.load(bundle, 'results/result.parquet/manifest.json', ['confidence'])
const level = catalog.levels.get('peptidoform_ion')
const pep = await level?.layers.get('pep')
// { runs: string[], features: string[], values: Float64Array[] }, one array per run; null when absent
level?.layers.name('pep')
// 'PEP', the field get reads; throws where get gives null
```

Each slot, `layers`, `var` and `obs`, answers as Python's does, with `get` in place of `[...]`:

- A name is a key first, then the level's own field of that name; `get` gives null when it is neither
- A prefix makes the lookup exact: `'c:q_value'` asks the confidence set alone, `'v:q_value'` the level's own field alone; `catalogues(bundle)` lists each set's `prefix`
- `get(key, { unit: 'minute' })` narrows a key by a qualifier it leaves open
- `keys()` and `has(key)` know keys only
- `var.select(keys)` and `obs.select(keys)` read every column the keys name, as `var[[...]]` does
- `var` also reads varm tables; such a field is named `table/column`
- A `var` or `obs` column is one array: a `Float64Array` for numbers, otherwise strings or booleans
- `X()` is the primary layer, and `obs_names()` and `var_names()` the run and feature names
- A lookup throws `UnresolvedField` at once when the catalogue cannot decide; data arrives as a promise

## The bundle

apb-catalog builds two bundles at each release:

- Bundle: the reviewed catalogue sets and the levels apb2 converts for each software version; lookups read only this
- Test bundle: synthetic results, with apb-catalog's answers on them; the tests check that TypeScript gives the same answers

How an app gets the latest bundle:

- Download `apb-catalog-bundle.tar.gz` from the latest [apb-catalog release](https://github.com/anndata-omics-bridge/apb-catalog/releases) and serve its folder with the data; a browser cannot download it from GitHub itself
- A newer catalog needs only new files on the server, no new package version
- A bundle of a newer format than the package reads is refused with "update @anndata-omics-bridge/apb-catalog"

The file server must answer HTTP range requests.

## Development

```bash
npm ci
make check     # type check and every test
```

The tests read both bundles from `APB_CATALOG_BUILD`, by default `../apb-catalog/build` (`make bundle` in apb-catalog).
