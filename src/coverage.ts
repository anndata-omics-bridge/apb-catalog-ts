// Which catalogued fields every rule supplies, and whether each level meets its set; apb_catalog.coverage.

import type { Bundle } from './bundle.js'
import { sortC } from './json.js'
import { ruleLevels, versionLabel } from './rules.js'
import {
  catalogueSet,
  entriesFor,
  entriesOn,
  rowDescribes,
  setNames,
  type CatalogueSet,
  type Entry,
  type ProducerCatalogue,
  type RequirementRow,
  type Variant,
} from './source.js'
import { records, type TableRow } from './table.js'

const COVERAGE_COLUMNS = [
  'software',
  'version',
  'software_version_pattern',
  'level',
  'key',
  'kind',
  'qualifiers',
  'origin',
  'producer',
  'requirement',
  'location',
  'table',
  'column',
  'needs',
  'verdict',
]

const SEVERITY: Record<string, string> = { required: 'fail', recommended: 'warn', optional: 'pass' }

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
// level the set reviews; a set without vendor catalogues is checked against every level the bundle's
// entries name for each version of versions.csv. A set with requirements judges each level: `fail`
// when a required field is unsupported, `warn` when a recommended one is, `pass` otherwise; an
// unsupported optional field is listed but passes.
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
      const variant = { level: found.level, software_version_pattern: found.software_version_pattern }
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
    ...producerFields(set.producers, variant),
  ]
  const required = set.requirements.filter((row) => row.level === variant.level)
  const missing = required.filter((row) => !found.some((item) => rowDescribes(row, item.entry)))
  const verdict = required.length > 0 ? coverageVerdict(missing.map((row) => row.requirement)) : null
  const base: TableRow = {
    software,
    version: versionLabel(bundle, variant.software_version_pattern),
    software_version_pattern: variant.software_version_pattern,
    level: variant.level,
    verdict,
  }
  const rows: TableRow[] = found.map((item) => ({
    ...base,
    ...coverageField(item.entry, item.producer),
    requirement: rowRequirement(required, item.entry),
  }))
  for (const row of missing) {
    const key = set.key(row.key)
    rows.push({
      ...base,
      key: row.key,
      kind: key.kind,
      qualifiers: qualifierPairs(key.fixed),
      location: row.location,
      requirement: row.requirement,
    })
  }
  return requiredOrder(rows.length > 0 ? rows : [base], required)
}

// The apps' fields on a rule level: every entry of an app counts, with what to run.
function producerFields(producers: ProducerCatalogue[], variant: Variant): Found[] {
  return producers.flatMap((producer) => entriesOn(producer, variant.level).map((entry) => ({ entry, producer })))
}

// Rows in the order of the requirements their key answers, vendor fields before producer fields;
// stable otherwise.
function requiredOrder(rows: TableRow[], required: RequirementRow[]): TableRow[] {
  const keys = required.map((row) => row.key)
  const rank = (row: TableRow): number => {
    const index = typeof row.key === 'string' ? keys.indexOf(row.key) : -1
    return index === -1 ? required.length : index
  }
  const produced = (row: TableRow): number => (row.producer === undefined || row.producer === null ? 0 : 1)
  return [...rows].sort((left, right) => rank(left) - rank(right) || produced(left) - produced(right))
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
  return severities.includes('warn') ? 'warn' : 'pass'
}

function coverageField(entry: Entry, producer: ProducerCatalogue | null): TableRow {
  const reference = entry.reference
  const others: Record<string, string> = {}
  for (const [name, value] of Object.entries(entry.qualifiers)) {
    if (name !== 'kind' && name !== 'origin') others[name] = value
  }
  return {
    key: entry.key,
    kind: entry.qualifiers.kind ?? null,
    qualifiers: qualifierPairs(others),
    origin: entry.qualifiers.origin ?? null,
    producer: producer === null ? null : producer.producer,
    location: reference.location,
    table: reference.table,
    column: reference.name,
    needs: producer === null ? null : producer.instruction,
  }
}
