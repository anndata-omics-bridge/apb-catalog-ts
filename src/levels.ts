// A result's levels read through a catalog: AnnData's slots, looked up by key as cf_xarray does;
// apb_catalog.levels.
//
// `(await DataCatalog.load(bundle, url, ['abundance'])).levels.get('protein')?.layers.get('maxlfq')`
// is the protein level's MaxLFQ layer. A name is looked up as one of the catalog's keys first, then
// as the level's own name in that slot; `get` gives null when it is neither, and `name` throws
// KeyError. Lookups are answered at once from the provenance JSON; data arrives as a promise.
//
// `new Catalog(bundle, 'DIA-NN', '1.9.2', 'abundance').levels.get('peptidoform_ion')?.layers.get('intensity')`
// is 'Precursor_Quantity': the same slots without data hold names.

import { KeyError } from './conditions.js'
import type { Column, Layer, Provenance } from './provenance.js'
import type { EntryReference } from './source.js'

// The slots a lookup reads; var also reads varm tables.
export type Location = 'layers' | 'var' | 'obs'

// Further qualifiers by name, one value each, such as { unit: 'minute' }.
export type Qualifiers = Record<string, string>

// How a catalog answers keys on its levels.
export interface Lookup {
  // The one field a key names on a level and location, narrowed by further qualifiers; null when
  // the level has none.
  field(level: string, location: Location, key: string, qualifiers: Qualifiers): EntryReference | null
  // Every field a key names on a level and location.
  fields(level: string, location: Location, key: string): EntryReference[]
  // The keys a level offers at a location.
  offered(level: string, location: Location): string[]
  // Every key of the catalog.
  known: ReadonlySet<string>
}

// A field's name in its slot; `table/column` for a column of a varm table.
export function fieldName(reference: EntryReference): string {
  const name = reference.name as string
  return reference.table === null ? name : `${reference.table}/${name}`
}

// One slot of a level, read by key first and by the level's own name second. As cf_xarray's
// accessor, keys() and has() know the catalog's keys only; the level's own names are read but not
// listed.
export class Slot<Value> {
  constructor(
    protected readonly level: string,
    protected readonly location: Location,
    protected readonly lookup: Lookup,
    // The value of a field, or the value of none.
    protected readonly read: (reference: EntryReference | null) => Value,
    protected readonly named: ReadonlySet<string>,
  ) {}

  // The field a key names, narrowed by further qualifiers, else the level's own field of that name;
  // null when it is neither. Throws UnresolvedField when the key names several fields or one the
  // catalogue cannot decide, and an Error for qualifiers with a name that is no key or that the key
  // fixes.
  get(key: string, qualifiers: Qualifiers = {}): Value {
    return this.read(this.reference(key, qualifiers))
  }

  // The name of the field `get` reads, such as 'PEP'; `table/column` for a column of a varm table.
  // Throws KeyError where `get` gives null.
  name(key: string, qualifiers: Qualifiers = {}): string {
    const reference = this.reference(key, qualifiers)
    if (reference === null) throw this.missing(key)
    return fieldName(reference)
  }

  // Whether the level offers this key here.
  has(key: string): boolean {
    return this.keys().includes(key)
  }

  // The keys the level offers in this slot, sorted.
  keys(): string[] {
    return this.lookup.offered(this.level, this.location)
  }

  protected reference(key: string, qualifiers: Qualifiers): EntryReference | null {
    if (this.lookup.known.has(key) || Object.keys(qualifiers).length > 0) {
      const found = this.lookup.field(this.level, this.location, key, qualifiers)
      if (found !== null) return found
    }
    return this.own(key)
  }

  protected own(name: string): EntryReference | null {
    if (!this.named.has(name)) return null
    return { level: this.level, location: this.location, name, table: null, prefix: null }
  }

  protected missing(name: string): KeyError {
    return new KeyError(`${this.level} ${this.location} has no key or field '${name}'`)
  }
}

// A var or obs slot, also read by a list of keys, as polars' select reads columns:
// `obs.select(['group'])` holds every column the key names, each under its own name, where
// `obs.get('group')` throws because there are several.
export class Columns<Value, Frame> extends Slot<Value> {
  constructor(
    level: string,
    location: Location,
    lookup: Lookup,
    read: (reference: EntryReference | null) => Value,
    named: ReadonlySet<string>,
    // The fields' values under their names.
    protected readonly combine: (references: EntryReference[]) => Frame,
  ) {
    super(level, location, lookup, read, named)
  }

