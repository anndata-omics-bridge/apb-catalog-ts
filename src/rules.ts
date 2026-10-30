// What apb2's rules declare: the fields each rule level keeps, its roles, its versions; apb_catalog.rules.

import type { Bundle } from './bundle.js'
import { isObject, strings, type Json, type JsonObject } from './json.js'
import { addressKey } from './source.js'

export interface RuleLevel {
  rule: string
  level: string
  software_name: string
  software_version_pattern: string
}

interface DeclarationRow {
  rule: string
  level: string
  declarations: string[]
}

function declarationRows(bundle: Bundle): DeclarationRow[] {
  return bundle.json('rules', 'declarations.json') as unknown as DeclarationRow[]
}

const SEP = '\x1f'

// Every effective declaration of a rule level, in apb2's order; none for an unknown one.
export function ruleDeclarations(bundle: Bundle, rule: string, level: string): JsonObject[] {
  const index = bundle.memo('declarations', () => {
    const found = new Map<string, JsonObject[]>()
    for (const row of declarationRows(bundle)) {
      found.set(row.rule + SEP + row.level, row.declarations.map((text) => JSON.parse(text) as JsonObject))
    }
    return found
  })
  return index.get(rule + SEP + level) ?? []
}

// The first effective declaration of a rule level.
export function ruleDeclaration(bundle: Bundle, rule: string, level: string): JsonObject {
  const found = ruleDeclarations(bundle, rule, level)[0]
  if (found === undefined) throw new Error(`no packaged rule ${rule} declares the level ${level}`)
  return found
}

// Every rule level with its software name and version pattern, in apb2's order.
export function ruleLevels(bundle: Bundle): RuleLevel[] {
  return bundle.memo('rule_levels', () =>
    declarationRows(bundle).map((row) => {
      const stored = ruleDeclaration(bundle, row.rule, row.level)
      return {
        rule: row.rule,
        level: row.level,
        software_name: String(stored.software_name),
        software_version_pattern: String(stored.software_version_pattern),
      }
    }),
  )
}

// The rule levels of one software whose version pattern admits a version.
export function rulesMatching(bundle: Bundle, software: string, version: string): RuleLevel[] {
  return ruleLevels(bundle).filter(
    (found) =>
      found.software_name.toLowerCase() === software.toLowerCase() &&
      new RegExp(found.software_version_pattern).test(version),
  )
}

function columnsAt(stored: JsonObject, location: string): Json[] {
  if (location === 'layers') {
    const layers = isObject(stored.measurements) ? stored.measurements.layers : undefined
    return Array.isArray(layers) ? layers : []
  }
  if (location === 'varm') return []
  const columns = isObject(stored.columns) ? stored.columns[location] : undefined
  return Array.isArray(columns) ? columns : []
}

// One field's declaration without its note, or null; varm fields come from producers, so no rule
// declares them.
export function ruleField(stored: JsonObject, location: string, name: string | null): JsonObject | null {
  for (const candidate of columnsAt(stored, location)) {
    if (isObject(candidate) && candidate.name === name) {
      const { note: _note, ...field } = candidate
      return field
    }
  }
  return null
}

function namesAt(stored: JsonObject, location: string): string[] {
  return columnsAt(stored, location).flatMap((column) =>
    isObject(column) && typeof column.name === 'string' ? [column.name] : [],
  )
}

// The obs, var and layer fields a rule level declares, as address keys.
export function ruleRetained(bundle: Bundle, rule: string, level: string): Set<string> {
  return bundle.memo(`retained${SEP}${rule}${SEP}${level}`, () => {
    const stored = ruleDeclaration(bundle, rule, level)
    const found = new Set<string>()
    for (const location of ['layers', 'obs', 'var']) {
      for (const name of namesAt(stored, location)) found.add(addressKey(location, null, name))
    }
    return found
  })
}

// The var column each role names on a rule level.
export function ruleRoles(bundle: Bundle, rule: string, level: string): Map<string, string> {
  const found = new Map<string, string>()
  for (const column of columnsAt(ruleDeclaration(bundle, rule, level), 'var')) {
    if (!isObject(column) || typeof column.name !== 'string') continue
    for (const role of strings(column.roles)) found.set(role, column.name)
  }
  return found
}

// The vendor columns apb2 computes one var column of a rule level from.
export function ruleVarInputs(bundle: Bundle, rule: string, level: string, name: string | null): string[] {
  const column = ruleField(ruleDeclaration(bundle, rule, level), 'var', name)
  return column === null ? [] : strings(column.inputs)
}

export function versionLabel(bundle: Bundle, pattern: string): string {
  const labels = bundle.json('rules', 'version_labels.json')
  const label = isObject(labels) ? labels[pattern] : undefined
  if (typeof label !== 'string') throw new Error(`no version label for '${pattern}' in the bundle`)
  return label
}
