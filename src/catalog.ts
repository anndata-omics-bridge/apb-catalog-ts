// Look up APB fields by meaning, so callers never name vendor columns; apb_catalog.catalog.

import type { Bundle } from './bundle.js'
import { MissingRequiredField, StaleField } from './conditions.js'
import { jsonEqual, jsonText, sortC, unique, type Json, type JsonObject } from './json.js'
import { Provenance, type Column, type Layer, type ProvenanceLevel } from './provenance.js'
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
import { ruleDeclarations, ruleField, ruleLevels, ruleRetained, ruleRoles, rulesMatching } from './rules.js'
import {
  annotationApplies,
  boundEntry,
  catalogueSet,
  checkPredicate,
  entriesFor,
  entriesOn,
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
import { ANY_RULE, entryRow, records, setColumns, type TableRow } from './table.js'

// Qualifiers a request means unless it says otherwise, where the set declares them.
const DEFAULTS: Record<string, string> = { stage: 'identification' }

// The accepted values of one qualifier: one value, or several.
export type QualifierValue = string | readonly string[]

// Qualifiers by name, such as { normalization: 'none' }.
export type Qualifiers = Record<string, QualifierValue>

// A lookup: the kind, and other qualifiers by name, such as { kind: 'intensity', normalization: 'none' }.
export interface Query {
  kind: QualifierValue
  [qualifier: string]: QualifierValue
}

export type Enforce = 'MUST' | 'SHOULD'

export interface CatalogOptions {
  // Throw MissingRequiredField when a field the set requires at that strength is missing.
  enforce?: Enforce | null
}

// Where a field lives: the level, the location ('layers', 'var', 'varm' or 'obs'), the column name
// and, for a varm field, its table.
export class Reference {
  constructor(
    readonly level: string,
    readonly location: string,
    readonly name: string,
    readonly table: string | null = null,
  ) {}

  toString(): string {
    const table = this.table === null ? '' : ` [${this.table}]`
    return `<Reference ${this.level} ${this.location}${table}: ${this.name}>`
  }
}

function referenceOf(found: EntryReference): Reference {
  return new Reference(found.level, found.location, found.name as string, found.table)
}

function accepted(qualifiers: Qualifiers): Accepted {
  return Object.fromEntries(
    Object.entries(qualifiers).map(([name, value]) => [name, typeof value === 'string' ? [value] : [...value]]),
  )
}

// The entry bound to the level's column: by name, by the role's column or by prefix. A prefix
// matching several columns binds to each, so the lookup reports them as ambiguous.
function bindEntry(entry: Entry, roles: Map<string, string>, obsColumns: string[]): Entry[] {
  const reference = entry.reference
  if (reference.role !== null) {
    const column = roles.get(reference.role)
    return column === undefined ? [] : [boundEntry(entry, column)]
  }
  if (reference.prefix !== null) {
    const prefix = reference.prefix.toLowerCase()
    return obsColumns.filter((column) => column.toLowerCase().startsWith(prefix)).map((column) => boundEntry(entry, column))
  }
  return [entry]
}

interface LevelInputs {
  retained: Set<string>
  roles: Map<string, string>
  obsColumns: string[]
  ran: (producer: ProducerCatalogue) => boolean
  annotations: AnnotationCatalogue[]
}

// Bind one level to its set: the reviewed vendor entries, then APB's own fields. Only entries whose
// field the level holds answer; a producer that has not run leaves its entries pending. A set with
// vendor catalogues answers only for a reviewed rule.
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
    boundEntries(annotation, ruleLevel, inputs.roles, inputs.obsColumns),
  )
  entries = [...entries, ...produced.entries, ...annotated]
  if (reviewed !== null) return new ReviewedLevel(name, reviewed, entries, produced.pending)
  return new ProducedLevel(name, software, pattern, entries, produced.pending)
}

// The entries whose field the level holds.
function heldEntries(entries: Entry[], retained: Set<string>): Entry[] {
  return entries.filter((entry) => retained.has(referenceKey(entry.reference)))
}

