// Look up APB fields by meaning, so callers never name vendor columns; apb_catalog.catalog.

import type { Bundle } from './bundle.js'
import { MissingRequiredField, UnresolvedField } from './conditions.js'
import { sortC, unique } from './json.js'
import { Level, LevelNames, type Location, type Lookup, type Qualifiers } from './levels.js'
import { Provenance, type ProvenanceLevel } from './provenance.js'
import {
  AbsentLevel,
  ProducedLevel,
  ReviewedLevel,
  UnreviewedLevel,
  type FieldRequest,
  type LevelView,
  type Pending,
  type Resolution,
} from './resolver.js'
import { ruleLevels, rulesMatching } from './rules.js'
import {
  annotationApplies,
  boundEntry,
  catalogueSet,
  checkPredicate,
  entriesFor,
  entriesOn,
  entrySource,
  keyPredicate,
  pendingReason,
  producerRan,
  referenceKey,
  type Accepted,
  type AnnotationCatalogue,
  type CatalogueSet,
  type Entry,
  type EntryReference,
  type ProducerCatalogue,
  type RequirementRow,
} from './source.js'
import { entryRow, records, type TableRow } from './table.js'

export type Enforce = 'MUST' | 'SHOULD'

export interface CatalogOptions {
  // Throw MissingRequiredField when a field the set requires at that strength is missing.
  enforce?: Enforce | null
}

// The entry bound to the level's column: by name or by prefix. A prefix matching several columns
// binds to each, so the lookup reports them as ambiguous.
function bindEntry(entry: Entry, obsColumns: string[]): Entry[] {
  const reference = entry.reference
  if (reference.prefix !== null) {
    const prefix = reference.prefix.toLowerCase()
    return obsColumns.filter((column) => column.toLowerCase().startsWith(prefix)).map((column) => boundEntry(entry, column))
  }
  return [entry]
}

interface LevelInputs {
  retained: Set<string>
  obsColumns: string[]
  ran: (producer: ProducerCatalogue) => boolean
  annotations: AnnotationCatalogue[]
}

// Bind one level to its set: the reviewed vendor entries, then the apps' and annotations'. Only
// entries whose field the level holds answer; an app that has not run leaves its entries pending. A
// set with vendor catalogues answers only for a reviewed software version.
function levelView(
  name: string,
  software: string | null,
  pattern: string | null,
  ruleLevel: string | null,
  set: CatalogueSet,
  inputs: LevelInputs,
): LevelView {
  if (software === null || pattern === null || ruleLevel === null) {
    return new UnreviewedLevel(name, null, null, 'the level records no rule_json software version')
  }
  let entries: Entry[] = []
  const reviewed = set.reviewed(software, pattern, ruleLevel)
  if (set.needsReview) {
    if (reviewed === null) {
      return new UnreviewedLevel(
        name,
        software,
        pattern,
        `no source catalogue reviewed ${software} ${pattern} ${ruleLevel}`,
      )
    }
    entries = heldEntries(entriesFor(reviewed.catalogue, reviewed.variant), inputs.retained)
  }
  const produced = producerEntries(set.producers, ruleLevel, inputs)
  const annotated = inputs.annotations.flatMap((annotation) =>
    boundEntries(annotation, ruleLevel, inputs.obsColumns),
  )
  entries = [...entries, ...produced.entries, ...annotated]
  if (reviewed !== null) return new ReviewedLevel(name, reviewed, entries, produced.pending)
  return new ProducedLevel(name, software, pattern, entries, produced.pending)
}

// The entries whose field the level holds.
function heldEntries(entries: Entry[], retained: Set<string>): Entry[] {
  return entries.filter((entry) => retained.has(referenceKey(entry.reference)))
}

function boundEntries(source: ProducerCatalogue | AnnotationCatalogue, ruleLevel: string, obsColumns: string[]): Entry[] {
  return entriesOn(source, ruleLevel).flatMap((entry) => bindEntry(entry, obsColumns))
}

