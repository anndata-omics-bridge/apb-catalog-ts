// Every answer apb-catalog gives in Python on the synthetic results, DataCatalog gives too, starting
// from each result's provenance JSON.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { findIn } from '../src/catalog.js'
import { Bundle, DataCatalog, type Query } from '../src/index.js'
import { Mismatches, type DataCatalogCase } from './cases.js'
import { BUNDLE, kindsOutcome, outcomeOf, readCases, serve, unpackResults, type Served } from './support.js'

let served: Served
let bundle: Bundle

before(async () => {
  served = await serve({ bundle: BUNDLE, results: unpackResults() })
  bundle = await Bundle.load(served.url('bundle/manifest.json'))
})

after(() => served.close())

test('DataCatalog answers every test-bundle case as apb-catalog does', async (context) => {
  const mismatches = new Mismatches()
  for (const found of readCases('data_catalog.json') as unknown as DataCatalogCase[]) {
    const label = `${found.result} ${found.catalogue} ${found.enforce ?? ''}`
    const provenance = served.url(`results/${found.result}.parquet/manifest.json`)
    const options = { enforce: found.enforce }
    if (found.error !== undefined) {
      await assert.rejects(DataCatalog.load(bundle, provenance, found.catalogue, options), Error, label)
      continue
    }
    const catalog = await DataCatalog.load(bundle, provenance, found.catalogue, options)
    for (const request of found.requests ?? []) {
      mismatches.compare(
        outcomeOf(() => findIn(catalog, request.level, request.location, request.qualifiers as Query)),
        request.outcome,
        `${label} ${request.level} ${request.location} ${JSON.stringify(request.qualifiers)}`,
      )
    }
    for (const kinds of found.kinds ?? []) {
      mismatches.compare(
        kindsOutcome(() => catalog.kinds(kinds.level, kinds.location)),
        kinds.outcome,
        `${label} kinds ${kinds.level} ${kinds.location}`,
      )
    }
    if (found.fields !== undefined && found.fields !== null) {
      mismatches.compareRows(catalog.fields(), found.fields, `${label} fields`)
    }
  }
  assert.ok(mismatches.checked > 1000, `only ${mismatches.checked} answers checked`)
  context.diagnostic(`${mismatches.checked} answers checked`)
  assert.equal(mismatches.found.length, 0, mismatches.report())
})
