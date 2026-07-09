/**
 * std::collections::HashMap / HashSet encoders (also hashbrown's).
 *
 * The archived format is rkyv's `ArchivedHashTable<Entry<K, V>>` (see
 * `./hashmap.decode.ts` for the byte layout). Key placement must reproduce
 * rkyv's probing exactly (see ./internal/swiss-table.ts), and key hashing
 * must match Rust's `Hash` impls, so the key codec is required to be
 * hashable.
 */

import {
  alignOffset,
  BaseEncoder,
  type Encoder,
  type AnyEncoder,
  type Infer,
  type Layout,
  type RkyvBuildHasher,
  type RkyvFormat,
  type RkyvWriter,
} from 'rkyv-js/core';

import { unit } from '../encode.ts';
import { fxBuildHasher } from './internal/fx-hasher.ts';
import { SetOfMapEncoder } from './internal/map-set.encode.ts';
import { buildSwissTable } from './internal/swiss-table.ts';

export interface TableLayout extends Layout {
  pb: 2 | 4 | 8;
}

interface EntryGeometry {
  entryAlign: number;
  valueOffset: number;
  entrySize: number;
}

export interface TableResolver {
  len: number;
  capacity: number;
  controlBytesPos: number;
}

export function requireHashableKey(keyCodec: AnyEncoder, what: string): void {
  if (!keyCodec.hashable) {
    throw new Error(
      `${what} requires a hashable key codec ` +
        '(string, integer, bool, char, or structs/tuples of those)',
    );
  }
}

export interface HashTableOptions {
  /**
   * Hasher matching the Rust side's ARCHIVED hasher — the `H` parameter of
   * `ArchivedHashMap<K, V, H>` — not the source map's `S`, which never
   * affects the wire. rkyv 0.8's derive/std impls always archive with
   * `FxHasher64` (the default); set this only for types archived through a
   * manual `serialize_from_iter` impl with a custom `H`.
   */
  hasher?: RkyvBuildHasher;
}

export class HashMapEncoder<K, V> extends BaseEncoder<Map<K, V>, TableResolver, TableLayout> {
  #key: Encoder<K>;
  #value: Encoder<V>;
  #buildHasher: RkyvBuildHasher;
  #geometryFormat: RkyvFormat | null = null;
  #geometry: EntryGeometry | null = null;

  constructor(
    keyCodec: Encoder<K>,
    valueCodec: Encoder<V>,
    buildHasher: RkyvBuildHasher = fxBuildHasher,
  ) {
    super({ inline: false, hashable: false });
    requireHashableKey(keyCodec, 'hashMap');
    this.#key = keyCodec;
    this.#value = valueCodec;
    this.#buildHasher = buildHasher;
  }

  // Header layout never depends on the entry types (maps are valid recursion
  // points in Rust); entry geometry is memoized separately and computed only
  // at write time.
  computeLayout(fmt: RkyvFormat): TableLayout {
    const pb = (fmt.pointerWidth / 8) as 2 | 4 | 8;
    return { size: pb * 3, align: fmt.aligned ? pb : 1, pb };
  }

  #entryGeometry(fmt: RkyvFormat): EntryGeometry {
    if (fmt !== this.#geometryFormat) {
      const k = this.#key.layout(fmt);
      const v = this.#value.layout(fmt);
      const entryAlign = Math.max(k.align, v.align);
      const valueOffset = alignOffset(k.size, v.align);
      this.#geometry = {
        entryAlign,
        valueOffset,
        entrySize: alignOffset(valueOffset + v.size, entryAlign),
      };
      this.#geometryFormat = fmt;
    }
    return this.#geometry as EntryGeometry;
  }

  archive(writer: RkyvWriter, value: Map<K, V>): TableResolver {
    const items = [...value.entries()];
    if (items.length === 0) {
      return { len: 0, capacity: 0, controlBytesPos: 0 };
    }
    const g = this.#entryGeometry(writer.format);

    const key = this.#key;
    const val = this.#value;
    const hasher = this.#buildHasher.create(writer.format);
    const encoder = writer.textEncoder;
    const table = buildSwissTable(items, hasher, (h, item) => key.hash(h, item[0], encoder));
    const { capacity, slotToItem, controlBytes } = table;

    // Dependencies in slot order (rkyv iterates ordered_items ascending).
    const keyResolvers: unknown[] = new Array<unknown>(capacity);
    const valueResolvers: unknown[] = new Array<unknown>(capacity);
    for (let slot = 0; slot < capacity; slot++) {
      const item = slotToItem[slot];
      if (item >= 0) {
        keyResolvers[slot] = key.inline ? undefined : key.archive(writer, items[item][0]);
        valueResolvers[slot] = val.inline ? undefined : val.archive(writer, items[item][1]);
      }
    }

    // Buckets from the highest slot down to slot 0, ending where the control
    // bytes begin: slot i lives at controlBytesPos - (i + 1) * entrySize.
    writer.align(g.entryAlign);
    for (let slot = capacity - 1; slot >= 0; slot--) {
      const entryStart = writer.pos;
      const item = slotToItem[slot];
      if (item < 0) {
        writer.writeZeros(g.entrySize);
      } else {
        key.resolve(writer, items[item][0], keyResolvers[slot]);
        writer.padTo(entryStart + g.valueOffset);
        val.resolve(writer, items[item][1], valueResolvers[slot]);
        writer.padTo(entryStart + g.entrySize);
      }
    }

    const controlBytesPos = writer.writeBytes(controlBytes);
    return { len: items.length, capacity, controlBytesPos };
  }

  resolve(writer: RkyvWriter, _value: Map<K, V>, resolver: TableResolver): number {
    const pos = writer.pos;
    const ptrPos = writer.reserveRelPtr();
    writer.writeUsize(resolver.len);
    writer.writeUsize(resolver.capacity);
    if (resolver.len > 0) {
      writer.writeRelPtrAt(ptrPos, resolver.controlBytesPos);
    } else {
      // An empty table's pointer is rkyv's invalid sentinel (raw offset 1).
      writer.writeInvalidPtrAt(ptrPos);
    }
    return pos;
  }
}

/**
 * HashMap<K, V> — rkyv's swiss-table hash map (write half).
 */
export function hashMap<K extends AnyEncoder, V extends AnyEncoder>(
  keyCodec: K,
  valueCodec: V,
  options?: HashTableOptions,
): Encoder<Map<Infer<K>, Infer<V>>> {
  return new HashMapEncoder(keyCodec, valueCodec, options?.hasher);
}

/**
 * HashSet<T> — a thin wrapper over `HashMap<T, ()>` (the archived formats
 * are identical; unit values are zero-sized).
 */
export function hashSet<E extends AnyEncoder>(
  element: E,
  options?: HashTableOptions,
): Encoder<Set<Infer<E>>> {
  return new SetOfMapEncoder(new HashMapEncoder<Infer<E>, null>(element, unit, options?.hasher));
}
