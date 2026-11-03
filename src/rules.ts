// The software versions apb2 converts, as apb-catalog's build wrote them to versions.csv, and the
// levels the bundle's entries name for each; apb_catalog.rules.

import type { Bundle } from './bundle.js'

// The location, varm table and name a level's retained fields are indexed by, as one string.
export function addressKey(location: string, table: string | null, name: string): string {
  return `${location}\x1f${table ?? ''}\x1f${name}`
}

// The fields of a CPE-style entry id, <source>/<version>/<level>/<attribute>/<key>/<column>: a
// version of `*` is every version; a key or column of `-` is one the attribute lacks.
export interface EntryAddress {
  source: string
  version: string
  level: string
  attribute: string
  key: string
  column: string
}

const ATTRIBUTES = ['obs', 'var', 'layers', 'varm']

export function entryAddress(entryId: string): EntryAddress {
  const fields = entryId.split('/')
  const [source, version, level, attribute, key, column] = fields
  if (
    fields.length !== 6 ||
    source === undefined ||
    version === undefined ||
    level === undefined ||
    attribute === undefined ||
    key === undefined ||
    column === undefined
  ) {
    throw new Error(`${entryId}: an entry id has six '/'-separated fields`)
  }
  if (!ATTRIBUTES.includes(attribute)) throw new Error(`${entryId}: the attribute is one of ${ATTRIBUTES.join(', ')}`)
  return { source, version, level, attribute, key, column }
}

// Whether an entry id holds for one software's labelled version.
function holdsFor(address: EntryAddress, version: SoftwareVersion): boolean {
  return address.source === version.software_name && (address.version === '*' || address.version === version.version)
}

export interface RuleLevel {
  software_name: string
  software_version_pattern: string
  version: string
  level: string
}

export interface SoftwareVersion {
  software_name: string
  version: string
  software_version_pattern: string
}

const COLUMNS = ['software', 'version', 'software_version_pattern']

// Every software version apb2 has a rule for, in apb2's order: its label, which entries name, and
// the rule's version pattern, which a converted result stores.
export function softwareVersions(bundle: Bundle): SoftwareVersion[] {
  return bundle.memo('versions', () => {
    const table = bundle.csv('catalogues', 'versions.csv')
    if (table.columns.join(',') !== COLUMNS.join(',')) {
      throw new Error(`versions.csv has the columns ${table.columns.join(', ')}, not ${COLUMNS.join(', ')}`)
    }
    return table.rows.map((row) => ({
      software_name: row.software,
      version: row.version,
      software_version_pattern: row.software_version_pattern,
    }))
  })
}

// Every level an entry names for a software version: versions in versions.csv's order, each
// version's levels in the order the entries first name them.
export function ruleLevels(bundle: Bundle): RuleLevel[] {
  return bundle.memo('rule_levels', () => {
    const entries = bundle.csv('catalogues', 'entries.csv').rows.map((row) => entryAddress(row.entry_id))
    const found: RuleLevel[] = []
    for (const version of softwareVersions(bundle)) {
      const named = entries.filter((address) => holdsFor(address, version))
      for (const level of new Set(named.map((address) => address.level))) {
        found.push({
          software_name: version.software_name,
          software_version_pattern: version.software_version_pattern,
          version: version.version,
          level,
        })
      }
    }
    return found
  })
}

// The version patterns an entry holds for: every one versions.csv lists for its software when its
// version is `*`, none for an app or annotation, which versions.csv does not list.
export function entryPatterns(bundle: Bundle, address: EntryAddress): string[] {
  if (address.version !== '*') return [versionPattern(bundle, address.source, address.version)]
  return softwareVersions(bundle)
    .filter((found) => found.software_name === address.source)
    .map((found) => found.software_version_pattern)
}

// The rule's version pattern for one software's labelled version.
export function versionPattern(bundle: Bundle, software: string, version: string): string {
  const found = softwareVersions(bundle).find(
    (entry) => entry.software_name === software && entry.version === version,
  )
  if (found === undefined) throw new Error(`versions.csv has no ${software} version '${version}'`)
  return found.software_version_pattern
}

// The rule levels of one software whose version pattern admits a version.
export function rulesMatching(bundle: Bundle, software: string, version: string): RuleLevel[] {
  return ruleLevels(bundle).filter(
    (found) =>
      found.software_name.toLowerCase() === software.toLowerCase() &&
      new RegExp(found.software_version_pattern).test(version),
  )
}

// The concise reading of one rule's software version pattern.
export function versionLabel(bundle: Bundle, pattern: string): string {
  const found = softwareVersions(bundle).find((entry) => entry.software_version_pattern === pattern)
  if (found === undefined) throw new Error(`no packaged rule declares the version pattern '${pattern}'`)
  return found.version
}