  // Every field the keys name, in order. Throws KeyError for a name that is neither a key the level
  // answers nor one of its own, and UnresolvedField for a field the catalogue cannot decide.
  select(keys: string[]): Frame {
    const found = new Map<string, EntryReference>()
    for (const key of keys) {
      for (const reference of this.fields(key)) {
        const address = [reference.location, reference.table ?? '', reference.name].join('\x1f')
        if (!found.has(address)) found.set(address, reference)
      }
    }
    return this.combine([...found.values()])
  }

  protected fields(name: string): EntryReference[] {
    if (this.lookup.known.has(name)) {
      const found = this.lookup.fields(this.level, this.location, name)
      if (found.length > 0) return found
    }
    const own = this.own(name)
    if (own === null) throw this.missing(name)
    return [own]
  }
}

// One level of a result, with AnnData's slots: X, layers, var, obs, obs_names and var_names. X is
// the level's primary layer and layers its other layers, one array per run; a key may name the
// primary layer, and then answers X. Each Parquet file is fetched once.
export class Level {
  readonly name: string
  readonly layers: Slot<Promise<Layer | null>>
  readonly var: Columns<Promise<Column | null>, Promise<Map<string, Column>>>
  readonly obs: Columns<Promise<Column | null>, Promise<Map<string, Column>>>
  readonly #provenance: Provenance

  constructor(name: string, provenance: Provenance, lookup: Lookup) {
    const level = provenance.level(name)
    this.name = name
    this.#provenance = provenance
    const layer = (reference: EntryReference): Promise<Layer> => provenance.layer(name, reference.name as string)
    const varColumn = (reference: EntryReference): Promise<Column> =>
      reference.table === null
        ? provenance.column(name, 'var', reference.name as string)
        : provenance.varmColumn(name, reference.table, reference.name as string)
    const obsColumn = (reference: EntryReference): Promise<Column> => provenance.column(name, 'obs', reference.name as string)
    const layers = new Set(level.layerOrder.filter((found) => found !== level.primaryLayer))
    this.layers = new Slot(name, 'layers', lookup, orNull(layer), layers)
    this.var = new Columns(name, 'var', lookup, orNull(varColumn), new Set(level.var.columns), frame(varColumn))
    this.obs = new Columns(name, 'obs', lookup, orNull(obsColumn), new Set(level.obs.columns), frame(obsColumn))
  }

  // The primary layer, one array per run.
  X(): Promise<Layer> {
    return this.#provenance.layer(this.name, this.#provenance.level(this.name).primaryLayer)
  }

  // One name per observation: its key columns, joined by "|".
  obs_names(): Promise<string[]> {
    return this.#provenance.axisNames(this.name, 'obs')
  }

  // One name per variable: its key columns, joined by "|".
  var_names(): Promise<string[]> {
    return this.#provenance.axisNames(this.name, 'var')
  }
}

// One level of a software version's rule, with the slots of Level holding names: layers, var and
// obs. Without data there is no X, obs_names or var_names, and no own name to fall back on.
export class LevelNames {
  readonly name: string
  readonly layers: Slot<string | null>
  readonly var: Columns<string | null, string[]>
  readonly obs: Columns<string | null, string[]>

  constructor(name: string, lookup: Lookup) {
    const named = (reference: EntryReference | null): string | null => (reference === null ? null : fieldName(reference))
    const names = (references: EntryReference[]): string[] => references.map(fieldName)
    this.name = name
    this.layers = new Slot(name, 'layers', lookup, named, new Set())
    this.var = new Columns(name, 'var', lookup, named, new Set(), names)
    this.obs = new Columns(name, 'obs', lookup, named, new Set(), names)
  }
}

function orNull<Value>(read: (reference: EntryReference) => Promise<Value>): (reference: EntryReference | null) => Promise<Value | null> {
  return (reference) => (reference === null ? Promise.resolve(null) : read(reference))
}

function frame(read: (reference: EntryReference) => Promise<Column>): (references: EntryReference[]) => Promise<Map<string, Column>> {
  return async (references) =>
    new Map(await Promise.all(references.map(async (reference): Promise<[string, Column]> => [fieldName(reference), await read(reference)])))
}
