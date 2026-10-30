// Every answer apb-catalog gives in Python from the rules alone, Catalog gives too.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Bundle, Catalog, type Query } from '../src/index.js'
import { Mismatches, type CatalogCase, type RequestCase } from './cases.js'
import { BUNDLE, kindsOutcome, outcomeOf, readCases, serve, type Served } from './support.js'

let served: Served
let bundle: Bundle

before(async () => {
  served = await serve({ bundle: BUNDLE })
  bundle = await Bundle.load(served.url('bundle/manifest.json'))
})

after(() => served.close())

function lookup(catalog: Catalog, request: RequestCase) {
  const query = request.qualifiers as Query
  if (request.location === 'layers') return catalog.layer(request.level, query)
  if (request.location === 'var') return catalog.var(request.level, query)
  return catalog.obs(request.level, query)
}

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
      const where = `${label} ${request.level} ${JSON.stringify(request.qualifiers)}`
      mismatches.compare(
        outcomeOf(() => lookup(catalog, request)),
        request.outcome,
        where,
      )
    }
    for (const kinds of found.kinds ?? []) {
      mismatches.compare(
        kindsOutcome(() => catalog.kinds(kinds.level, kinds.location)),
        kinds.outcome,
        `${label} kinds ${kinds.level} ${kinds.location}`,
      )
    }
    mismatches.compareRows(catalog.fields(), found.fields, `${label} fields`)
  }
  assert.ok(mismatches.checked > 1000, `only ${mismatches.checked} answers checked`)
  context.diagnostic(`${mismatches.checked} answers checked`)
  assert.equal(mismatches.found.length, 0, mismatches.report())
})
