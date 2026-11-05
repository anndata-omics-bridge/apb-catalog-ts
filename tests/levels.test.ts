// A level's slots as apb_catalog.levels reads them: a key first, then the level's own name; get
// gives null where name throws KeyError; further qualifiers narrow a key but cannot replace it.

import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { KeyError } from '../src/conditions.js'
import { Bundle, Catalog, DataCatalog, UnresolvedField } from '../src/index.js'
import { isObject } from '../src/json.js'
import type { Level } from '../src/levels.js'
import { BUNDLE, serve, unpackResults, type Served } from './support.js'

const MAXQUANT = 'maxquant_wide-peptidoform_ion.parquet'

let served: Served
let bundle: Bundle

// Beside the MaxQuant result's provenance JSON, a copy that records apb-fasta's peptide
// verification and its varm table.
before(async () => {
  const results = unpackResults()
  const manifest = JSON.parse(readFileSync(join(results, MAXQUANT, 'manifest.json'), 'utf-8')) as unknown
  assert.ok(isObject(manifest) && isObject(manifest.apb) && isObject(manifest.levels))
  const level = manifest.levels.peptidoform_ion
  assert.ok(isObject(level))
  manifest.apb.fasta = { provenance: { peptide_verification: {} } }
  level.varm_order = ['fasta_validation']
  level.varm = { fasta_validation: { file: 'fasta_validation.parquet', columns: ['peptide_in_fasta'], key_columns: [] } }
  writeFileSync(join(results, MAXQUANT, 'verified.json'), JSON.stringify(manifest))
  served = await serve({ bundle: BUNDLE, results })
  bundle = await Bundle.load(served.url('bundle/manifest.json'))
})

after(() => served.close())

async function ion(result: string, ...sets: string[]): Promise<Level> {
  const catalog = await DataCatalog.load(bundle, served.url(`results/${result}.parquet/manifest.json`), sets)
  const level = catalog.levels.get('peptidoform_ion')
  assert.ok(level !== undefined)
  return level
}

test('get gives null where name throws KeyError: a key the level lacks, or a name that is neither', async () => {
  const level = await ion('maxquant_wide-peptidoform_ion', 'confidence')
  assert.equal(level.layers.name('pep'), 'PEP')
  assert.equal(await level.layers.get('q_value'), null)
  assert.throws(() => level.layers.name('q_value'), KeyError)
  assert.equal(await level.layers.get('intensities'), null)
  assert.throws(() => level.layers.name('intensities'), /peptidoform_ion layers has no key or field 'intensities'/)
})

test('a name that is no key reads the level\'s own field; keys() and has() know keys only', async () => {
  const level = await ion('maxquant_wide-peptidoform_ion', 'confidence')
  assert.equal(level.layers.name('Score'), 'Score')
  assert.ok((await level.layers.get('Score')) !== null)
  assert.deepEqual(level.layers.keys(), ['pep'])
  assert.ok(level.layers.has('pep'))
  assert.ok(!level.layers.has('Score'))
  assert.equal(await level.layers.get('Intensity'), null, 'the primary layer is X, not one of the layers')
})

test('a qualifier the key leaves open narrows it; one the key fixes, or kind, throws', async () => {
  const chromatography = await ion('alphadia_v2-peptidoform_ion', 'chromatography')
  assert.equal(chromatography.layers.name('retention_time', { unit: 'second' }), 'precursor_rt_observed')
  assert.equal(await chromatography.layers.get('retention_time', { unit: 'minute' }), null)
  const abundance = await ion('alphadia_v2-peptidoform_ion', 'abundance')
  assert.throws(() => abundance.layers.get('normalized_intensity', { normalization: 'none' }), /ask by key; normalized_intensity fixes normalization/)
  assert.throws(() => abundance.layers.get('intensity', { kind: 'intensity' }), /fixes kind/)
  assert.throws(() => abundance.layers.get('intensities', { unit: 'second' }), /unknown key 'intensities'/)
})

test('an app\'s field waits until the app has run; a varm field is named table/column', async () => {
  const unverified = await ion('maxquant_wide-peptidoform_ion', 'apb')
  assert.throws(() => unverified.var.get('peptide_in_fasta'), UnresolvedField)
  assert.ok(!unverified.var.has('peptide_in_fasta'))
  const catalog = await DataCatalog.load(bundle, served.url(`results/${MAXQUANT}/verified.json`), [])
  const verified = catalog.levels.get('peptidoform_ion')
  assert.ok(verified !== undefined)
  assert.equal(verified.var.name('peptide_in_fasta'), 'fasta_validation/peptide_in_fasta')
  assert.ok(verified.var.has('peptide_in_fasta'))
})

test('select reads every column a key names, where get throws because there are several', async () => {
  const level = await ion('edge-sdrf', 'apb')
  assert.throws(() => level.obs.get('group'), UnresolvedField)
  const groups = await level.obs.select(['group'])
  assert.deepEqual([...groups.keys()], ['factor_value_treatment', 'factor_value_dose'])
  const runs = await level.obs_names()
  for (const column of groups.values()) assert.equal(column.length, runs.length)
  assert.throws(() => level.obs.select(['groups']), KeyError)
})

test('a Catalog level holds names: get gives the name or null, and there are no own names', () => {
  const level = new Catalog(bundle, 'DIA-NN', '1.7', 'abundance').levels.get('peptidoform_ion')
  assert.ok(level !== undefined)
  assert.equal(level.layers.get('intensity'), 'Precursor_Quantity')
  assert.equal(level.layers.name('normalized_intensity'), 'Precursor_Normalised')
  assert.equal(level.layers.get('directlfq'), null)
  assert.throws(() => level.layers.name('directlfq'), KeyError)
  assert.equal(level.layers.get('Precursor_Quantity'), null)
})

test('a prefix tells a key from the vendor column of its name', async () => {
  const level = await ion('sage-peptidoform_ion', 'confidence')
  assert.equal(level.var.name('q_value'), 'q_value')
  assert.equal(level.var.name('v:q_value'), 'q_value')
  assert.equal(level.var.name('c:quantification_q_value'), 'q_value')
  assert.equal(await level.var.get('c:q_value'), null)
  assert.throws(() => level.var.name('c:q_value'), /has no key or field 'c:q_value'/)
  assert.throws(() => level.var.select(['c:q_value']), KeyError)
  assert.deepEqual([...(await level.var.select(['v:q_value'])).keys()], ['q_value'])
  assert.deepEqual([level.var.has('q_value'), level.var.has('c:q_value'), level.var.has('v:q_value')], [false, false, true])
})

test('a prefix of no composed set, a key its set lacks, or a qualified vendor name throws', async () => {
  const level = await ion('sage-peptidoform_ion', 'confidence')
  assert.throws(() => level.var.get('a:intensity'), /unknown prefix 'a' in 'a:intensity'; prefixes: apb, c, v/)
  assert.throws(() => level.var.get('c:intensity'), /unknown key 'intensity'/)
  assert.throws(() => level.var.get('v:q_value', { stage: 'run' }), /takes no qualifiers/)
})

test('a catalog answers its own prefix and no vendor name', () => {
  const ion = new Catalog(bundle, 'DIA-NN', '2.6.0', 'abundance').levels.get('peptidoform_ion')
  assert.ok(ion !== undefined)
  assert.equal(ion.layers.get('a:intensity'), 'Precursor_Quantity')
  assert.equal(ion.layers.get('v:Precursor_Quantity'), null)
  assert.throws(() => ion.layers.get('c:pep'), /unknown prefix 'c'.*a, v/)
})
