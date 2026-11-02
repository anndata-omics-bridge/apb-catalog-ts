// The levels apb2 converts for each software version range, as apb-catalog's build wrote them to
// rule_levels.csv; apb_catalog.rules.

import type { Bundle } from './bundle.js'

// The location, varm table and name a level's retained fields are indexed by, as one string.
export function addressKey(location: string, table: string | null, name: string): string {
  return `${location}\x1f${table ?? ''}\x1f${name}`
}

export interface RuleLevel {
  software_name: string
  software_version_pattern: string
  version: string
  level: string
}

const COLUMNS = ['software', 'software_version_pattern', 'version', 'level']

// Every rule level with its software name, version pattern and the pattern's label, in apb2's order.
export function ruleLevels(bundle: Bundle): RuleLevel[] {
  return bundle.memo('rule_levels', () => {
    const table = bundle.csv('catalogues', 'rule_levels.csv')
    if (table.columns.join(',') !== COLUMNS.join(',')) {
      throw new Error(`rule_levels.csv has the columns ${table.columns.join(', ')}, not ${COLUMNS.join(', ')}`)
    }
    return table.rows.map((row) => ({
      software_name: row.software,
      software_version_pattern: row.software_version_pattern,
      version: row.version,
      level: row.level,
    }))
  })
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
  const found = ruleLevels(bundle).find((level) => level.software_version_pattern === pattern)
  if (found === undefined) throw new Error(`no packaged rule declares the version pattern '${pattern}'`)
  return found.version
}
