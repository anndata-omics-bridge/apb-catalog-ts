// A bundle of another format, or a result of another format, is refused with a clear error.

import assert from 'node:assert/strict'
import { cpSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { Bundle, DataCatalog } from '../src/index.js'
import { isObject } from '../src/json.js'
import { BUNDLE, readJson, serve, unpackResults, type Served } from './support.js'

const RESULT = 'maxquant_wide-peptidoform_ion.parquet'

let served: Served
let newer: string
let older: string

before(async () => {
  newer = mkdtempSync(join(tmpdir(), 'apb-catalog-newer-'))
  cpSync(BUNDLE, join(newer, 'bundle'), { recursive: true })
  const manifest = readJson(join(BUNDLE, 'manifest.json'))
  assert.ok(isObject(manifest))
  writeFileSync(join(newer, 'bundle', 'manifest.json'), JSON.stringify({ ...manifest, bundle_format: 99 }))
  older = mkdtempSync(join(tmpdir(), 'apb-catalog-older-'))
  cpSync(BUNDLE, join(older, 'bundle'), { recursive: true })
  writeFileSync(join(older, 'bundle', 'manifest.json'), JSON.stringify({ ...manifest, bundle_format: 2 }))
  const results = unpackResults()
  const provenance = readJson(join(results, RESULT, 'manifest.json'))
  assert.ok(isObject(provenance))
  writeFileSync(join(results, RESULT, 'manifest.json'), JSON.stringify({ ...provenance, format_version: '8' }))
  served = await serve({ bundle: BUNDLE, newer: join(newer, 'bundle'), older: join(older, 'bundle'), results })
})

after(() => served.close())

test('a bundle of a newer format is refused', async () => {
  await assert.rejects(Bundle.load(served.url('newer/manifest.json')), /has format 99; update @anndata-omics-bridge/)
})

test('a bundle of an older format is refused', async () => {
  await assert.rejects(Bundle.load(served.url('older/manifest.json')), /has format 2; this package reads format 3/)
})

test('a result of another Parquet format version is refused', async () => {
  const bundle = await Bundle.load(served.url('bundle/manifest.json'))
  await assert.rejects(
    DataCatalog.load(bundle, served.url(`results/${RESULT}/manifest.json`), ['confidence']),
    /apb2-parsed-levels-parquet version 8; @anndata-omics-bridge\/apb-catalog reads apb2-parsed-levels-parquet version 9/,
  )
})
