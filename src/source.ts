// Reviewed meanings of retained APB fields, per vendor and software version; apb_catalog.source and
// .vocabulary.

import type { Bundle } from './bundle.js'
import type { Row } from './csv.js'
import { isObject, sortC, type JsonObject } from './json.js'
import { addressKey, entryAddress, entryPatterns, ruleLevels, type EntryAddress } from './rules.js'

export const UNKNOWN = 'unknown'

// The locations a request reads: var and varm both hold one value per feature.
export const READS: Record<string, string[]> = {
  obs: ['obs'],
  layers: ['layers'],
  var: ['var', 'varm'],
  varm: ['varm'],
}

// Accepted values per qualifier; a qualifier left out accepts any value.
export type Accepted = Record<string, string[]>

// Where an entry's field lives: by name, or by the column-name prefix it is found by.
export interface EntryReference {
  level: string
  location: string
  name: string | null
  table: string | null
  prefix: string | null
}

export interface Entry {
  entry_id: string
  software_version_pattern: string[]
  reference: EntryReference
  key: string
  qualifiers: Record<string, string>
}

// One access key of a set: the name callers ask by, standing for a kind and the qualifier values it
// fixes; a qualifier it does not fix stays open.
export interface Key {
  key: string
  kind: string
  fixed: Record<string, string>
  psi_ms: string[]
}

export interface Variant {
  level: string
  software_version_pattern: string
}

export interface VendorCatalogue {
  type: 'vendor'
  label: string
  software_name: string
  variants: Variant[]
  entries: Entry[]
}

export interface ProducerCatalogue {
  type: 'producer'
  label: string
  producer: string
  requires: string[]
  instruction: string | null
  entries: Entry[]
}

export interface AnnotationCatalogue {
  type: 'annotation'
  label: string
  convention: string
  entries: Entry[]
}

export type Source = VendorCatalogue | ProducerCatalogue | AnnotationCatalogue

// What one set's entries mean: its qualifiers, each with its admitted values, "unknown" among them.
export interface SetVocabulary {
  definition: string
  qualifiers: Record<string, { definition: string; values: Record<string, string> }>
}

// How strongly a consumer needs one meaning on one level: a field location and a key.
export interface RequirementRow {
  level: string
  location: string
  key: string
  requirement: string
}

// A request accepts any subset of the qualifiers, each with admitted values; every qualifier admits "unknown".
export function checkPredicate(vocabulary: SetVocabulary, qualifiers: Accepted): void {
  for (const [name, accepted] of Object.entries(qualifiers)) {
    if (accepted.length === 0) throw new Error(`qualifier '${name}' accepts no value`)
    for (const value of accepted) checkValue(vocabulary, name, value)
  }
}

function checkValue(vocabulary: SetVocabulary, name: string, value: string): void {
  const qualifier = vocabulary.qualifiers[name]
  if (qualifier === undefined) {
    throw new Error(`unknown qualifier '${name}'; declared: ${sortC(Object.keys(vocabulary.qualifiers)).join(', ')}`)
  }
  if (!(value in qualifier.values)) {
    throw new Error(
      `qualifier '${name}' does not admit '${value}'; admitted: ${sortC(Object.keys(qualifier.values)).join(', ')}`,
    )
  }
}

export function referenceKey(reference: EntryReference): string {
  if (reference.name === null) throw new Error('the reference is not bound to a column')
  return addressKey(reference.location, reference.table, reference.name)
}

// A ";"-separated list of one CSV cell; none when the cell is empty.
function cellList(text: string, separator = ';'): string[] {
  return text === '' ? [] : text.split(separator)
}

// One key from its keys.csv row and the values its key_qualifiers.csv rows fix; a qualifier
// without a row stays open.
function rowKey(row: Row, fixed: Record<string, string>): Key {
  return { key: row.key, kind: row.kind, fixed, psi_ms: cellList(row.psi_ms) }
}

// Whether an entry with these qualifiers has this key.
function keyDescribes(key: Key, qualifiers: Record<string, string>): boolean {
  return qualifiers.kind === key.kind && Object.entries(key.fixed).every(([name, value]) => qualifiers[name] === value)
}