function boundEntries(
  source: ProducerCatalogue | AnnotationCatalogue,
  ruleLevel: string,
  roles: Map<string, string>,
  obsColumns: string[],
): Entry[] {
  return entriesOn(source, ruleLevel).flatMap((entry) => bindEntry(entry, roles, obsColumns))
}

// The producers' entries the level holds, and the entries of producers that have not run.
function producerEntries(
  producers: ProducerCatalogue[],
  ruleLevel: string,
  inputs: LevelInputs,
): { entries: Entry[]; pending: Pending[] } {
  const entries: Entry[] = []
  const pending: Pending[] = []
  for (const producer of producers) {
    const offered = boundEntries(producer, ruleLevel, inputs.roles, inputs.obsColumns)
    if (inputs.ran(producer)) {
      entries.push(...heldEntries(offered, inputs.retained))
    } else {
      const reason = pendingReason(producer)
      pending.push(...offered.map((entry) => ({ entry, reason })))
    }
  }
  return { entries, pending }
}

function checkEnforce(name: string, set: CatalogueSet, enforce: Enforce | null): void {
  if (enforce === null) return
  if (enforce !== 'MUST' && enforce !== 'SHOULD') throw new Error('enforce is null, "MUST" or "SHOULD"')
  if (set.requirements.length === 0) throw new Error(`catalogue '${name}' sets no requirements, so nothing to enforce`)
}

// A missing field the set requires: throw MissingRequiredField, or warn for a SHOULD field under
// enforce MUST.
function enforceRequirement(resolution: Resolution, row: RequirementRow, enforce: Enforce): null {
  resolution.requirement = row.requirement
  if (row.requirement === 'MUST' || enforce === 'SHOULD') throw new MissingRequiredField(resolution, row)
  console.warn(new MissingRequiredField(resolution, row))
  return null
}

// Who each entry of the set comes from, by entry id.
function sourceLabels(set: CatalogueSet): Map<string, string> {
  const labels = new Map<string, string>()
  for (const source of set.sources()) {
    for (const entry of source.entries) labels.set(entry.entry_id, source.label)
  }
  return labels
}

// The requests, answers and rows both catalogues share for one set.
class Lookups {
  constructor(
    readonly name: string,
    readonly set: CatalogueSet,
    readonly views: Map<string, LevelView>,
    readonly enforce: Enforce | null,
  ) {
    checkEnforce(name, set, enforce)
  }

  request(level: string, location: string, qualifiers: Accepted): FieldRequest {
    const declared = new Set(Object.keys(this.set.vocabulary.qualifiers))
    const described: Accepted = {}
    for (const [name, value] of Object.entries(DEFAULTS)) {
      if (declared.has(name)) described[name] = [value]
    }
    Object.assign(described, qualifiers)
    return { level, location, qualifiers: described }
  }

  answer(request: FieldRequest): Resolution {
    checkPredicate(this.set.vocabulary, request.qualifiers)
    const view = this.views.get(request.level) ?? new AbsentLevel(request.level)
    return view.resolve(request)
  }

  // The field asked for; a missing required field throws or warns as enforce says.
  find(level: string, location: string, qualifiers: Accepted): EntryReference | null {
    const request = this.request(level, location, qualifiers)
    const resolution = this.answer(request)
    const row =
      resolution.status === 'missing' && this.enforce !== null
        ? this.set.requirementFor(level, location, request.qualifiers)
        : null
    if (row === null || row.requirement === 'MAY' || this.enforce === null) return resolution.found()
    return enforceRequirement(resolution, row, this.enforce)
  }

  kinds(level: string, location: string, qualifiers: Accepted): string[] {
    return this.answer(this.request(level, location, qualifiers)).offered('kind')
  }

  rows(view: LevelView, entries: Entry[]): TableRow[] {
    const labels = sourceLabels(this.set)
    const rule = view.ruleName ?? ANY_RULE
    return entries.map((entry) =>
      entryRow(
        this.name,
        this.set,
        labels.get(entry.entry_id) ?? '',
        view.softwareVersionPattern,
        entry.rules.length > 0 ? rule : ANY_RULE,
        entry,
      ),
    )
  }

