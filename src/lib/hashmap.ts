/**
 * std::collections::HashMap / HashSet codecs (also hashbrown's).
 *
 * The archived format is rkyv's `ArchivedHashTable<Entry<K, V>>`:
 *
 * - header: ptr (RelPtr to control bytes) + len + cap, each pointer-width
 * - bucket entries stored BEFORE the control bytes: slot `i` lives at
 *   `controlBytes - (i + 1) * entrySize`; empty buckets are zero-filled
 * - control bytes: one byte per slot (0xff empty, else h2), rounded up to
 *   the probe group width, with early bytes mirrored past `capacity`
 *
 * Key placement must reproduce rkyv's probing exactly (see
 * ./internal/swiss-table.ts), and key hashing must match Rust's `Hash`
 * impls, so the key codec is required to be hashable.
 */

import {
  alignOffset,
  Codec,
  type AnyCodec,
  type Infer,
  type Layout,
  type RkyvBuildHasher,
  type RkyvFormat,
  type RkyvReader,
  type RkyvWriter,
} from 'rkyv-js/core';
import { unit } from 'rkyv-js/primitives';

import { fxBuildHasher } from './internal/fx-hasher.ts';
import { SetOfMapCodec } from './internal/map-set.ts';
import { buildSwissTable } from './internal/swiss-table.ts';

interface TableLayout extends Layout {
  pb: 2 | 4 | 8;
}

interface EntryGeometry {
  entryAlign: number;
  valueOffset: number;
  entrySize: number;
}

interface TableResolver {
  len: number;
  capacity: number;
  controlBytesPos: number;
}

export function requireHashableKey(keyCodec: Codec<unknown>, what: string): void {
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

class HashMapCodec<K, V> extends Codec<Map<K, V>, TableResolver, TableLayout> {
  #key: Codec<K>;
  #value: Codec<V>;
  #buildHasher: RkyvBuildHasher;
  #geometryFormat: RkyvFormat | null = null;
  #geometry: EntryGeometry | null = null;

  constructor(keyCodec: Codec<K>, valueCodec: Codec<V>, buildHasher: RkyvBuildHasher = fxBuildHasher) {
    super({ inline: false, hashable: false });
    requireHashableKey(keyCodec as Codec<unknown>, 'hashMap');
    this.#key = keyCodec;
    this.#value = valueCodec;
    this.#buildHasher = buildHasher;
  }

  // Header layout never depends on the entry types (maps are valid recursion
  // points in Rust); entry geometry is memoized separately and computed only
  // at read/write time.
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

  read(reader: RkyvReader, offset: number): Map<K, V> {
    const l = this.layout(reader.format);
    const result = new Map<K, V>();
    const length = reader.readUsize(offset + l.pb);
    if (length === 0) return result;

    const g = this.#entryGeometry(reader.format);
    const capacity = reader.readUsize(offset + l.pb * 2);
    const controlBytesOffset = reader.readRelPtr(offset);

    let remaining = length;
    for (let slot = 0; slot < capacity && remaining > 0; slot++) {
      if (reader.readU8(controlBytesOffset + slot) < 0x80) {
        const entryOffset = controlBytesOffset - (slot + 1) * g.entrySize;
        result.set(
          this.#key.read(reader, entryOffset),
          this.#value.read(reader, entryOffset + g.valueOffset),
        );
        remaining--;
      }
    }
    return result;
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
 * HashMap<K, V> — rkyv's swiss-table hash map.
 *
 * @example
 * ```typescript
 * import { hashMap } from 'rkyv-js/lib/hashmap';
 * const Counts = hashMap(r.string, r.u32);
 * ```
 */
export function hashMap<K extends AnyCodec, V extends AnyCodec>(
  keyCodec: K,
  valueCodec: V,
  options?: HashTableOptions,
): Codec<Map<Infer<K>, Infer<V>>> {
  return new HashMapCodec(keyCodec, valueCodec, options?.hasher);
}

/**
 * HashSet<T> — a thin wrapper over `HashMap<T, ()>` (the archived formats
 * are identical; unit values are zero-sized).
 */
export function hashSet<E extends AnyCodec>(
  element: E,
  options?: HashTableOptions,
): Codec<Set<Infer<E>>> {
  return new SetOfMapCodec(new HashMapCodec<Infer<E>, null>(element, unit, options?.hasher));
}
