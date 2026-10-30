// Answer a request for a meaning from reviewed entries, without choosing silently; apb_catalog.resolver.

import { UnresolvedField } from './conditions.js'
import { sortC, unique } from './json.js'
import { READS, UNKNOWN, type Accepted, type Entry, type EntryReference, type ReviewedRule } from './source.js'

// A consumer's question: one level and location, constrained by accepted qualifier values.
// Qualifiers left out accept any value; accepting "unknown" admits entries that leave it unknown.
export interface FieldRequest {
  level: string
  location: string | null
  qualifiers: Accepted
}

export interface Candidate {
  entry_id: string
  reference: EntryReference
  qualifiers: Record<string, string>
  undecided: string[]
}

// An entry of a producer that has not run, and why.
export interface Pending {
  entry: Entry
  reason: string
}

export type Status = 'resolved' | 'ambiguous' | 'unknown' | 'missing'

function requestAdmits(request: FieldRequest, entry: Entry): boolean {
  const selects = request.location === null || (READS[request.location] ?? []).includes(entry.reference.location)
  return selects && requestMismatched(request, entry.qualifiers).length === 0
}

// The requested qualifiers an entry's known values contradict.
function requestMismatched(request: FieldRequest, qualifiers: Record<string, string>): string[] {
  return Object.entries(request.qualifiers)
    .filter(([name, accepted]) => qualifiers[name] !== UNKNOWN && !accepted.includes(qualifiers[name] as string))
    .map(([name]) => name)
}

// The requested qualifiers an entry leaves unknown.
function requestUndecided(request: FieldRequest, qualifiers: Record<string, string>): string[] {
  return Object.entries(request.qualifiers)
    .filter(([name, accepted]) => qualifiers[name] === UNKNOWN && !accepted.includes(UNKNOWN))
    .map(([name]) => name)
}

function newCandidate(entry: Entry, undecided: string[] = []): Candidate {
  return { entry_id: entry.entry_id, reference: entry.reference, qualifiers: entry.qualifiers, undecided }
}

// The answer to one request; only a resolved one carries a reference. `requirement` records the
// requirement a missing field had when the lookup enforced it.
export class Resolution {
  readonly request: FieldRequest
  readonly status: Status
  readonly reference: EntryReference | null
  readonly candidates: Candidate[]
  readonly reasons: string[]
  requirement: string | null = null

  constructor(
    request: FieldRequest,
    status: Status,
    reference: EntryReference | null = null,
    candidates: Candidate[] = [],
    reasons: string[] = [],
  ) {
    this.request = request
    this.status = status
    this.reference = reference
    this.candidates = candidates
    this.reasons = reasons
  }

  // The distinct values the candidates carry; an unreviewed level throws UnresolvedField.
  offered(qualifier: string): string[] {
    if (this.status === 'unknown' && this.candidates.length === 0) throw new UnresolvedField(this)
    return sortC(unique(this.candidates.map((candidate) => candidate.qualifiers[qualifier] as string)))
  }

  // The reference, null when the field is missing; ambiguous and unknown answers throw UnresolvedField.
  found(): EntryReference | null {
    if (this.status === 'ambiguous' || this.status === 'unknown') throw new UnresolvedField(this)
    return this.reference
  }
}

// Resolve only when exactly one entry matches, none is undecided and none is pending.
export function resolveEntries(entries: Entry[], pending: Pending[], request: FieldRequest, missing: string): Resolution {
  const compatible = entries
    .filter((entry) => requestAdmits(request, entry))
    .map((entry) => newCandidate(entry, requestUndecided(request, entry.qualifiers)))
  const waiting = pending.filter((found) => requestAdmits(request, found.entry))
  const matches = compatible.filter((candidate) => candidate.undecided.length === 0)
  const undecided = compatible.filter((candidate) => candidate.undecided.length > 0)
  const candidates = [...compatible, ...waiting.map((found) => newCandidate(found.entry))]
  if (matches.length > 1) {
    const names = matches.map((candidate) => candidate.reference.name)
    return new Resolution(request, 'ambiguous', null, candidates, [`${matches.length} entries match: ${names.join(', ')}`])
  }
  if (waiting.length > 0) {
    return new Resolution(request, 'unknown', null, candidates, unique(waiting.map((found) => found.reason)))
  }
  if (undecided.length > 0) {
    const reasons = undecided.map(
      (candidate) => `${candidate.reference.name} leaves ${candidate.undecided.join(', ')} unknown`,
    )
    return new Resolution(request, 'unknown', null, candidates, reasons)
  }
  const match = matches[0]
  if (match !== undefined) return new Resolution(request, 'resolved', match.reference, candidates)
  return new Resolution(request, 'missing', null, [], [missing])
}

// How a level is bound to its set. Each view answers resolve(request) and carries its level,
// entries, software version pattern and rule name (null unless reviewed).
export interface LevelView {
  readonly level: string
  readonly entries: Entry[]
  readonly softwareVersionPattern: string | null
  readonly ruleName: string | null
  resolve(request: FieldRequest): Resolution
}

// A level with a reviewed rule; `entries` are those whose fields the level holds. `pending`
// entries belong to producers that have not run; a request they would answer is unknown until the
// producer runs.
export class ReviewedLevel implements LevelView {
  constructor(
    readonly level: string,
    readonly rule: ReviewedRule,
    readonly entries: Entry[],
    readonly pending: Pending[] = [],
  ) {}

  get ruleName(): string {
    return this.rule.variant.rule
  }

  get softwareVersionPattern(): string {
    return this.rule.variant.software_version_pattern
  }

  resolve(request: FieldRequest): Resolution {
    const missing = `no reviewed ${this.rule.variant.rule} entry on ${this.level} matches`
    return resolveEntries(this.entries, this.pending, request, missing)
  }
}

// A level of a set without vendor catalogues, answered by APB's own fields alone.
export class ProducedLevel implements LevelView {
  readonly ruleName = null

  constructor(
    readonly level: string,
    readonly softwareName: string,
    readonly softwareVersionPattern: string,
    readonly entries: Entry[],
    readonly pending: Pending[] = [],
  ) {}

  resolve(request: FieldRequest): Resolution {
    return resolveEntries(this.entries, this.pending, request, `no entry on ${this.level} matches`)
  }
}

// A level whose meanings cannot be established, so every answer is unknown.
export class UnreviewedLevel implements LevelView {
  readonly entries: Entry[] = []
  readonly ruleName = null

  constructor(
    readonly level: string,
    readonly softwareName: string | null,
    readonly softwareVersionPattern: string | null,
    readonly reason: string,
  ) {}

  resolve(request: FieldRequest): Resolution {
    return new Resolution(request, 'unknown', null, [], [this.reason])
  }
}

// A requested level the result does not contain.
export class AbsentLevel {
  constructor(readonly level: string) {}

  resolve(request: FieldRequest): Resolution {
    return new Resolution(request, 'missing', null, [], [`the result has no ${this.level} level`])
  }
}
