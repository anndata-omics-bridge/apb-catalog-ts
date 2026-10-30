// JSON values as the bundle and a result's provenance JSON hold them, and Python's ways of comparing,
// sorting and printing them.

export type Json = null | boolean | number | string | Json[] | JsonObject

export interface JsonObject {
  [key: string]: Json
}

export function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Python's sorted(): code-point order, independent of the locale.
export function compareC(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

export function sortC(values: Iterable<string>): string[] {
  return [...values].sort(compareC)
}

export function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)]
}

// Equality of two JSON values, ignoring the order of object members, as Python's dict equality does.
export function jsonEqual(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => jsonEqual(value, right[index]))
    )
  }
  if (isObject(left) || isObject(right)) {
    if (!isObject(left) || !isObject(right)) return false
    const names = Object.keys(left)
    return (
      names.length === Object.keys(right).length &&
      names.every((name) => name in right && jsonEqual(left[name], right[name]))
    )
  }
  return left === right
}

// One JSON value as text, for messages and constants. JSON.parse cannot tell 5 from 5.0; a
// left-out field's constant recovers the float from the provenance JSON's text (provenance.ts).
export function jsonText(value: unknown): string {
  return JSON.stringify(value ?? null)
}

// A string map from a JSON object of strings; an empty one when the object is absent.
export function stringMap(value: Json | undefined): Record<string, string> {
  const found: Record<string, string> = {}
  if (isObject(value)) {
    for (const [name, text] of Object.entries(value)) {
      if (typeof text === 'string') found[name] = text
    }
  }
  return found
}

export function strings(value: Json | undefined): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}
