// The data a DataCatalog hands back: one array per run for a layer, one array for a var or obs
// column, checked against the Parquet files read directly.

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { parquetReadObjects, type AsyncBuffer } from 'hyparquet'
import { compressors } from 'hyparquet-compressors'
import { Bundle, DataCatalog } from '../src/index.js'
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

function catalog(result: string, set: string): Promise<DataCatalog> {
  return DataCatalog.load(bundle, served.url(`results/${result}.parquet/manifest.json`), set)
}

test('layer() gives one array per run, named by the obs and var key columns', async () => {
  const result = 'maxquant_wide-peptidoform_ion'
  const pep = await (await catalog(result, 'confidence')).layer('peptidoform_ion', { kind: 'pep' })
  assert.ok(pep !== null)
  const stored = await rows(result, 'layers/PEP.parquet')
  const obs = await rows(result, 'obs.parquet')
  const vars = await rows(result, 'var.parquet')
  assert.deepEqual(pep.runs, obs.map((row) => String(row.Raw_File)))
  assert.equal(pep.features.length, vars.length)
  assert.equal(pep.values.length, pep.runs.length)
  for (const [run, values] of pep.values.entries()) {
    assert.ok(values instanceof Float64Array)
    assert.deepEqual([...values], stored.map((row) => Number(row[`obs_${run}`])))
  }
})

test('var() gives one value per feature, as strings or booleans', async () => {
  const result = 'maxquant_wide-peptidoform_ion'
  const apb = await catalog(result, 'apb')
  const vars = await rows(result, 'var.parquet')
  assert.deepEqual(await apb.var('peptidoform_ion', { kind: 'peptidoform_ion' }), vars.map((row) => row.ProForma_ion))
  assert.deepEqual(await apb.var('peptidoform_ion', { kind: 'decoy' }), vars.map((row) => row.apb_Decoy))
})

test('obs() gives one value per run', async () => {
  const result = 'edge-prolfquapp'
  const obs = await rows(result, 'obs.parquet')
  const found = await (await catalog(result, 'apb')).obs('peptidoform_ion', { kind: 'condition' })
  assert.deepEqual(found, obs.map((row) => row.group))
})

test('a missing field gives null and fetches nothing', async () => {
  const confidence = await catalog('maxquant_wide-peptidoform_ion', 'confidence')
  served.requests.length = 0
  assert.equal(await confidence.layer('peptidoform_ion', { kind: 'q_value' }), null)
  assert.equal(served.requests.length, 0)
})
