// The bundle apb-catalog releases: rules and catalogue sets. The app serves it with the data; a
// Bundle fetches all of it once, so every lookup afterwards answers without waiting.

import { isObject, strings, type Json, type JsonObject } from './json.js'

// The newest bundle format this package reads.
export const BUNDLE_FORMAT = 1

// A URL as given, or relative to the page.
export function absoluteUrl(url: string | URL): URL {
  return url instanceof URL ? url : new URL(url, globalThis.location?.href)
}

export async function fetchJson(url: URL): Promise<Json> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetching ${url.href} failed: ${response.status} ${response.statusText}`)
  return (await response.json()) as Json
}

export class Bundle {
  readonly url: URL
  readonly manifest: JsonObject
  readonly #files: Map<string, Json>
  readonly #memo = new Map<string, unknown>()

  private constructor(url: URL, manifest: JsonObject, files: Map<string, Json>) {
    this.url = url
    this.manifest = manifest
    this.#files = files
  }

  // Fetch the bundle whose manifest.json is at `url`, and every JSON file a lookup reads.
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
    const paths = strings(manifest.files).filter((path) => path.endsWith('.json') && !path.startsWith('schemas/'))
    const read = await Promise.all(paths.map((path) => fetchJson(new URL(path, manifestUrl))))
    return new Bundle(manifestUrl, manifest, new Map(paths.map((path, index) => [path, read[index] as Json])))
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

  // A value computed once per bundle.
  memo<T>(key: string, compute: () => T): T {
    if (!this.#memo.has(key)) this.#memo.set(key, compute())
    return this.#memo.get(key) as T
  }
}
