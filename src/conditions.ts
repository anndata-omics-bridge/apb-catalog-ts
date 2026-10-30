// The errors apb-catalog raises in Python, with the same messages.

import type { Reference } from './catalog.js'
import type { FieldRequest, Resolution } from './resolver.js'
import type { RequirementRow } from './source.js'

function wantedText(qualifiers: FieldRequest['qualifiers']): string {
  return Object.entries(qualifiers)
    .map(([name, accepted]) => `${name}=${accepted.join('|')}`)
    .join(', ')
}

// A lookup that several fields answer, or that an unreviewed level cannot answer.
export class UnresolvedField extends Error {
  override name = 'UnresolvedField'
  readonly resolution: Resolution

  constructor(resolution: Resolution) {
    const request = resolution.request
    const names = resolution.candidates.map((candidate) => candidate.reference.name)
    super(
      `${wantedText(request.qualifiers)} on ${request.level} is ${resolution.status}: ` +
        resolution.reasons.join('; ') +
        (names.length > 0 ? `; candidates: ${names.join(', ')}` : ''),
    )
    this.resolution = resolution
  }
}

// A field the catalogue set requires is missing. Thrown, or passed to console.warn for a SHOULD
// field when the lookup enforces MUST.
export class MissingRequiredField extends Error {
  override name = 'MissingRequiredField'
  readonly resolution: Resolution
  readonly row: RequirementRow

  constructor(resolution: Resolution, row: RequirementRow) {
    super(
      `${row.requirement} field ${wantedText(resolution.request.qualifiers)} on ${row.level} is missing: ` +
        resolution.reasons.join('; '),
    )
    this.resolution = resolution
    this.row = row
  }
}

// The result's stored rule declares the field differently from the bundle's rule.
export class StaleField extends Error {
  override name = 'StaleField'
  readonly reference: Reference

  constructor(reference: Reference, stored: string, current: string) {
    super(
      `${reference.name}: this result reads ${stored}, the catalog's rule ${current}; ` +
        'reconvert the result, or serve a newer bundle if it is newer',
    )
    this.reference = reference
  }
}
