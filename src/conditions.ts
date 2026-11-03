// The errors apb-catalog raises in Python, with the same messages.

import type { FieldRequest, Resolution } from './resolver.js'
import type { RequirementRow } from './source.js'

// The key asked for and the qualifiers the request accepts, for messages.
function wanted(request: FieldRequest): string {
  const accepted = Object.entries(request.qualifiers)
    .map(([name, values]) => `${name}=${values.join('|')}`)
    .join(', ')
  return request.key === null ? accepted : `${request.key} (${accepted})`
}

// A name that is neither a key the level answers nor one of the level's own; Python's KeyError.
export class KeyError extends Error {
  override name = 'KeyError'
}

// A lookup that several fields answer, or that an unreviewed level cannot answer.
export class UnresolvedField extends Error {
  override name = 'UnresolvedField'
  readonly resolution: Resolution

  constructor(resolution: Resolution) {
    const request = resolution.request
    const names = resolution.candidates.map((candidate) => candidate.reference.name)
    super(
      `${wanted(request)} on ${request.level} is ${resolution.status}: ` +
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
      `${row.requirement} field ${wanted(resolution.request)} on ${row.level} is missing: ` +
        resolution.reasons.join('; '),
    )
    this.resolution = resolution
    this.row = row
  }
}