// Every field the set's entries name on one level: without data, the catalogue says what a level
// holds.
function catalogued(set: CatalogueSet, level: string): Set<string> {
  return new Set(
    set
      .sources()
      .flatMap((source) => source.entries)
      .filter((entry) => (entry.reference.level === level || entry.reference.level === '*') && entry.reference.name !== null)
      .map((entry) => referenceKey(entry.reference)),
  )
}

// The apps' entries the level holds, and the entries of apps that have not run.
function producerEntries(
  producers: ProducerCatalogue[],
  ruleLevel: string,
  inputs: LevelInputs,
): { entries: Entry[]; pending: Pending[] } {
  const entries: Entry[] = []
  const pending: Pending[] = []
  for (const producer of producers) {
    const offered = boundEntries(producer, ruleLevel, inputs.obsColumns)
    if (inputs.ran(producer)) {
      entries.push(...heldEntries(offered, inputs.retained))
    } else {
      const reason = pendingReason(producer)
      pending.push(...offered.map((entry) => ({ entry, reason })))
    }
  }
  return { entries, pending }
}

function checkEnforce(enforce: Enforce | null): void {
  if (enforce !== null && enforce !== 'MUST' && enforce !== 'SHOULD') throw new Error('enforce is null, "MUST" or "SHOULD"')
}

// A missing field the set requires: throw MissingRequiredField, or warn for a SHOULD field under
// enforce MUST.
function enforceRequirement(resolution: Resolution, row: RequirementRow, enforce: Enforce): Resolution {
  resolution.requirement = row.requirement
  if (row.requirement === 'MUST' || enforce === 'SHOULD') throw new MissingRequiredField(resolution, row)
  console.warn(new MissingRequiredField(resolution, row))
  return resolution
}

// The requests, answers and rows both catalogues share for one set.
class Lookups {
  constructor(
    readonly name: string,
    readonly set: CatalogueSet,
    readonly views: Map<string, LevelView>,
    readonly enforce: Enforce | null,
  ) {
    if (enforce !== null && set.requirements.length === 0) {
      throw new Error(`catalogue '${name}' sets no requirements, so nothing to enforce`)
    }
  }

  // The request for a key, or for every key when `key` is null, narrowed by further qualifiers.
  // Throws when the set has no such key, or a qualifier names the kind or a value the key fixes.
  request(level: string, location: Location, key: string | null, qualifiers: Qualifiers): FieldRequest {
    const fixed: Accepted = key === null ? {} : keyPredicate(this.set.key(key))
    const clashing = sortC(Object.keys(qualifiers).filter((name) => name === 'kind' || name in fixed))
    if (clashing.length > 0) throw new Error(`ask by key; ${key ?? 'the lookup'} fixes ${clashing.join(', ')}`)
    const asked = Object.fromEntries(Object.entries(qualifiers).map(([name, value]) => [name, [value]]))
    return { level, location, key, qualifiers: { ...fixed, ...asked } }
  }

  answer(request: FieldRequest): Resolution {
    checkPredicate(this.set.vocabulary, request.qualifiers)
    const view = this.views.get(request.level) ?? new AbsentLevel(request.level)
    return view.resolve(request)
  }

  // The answer; a missing required field throws or warns as enforce says.
  lookup(level: string, location: Location, key: string, qualifiers: Qualifiers): Resolution {
    const resolution = this.answer(this.request(level, location, key, qualifiers))
    const row =
      resolution.status === 'missing' && this.enforce !== null ? this.set.requirementFor(level, location, key) : null
    if (row === null || row.requirement === 'MAY' || this.enforce === null) return resolution
    return enforceRequirement(resolution, row, this.enforce)
  }

  // The one field asked for, null when the level has none.
  find(level: string, location: Location, key: string, qualifiers: Qualifiers): EntryReference | null {
    return this.lookup(level, location, key, qualifiers).found()
  }

