// Every answer apb-catalog gives in Python from the rules alone, Catalog gives too.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Bundle, Catalog } from '../src/index.js'
import { Mismatches, type CatalogCase } from './cases.js'
import { BUNDLE, keysOutcome, named, outcomeOf, readCases, serve, slotOf, type Served } from './support.js'

let served: Served
let bundle: Bundle

before(async () => {
  served = await serve({ bundle: BUNDLE })
  bundle = await Bundle.load(served.url('bundle/manifest.json'))
})

after(() => served.close())

test('Catalog answers every test-bundle case as apb-catalog does', (context) => {
  const mismatches = new Mismatches()
  for (const found of readCases('catalog.json') as unknown as CatalogCase[]) {
    const label = `${found.catalogue} ${found.software} ${found.version}`
    if (found.error !== undefined) {
      assert.throws(() => new Catalog(bundle, found.software, found.version, found.catalogue), Error, label)
      continue
    }
    const catalog = new Catalog(bundle, found.software, found.version, found.catalogue)
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
    mismatches.compareRows(catalog.fields(), found.fields, `${label} fields`)
  }
  assert.ok(mismatches.checked > 1000, `only ${mismatches.checked} answers checked`)
  context.diagnostic(`${mismatches.checked} answers checked`)
  assert.equal(mismatches.found.length, 0, mismatches.report())
})
