// Which catalogued fields every rule supplies, and whether each level meets its set; apb_catalog.coverage.

import type { Bundle } from './bundle.js'
import type { Json } from './json.js'
import { sortC } from './json.js'
import { ruleLevels, ruleRetained, ruleRoles, ruleVarInputs, versionLabel } from './rules.js'
import {
  boundEntry,
  catalogueSet,
  entriesFor,
  entriesOn,
  referenceKey,
  rowDescribes,
  setNames,
  type CatalogueSet,
  type Entry,
  type EntryReference,
  type ProducerCatalogue,
  type RequirementRow,
  type Variant,
} from './source.js'
import { records, type TableRow } from './table.js'

const COVERAGE_COLUMNS = [
  'software',
  'version',
  'rule',
  'level',
  'kind',
  'qualifiers',
  'origin',
  'producer',
  'requirement',
  'location',
  'table',
  'column',
  'inputs',
  'needs',
  'verdict',
]

const SEVERITY: Record<string, string> = { MUST: 'fail', SHOULD: 'warn', MAY: 'warn' }

// Every catalogue set of the bundle with its purpose, its users and its number of entries.
export function catalogues(bundle: Bundle): TableRow[] {
  const rows = setNames(bundle).map((name) => {
    const set = catalogueSet(bundle, name)
    return {
      catalogue: name,
      purpose: set.description.purpose,
      used_by: [...set.description.used_by],
      has_requirements: set.requirements.length > 0,
      entries: set.sources().reduce((count, source) => count + source.entries.length, 0),
    }
  })
  return records(rows, ['catalogue', 'purpose', 'used_by', 'has_requirements', 'entries'])
}

// Check every rule against one catalogue set: one row per catalogued or required field of each rule
// level the set reviews; a set without vendor catalogues is checked against every rule level. A set
// with requirements judges each level: `fail` when a MUST field is unsupported, `warn` when a SHOULD
// or MAY field is, `pass` otherwise.
export function rule_coverage(bundle: Bundle, catalogue: string): TableRow[] {
  const set = catalogueSet(bundle, catalogue)
  const rows: TableRow[] = []
  for (const vendor of set.catalogues) {
    for (const variant of vendor.variants) {
      rows.push(...variantRows(bundle, set, vendor.software_name, variant, entriesFor(vendor, variant)))
    }
  }
  if (!set.needsReview) {
    for (const found of ruleLevels(bundle)) {
      const variant = { rule: found.rule, level: found.level, software_version_pattern: found.software_version_pattern }
      rows.push(...variantRows(bundle, set, found.software_name, variant, []))
    }
  }
  return records(rows, COVERAGE_COLUMNS)
}

interface Found {
  entry: Entry
  producer: ProducerCatalogue | null
}

function variantRows(
  bundle: Bundle,
  set: CatalogueSet,
  software: string,
  variant: Variant,
  vendorEntries: Entry[],
): TableRow[] {
  const found: Found[] = [
    ...vendorEntries.map((entry) => ({ entry, producer: null })),
    ...producerFields(bundle, set.producers, variant),
  ]
  const required = set.requirements.filter((row) => row.level === variant.level)
  const missing = required.filter((row) => !found.some((item) => rowDescribes(row, item.entry)))
  const verdict = required.length > 0 ? coverageVerdict(missing.map((row) => row.requirement)) : null
  const base: TableRow = {
    software,
    version: versionLabel(bundle, variant.software_version_pattern),
    rule: variant.rule,
    level: variant.level,
    verdict,
  }
  const rows: TableRow[] = found.map((item) => ({
    ...base,
    ...coverageField(bundle, item.entry, item.producer, variant),
    requirement: rowRequirement(required, item.entry),
  }))
  for (const row of missing) {
    rows.push({
      ...base,
      kind: row.kind,
      qualifiers: qualifierPairs(row.qualifiers),
      location: row.location,
      requirement: row.requirement,
    })
  }
  return requiredOrder(rows.length > 0 ? rows : [base], required)
}

// The producer fields that count on a rule level: where conversion keeps their column, or once their
// producer runs.
function producerFields(bundle: Bundle, producers: ProducerCatalogue[], variant: Variant): Found[] {
  const roles = ruleRoles(bundle, variant.rule, variant.level)
  return producers.flatMap((producer) =>
    entriesOn(producer, variant.level)
      .flatMap((entry) => coverageBound(entry, roles))
      .filter((entry) => producer.requires.length > 0 || variantRetains(bundle, variant, entry.reference))
      .map((entry) => ({ entry, producer })),
  )
}

// Rows in the order of the requirements their kind answers, vendor fields before producer fields;
// stable otherwise.
function requiredOrder(rows: TableRow[], required: RequirementRow[]): TableRow[] {
  const kinds = required.map((row) => row.kind)
  const rank = (row: TableRow): number => {
    const index = typeof row.kind === 'string' ? kinds.indexOf(row.kind) : -1
    return index === -1 ? required.length : index
  }
  const produced = (row: TableRow): number => (row.producer === undefined || row.producer === null ? 0 : 1)
  return [...rows].sort((left, right) => rank(left) - rank(right) || produced(left) - produced(right))
}

// A producer entry bound to the rule's column: its role's column when it names a role.
function coverageBound(entry: Entry, roles: Map<string, string>): Entry[] {
  const role = entry.reference.role
  if (role === null) return [entry]
  const column = roles.get(role)
  return column === undefined ? [] : [boundEntry(entry, column)]
}

function variantRetains(bundle: Bundle, variant: Variant, reference: EntryReference): boolean {
  return ruleRetained(bundle, variant.rule, variant.level).has(referenceKey(reference))
}

function rowRequirement(required: RequirementRow[], entry: Entry): string | null {
  return required.find((row) => rowDescribes(row, entry))?.requirement ?? null
}

function qualifierPairs(qualifiers: Record<string, string>): string | null {
  const names = sortC(Object.keys(qualifiers))
  return names.length === 0 ? null : names.map((name) => `${name}=${qualifiers[name]}`).join(';')
}

function coverageVerdict(requirements: string[]): string {
  const severities = requirements.map((requirement) => SEVERITY[requirement])
  if (severities.includes('fail')) return 'fail'
  return severities.length > 0 ? 'warn' : 'pass'
}

function coverageField(bundle: Bundle, entry: Entry, producer: ProducerCatalogue | null, variant: Variant): TableRow {
  const reference = entry.reference
  const others: Record<string, string> = {}
  for (const [name, value] of Object.entries(entry.qualifiers)) {
    if (name !== 'kind' && name !== 'origin') others[name] = value
  }
  const inputs: Json =
    reference.location === 'var' && variantRetains(bundle, variant, reference)
      ? ruleVarInputs(bundle, variant.rule, variant.level, reference.name)
      : []
  return {
    kind: entry.qualifiers.kind ?? null,
    qualifiers: qualifierPairs(others),
    origin: entry.qualifiers.origin ?? null,
    producer: producer === null ? null : producer.producer,
    location: reference.location,
    table: reference.table,
    column: reference.name,
    inputs,
    needs: producer === null ? null : producer.instruction,
  }
}