  // Every field one key names on a level: each match of an ambiguous answer. Throws UnresolvedField
  // when a field the key may name is undecided, or its producer has not run.
  findAll(level: string, location: Location, key: string): EntryReference[] {
    const resolution = this.lookup(level, location, key, {})
    if (resolution.status !== 'ambiguous') {
      const found = resolution.found()
      return found === null ? [] : [found]
    }
    const answering = new Set(this.views.get(level)?.entries.map((entry) => referenceKey(entry.reference)))
    if (resolution.candidates.some((candidate) => candidate.undecided.length > 0 || !answering.has(referenceKey(candidate.reference)))) {
      throw new UnresolvedField(resolution)
    }
    return resolution.candidates.map((candidate) => candidate.reference)
  }

  // The keys a field the level holds answers; a later producer's keys wait until it runs, so every
  // key listed reads.
  keys(level: string, location: Location): string[] {
    const resolution = this.answer(this.request(level, location, null, {}))
    const held = new Set(this.views.get(level)?.entries.map((entry) => referenceKey(entry.reference)))
    const answering = new Set(
      resolution.candidates.filter((candidate) => held.has(referenceKey(candidate.reference))).map((candidate) => candidate.key),
    )
    return resolution.offered().filter((key) => answering.has(key))
  }

  rows(view: LevelView, entries: Entry[]): TableRow[] {
    return entries.map((entry) => entryRow(this.name, this.set, entrySource(entry), view.softwareVersionPattern, entry))
  }
}

function present(rows: TableRow[]): TableRow[] {
  return rows.map((row) => ({ ...row, present: true, constant: null }))
}

// Rows with every column any of them has, in the order the columns first appear.
function fieldsFrame(rows: TableRow[]): TableRow[] {
  return records(rows, unique(rows.flatMap((row) => Object.keys(row))))
}

// Which column one software version reports for each meaning, from the catalogue alone, without
// data. `levels.get('peptidoform_ion')?.layers.get('intensity')` is 'Precursor_Quantity' for DIA-NN
// 2.6.0 in abundance: the slots of DataCatalog's levels, holding names. The rule levels whose
// version pattern admits the version give the levels; the set's entries for that pattern give each
// level's fields. Lookups that several fields answer, or that an unreviewed level cannot, throw
// UnresolvedField.
export class Catalog {
  readonly levels: ReadonlyMap<string, LevelNames>
  readonly #lookups: Lookups

  constructor(bundle: Bundle, software: string, version: string, catalog: string, options: CatalogOptions = {}) {
    const enforce = options.enforce ?? null
    checkEnforce(enforce)
    const set = catalogueSet(bundle, catalog)
    const matched = rulesMatching(bundle, software, version)
    if (matched.length === 0) {
      const known = unique(
        ruleLevels(bundle)
          .filter((found) => found.software_name.toLowerCase() === software.toLowerCase())
          .map((found) => found.software_version_pattern),
      )
      throw new Error(`no packaged ${software} rule admits version '${version}'; patterns: ${sortC(known).join(', ')}`)
    }
    const views = new Map<string, LevelView>()
    for (const found of matched) {
      views.set(
        found.level,
        levelView(found.level, found.software_name, found.software_version_pattern, found.level, set, {
          retained: catalogued(set, found.level),
          obsColumns: [],
          ran: (producer) => producer.requires.length === 0,
          annotations: [],
        }),
      )
    }
    const lookups = new Lookups(catalog, set, views, enforce)
    const lookup: Lookup = {
      field: (level, location, key, qualifiers) => lookups.find(level, location, key, qualifiers),
      fields: (level, location, key) => lookups.findAll(level, location, key),
      offered: (level, location) => lookups.keys(level, location),
      known: new Set(set.keys.map((key) => key.key)),
    }
    this.#lookups = lookups
    this.levels = new Map([...views.keys()].map((name) => [name, new LevelNames(name, lookup)]))
  }

  // What this catalogue set holds and who uses it.
  get description(): { purpose: string; used_by: string[] } {
    return this.#lookups.set.description
  }

  // Every catalogued field the rule declares, one row per field, as catalogue_table shows them.
  fields(): TableRow[] {
    const lookups = this.#lookups
    return fieldsFrame([...lookups.views.values()].flatMap((view) => present(lookups.rows(view, view.entries))))
  }

