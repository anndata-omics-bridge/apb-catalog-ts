// Every answer apb-catalog gives in Python on the synthetic results, DataCatalog gives too, starting
// from each result's provenance JSON.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Bundle, DataCatalog } from '../src/index.js'
import { Mismatches, type DataCatalogCase } from './cases.js'
import { BUNDLE, keysOutcome, named, outcomeOf, readCases, serve, slotOf, unpackResults, type Served } from './support.js'

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
      await assert.rejects(DataCatalog.load(bundle, provenance, [found.catalogue], options), Error, label)
      continue
    }
    const catalog = await DataCatalog.load(bundle, provenance, [found.catalogue], options)
    for (const request of found.requests ?? []) {
      const slot = slotOf(catalog.levels, request.level, request.location)
      mismatches.compare(
        outcomeOf(() => named(slot, request.key, request.qualifiers)),
        request.outcome,
        `${label} ${request.level} ${request.location} ${request.key} ${JSON.stringify(request.qualifiers)}`,
      )
    }
    for (const keys of found.keys ?? []) {
      mismatches.compare(
        keysOutcome(() => slotOf(catalog.levels, keys.level, keys.location).keys()),
        keys.outcome,
        `${label} keys ${keys.level} ${keys.location}`,
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
