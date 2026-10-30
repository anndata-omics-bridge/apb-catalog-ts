// One APB Parquet result, from its provenance JSON (the result's manifest.json). Lookups read only
// that JSON; a Parquet file is fetched the first time its data is asked for, and only the columns
// asked for.

import { asyncBufferFromUrl, cachedAsyncBuffer, parquetMetadataAsync, parquetRead } from 'hyparquet'
import type { AsyncBuffer, FileMetaData } from 'hyparquet'
// apb2 writes Parquet with ZSTD, which hyparquet decodes only with these.
import { compressors } from 'hyparquet-compressors'
import { absoluteUrl } from './bundle.js'
import { isObject, stringMap, strings, jsonText, type Json, type JsonObject } from './json.js'
import { addressKey } from './source.js'

export const PARQUET_FORMAT = 'apb2-parsed-levels-parquet'
export const PARQUET_FORMAT_VERSION = '9'

// One layer: a value per feature for each run, with the run and feature names.
export interface Layer {
  runs: string[]
  features: string[]
  values: Float64Array[]
}

// One obs or var column: numbers as a Float64Array (null as NaN), anything else as an array.
export type Column = Float64Array | Array<string | boolean | null>

interface TableEntry {
  file: string
  columns: string[]
  key_columns: string[]
}

function tableEntry(value: Json | undefined): TableEntry {
  const entry = isObject(value) ? value : {}
  return {
    file: String(entry.file),
    columns: strings(entry.columns),
    key_columns: strings(entry.key_columns),
  }
}

// The objects whose `value` member the provenance JSON writes as a float, such as 0.0, which
// JSON.parse turns into 0. A left-out field's constant prints from that value, as 0.0 in Python.
const floatValues = new WeakSet<object>()

async function fetchProvenance(url: URL): Promise<Json> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`fetching ${url.href} failed: ${response.status} ${response.statusText}`)
  // The reviver's context, with each value's source text, is missing in older browsers; there a
  // float constant prints as an integer.
  return JSON.parse(await response.text(), function (this: unknown, key, value, context?: { source?: string }) {
    if (key === 'value' && typeof value === 'number' && isObject(this) && /[.eE]/.test(context?.source ?? '')) {
      floatValues.add(this)
    }
    return value
  }) as Json
}

// A left-out field's single value as Python's json.dumps writes it.
function constantText(field: Json | undefined): string {
  const value = isObject(field) ? field.value : null
  if (typeof value === 'number' && Number.isInteger(value) && Math.abs(value) < 1e16 && floatValues.has(field as object)) {
    return `${value}.0`
  }
  return jsonText(value)
}

function namedTables(level: JsonObject, slot: string): Map<string, TableEntry> {
  const entries = isObject(level[slot]) ? level[slot] : {}
  return new Map(strings(level[`${slot}_order`]).map((name) => [name, tableEntry(entries[name])]))
}

// One level as its provenance JSON describes it.
export class ProvenanceLevel {
  readonly name: string
  readonly directory: string
  readonly primaryLayer: string
  readonly obs: TableEntry
  readonly var: TableEntry
  readonly layerOrder: string[]
  readonly layers: Map<string, TableEntry>
  readonly varm: Map<string, TableEntry>
  readonly apb: JsonObject

  constructor(name: string, entry: JsonObject) {
    this.name = name
    this.directory = String(entry.directory)
    this.primaryLayer = String(entry.primary_layer)
    this.obs = tableEntry(entry.obs)
    this.var = tableEntry(entry.var)
    this.layerOrder = strings(entry.layer_order)
    const layers = isObject(entry.layers) ? entry.layers : {}
    this.layers = new Map(this.layerOrder.map((layer) => [layer, tableEntry(layers[layer])]))
    this.varm = namedTables(entry, 'varm')
    this.apb = isObject(entry.apb) ? entry.apb : {}
  }

  // The rule conversion stored, or null.
  storedRule(): JsonObject | null {
    const parse = isObject(this.apb.parse) ? this.apb.parse : {}
    const provenance = isObject(parse.provenance) ? parse.provenance : {}
    if (typeof provenance.rule_json !== 'string') return null
    const rule = JSON.parse(provenance.rule_json) as Json
    return isObject(rule) ? rule : null
  }