  fieldRecords(rows: TableRow[]): TableRow[] {
    return records(rows, [...setColumns(this.set), 'present', 'constant'])
  }
}

function present(rows: TableRow[]): TableRow[] {
  return rows.map((row) => ({ ...row, present: true, constant: null }))
}

// Which column one software version reports for each meaning, from the rules alone, without data.
// The rule of the software whose version pattern admits the version decides which fields each level
// has. Lookups that several fields answer, or that an unreviewed level cannot, throw UnresolvedField.
export class Catalog {
  readonly #lookups: Lookups

  constructor(bundle: Bundle, software: string, version: string, catalog: string, options: CatalogOptions = {}) {
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
          retained: ruleRetained(bundle, found.rule, found.level),
          roles: ruleRoles(bundle, found.rule, found.level),
          obsColumns: [],
          ran: (producer) => producer.requires.length === 0,
          annotations: [],
        }),
      )
    }
    this.#lookups = new Lookups(catalog, set, views, options.enforce ?? null)
  }

  // What this catalogue set holds and who uses it.
  get description(): { purpose: string; used_by: string[] } {
    return this.#lookups.set.description
  }

  // The kinds the level offers at one location ('layers', 'var' or 'obs'), given other qualifiers.
  kinds(level: string, location: string, qualifiers: Qualifiers = {}): string[] {
    return this.#lookups.kinds(level, location, accepted(qualifiers))
  }

  // Where the run-by-feature layer with this meaning lives, or null when the level has none.
  layer(level: string, query: Query): Reference | null {
    return this.#found(level, 'layers', query)
  }

  // Where the per-feature column with this meaning lives, in var or a varm table, or null.
  var(level: string, query: Query): Reference | null {
    return this.#found(level, 'var', query)
  }

  // Where the per-run column with this meaning lives, or null.
  obs(level: string, query: Query): Reference | null {
    return this.#found(level, 'obs', query)
  }

  // Every catalogued field the rule declares, one row per field, as catalogue_table shows them.
  fields(): TableRow[] {
    const lookups = this.#lookups
    return lookups.fieldRecords([...lookups.views.values()].flatMap((view) => present(lookups.rows(view, view.entries))))
  }

  toString(): string {
    return `<Catalog ${this.#lookups.name}: ${[...this.#lookups.views.keys()].join(', ')}>`
  }

  #found(level: string, location: string, query: Query): Reference | null {
    const found = this.#lookups.find(level, location, accepted(query))
    return found === null ? null : referenceOf(found)
  }
}

// The lookup behind a DataCatalog's data calls, for the tests: the reference, after the staleness check.
export let findIn: (catalog: DataCatalog, level: string, location: string, query: Query) => Reference | null

// What one result's fields mean to one consumer. Starts from the result's provenance JSON and
// fetches a Parquet file only when its data is asked for. A lookup of a field the result's stored
// rule declares differently from the catalog's rule throws StaleField; ambiguous or unreviewed
// answers throw UnresolvedField.
export class DataCatalog {
  readonly #bundle: Bundle
  readonly #provenance: Provenance
  readonly #lookups: Lookups

  static {
    findIn = (catalog, level, location, query) => catalog.#find(level, location, query)
  }

  private constructor(bundle: Bundle, provenance: Provenance, catalog: string, options: CatalogOptions) {
    const set = catalogueSet(bundle, catalog)
    const annotations = set.annotations.filter((annotation) => annotationApplies(annotation, provenance.metadata))
    const views = new Map<string, LevelView>()
    for (const [name, level] of provenance.levels) {
      const version = level.ruleVersion()
      views.set(
        name,
        levelView(name, version.software, version.pattern, version.level, set, {
          retained: level.retained(),
          roles: level.roles(),
          obsColumns: level.obs.columns,
          ran: (producer) => producerRan(producer, provenance.metadata),
          annotations,
        }),
      )
    }
    this.#bundle = bundle
    this.#provenance = provenance
    this.#lookups = new Lookups(catalog, set, views, options.enforce ?? null)
  }

