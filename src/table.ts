// Every catalogue set as one long table: one row per entry and software version it applies to;
// apb_catalog.table.

import type { Bundle } from './bundle.js'
import type { Json } from './json.js'
import { catalogueSet, rowDescribes, setNames, type CatalogueSet, type Entry } from './source.js'

export type TableRow = Record<string, Json>

export const KEY_COLUMNS = ['set', 'source', 'software_version_pattern', 'level', 'location', 'table', 'name']

// The column an entry names: its name, or the prefix it is found by.
function fieldName(entry: Entry): string {
  const reference = entry.reference
  if (reference.name !== null) return reference.name
  return `prefix:${reference.prefix}`
}

// The set's qualifiers besides kind, in vocabulary order.
function otherQualifiers(set: CatalogueSet): string[] {
  return Object.keys(set.vocabulary.qualifiers).filter((name) => name !== 'kind')
}

// One table row: where the entry's field lives, its key and qualifiers, its requirement.
export function entryRow(
  setName: string,
  set: CatalogueSet,
  source: string,
  softwareVersionPattern: string | null,
  entry: Entry,
): TableRow {
  const reference = entry.reference
  const row: TableRow = {
    set: setName,
    source,
    software_version_pattern: softwareVersionPattern,
    level: reference.level,
    location: reference.location,
    table: reference.table,
    name: fieldName(entry),
    key: entry.key,
    kind: entry.qualifiers.kind ?? null,
  }
  for (const qualifier of otherQualifiers(set)) {
    row[`qualifier.${qualifier}`] = entry.qualifiers[qualifier] ?? null
  }
  row.requirement = set.requirements.find((requirement) => rowDescribes(requirement, entry))?.requirement ?? null
  row.entry_id = entry.entry_id
  return row
}

// Every row of one set: vendor entries once per software version pattern, the others once, without
// a pattern.
function setRows(setName: string, set: CatalogueSet): TableRow[] {
  const rows: TableRow[] = []
  for (const vendor of set.catalogues) {
    for (const entry of vendor.entries) {
      for (const pattern of entry.software_version_pattern) rows.push(entryRow(setName, set, vendor.label, pattern, entry))
    }
  }
  for (const source of [...set.producers, ...set.annotations]) {
    for (const entry of source.entries) rows.push(entryRow(setName, set, source.label, null, entry))
  }
  return rows
}

export function setColumns(set: CatalogueSet): string[] {
  return [
    ...KEY_COLUMNS,
    'key',
    'kind',
    ...otherQualifiers(set).map((name) => `qualifier.${name}`),
    'requirement',
    'entry_id',
  ]
}

// Rows with exactly these columns, in this order; a column a row lacks is null there.
export function records(rows: TableRow[], columns: string[]): TableRow[] {
  return rows.map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])))
}

// The catalogue sets as one long table, one row per entry and software version it applies to, as
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
  return records(rows, [...KEY_COLUMNS, 'key', 'kind', ...qualifiers, 'requirement', 'entry_id'])
}