  // The software name, version pattern and level the stored rule declares, or nulls.
  ruleVersion(): { software: string | null; pattern: string | null; level: string | null } {
    const rule = this.storedRule()
    const software = rule?.software_name
    const pattern = rule?.software_version_pattern
    const level = rule?.quantification_level
    if (typeof software === 'string' && typeof pattern === 'string' && typeof level === 'string') {
      return { software, pattern, level }
    }
    return { software: null, pattern: null, level: null }
  }

  roles(): Map<string, string> {
    const roles = isObject(this.apb.roles) ? this.apb.roles : {}
    return new Map(Object.entries(stringMap(roles.columns)))
  }

  // The address keys of the fields the level holds.
  retained(): Set<string> {
    const found = new Set<string>()
    for (const layer of this.layerOrder) found.add(addressKey('layers', null, layer))
    for (const column of this.var.columns) found.add(addressKey('var', null, column))
    for (const column of this.obs.columns) found.add(addressKey('obs', null, column))
    for (const [table, entry] of this.varm) {
      for (const column of entry.columns) found.add(addressKey('varm', table, column))
    }
    return found
  }

  // The single value of each field apb2 left out of the level, by address key.
  leftOut(): Map<string, string> {
    const parse = isObject(this.apb.parse) ? this.apb.parse : {}
    const result = isObject(parse.result) ? parse.result : {}
    const fields = isObject(result.uninformative_fields) ? result.uninformative_fields : {}
    const single = isObject(fields.single_valued) ? fields.single_valued : {}
    const found = new Map<string, string>()
    for (const [location, names] of Object.entries(single)) {
      if (!isObject(names)) continue
      for (const [name, field] of Object.entries(names)) found.set(addressKey(location, null, name), constantText(field))
    }
    return found
  }
}

interface ParquetFile {
  file: AsyncBuffer
  metadata: FileMetaData
}

export class Provenance {
  readonly url: URL
  readonly manifest: JsonObject
  readonly levels: Map<string, ProvenanceLevel>
  // The root post-parse records, such as `sdrf` or `fasta`.
  readonly metadata: JsonObject
  readonly #files = new Map<string, Promise<ParquetFile>>()
  readonly #columns = new Map<string, Promise<unknown[]>>()

  private constructor(url: URL, manifest: JsonObject) {
    this.url = url
    this.manifest = manifest
    const levels = isObject(manifest.levels) ? manifest.levels : {}
    this.levels = new Map(
      strings(manifest.level_order).map((name) => {
        const entry = levels[name]
        return [name, new ProvenanceLevel(name, isObject(entry) ? entry : {})]
      }),
    )
    const apb = isObject(manifest.apb) ? manifest.apb : {}
    this.metadata = Object.fromEntries(Object.entries(apb).filter(([key]) => key !== 'parse' && key !== 'hierarchy'))
  }

  // Fetch the provenance JSON at `url`; nothing else is fetched until data is asked for.
  static async load(url: string | URL): Promise<Provenance> {
    const manifestUrl = absoluteUrl(url)
    const manifest = await fetchProvenance(manifestUrl)
    if (!isObject(manifest)) throw new Error(`${manifestUrl.href} is not an APB Parquet result's manifest.json`)
    if (manifest.format !== PARQUET_FORMAT || manifest.format_version !== PARQUET_FORMAT_VERSION) {
      throw new Error(
        `${manifestUrl.href} is ${String(manifest.format)} version ${String(manifest.format_version)}; ` +
          `@anndata-omics-bridge/apb-catalog reads ${PARQUET_FORMAT} version ${PARQUET_FORMAT_VERSION}`,
      )
    }
    return new Provenance(manifestUrl, manifest)
  }

  level(name: string): ProvenanceLevel {
    const found = this.levels.get(name)
    if (found === undefined) throw new Error(`the result has no ${name} level`)
    return found
  }