// Where an entry's field lives, from its id: a layer by its key, an obs or var column by its column,
// a varm column by table and column; an obs column ending in `*` is a prefix.
function addressReference(entryId: string, address: EntryAddress): EntryReference {
  const { level, attribute: location, key, column } = address
  const fail = (reason: string): never => {
    throw new Error(`${entryId}: ${reason}`)
  }
  if (location === 'layers') {
    if (key === '-' || column !== '-') fail('a layer names its key and no column')
    return { level, location, name: key, table: null, prefix: null }
  }
  if (column === '-') fail(`${location} names a column`)
  if (location === 'varm') {
    if (key === '-') fail('a varm column names its table as key')
    return { level, location, name: column, table: key, prefix: null }
  }
  if (key !== '-') fail(`${location} has no key`)
  if (!column.endsWith('*')) return { level, location, name: column, table: null, prefix: null }
  if (location !== 'obs') fail('a prefix names an obs column')
  return { level, location, name: null, table: null, prefix: column.slice(0, -1) }
}

// One entry from its entries.csv row, its other qualifiers and the key they match: exactly one.
function rowEntry(bundle: Bundle, row: Row, address: EntryAddress, qualifiers: Record<string, string>, keys: Key[]): Entry {
  const described = { kind: row.kind, ...qualifiers }
  const matching = keys.filter((key) => keyDescribes(key, described)).map((key) => key.key)
  const [key] = matching
  if (matching.length !== 1 || key === undefined) {
    throw new Error(`${row.entry_id}: matches the keys ${matching.join(', ')}, not exactly one`)
  }
  return {
    entry_id: row.entry_id,
    software_version_pattern: entryPatterns(bundle, address),
    reference: addressReference(row.entry_id, address),
    key,
    qualifiers: described,
  }
}

// One catalogue per software of versions.csv, each reviewing every level the bundle's entries name
// for its versions, when the set has vendor entries; none otherwise.
function vendorCatalogues(bundle: Bundle, name: string, entries: Map<string, Entry[]>): VendorCatalogue[] {
  if (entries.size === 0) return []
  const variants = new Map<string, Variant[]>()
  for (const found of ruleLevels(bundle)) {
    const listed = variants.get(found.software_name) ?? []
    listed.push({ level: found.level, software_version_pattern: found.software_version_pattern })
    variants.set(found.software_name, listed)
  }
  const unknown = [...entries.keys()].filter((software) => !variants.has(software))
  if (unknown.length > 0) {
    throw new Error(`${name}: no packaged rule declares the software ${sortC(unknown).join(', ')}`)
  }
  return [...variants].map(([software, found]) => ({
    type: 'vendor',
    label: software,
    software_name: software,
    variants: found,
    entries: entries.get(software) ?? [],
  }))
}

// A set's vocabulary from its vocabulary.csv rows: the set's, each qualifier's, and each value's.
function setVocabulary(rows: Row[], head: Row): SetVocabulary {
  const qualifiers: SetVocabulary['qualifiers'] = {}
  for (const row of rows) {
    if (row.qualifier !== '' && row.value === '') qualifiers[row.qualifier] = { definition: row.definition, values: {} }
  }
  for (const row of rows) {
    if (row.value === '') continue
    const qualifier = qualifiers[row.qualifier]
    if (qualifier === undefined) throw new Error(`vocabulary.csv defines '${row.value}' of no qualifier`)
    qualifier.values[row.value] = row.definition
  }
  return { definition: head.definition, qualifiers }
}

interface DataPackage {
  version: string
  resources: { name: string; schema: { fields: { name: string }[] } }[]
}

// One catalogue table of the bundle, read once; its columns must be those datapackage.json declares.
function catalogueRows(bundle: Bundle, table: string): Row[] {
  return bundle.memo(`table:${table}`, () => {
    const found = bundle.csv('catalogues', `${table}.csv`)
    const datapackage = bundle.json('catalogues', 'datapackage.json') as unknown as DataPackage
    const resource = datapackage.resources.find((candidate) => candidate.name === table)
    const declared = resource?.schema.fields.map((field) => field.name) ?? []
    if (found.columns.join(',') !== declared.join(',')) {
      throw new Error(`${table}.csv has the columns ${found.columns.join(', ')}, not ${declared.join(', ')}`)
    }
    return found.rows
  })
}

