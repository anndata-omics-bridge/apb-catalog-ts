# Get started

Every output below is what the call returned on 3 November 2026, on apb-catalog's bundle 0.1.4 and the synthetic results of its test bundle: tiny APB results of two runs and three features, one per software version.

## Install

```bash
npm install @anndata-omics-bridge/apb-catalog
```

The package reads APB's Parquet results. Convert with [apb2](https://anndata-omics-bridge.github.io/apb2/):

```bash
apb2 convert DATA --params PARAMETER_FILE --format parquet --output result   # writes result.parquet
```

## Load the bundle

Download `apb-catalog-bundle.tar.gz` from an [apb-catalog release](https://github.com/anndata-omics-bridge/apb-catalog/releases) and serve its folder next to the data; the file server must answer HTTP range requests.

```ts
import {
  Bundle, Catalog, DataCatalog, UnresolvedField, catalogues
} from '@anndata-omics-bridge/apb-catalog'

const bundle = await Bundle.load('catalog/apb-catalog-bundle/manifest.json')
bundle.version                       // '0.1.4'
catalogues(bundle).map((row) => [row.catalogue, row.entries])
// [['abundance', 45], ['confidence', 26], ['proteobench_entrapment', 7],
//  ['apb', 268], ['chromatography', 58]]
```

## Names without data

`Catalog` takes a software name and version and answers from the rules alone; its levels hold names:

```ts
const catalog = new Catalog(bundle, 'DIA-NN', '2.2.0', 'abundance')
Array.from(catalog.levels.keys())   // ['peptidoform_ion', 'protein']

const ion = catalog.levels.get('peptidoform_ion')
ion?.layers.keys()
// ['intensity', 'ms1_intensity', 'normalized_intensity', 'normalized_ms1_intensity']
ion?.layers.get('intensity')         // 'Precursor_Quantity'
ion?.layers.get('maxlfq')            // null: no MaxLFQ for precursors
ion?.layers.name('maxlfq')
// throws KeyError: peptidoform_ion layers has no key or field 'maxlfq'

const apb = new Catalog(bundle, 'DIA-NN', '2.2.0', 'apb')
apb.levels.get('peptidoform_ion')?.var.select(['peptidoform_ion', 'protein_assignment'])
// ['ProForma_ion', 'Protein_Group']
```

## Get the data of a result

`DataCatalog.load` starts from the result's provenance JSON and composes the named sets with `apb`, which is always in:

```ts
const result = 'results/maxquant_wide-peptidoform_ion.parquet/manifest.json'
const confidence = await DataCatalog.load(bundle, result, ['confidence'])
const level = confidence.levels.get('peptidoform_ion')

level?.layers.keys()                 // ['pep']
level?.var.keys()
// ['contaminant', 'decoy', 'fasta_accessions', 'peptide', 'peptidoform',
//  'peptidoform_ion', 'protein_assignment']
level?.layers.name('pep')            // 'PEP', MaxQuant's name

const pep = await level?.layers.get('pep')
// { runs: ['S0', 'S1'], features: ['F0', 'F1', 'F2'],
//   values: [Float64Array [0.8, 0.9, 1], …] }: one array per run
```

| Call | Returns | One value per |
| --- | --- | --- |
| `layers.get(key)` | `Promise<Layer \| null>`: `runs`, `features`, and one `Float64Array` per run | run and feature |
| `var.get(key)` | `Promise<Column \| null>`: a `Float64Array` for numbers, otherwise strings or booleans | feature |
| `obs.get(key)` | `Promise<Column \| null>` | run |
| `layers.name(key)`, `var.name(key)`, `obs.name(key)` | the field's name, at once | |

```ts
await level?.var.get('decoy')        // [true, false, true]
level?.var.name('peptidoform_ion')   // 'ProForma_ion'
await level?.layers.get('q_value')   // null: no q-value per run here
await level?.X()                     // the primary layer, Intensity: 2 runs × 3 features
await level?.obs_names()             // ['S0', 'S1']
```

`null` means the vendor reports no such field, or APB2 left it out because it held one value or none. A lookup is answered from the provenance JSON alone; only the data fetches a Parquet file.

## Keys first, then the level's own names

A name that is no key reads the level's own field of that name, as cf_xarray's accessor does; `keys()` and `has()` know keys only:

```ts
level?.layers.name('Score')          // 'Score': MaxQuant's own layer
level?.layers.has('Score')           // false
level?.layers.has('pep')             // true
```

A vendor may name a column as a key is named, as Sage names its quantification q-value `q_value`. A prefix makes the lookup exact: a set's prefix asks that set alone and never the level's own field, `v:` the level's own field alone and never the catalog; `catalogues(bundle)` lists each set's `prefix`:

```ts
level?.layers.name('c:pep')          // 'PEP': the confidence set alone
level?.layers.name('v:Score')        // 'Score': MaxQuant's own layer alone
level?.layers.get('c:Score')         // throws: unknown key 'Score'
```

Name several sets to read their keys together:

```ts
const both = await DataCatalog.load(bundle, result, ['abundance', 'confidence'])
both.levels.get('peptidoform_ion')?.layers.keys()   // ['intensity', 'pep']
```

## Narrow with qualifiers

A qualifier the key leaves open is the second argument of `get` and `name`:

```ts
const alphadia = 'results/alphadia_v2-peptidoform_ion.parquet/manifest.json'
const chromatography = await DataCatalog.load(bundle, alphadia, ['chromatography'])
const rt = chromatography.levels.get('peptidoform_ion')

rt?.layers.name('retention_time', { unit: 'second' })   // 'precursor_rt_observed'
await rt?.layers.get('retention_time', { unit: 'minute' })   // null: AlphaDIA's is in seconds
```

A qualifier the key already fixes throws: in the `abundance` set, `layers.get('normalized_intensity', { normalization: 'none' })` throws "ask by key; normalized_intensity fixes normalization".

## Several columns for one key

Where a key names several columns, such as the two SDRF factor values that both say `group`, `get` throws `UnresolvedField` and `select` reads them all:

```ts
const annotated = await DataCatalog.load(bundle, 'results/edge-sdrf.parquet/manifest.json', [])
const sdrf = annotated.levels.get('peptidoform_ion')

sdrf?.obs.get('group')
// throws UnresolvedField: group (kind=group) on peptidoform_ion is ambiguous:
// 2 entries match: factor_value_treatment, factor_value_dose
await sdrf?.obs.select(['group'])
// Map { 'factor_value_treatment' => ['a', 'b'], 'factor_value_dose' => ['1', '2'] }
```

## When there is no single answer

| Call | Throws |
| --- | --- |
| Spectronaut `abundance`, `protein` level: `layers.get('normalized_intensity')` | `UnresolvedField`, unknown: `PG_Quantity` leaves kind unknown |
| apb-fasta's `var.get('peptide_in_fasta')` before apb-fasta ran | `UnresolvedField`, unknown: run `apb-fasta verify-peptides` |
| `layers.name('maxlfq')` where there is none | `KeyError`; `get` returns `null` |
| `new Catalog(bundle, 'DIA-NN', '3.0', 'confidence')` | `Error`: no packaged DIA-NN rule admits version '3.0' |

```ts
const spectronaut = 'results/spectronaut-protein.parquet/manifest.json'
const abundance = await DataCatalog.load(bundle, spectronaut, ['abundance'])
try {
  await abundance.levels.get('protein')?.layers.get('normalized_intensity')
} catch (error) {
  if (!(error instanceof UnresolvedField)) throw error
  error.resolution.status   // 'unknown'
  error.message             // the reason and the candidate fields
}
```

A lookup throws at once; only the data arrives as a promise.
