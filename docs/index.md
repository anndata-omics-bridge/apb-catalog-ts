# apb-catalog-ts

apb-catalog's API in TypeScript, published as `@anndata-omics-bridge/apb-catalog`: look up the fields of an [APB](https://anndata-omics-bridge.github.io/apb2/) result by meaning, such as a PEP or an unnormalized intensity, in the browser, without naming vendor columns.

```ts
const catalog = await DataCatalog.load(bundle, 'results/result.parquet/manifest.json', ['confidence'])
const pep = await catalog.levels.get('peptidoform_ion')?.layers.get('pep')
// MaxQuant's PEP, Spectronaut's EG_PEP: one array per run, or null when the result has none
```

## What it is

- The same classes and calls as Python's [apb-catalog](https://anndata-omics-bridge.github.io/apb-catalog/) and R's [apbCatalogR](https://github.com/anndata-omics-bridge/apbCatalogR): `Catalog`, `DataCatalog`, `levels` with AnnData's slots
- Built for web apps that plot from APB results in the browser
- Answers every lookup as Python does: the tests replay the answers Python recorded in apb-catalog's test bundle

## What differs from Python

- The bundle is not shipped with the package: the app serves it next to the data, and `Bundle.load` fetches it once
- `DataCatalog` starts from a result's provenance JSON, the Parquet result's `manifest.json`; a data call fetches only the Parquet file it needs, by HTTP range request, once
- `get` replaces `[...]`, since TypeScript cannot overload indexing; data arrives as a promise
- Not ported, as in apbCatalogR: snapshots (`resolve`, `snapshot`, `attach_snapshot`)

## Pages

- [Get started](./getting-started): every call on the synthetic results of apb-catalog's test bundle, with what it returned
- [API](./api): the classes, slots and answers, with their Python counterparts