// An entry is its id and kind: one id holds two kinds where one column has two meanings.
function entryName(row: Row): string {
  return `${row.entry_id}\x1f${row.kind}`
}

// The entry with its reference bound to one level's column, its id naming that column.
export function boundEntry(entry: Entry, name: string): Entry {
  const entry_id = [...entry.entry_id.split('/').slice(0, 5), name].join('/')
  return { ...entry, entry_id, reference: { ...entry.reference, name, prefix: null } }
}

// The entries a vendor catalogue reviewed for one of its rule variants.
export function entriesFor(vendor: VendorCatalogue, variant: Variant): Entry[] {
  return vendor.entries.filter(
    (entry) =>
      entry.software_version_pattern.includes(variant.software_version_pattern) &&
      entry.reference.level === variant.level,
  )
}

// This entry on one level: itself, an entry of every level (`*`) taking that level in its reference
// and id, or null on another level.
function entryOn(entry: Entry, level: string): Entry | null {
  if (entry.reference.level === level) return entry
  if (entry.reference.level !== '*') return null
  const [source, version, , ...rest] = entry.entry_id.split('/')
  return { ...entry, entry_id: [source, version, level, ...rest].join('/'), reference: { ...entry.reference, level } }
}

// The entries a producer or annotation catalogue supplies on one level, those of every level included.
export function entriesOn(source: Source, level: string): Entry[] {
  return source.entries.flatMap((entry) => entryOn(entry, level) ?? [])
}

// Who an entry comes from: the software, an app, or `annotation:<convention>`, the first field of its id.
export function entrySource(entry: Entry): string {
  return entry.entry_id.split('/')[0] as string
}

// Whether a result's metadata records a producer's run.
export function producerRan(producer: ProducerCatalogue, metadata: JsonObject): boolean {
  let section: JsonObject = metadata
  for (const [depth, key] of producer.requires.entries()) {
    if (!(key in section)) return false
    if (depth === producer.requires.length - 1) break
    const next = section[key]
    if (!isObject(next)) return false
    section = next
  }
  return true
}

export function pendingReason(producer: ProducerCatalogue): string {
  return `${producer.producer} has not run on this result; ${producer.instruction}`
}

export function annotationApplies(annotation: AnnotationCatalogue, metadata: JsonObject): boolean {
  return annotation.convention in metadata
}

// Whether an entry on a requirement row's level answers the row.
export function rowDescribes(row: RequirementRow, entry: Entry): boolean {
  return (
    entry.reference.level === row.level &&
    (READS[row.location] ?? []).includes(entry.reference.location) &&
    entry.key === row.key
  )
}

// The qualifier values a request for a key accepts: its kind and the values it fixes.
export function keyPredicate(key: Key): Accepted {
  return { kind: [key.kind], ...Object.fromEntries(Object.entries(key.fixed).map(([name, value]) => [name, [value]])) }
}

interface ReviewedRule {
  catalogue: VendorCatalogue
  variant: Variant
}

// One packaged catalogue set: its vocabulary, vendor, producer and annotation catalogues and
// requirements, indexed by software and version. Producers hold the fields apps write after
// conversion and annotations the sample-annotation fields; both apply to every software version. A
// set made only of them has no vendor catalogue and needs no review.
export class CatalogueSet {
  readonly name: string
  readonly vocabulary: SetVocabulary
  readonly vocabulary_version: string
  readonly description: { purpose: string; used_by: string[] }
  readonly catalogues: VendorCatalogue[]
  readonly producers: ProducerCatalogue[]
  readonly annotations: AnnotationCatalogue[]
  readonly keys: Key[]
  readonly requirements: RequirementRow[]
  readonly #byVersion = new Map<string, ReviewedRule>()

