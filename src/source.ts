// Reviewed meanings of retained APB fields, per vendor and rule variant; apb_catalog.source and
// .vocabulary.

import type { Bundle } from './bundle.js'
import type { AnnotationCatalogue as AnnotationFile } from './generated/annotation-catalogue.js'
import type { CataloguesSchema } from './generated/catalogues.js'
import type { ProducerCatalogue as ProducerFile } from './generated/producer-catalogue.js'
import type { RequirementRow as RequirementFile, RequirementsSchema } from './generated/requirements.js'
import type { SourceCatalogue as SourceFile, SourceEntry } from './generated/source-catalogue.js'
import type { SetVocabulary, Vocabulary } from './generated/vocabulary.js'
import { compareC, isObject, sortC, type JsonObject } from './json.js'

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

// Where an entry's field lives: by name, or by the role or column-name prefix it is found by.
export interface EntryReference {
  level: string
  location: string
  name: string | null
  table: string | null
  role: string | null
  prefix: string | null
}

export interface Entry {
  entry_id: string
  rules: string[]
  reference: EntryReference
  qualifiers: Record<string, string>
}

export interface Variant {
  rule: string
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

export interface RequirementRow {
  level: string
  location: string
  kind: string
  qualifiers: Record<string, string>
  requirement: string
}

// A request accepts any subset of the qualifiers, each with admitted values or "unknown".
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
  if (value !== UNKNOWN && !(value in qualifier.values)) {
    throw new Error(
      `qualifier '${name}' does not admit '${value}'; admitted: ${sortC(Object.keys(qualifier.values)).join(', ')}`,
    )
  }
}

// The location, varm table and name a level's retained fields are indexed by, as one string.
export function addressKey(location: string, table: string | null, name: string): string {
  return `${location}\x1f${table ?? ''}\x1f${name}`
}

export function referenceKey(reference: EntryReference): string {
  if (reference.name === null) throw new Error('the reference is not bound to a column')
  return addressKey(reference.location, reference.table, reference.name)
}

function newEntry(found: SourceEntry): Entry {
  const reference = found.reference
  return {
    entry_id: found.entry_id,
    rules: [...found.rules],
    reference: {
      level: reference.level,
      location: reference.location,
      name: reference.name ?? null,
      table: reference.table ?? null,
      role: reference.role ?? null,
      prefix: reference.prefix ?? null,
    },
    qualifiers: { ...found.qualifiers },
  }
}

// The entry with its reference bound to one level's column.
export function boundEntry(entry: Entry, name: string): Entry {
  return { ...entry, reference: { ...entry.reference, name, role: null, prefix: null } }
}

// The entries a vendor catalogue reviewed for one of its rule variants.
export function entriesFor(vendor: VendorCatalogue, variant: Variant): Entry[] {
  return vendor.entries.filter((entry) => entry.rules.includes(variant.rule) && entry.reference.level === variant.level)
}

// The entries a producer or annotation catalogue supplies on one level.
export function entriesOn(source: Source, level: string): Entry[] {
  return source.entries.filter((entry) => entry.reference.level === level)
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
  const qualifiers = entry.qualifiers
  return (
    entry.reference.level === row.level &&
    (READS[row.location] ?? []).includes(entry.reference.location) &&
    qualifiers.kind === row.kind &&
    Object.entries(row.qualifiers).every(([name, value]) => qualifiers[name] === value)
  )
}

// The single accepted value of a qualifier, or undefined when it accepts none or several.
function only(accepted: string[] | undefined): string | undefined {
  return accepted?.length === 1 ? accepted[0] : undefined
}

// Whether a request on one level and location asks for a requirement row's meaning.
export function rowAsked(row: RequirementRow, level: string, location: string, qualifiers: Accepted): boolean {
  return (
    level === row.level &&
    location === row.location &&
    only(qualifiers.kind) === row.kind &&
    Object.entries(row.qualifiers).every(([name, value]) => only(qualifiers[name]) === value)
  )
}

interface ReviewedRule {
  catalogue: VendorCatalogue
  variant: Variant
}

// One packaged catalogue set: its vocabulary, vendor, producer and annotation catalogues and
// requirements, indexed by software and version. Producers hold the fields APB itself writes and
// annotations the sample-annotation fields; both apply to every level. A set made only of them
// has no vendor catalogue and needs no review.
export class CatalogueSet {
  readonly name: string
  readonly vocabulary: SetVocabulary
  readonly vocabulary_version: string
  readonly description: { purpose: string; used_by: string[] }
  readonly catalogues: VendorCatalogue[]
  readonly producers: ProducerCatalogue[]
  readonly annotations: AnnotationCatalogue[]
  readonly requirements: RequirementRow[]
  readonly #byVersion = new Map<string, ReviewedRule>()

  constructor(bundle: Bundle, name: string) {
    const descriptions = bundle.json('catalogues', 'catalogues.json') as unknown as CataloguesSchema
    const description = descriptions[name]
    if (description === undefined) {
      throw new Error(`unknown catalogue '${name}'; packaged: ${Object.keys(descriptions).join(', ')}`)
    }
    const vocabularies = bundle.json('catalogues', 'vocabulary.json') as unknown as Vocabulary
    const vocabulary = vocabularies.sets[name]
    if (vocabulary === undefined) throw new Error(`the bundle's vocabulary has no set '${name}'`)
    const folder = <T>(kind: string): T[] => {
      const prefix = `catalogues/${kind}/${name}/`
      return bundle.files
        .filter((path) => path.startsWith(prefix) && path.endsWith('.json') && !path.slice(prefix.length).includes('/'))
        .sort(compareC)
        .map((path) => bundle.json(path) as unknown as T)
    }
    this.name = name
    this.vocabulary = vocabulary
    this.vocabulary_version = vocabularies.vocabulary_version
    this.description = { purpose: description.purpose, used_by: [...description.used_by] }
    this.catalogues = folder<SourceFile>('sources').map((found) => ({
      type: 'vendor',
      label: found.software_name,
      software_name: found.software_name,
      variants: found.variants.map((variant) => ({
        rule: variant.rule,
        level: variant.level,
        software_version_pattern: variant.software_version_pattern,
      })),
      entries: found.entries.map(newEntry),
    }))
    this.producers = folder<ProducerFile>('producers').map((found) => ({
      type: 'producer',
      label: `producer:${found.producer}`,
      producer: found.producer,
      requires: [...(found.requires ?? [])],
      instruction: found.instruction ?? null,
      entries: found.entries.map(newEntry),
    }))
    this.annotations = folder<AnnotationFile>('annotations').map((found) => ({
      type: 'annotation',
      label: `annotation:${found.convention}`,
      convention: found.convention,
      entries: found.entries.map(newEntry),
    }))
    const requirements = bundle.json('catalogues', 'requirements.json') as unknown as RequirementsSchema
    this.requirements = (requirements[name] ?? []).map((row: RequirementFile) => ({
      level: row.level,
      location: row.location,
      kind: row.kind,
      qualifiers: { ...(row.qualifiers ?? {}) },
      requirement: row.requirement,
    }))
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

  // The requirement row a request asks for, or null.
  requirementFor(level: string, location: string, qualifiers: Accepted): RequirementRow | null {
    return this.requirements.find((row) => rowAsked(row, level, location, qualifiers)) ?? null
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
  return Object.keys(bundle.json('catalogues', 'catalogues.json') as JsonObject)
}
