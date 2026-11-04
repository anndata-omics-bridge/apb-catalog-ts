// The bundle apb-catalog releases: rules and catalogue tables. The app serves it with the data; a
// Bundle fetches all of it once, so every lookup afterwards answers without waiting.

import { parseCsv, type Table } from './csv.js'
import { isObject, strings, type Json, type JsonObject } from './json.js'

// The bundle format this package reads.
export const BUNDLE_FORMAT = 4

// A URL as given, or relative to the page.
export function absoluteUrl(url: string | URL): URL {
  return url instanceof URL ? url : new URL(url, globalThis.location?.href)
}

// A bundle is republished under the same URLs, so every file is revalidated with the server: a
// browser's heuristic cache would otherwise mix files of two bundles.
const REVALIDATE: RequestInit = { cache: 'no-cache' }

export async function fetchJson(url: URL): Promise<Json> {
  const response = await fetch(url, REVALIDATE)
  if (!response.ok) throw new Error(`fetching ${url.href} failed: ${response.status} ${response.statusText}`)
  return (await response.json()) as Json
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url, REVALIDATE)
  if (!response.ok) throw new Error(`fetching ${url.href} failed: ${response.status} ${response.statusText}`)
  return await response.text()
}

export class Bundle {
  readonly url: URL
  readonly manifest: JsonObject
  readonly #files: Map<string, Json>
  readonly #tables: Map<string, Table>
  readonly #memo = new Map<string, unknown>()

  private constructor(url: URL, manifest: JsonObject, files: Map<string, Json>, tables: Map<string, Table>) {
    this.url = url
    this.manifest = manifest
    this.#files = files
    this.#tables = tables
  }

  // Fetch the bundle whose manifest.json is at `url`, and every JSON and CSV file a lookup reads.
  static async load(url: string | URL): Promise<Bundle> {
    const manifestUrl = absoluteUrl(url)
    const manifest = await fetchJson(manifestUrl)
    if (!isObject(manifest)) throw new Error(`${manifestUrl.href} is not an apb-catalog bundle manifest`)
    const format = manifest.bundle_format
    if (typeof format !== 'number' || format > BUNDLE_FORMAT) {
      throw new Error(
        `bundle ${String(manifest.version)} has format ${String(format)}; ` +
          'update @anndata-omics-bridge/apb-catalog to read it',
      )
    }
    if (format < BUNDLE_FORMAT) {
      throw new Error(
        `bundle ${String(manifest.version)} has format ${format}; this package reads format ${BUNDLE_FORMAT}`,
      )
    }
    const files = strings(manifest.files)
    const paths = files.filter((path) => path.endsWith('.json'))
    const tables = files.filter((path) => path.endsWith('.csv'))
    const [read, texts] = await Promise.all([
      Promise.all(paths.map((path) => fetchJson(new URL(path, manifestUrl)))),
      Promise.all(tables.map((path) => fetchText(new URL(path, manifestUrl)))),
    ])
    return new Bundle(
      manifestUrl,
      manifest,
      new Map(paths.map((path, index) => [path, read[index] as Json])),
      new Map(tables.map((path, index) => [path, parseCsv(texts[index] as string)])),
    )
  }

  get version(): string {
    return String(this.manifest.version)
  }

  // The files of the bundle, as the manifest lists them.
  get files(): string[] {
    return strings(this.manifest.files)
  }

  // One JSON file of the bundle, by its path in the bundle.
  json(...path: string[]): Json {
    const name = path.join('/')
    const found = this.#files.get(name)
    if (found === undefined) throw new Error(`the bundle has no ${name}`)
    return found
  }

  // One CSV table of the bundle, by its path in the bundle.
  csv(...path: string[]): Table {
    const name = path.join('/')
    const found = this.#tables.get(name)
    if (found === undefined) throw new Error(`the bundle has no ${name}`)
    return found
  }

  // A value computed once per bundle.
  memo<T>(key: string, compute: () => T): T {
    if (!this.#memo.has(key)) this.#memo.set(key, compute())
    return this.#memo.get(key) as T
  }
}
