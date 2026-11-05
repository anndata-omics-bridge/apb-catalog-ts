# API

Everything is imported from `@anndata-omics-bridge/apb-catalog`. Each call answers as its Python counterpart in [apb-catalog's API](https://anndata-omics-bridge.github.io/apb-catalog/api/) does; [Get started](./getting-started) shows them on results.

## Bundle

| Call | Returns |
| --- | --- |
| `await Bundle.load(url)` | The catalog bundle, from the URL of its `manifest.json`; every file fetched once, revalidated with the server |
| `bundle.version` | The bundle's version, such as `'0.1.4'` |
| `bundle.csv(...path)`, `bundle.json(...path)` | One file of the bundle, by its path in it, such as `bundle.csv('catalogues', 'versions.csv')` |

A bundle of another format than the package reads is refused: a newer one with "update @anndata-omics-bridge/apb-catalog".

## Catalogs

| Constructor | Answers from | Python |
| --- | --- | --- |
| `await DataCatalog.load(bundle, provenanceUrl, catalogs, { enforce })` | One APB Parquet result, from its provenance JSON: the rule each level was converted with; the named sets composed with `apb`, always in | `DataCatalog(result, *catalogs, enforce=None)` |
| `new Catalog(bundle, software, version, catalog, { enforce })` | The packaged APB2 rule whose version pattern admits `version`; no data | `Catalog(software, version, catalog, enforce=None)` |

| Member | `DataCatalog` | `Catalog` |
| --- | --- | --- |
| `levels` | `ReadonlyMap<string, Level>`: one result level per name, with AnnData's slots | `ReadonlyMap<string, LevelNames>`: one rule level, the same slots holding names |
| `fields()` | `TableRow[]`: the long table's columns plus `present` and `constant` | same, `present` always true |
| `description` | the first set's `purpose` and `used_by` | the set's |

- A key is one of a set's keys: a kind with the qualifier values it fixes, such as `normalized_intensity` (kind `intensity`, normalization `run_setting`); [Catalogues](https://anndata-omics-bridge.github.io/apb-catalog/catalogues/) lists them per set
- Composed sets: a key routes to the sets that define it; two sets naming different fields for one key on one level throw when the catalog is built; `keys()` and `fields()` cover every set
- A level answers only for its own entity: `peptidoform_ion` for precursors, `protein` for protein groups

## Levels

| Member | `DataCatalog` level | `Catalog` level | Python |
| --- | --- | --- | --- |
| `name` | the level's name | same | `name` |
| `X()` | `Promise<Layer>`: the primary layer | — | `X` |
| `layers.get(key, qualifiers)` | `Promise<Layer \| null>` | `string \| null` | `layers.get(key, **qualifiers)`, and `layers[key]` |
| `var.get(key, qualifiers)`, `obs.get(key, qualifiers)` | `Promise<Column \| null>`; `var` also reads `varm` tables | `string \| null` | `var.get(...)`, `obs.get(...)` |
| `layers.name(key, qualifiers)`, `var.name(...)`, `obs.name(...)` | `string`, the field `get` reads; a `varm` field is `table/column`; throws `KeyError` where `get` gives `null` | same | `name(key, **qualifiers)` |
| `var.select(keys)`, `obs.select(keys)` | `Promise<Map<string, Column>>`: every column the keys name, in order, by name | `string[]` | `var[[key, …]]` |
| `layers.keys()`, `var.keys()`, `obs.keys()` | `string[]`, sorted: the keys the level offers there | same | `keys()` |
| `layers.has(key)`, … | whether the level offers the key there | same | `key in layers` |
| `obs_names()`, `var_names()` | `Promise<string[]>`: the key columns, joined by `\|` | — | `obs_names`, `var_names` |

- `Layer` is `{ runs: string[], features: string[], values: Float64Array[] }`, one array per run; `Column` is a `Float64Array` for numbers (null as NaN), otherwise an array of strings or booleans
- `qualifiers` is an object of one value per qualifier the key leaves open, such as `{ unit: 'minute' }`; `kind`, or a qualifier the key fixes, throws
- Lookup follows cf_xarray: a key first, then the level's own name in that slot; `keys()` and `has()` know keys only
- A prefix makes the lookup exact: a set's prefix asks that set alone, so `'c:q_value'` is the confidence set's q-value or nothing, never Sage's own `q_value` column; `'v:'` asks the level's own name alone, never the catalog; an unknown prefix, or qualifiers on a `'v:'` name, throw
- Every key `keys()` lists reads: an app's keys, such as apb-fasta's, appear once the app has run
- A key may name the primary layer and then answers `X()`; `layers` holds the other layers, as in AnnData
- A lookup is answered at once from the provenance JSON and throws at once; only the data is a promise, and each Parquet file is fetched once

## Answers

| Answer | Means |
| --- | --- |
| a field | Exactly one catalogued field matches |
| `null` | From `get`: the level's software version was reviewed and has no such field, or the name is neither a key nor the level's own; an absent level is not in `levels` |
| `KeyError` | From `name` and `select` where `get` gives `null`; its `name` is `'KeyError'` |
| `UnresolvedField` | Two fields match equally, an entry leaves a requested qualifier `unknown`, no catalogue reviewed the level's software version, or an app such as apb-fasta has not run; `resolution.status` and the message name the reason and candidates |
| `Error` | A misspelled set or qualifier, qualifiers with a name that is no key, a qualifier the key fixes, or a version no packaged rule admits |

## Requirements and `enforce`

`{ enforce: 'required' }` or `{ enforce: 'recommended' }` makes a set's requirement rows binding:

| Created with | `required` absent | `recommended` absent | `optional` absent |
| --- | --- | --- | --- |
| no `enforce` | `null` | `null` | `null` |
| `enforce: 'required'` | throws `MissingRequiredField` | `null`, and a `MissingRequiredField` passed to `console.warn` | `null` |
| `enforce: 'recommended'` | throws | throws | `null` |

`enforce` on a catalog whose sets have no requirement rows throws.

## Tables

| Call | Returns | Python |
| --- | --- | --- |
| `catalogues(bundle)` | One row per set: `catalogue`, `prefix`, `purpose`, `used_by`, `has_requirements`, `entries` | `catalogues()` |
| `rule_coverage(bundle, set)` | Every packaged rule level checked against one set, one row per field, with `requirement` and `verdict` | `rule_coverage(set)` |
| `catalogue_table(bundle, set?)` | Every set, or one, as one row per entry and software version pattern | `catalogue_table(catalogue=None)` |

The columns are Python's; [apb-catalog's API](https://anndata-omics-bridge.github.io/apb-catalog/api/#the-long-table) describes them.

## Not ported

As in apbCatalogR: snapshots, Python's `resolve`, `snapshot`, `attach_snapshot` and `ResolutionSnapshot`; and the command line.
