// The bundles apb-catalog builds, served over HTTP as an app serves them, and ways to compare
// TypeScript's answers with the ones Python recorded in the test bundle.

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, statSync, createReadStream } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join, normalize, resolve, sep } from 'node:path'
import { MissingRequiredField, StaleField, UnresolvedField, type Reference } from '../src/index.js'
import type { Json } from '../src/json.js'

export const BUILD = resolve(process.env.APB_CATALOG_BUILD ?? '../apb-catalog/build')
export const BUNDLE = join(BUILD, 'apb-catalog-bundle')
export const TEST_BUNDLE = join(BUILD, 'apb-catalog-test-bundle')

export function readJson(path: string): Json {
  return JSON.parse(readFileSync(path, 'utf-8')) as Json
}

export function readCases(name: string): Json {
  return readJson(join(TEST_BUNDLE, 'cases', name))
}

// The synthetic results, unpacked into a fresh folder.
export function unpackResults(): string {
  const folder = mkdtempSync(join(tmpdir(), 'apb-catalog-results-'))
  execFileSync('tar', ['-xzf', join(TEST_BUNDLE, 'results.tar.gz'), '-C', folder])
  return folder
}

export interface Served {
  url(path: string): string
  // Every request since the server started or since the log was last cleared.
  requests: Array<{ method: string; path: string; range: string | null }>
  close(): Promise<void>
}

// A static file server for folders by URL prefix, answering HEAD and byte-range requests.
export async function serve(roots: Record<string, string>): Promise<Served> {
  const requests: Served['requests'] = []
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
    requests.push({ method: request.method ?? 'GET', path, range: request.headers.range ?? null })
    const [prefix, ...rest] = path.slice(1).split('/')
    const root = roots[prefix ?? '']
    const file = root === undefined ? undefined : normalize(join(root, ...rest))
    if (root === undefined || file === undefined || !file.startsWith(root + sep)) {
      response.writeHead(404).end()
      return
    }
    let size: number
    try {
      size = statSync(file).size
    } catch {
      response.writeHead(404).end()
      return
    }
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '')
    if (range === null) {
      response.writeHead(200, { 'Content-Length': size, 'Accept-Ranges': 'bytes' })
      if (request.method === 'HEAD') response.end()
      else createReadStream(file).pipe(response)
      return
    }
    const start = Number(range[1])
    const end = range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1)
    response.writeHead(206, { 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${size}` })
    createReadStream(file, { start, end }).pipe(response)
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  const { port } = server.address() as AddressInfo
  return {
    url: (path) => `http://127.0.0.1:${port}/${path}`,
    requests,
    close: () => new Promise<void>((done) => server.close(() => done())),
  }
}

export type Outcome = Record<string, Json>

// What one lookup gives: the reference, or the class of the error it throws, and whether it warned.
export function outcomeOf(lookup: () => Reference | null): Outcome {
  const warn = console.warn
  let warned = false
  console.warn = (warning: unknown) => {
    if (warning instanceof MissingRequiredField) warned = true
    else warn(warning)
  }
  try {
    const found = lookup()
    const reference =
      found === null ? null : { level: found.level, location: found.location, table: found.table, name: found.name }
    return warned ? { reference, warning: 'MissingRequiredField' } : { reference }
  } catch (error) {
    if (error instanceof UnresolvedField) return { error: 'UnresolvedField', status: error.resolution.status }
    if (error instanceof StaleField) return { error: 'StaleField' }
    if (error instanceof MissingRequiredField) return { error: 'MissingRequiredField' }
    throw error
  } finally {
    console.warn = warn
  }
}

export function kindsOutcome(kinds: () => string[]): Outcome {
  try {
    return { kinds: kinds() }
  } catch (error) {
    if (error instanceof UnresolvedField) return { error: 'UnresolvedField', status: error.resolution.status }
    throw error
  }
}