  constructor(bundle: Bundle, name: string) {
    const rows = (table: string): Row[] => catalogueRows(bundle, table).filter((row) => row.set === name)
    const vocabulary = rows('vocabulary')
    const heads = vocabulary.filter((row) => row.qualifier === '')
    const head = heads[0]
    if (heads.length !== 1 || head === undefined) {
      throw new Error(`unknown catalogue '${name}'; packaged: ${setNames(bundle).join(', ')}`)
    }
    const setVocab = setVocabulary(vocabulary, head)
    const fixed = new Map<string, Record<string, string>>()
    for (const row of rows('key_qualifiers')) {
      fixed.set(row.key, { ...fixed.get(row.key), [row.qualifier]: row.value })
    }
    const keys = rows('keys').map((row) => rowKey(row, fixed.get(row.key) ?? {}))
    const qualifiers = new Map<string, Record<string, string>>()
    for (const row of rows('entry_qualifiers')) {
      qualifiers.set(entryName(row), { ...qualifiers.get(entryName(row)), [row.qualifier]: row.value })
    }
    const bySource = new Map<string, Entry[]>()
    for (const row of rows('entries')) {
      const address = entryAddress(row.entry_id)
      const entry = rowEntry(bundle, row, address, qualifiers.get(entryName(row)) ?? {}, keys)
      qualifiers.delete(entryName(row))
      bySource.set(address.source, [...(bySource.get(address.source) ?? []), entry])
    }
    if (qualifiers.size > 0) {
      const stray = sortC([...qualifiers.keys()].map((found) => found.replace('\x1f', ' ')))
      throw new Error(`${name}: entry_qualifiers.csv qualifies no entry ${stray.join(', ')}`)
    }
    const runs = rows('producers')
    const vendors = new Map<string, Entry[]>()
    const producers: ProducerCatalogue[] = []
    const annotations: AnnotationCatalogue[] = []
    for (const [source, entries] of bySource) {
      const run = runs.find((row) => row.producer === source)
      if (source.startsWith('annotation:')) {
        annotations.push({ type: 'annotation', label: source, convention: source.slice('annotation:'.length), entries })
      } else if (run !== undefined) {
        producers.push({
          type: 'producer',
          label: source,
          producer: source,
          requires: cellList(run.requires, '.'),
          instruction: run.instruction === '' ? null : run.instruction,
          entries,
        })
      } else vendors.set(source, entries)
    }
    const datapackage = bundle.json('catalogues', 'datapackage.json') as unknown as DataPackage
    this.name = name
    this.vocabulary = setVocab
    this.vocabulary_version = datapackage.version
    this.description = { purpose: head.purpose, used_by: cellList(head.used_by) }
    this.catalogues = vendorCatalogues(bundle, name, vendors)
    this.producers = producers
    this.annotations = annotations
    this.keys = keys
    this.requirements = rows('requirements').map((row) => ({
      level: row.level,
      location: row.location,
      key: row.key,
      requirement: row.requirement,
    }))
    for (const row of this.requirements) this.key(row.key)
    for (const catalogue of this.catalogues) {
      for (const variant of catalogue.variants) {
        const key = [catalogue.software_name, variant.software_version_pattern, variant.level].join('\x1f')
        this.#byVersion.set(key, { catalogue, variant })
      }
    }
  }

  // Every catalogue of the set: vendor, producer and annotation.
  sources(): Source[] {
    return [...this.catalogues, ...this.producers, ...this.annotations]
  }

  // The rule reviewed for one software version's level, or null.
  reviewed(software: string, pattern: string, level: string): ReviewedRule | null {
    return this.#byVersion.get([software, pattern, level].join('\x1f')) ?? null
  }

  // One key of the set, by name.
  key(name: string): Key {
    const found = this.keys.find((key) => key.key === name)
    if (found === undefined) {
      throw new Error(`unknown key '${name}'; keys: ${sortC(this.keys.map((key) => key.key)).join(', ')}`)
    }
    return found
  }

  // Whether the set has this key.
  hasKey(name: string): boolean {
    return this.keys.some((key) => key.key === name)
  }

  // The requirement row a request on one level and location asks for with its key, or null.
  requirementFor(level: string, location: string, key: string | null): RequirementRow | null {
    return this.requirements.find((row) => row.level === level && row.location === location && row.key === key) ?? null
  }

  // Whether a level answers only once a vendor catalogue reviewed its rule.
  get needsReview(): boolean {
    return this.catalogues.length > 0
  }
}

export type { ReviewedRule }

export function catalogueSet(bundle: Bundle, name: string): CatalogueSet {
  return bundle.memo(`set:${name}`, () => new CatalogueSet(bundle, name))
}

export function setNames(bundle: Bundle): string[] {
  return catalogueRows(bundle, 'vocabulary')
    .filter((row) => row.qualifier === '')
    .map((row) => row.set)
}
