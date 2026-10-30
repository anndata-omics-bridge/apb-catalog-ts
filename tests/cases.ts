// The shape of the test bundle's cases, and a way to report every mismatch at once.

import type { Json, JsonObject } from '../src/json.js'
import { jsonEqual } from '../src/json.js'

export interface RequestCase {
  level: string
  location: 'layers' | 'var' | 'obs'
  qualifiers: Record<string, string>
  outcome: JsonObject
}

export interface KindsCase {
  level: string
  location: string
  outcome: JsonObject
}

export interface CatalogCase {
  catalogue: string
  software: string
  version: string
  error?: string
  requests?: RequestCase[]
  kinds?: KindsCase[]
  fields: Json[]
}

export interface DataCatalogCase {
  result: string
  catalogue: string
  enforce: 'MUST' | 'SHOULD' | null
  error?: string
  requests?: RequestCase[]
  kinds?: KindsCase[]
  fields?: Json[] | null
}

// Mismatches between answers and the recorded ones, collected so a test reports all of them.
export class Mismatches {
  readonly found: string[] = []
  checked = 0

  compare(actual: unknown, expected: unknown, label: string): void {
    this.checked++
    if (!jsonEqual(actual, expected)) {
      this.found.push(`${label}\n  actual:   ${JSON.stringify(actual)}\n  expected: ${JSON.stringify(expected)}`)
    }
  }

  // Rows compared one by one, so a mismatch names the first row that differs.
  compareRows(actual: unknown[], expected: unknown[], label: string): void {
    if (actual.length !== expected.length) {
      this.compare(actual.length, expected.length, `${label}: row count`)
      return
    }
    const index = actual.findIndex((row, at) => !jsonEqual(row, expected[at]))
    this.compare(index === -1 ? null : actual[index], index === -1 ? null : expected[index], `${label}: row ${index}`)
  }

  report(): string {
    return `${this.found.length} of ${this.checked} answers differ:\n${this.found.slice(0, 10).join('\n')}`
  }
}
