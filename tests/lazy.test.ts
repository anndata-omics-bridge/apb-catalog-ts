// A DataCatalog starts from the provenance JSON alone and fetches a Parquet file only when its data
// is asked for, once, and only by byte range.

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { Bundle, DataCatalog } from '../src/index.js'
import { BUNDLE, serve, unpackResults, type Served } from './support.js'

const RESULT = 'results/maxquant_wide-peptidoform_ion.parquet'

let served: Served
let bundle: Bundle

before(async () => {
  served = await serve({ bundle: BUNDLE, results: unpackResults() })
  bundle = await Bundle.load(served.url('bundle/manifest.json'))
})

after(() => served.close())

function files(): Set<string> {
  return new Set(served.requests.map((request) => request.path))
}

test('lookups read only the provenance JSON; data calls fetch their own files once', async () => {
  served.requests.length = 0
  const catalog = await DataCatalog.load(bundle, served.url(`${RESULT}/manifest.json`), 'confidence')
  assert.deepEqual(files(), new Set([`/${RESULT}/manifest.json`]))

  catalog.kinds('peptidoform_ion', 'layers')
  catalog.fields()
  assert.equal(served.requests.length, 1)

  const pep = await catalog.layer('peptidoform_ion', { kind: 'pep' })
  assert.ok(pep !== null)
  assert.deepEqual(
    files(),
    new Set([
      `/${RESULT}/manifest.json`,
      `/${RESULT}/levels/peptidoform_ion/layers/PEP.parquet`,
      `/${RESULT}/levels/peptidoform_ion/obs.parquet`,
      `/${RESULT}/levels/peptidoform_ion/var.parquet`,
    ]),
  )
  const parquet = served.requests.filter((request) => request.path.endsWith('.parquet') && request.method === 'GET')
  assert.ok(parquet.length > 0 && parquet.every((request) => request.range !== null), 'Parquet is read by range')

  const fetched = served.requests.length
  await catalog.layer('peptidoform_ion', { kind: 'pep' })
  assert.equal(served.requests.length, fetched, 'a repeated data call fetches nothing')
})
