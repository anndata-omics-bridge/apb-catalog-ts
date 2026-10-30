// Every catalogue set as one long table: one row per entry and rule it applies to; apb_catalog.table.

import type { Bundle } from './bundle.js'
import type { Json } from './json.js'
import { catalogueSet, rowDescribes, setNames, type CatalogueSet, type Entry } from './source.js'

export type TableRow = Record<string, Json>

export const KEY_COLUMNS = ['set', 'source', 'version_pattern', 'rule', 'level', 'location', 'table', 'name']

// The rule of an entry that applies to every rule: a producer's or a sample annotation's.
export const ANY_RULE = '*'

// The column an entry names: its name, or the role or prefix it is found by.
function fieldName(entry: Entry): string {
  const reference = entry.reference
  if (reference.name !== null) return reference.name
  if (reference.role !== null) return `role:${reference.role}`
  return `prefix:${reference.prefix}`
}

// One table row: where the entry's field lives, its qualifiers and its requirement.
export function entryRow(
  setName: string,
  set: CatalogueSet,
  source: string,
  versionPattern: string | null,
  rule: string,
  entry: Entry,
): TableRow {
  const reference = entry.reference
  const row: TableRow = {
    set: setName,
    source,
    version_pattern: versionPattern,
    rule,
    level: reference.level,
    location: reference.location,
    table: reference.table,
    name: fieldName(entry),
  }
  for (const qualifier of Object.keys(set.vocabulary.qualifiers)) {
    row[`qualifier.${qualifier}`] = entry.qualifiers[qualifier] ?? null
  }
  row.requirement = set.requirements.find((requirement) => rowDescribes(requirement, entry))?.requirement ?? null
  row.entry_id = entry.entry_id
  return row
}

// Every row of one set: vendor entries once per rule, the others once.
function setRows(setName: string, set: CatalogueSet): TableRow[] {
  const rows: TableRow[] = []
  for (const vendor of set.catalogues) {
    const patterns = new Map(vendor.variants.map((variant) => [variant.rule, variant.software_version_pattern]))
    for (const entry of vendor.entries) {
      for (const rule of entry.rules) {
        rows.push(entryRow(setName, set, vendor.label, patterns.get(rule) ?? null, rule, entry))
      }
    }
  }
  for (const source of [...set.producers, ...set.annotations]) {
    for (const entry of source.entries) rows.push(entryRow(setName, set, source.label, null, ANY_RULE, entry))
  }
  return rows
}

export function setColumns(set: CatalogueSet): string[] {
  return [
    ...KEY_COLUMNS,
    ...Object.keys(set.vocabulary.qualifiers).map((name) => `qualifier.${name}`),
    'requirement',
    'entry_id',
  ]
}

// Rows with exactly these columns, in this order; a column a row lacks is null there.
export function records(rows: TableRow[], columns: string[]): TableRow[] {
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])))
}

// The catalogue sets as one long table, one row per entry and rule it applies to, as
// `apb-catalog table` prints it: every set of the bundle, or one.
export function catalogue_table(bundle: Bundle, catalogue: string | null = null): TableRow[] {
  const names = catalogue === null ? setNames(bundle) : [catalogue]
  const rows: TableRow[] = []
  const columns = new Set<string>()
  for (const name of names) {
    const set = catalogueSet(bundle, name)
    rows.push(...setRows(name, set))
    for (const column of setColumns(set)) columns.add(column)
  }
  const qualifiers = [...columns].filter((column) => column.startsWith('qualifier.'))
  return records(rows, [...KEY_COLUMNS, ...qualifiers, 'requirement', 'entry_id'])
}