  toString(): string {
    return `<Catalog ${this.#lookups.name}: ${[...this.#lookups.views.keys()].join(', ')}>`
  }
}

// The set every data catalog composes: APB's own fields, so obs and var always answer.
const BASE = 'apb'

// What one result's fields mean to its consumers. Composes the named sets with apb, which is always
// in; a key routes to the sets that define it, and two sets naming different fields for one key on
// one level is an error. `levels.get('peptidoform_ion')?.layers.get('pep')` is MaxQuant's PEP
// layer. Starts from the result's provenance JSON and fetches a Parquet file only when its data is
// asked for. Ambiguous or unreviewed answers throw UnresolvedField.
export class DataCatalog {
  readonly levels: ReadonlyMap<string, Level>
  readonly #provenance: Provenance
  readonly #sets: Map<string, Lookups>
  readonly #known: Set<string>

  private constructor(bundle: Bundle, provenance: Provenance, catalogs: string[], options: CatalogOptions) {
    const enforce = options.enforce ?? null
    checkEnforce(enforce)
    const names = unique([...catalogs, BASE])
    this.#sets = new Map(names.map((name) => [name, dataLookups(bundle, provenance, name, enforce)]))
    if (enforce !== null && ![...this.#sets.values()].some((lookups) => lookups.set.requirements.length > 0)) {
      throw new Error(`catalogues ${names.join(', ')} set no requirements, so nothing to enforce`)
    }
    checkSharedKeys(this.#sets)
    this.#known = new Set([...this.#sets.values()].flatMap((lookups) => lookups.set.keys.map((key) => key.key)))
    this.#provenance = provenance
    const lookup: Lookup = {
      field: (level, location, key, qualifiers) => this.#find(level, location, key, qualifiers),
      fields: (level, location, key) => this.#keyFields(level, location, key),
      offered: (level, location) => this.#offered(level, location),
      known: this.#known,
    }
    this.levels = new Map([...provenance.levels.keys()].map((name) => [name, new Level(name, provenance, lookup)]))
  }

  // Bind the catalogue sets to the levels of the result whose provenance JSON is at `provenanceUrl`.
  static async load(
    bundle: Bundle,
    provenanceUrl: string | URL,
    catalogs: string[],
    options: CatalogOptions = {},
  ): Promise<DataCatalog> {
    return new DataCatalog(bundle, await Provenance.load(provenanceUrl), catalogs, options)
  }

  // What the first catalogue set named holds and who uses it.
  get description(): { purpose: string; used_by: string[] } {
    return this.#first().set.description
  }

  // Every catalogued field of the result in every composed set, one row per field, as
  // catalogue_table shows them, with `present` and, for a field apb2 left out because it held one
  // value, that `constant`.
  fields(): TableRow[] {
    const rows = [...this.#sets.values()].flatMap((lookups) =>
      [...lookups.views].flatMap(([name, view]) => levelFields(lookups, view, this.#provenance.level(name))),
    )
    return fieldsFrame(rows)
  }

  toString(): string {
    return `<DataCatalog ${[...this.#sets.keys()].join(', ')}: ${[...this.levels.keys()].join(', ')}>`
  }

  #first(): Lookups {
    return this.#sets.values().next().value as Lookups
  }

  // The sets that define a key and declare every further qualifier asked; the first set that
  // defines it when none declares them, so its lookup names what it lacks.
  #defining(key: string, qualifiers: Qualifiers = {}): Lookups[] {
    const found = [...this.#sets.values()].filter((lookups) => lookups.set.hasKey(key))
    if (found.length === 0) throw new Error(`unknown key '${key}'; keys: ${sortC(this.#known).join(', ')}`)
    const declaring = found.filter((lookups) =>
      Object.keys(qualifiers).every((name) => name in lookups.set.vocabulary.qualifiers),
    )
    return declaring.length > 0 ? declaring : found.slice(0, 1)
  }

  // The field one key names, asked of every set that defines the key; the first found.
  #find(level: string, location: Location, key: string, qualifiers: Qualifiers): EntryReference | null {
    let found: EntryReference | null = null
    for (const lookups of this.#defining(key, qualifiers)) {
      const reference = lookups.find(level, location, key, qualifiers)
      found = found ?? reference
    }
    return found
  }

  // Every field one key names, from every set that defines the key.
  #keyFields(level: string, location: Location, key: string): EntryReference[] {
    const found = new Map<string, EntryReference>()
    for (const lookups of this.#defining(key)) {
      for (const reference of lookups.findAll(level, location, key)) {
        if (!found.has(referenceKey(reference))) found.set(referenceKey(reference), reference)
      }
    }
    return [...found.values()]
  }

  // The keys the level offers at one location, from every set.
  #offered(level: string, location: Location): string[] {
    return sortC(unique([...this.#sets.values()].flatMap((lookups) => lookups.keys(level, location))))
  }
}

// One set bound to every level of a result; `enforce` applies where the set has requirements.
function dataLookups(bundle: Bundle, provenance: Provenance, name: string, enforce: Enforce | null): Lookups {
  const set = catalogueSet(bundle, name)
  const annotations = set.annotations.filter((annotation) => annotationApplies(annotation, provenance.metadata))
  const views = new Map<string, LevelView>()
  for (const [levelName, level] of provenance.levels) {
    const version = level.ruleVersion()
    views.set(
      levelName,
      levelView(levelName, version.software, version.pattern, version.level, set, {
        retained: level.retained(),
        obsColumns: level.obs.columns,
        ran: (producer) => producerRan(producer, provenance.metadata),
        annotations,
      }),
    )
  }
  return new Lookups(name, set, views, set.requirements.length > 0 ? enforce : null)
}

// Sets that share a key must name the same fields with it, level by level and slot by slot; a set
// may name more, told apart by a qualifier the other set lacks. Throws when two sets name different
// fields for one key in one slot of a level.
function checkSharedKeys(sets: Map<string, Lookups>): void {
  const named = new Map<string, Map<string, Set<string>>>()
  for (const [setName, lookups] of sets) {
    for (const [level, view] of lookups.views) {
      for (const entry of view.entries) {
        const location = entry.reference.location === 'varm' ? 'var' : entry.reference.location
        const slot = [level, entry.key, location].join('\x1f')
        const bySet = named.get(slot) ?? new Map<string, Set<string>>()
        named.set(slot, bySet)
        const fields = bySet.get(setName) ?? new Set<string>()
        bySet.set(setName, fields)
        fields.add(referenceKey(entry.reference))
      }
    }
  }
  const within = (one: Set<string>, other: Set<string>): boolean => [...one].every((field) => other.has(field))
  for (const [slot, bySet] of named) {
    const fields = [...bySet.values()]
    if (fields.some((one) => fields.some((other) => !(within(one, other) || within(other, one))))) {
      const [level, key, location] = slot.split('\x1f')
      throw new Error(`key '${key}' names different ${location} fields on ${level} in the sets ${sortC(bySet.keys()).join(', ')}`)
    }
  }
}

// The rows of one level's fields: those it holds, and for a reviewed level those it lacks, with the
// single value of a field apb2 left out.
function levelFields(lookups: Lookups, view: LevelView, level: ProvenanceLevel): TableRow[] {
  const rows = present(lookups.rows(view, view.entries))
  if (!(view instanceof ReviewedLevel)) return rows
  const held = new Set(view.entries.map((entry) => entry.entry_id))
  const leftOut = level.leftOut()
  const absent = entriesFor(view.rule.catalogue, view.rule.variant).filter((entry) => !held.has(entry.entry_id))
  const absentRows = lookups.rows(view, absent).map((row, index) => ({
    ...row,
    present: false,
    constant: leftOut.get(referenceKey((absent[index] as Entry).reference)) ?? null,
  }))
  return [...rows, ...absentRows]
}
