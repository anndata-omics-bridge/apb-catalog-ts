// The data a DataCatalog's levels hand back: one array per run for a layer, one array for a var or
// obs column, checked against the Parquet files read directly.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { parquetReadObjects, type AsyncBuffer } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { Bundle, DataCatalog } from '../src/index.js'
import type { Level } from '../src/levels.js'
import { BUNDLE, serve, unpackResults, type Served } from './support.js'

let served: Served
let bundle: Bundle
let results: string

before(async () => {
  results = unpackResults()
  served = await serve({ bundle: BUNDLE, results })
  bundle = await Bundle.load(served.url('bundle/manifest.json'))
})

after(() => served.close())

// One Parquet file of a level, read whole from disk.
async function rows(result: string, file: string): Promise<Array<Record<string, unknown>>> {
  const bytes = readFileSync(join(results, `${result}.parquet`, 'levels', 'peptidoform_ion', file))
  const buffer: AsyncBuffer = {
    byteLength: bytes.byteLength,
    slice: (start, end) => bytes.buffer.slice(bytes.byteOffset + start, bytes.byteOffset + (end ?? bytes.byteLength)),
  }
  return parquetReadObjects({ file: buffer, compressors })
}

// The peptidoform_ion level of a result, read through the named sets.
async function ion(result: string, ...sets: string[]): Promise<Level> {
  const catalog = await DataCatalog.load(bundle, served.url(`results/${result}.parquet/manifest.json`), sets)
  const level = catalog.levels.get('peptidoform_ion')
  assert.ok(level !== undefined)
  return level
}

test('a layer gives one array per run, named by the obs and var key columns', async () => {
  const result = 'maxquant_wide-peptidoform_ion'
  const pep = await (await ion(result, 'confidence')).layers.get('pep')
  assert.ok(pep !== null)
  const stored = await rows(result, 'layers/PEP.parquet')
  const obs = await rows(result, 'obs.parquet')
  const vars = await rows(result, 'var.parquet')
  assert.deepEqual(pep.runs, obs.map((row) => String(row.Raw_file)))
  assert.equal(pep.features.length, vars.length)
  assert.equal(pep.values.length, pep.runs.length)
  for (const [run, values] of pep.values.entries()) {
    assert.ok(values instanceof Float64Array)
    assert.deepEqual([...values], stored.map((row) => Number(row[`obs_${run}`])))
  }
})

test('a var column gives one value per feature, as strings or booleans', async () => {
  const result = 'maxquant_wide-peptidoform_ion'
  const level = await ion(result, 'apb')
  const vars = await rows(result, 'var.parquet')
  assert.deepEqual(await level.var.get('peptidoform_ion'), vars.map((row) => row.ProForma_ion))
  assert.deepEqual(await level.var.get('decoy'), vars.map((row) => row.apb_Decoy))
})

test('an obs column gives one value per run', async () => {
  const result = 'edge-prolfquapp'
  const obs = await rows(result, 'obs.parquet')
  assert.deepEqual(await (await ion(result, 'apb')).obs.get('group'), obs.map((row) => row.group))
})

test('a missing field gives null and fetches nothing', async () => {
  const level = await ion('maxquant_wide-peptidoform_ion', 'confidence')
  served.requests.length = 0
  assert.equal(await level.layers.get('q_value'), null)
  assert.equal(served.requests.length, 0)
})

test('X is the primary layer, its runs and features the obs and var names', async () => {
  const result = 'maxquant_wide-peptidoform_ion'
  const level = await ion(result)
  const x = await level.X()
  const stored = await rows(result, 'layers/Intensity.parquet')
  assert.deepEqual(x.runs, await level.obs_names())
  assert.deepEqual(x.features, await level.var_names())
  assert.deepEqual([...(x.values[0] as Float64Array)], stored.map((row) => Number(row.obs_0)))
})