  // One layer of a level, with the runs and features named by the obs and var key columns.
  async layer(levelName: string, name: string): Promise<Layer> {
    const level = this.level(levelName)
    const entry = level.layers.get(name)
    if (entry === undefined) throw new Error(`the ${levelName} level has no layer ${name}`)
    const [runs, features, columns] = await Promise.all([
      this.#axisNames(level, level.obs),
      this.#axisNames(level, level.var),
      Promise.all(entry.columns.map((column) => this.#column(this.#path(level, 'layers', entry.file), column))),
    ])
    const values = columns.map((column, index) => {
      const numbers = numeric(column)
      if (numbers === null) throw new Error(`layer ${name} column ${entry.columns[index]} is not numeric`)
      return numbers
    })
    return { runs, features, values }
  }

  // One obs or var column of a level.
  async column(levelName: string, location: 'obs' | 'var', name: string): Promise<Column> {
    const level = this.level(levelName)
    const entry = location === 'obs' ? level.obs : level.var
    return columnOf(await this.#column(this.#path(level, null, entry.file), name))
  }

  // One column of a varm table of a level.
  async varmColumn(levelName: string, table: string, name: string): Promise<Column> {
    const level = this.level(levelName)
    const entry = level.varm.get(table)
    if (entry === undefined) throw new Error(`the ${levelName} level has no varm table ${table}`)
    return columnOf(await this.#column(this.#path(level, 'varm', entry.file), name))
  }

  #path(level: ProvenanceLevel, slot: string | null, file: string): URL {
    const parts = ['levels', level.directory, ...(slot === null ? [] : [slot]), file]
    return new URL(parts.map(encodeURIComponent).join('/'), this.url)
  }

  // The row names of an axis: its key column, or its key columns joined by "|".
  async #axisNames(level: ProvenanceLevel, entry: TableEntry): Promise<string[]> {
    const url = this.#path(level, null, entry.file)
    const keys = await Promise.all(entry.key_columns.map((key) => this.#column(url, key)))
    const rows = keys[0]?.length ?? 0
    return Array.from({ length: rows }, (_, row) => keys.map((key) => String(key[row])).join('|'))
  }

  // One column of one Parquet file, fetched once.
  #column(url: URL, name: string): Promise<unknown[]> {
    const key = `${url.href}\x1f${name}`
    let found = this.#columns.get(key)
    if (found === undefined) {
      found = this.#read(url, name)
      this.#columns.set(key, found)
    }
    return found
  }

  async #read(url: URL, name: string): Promise<unknown[]> {
    const { file, metadata } = await this.#open(url)
    const rows = Number(metadata.num_rows)
    const values: unknown[] = new Array(rows).fill(null)
    await parquetRead({
      file,
      metadata,
      compressors,
      columns: [name],
      onChunk(chunk) {
        if (chunk.columnName !== name) return
        const data = chunk.columnData
        for (let index = 0; index < data.length && chunk.rowStart + index < rows; index++) {
          values[chunk.rowStart + index] = data[index]
        }
      },
    })
    return values
  }

  #open(url: URL): Promise<ParquetFile> {
    let found = this.#files.get(url.href)
    if (found === undefined) {
      found = (async () => {
        const file = cachedAsyncBuffer(await asyncBufferFromUrl({ url: url.href }))
        return { file, metadata: await parquetMetadataAsync(file) }
      })()
      this.#files.set(url.href, found)
    }
    return found
  }
}

// The values as numbers, or null when one is neither a number nor missing.
function numeric(values: unknown[]): Float64Array | null {
  const numbers = new Float64Array(values.length)
  for (const [index, value] of values.entries()) {
    if (value === null || value === undefined) numbers[index] = Number.NaN
    else if (typeof value === 'number') numbers[index] = value
    else if (typeof value === 'bigint') numbers[index] = Number(value)
    else return null
  }
  return numbers
}

function columnOf(values: unknown[]): Column {
  return (
    numeric(values) ??
    values.map((value) =>
      value === null || value === undefined ? null : typeof value === 'boolean' ? value : String(value),
    )
  )
}
