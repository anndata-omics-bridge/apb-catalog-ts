// A left-out field's constant prints as Python prints it: a float stays a float, as the provenance
// JSON writes it.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { isObject } from '../src/json.js'
import { Provenance } from '../src/provenance.js'
import { serve, unpackResults, type Served } from './support.js'

const RESULT = 'maxquant_wide-peptidoform_ion.parquet'

let served: Served

before(async () => {
  const results = unpackResults()
  const path = join(results, RESULT, 'manifest.json')
  const manifest = JSON.parse(readFileSync(path, 'utf-8')) as unknown
  assert.ok(isObject(manifest) && isObject(manifest.levels))
  const level = manifest.levels.peptidoform_ion
  assert.ok(isObject(level) && isObject(level.apb) && isObject(level.apb.parse))
  level.apb.parse.result = {
    uninformative_fields: {
      single_valued: { var: { Float: { value: 'FLOAT' }, Integer: { value: 2 }, Text: { value: 'x' } } },
    },
  }
  writeFileSync(path, JSON.stringify(manifest).replace('"FLOAT"', '0.0'))
  served = await serve({ results })
})

after(() => served.close())

test('a constant written as 0.0 stays 0.0; an integer and a string print as JSON', async () => {
  const provenance = await Provenance.load(served.url(`results/${RESULT}/manifest.json`))
  const leftOut = provenance.level('peptidoform_ion').leftOut()
  assert.deepEqual(
    [...leftOut.values()],
    ['0.0', '2', '"x"'],
  )
})
