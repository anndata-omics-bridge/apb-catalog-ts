# @anndata-omics-bridge/apb-catalog

apb-catalog's API in TypeScript: look up the fields of an [APB](https://github.com/anndata-omics-bridge/apb2) result by meaning, such as a PEP or an unnormalized intensity, in the browser, without naming vendor columns.

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
| `new Catalog(bundle, software, version, set)` | From the rules alone, without data |
| `await DataCatalog.load(bundle, provenanceUrl, set)` | On one result, and returns the data |
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
const diann = new Catalog(bundle, 'DIA-NN', '2.2.0', 'abundance')
diann.kinds('peptidoform_ion', 'layers')
// ['intensity', 'ms1_intensity']
diann.layer('peptidoform_ion', { kind: 'intensity', normalization: 'none' })
// <Reference peptidoform_ion layers: Precursor_Quantity>
```

Get the data of a result:

```ts
const confidence = await DataCatalog.load(bundle, 'results/result.parquet/manifest.json', 'confidence')
const pep = await confidence.layer('peptidoform_ion', { kind: 'pep' })
// { runs: string[], features: string[], values: Float64Array[] }, one array per run
```

`var()` and `obs()` return one array: a `Float64Array` for numbers, otherwise strings or booleans. A field the result's stored rule declares differently from the catalog throws `StaleField`.

## The bundle

apb-catalog builds two bundles at each release:

- Bundle: apb2's parse rules and the reviewed catalogue sets; lookups read only this
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
make types     # regenerate src/generated/ from the bundle's JSON schemas
```

The tests read both bundles from `APB_CATALOG_BUILD`, by default `../apb-catalog/build` (`make bundle` in apb-catalog).
