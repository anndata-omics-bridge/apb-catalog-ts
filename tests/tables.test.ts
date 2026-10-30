// The catalogue tables match apb-catalog's.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Bundle, catalogue_table, catalogues, rule_coverage } from '../src/index.js'
import { isObject } from '../src/json.js'
import { Mismatches } from './cases.js'
import { BUNDLE, readCases, serve, type Served } from './support.js'

let served: Served
let bundle: Bundle

before(async () => {
  served = await serve({ bundle: BUNDLE })
  bundle = await Bundle.load(served.url('bundle/manifest.json'))
})

after(() => served.close())

test('catalogues, rule_coverage and catalogue_table match apb-catalog', (context) => {
  const tables = readCases('tables.json')
  assert.ok(isObject(tables))
  const coverage = tables.rule_coverage
  const table = tables.catalogue_table
  assert.ok(Array.isArray(tables.catalogues) && isObject(coverage) && isObject(table))
  const mismatches = new Mismatches()
  mismatches.compareRows(catalogues(bundle), tables.catalogues, 'catalogues')
  for (const [name, rows] of Object.entries(coverage)) {
    mismatches.compareRows(rule_coverage(bundle, name), rows as unknown[], `rule_coverage ${name}`)
  }
  for (const [name, rows] of Object.entries(table)) {
    const found = name === 'all' ? catalogue_table(bundle) : catalogue_table(bundle, name)
    mismatches.compareRows(found, rows as unknown[], `catalogue_table ${name}`)
  }
  assert.ok(mismatches.checked >= 1 + Object.keys(coverage).length + Object.keys(table).length)
  context.diagnostic(`${mismatches.checked} answers checked`)
  assert.equal(mismatches.found.length, 0, mismatches.report())
})