  // Bind a catalogue set to the levels of the result whose provenance JSON is at `provenanceUrl`.
  static async load(
    bundle: Bundle,
    provenanceUrl: string | URL,
    catalog: string,
    options: CatalogOptions = {},
  ): Promise<DataCatalog> {
    return new DataCatalog(bundle, await Provenance.load(provenanceUrl), catalog, options)
  }

  // What this catalogue set holds and who uses it.
  get description(): { purpose: string; used_by: string[] } {
    return this.#lookups.set.description
  }

  // The kinds the level offers at one location ('layers', 'var' or 'obs'), given other qualifiers.
  kinds(level: string, location: string, qualifiers: Qualifiers = {}): string[] {
    return this.#lookups.kinds(level, location, accepted(qualifiers))
  }

  // The layer with this meaning, or null when the result has none.
  async layer(level: string, query: Query): Promise<Layer | null> {
    const reference = this.#find(level, 'layers', query)
    return reference === null ? null : this.#provenance.layer(level, reference.name)
  }

  // The per-feature column with this meaning, from var or a varm table, or null.
  async var(level: string, query: Query): Promise<Column | null> {
    const reference = this.#find(level, 'var', query)
    if (reference === null) return null
    return reference.table === null
      ? this.#provenance.column(level, 'var', reference.name)
      : this.#provenance.varmColumn(level, reference.table, reference.name)
  }

  // The per-run column with this meaning, or null.
  async obs(level: string, query: Query): Promise<Column | null> {
    const reference = this.#find(level, 'obs', query)
    return reference === null ? null : this.#provenance.column(level, 'obs', reference.name)
  }

  // Every catalogued field of the result, one row per field, as catalogue_table shows them, with
  // `present` and, for a field apb2 left out because it held one value, that `constant`.
  fields(): TableRow[] {
    const lookups = this.#lookups
    const rows = [...lookups.views].flatMap(([name, view]) => levelFields(lookups, view, this.#provenance.level(name)))
    return lookups.fieldRecords(rows)
  }

  toString(): string {
    return `<DataCatalog ${this.#lookups.name}: ${[...this.#lookups.views.keys()].join(', ')}>`
  }

  #find(level: string, location: string, query: Query): Reference | null {
    const found = this.#lookups.find(level, location, accepted(query))
    if (found === null) return null
    const view = this.#lookups.views.get(level)
    if (view !== undefined) checkCurrent(this.#bundle, view, this.#provenance.level(level), found)
    return referenceOf(found)
  }
}

// Throw StaleField when the level's stored rule declares the field differently from the bundle's rule.
function checkCurrent(bundle: Bundle, view: LevelView, level: ProvenanceLevel, reference: EntryReference): void {
  const rule = view.ruleName
  const storedRule = level.storedRule()
  if (rule === null || storedRule === null) return
  const stored = ruleField(storedRule, reference.location, reference.name)
  const current = ruleDeclarations(bundle, rule, String(storedRule.quantification_level)).map((declared) =>
    ruleField(declared, reference.location, reference.name),
  )
  if (current.some((declared) => jsonEqual(stored, declared))) return
  if (stored === null && current.every((declared) => declared === null)) return
  const declared = current.find((found) => found !== null) ?? null
  throw new StaleField(referenceOf(reference), sourceText(stored), sourceText(declared))
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

function sourceText(declared: JsonObject | null): string {
  if (declared === null) return 'no such field'
  let source: Json | undefined = declared.source
  if (source === undefined || source === null || source === '') source = declared.inputs
  if (source !== undefined && source !== null && !(Array.isArray(source) && source.length === 0)) {
    return jsonText(source)
  }
  return jsonText(Object.fromEntries(sortC(Object.keys(declared)).map((name) => [name, declared[name]])))
}
