/**
 * indexmap::IndexMap / IndexSet codecs (rkyv's `indexmap-2` feature).
 *
 * ArchivedIndexMap layout:
 *
 * ```text
 * struct ArchivedIndexMap<K, V> {
 *     table: ArchivedHashTable<ArchivedUsize>,  // ptr + len + cap
 *     entries: RelPtr<Entry<K, V>>,
 * }
 * ```
 *
 * The hash table maps key hashes to indexes into a separate, insertion-order
 * `entries` array. Serialization order (matching rkyv exactly): table
 * buckets (reverse slot order) → control bytes → per-entry dependencies in
 * insertion order → aligned entries array. The entries pointer is always a
 * real pointer (even when empty); only the table pointer uses the invalid
 * sentinel for empty maps.
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

import { requireHashableKey, type HashTableOptions } from './hashmap.ts';
import { fxBuildHasher } from './internal/fx-hasher.ts';
import { SetOfMapCodec } from './internal/map-set.ts';
import { buildSwissTable } from './internal/swiss-table.ts';

interface IndexLayout extends Layout {
  pb: 2 | 4 | 8;
}

interface EntryGeometry {
  entryAlign: number;
  valueOffset: number;
  entrySize: number;
}

interface IndexResolver {
  len: number;
  capacity: number;
  controlBytesPos: number;
  entriesPos: number;
}

class IndexMapCodec<K, V> extends Codec<Map<K, V>, IndexResolver, IndexLayout> {
  #key: Codec<K>;
  #value: Codec<V>;
  #buildHasher: RkyvBuildHasher;
  #geometryFormat: RkyvFormat | null = null;
  #geometry: EntryGeometry | null = null;

  constructor(keyCodec: Codec<K>, valueCodec: Codec<V>, buildHasher: RkyvBuildHasher = fxBuildHasher) {
    super({ inline: false, hashable: false });
    requireHashableKey(keyCodec as Codec<unknown>, 'indexMap');
    this.#key = keyCodec;
    this.#value = valueCodec;
    this.#buildHasher = buildHasher;
  }

  // Header layout never depends on the entry types (maps are valid recursion
  // points in Rust); entry geometry is memoized separately and computed only
  // at read/write time.
  computeLayout(fmt: RkyvFormat): IndexLayout {
    const pb = (fmt.pointerWidth / 8) as 2 | 4 | 8;
    // table (ptr + len + cap) + entries ptr
    return { size: pb * 4, align: fmt.aligned ? pb : 1, pb };
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
    const g = this.#entryGeometry(reader.format);
    const length = reader.readUsize(offset + l.pb);
    const entriesOffset = reader.readRelPtr(offset + l.pb * 3);
    const result = new Map<K, V>();
    for (let i = 0; i < length; i++) {
      const entryOffset = entriesOffset + i * g.entrySize;
      result.set(
        this.#key.read(reader, entryOffset),
        this.#value.read(reader, entryOffset + g.valueOffset),
      );
    }
    return result;
  }

  archive(writer: RkyvWriter, value: Map<K, V>): IndexResolver {
    const l = this.layout(writer.format);
    const g = this.#entryGeometry(writer.format);
    const key = this.#key;
    const val = this.#value;
    const items = [...value.entries()];

    let capacity = 0;
    let controlBytesPos = 0;

    if (items.length > 0) {
      const hasher = this.#buildHasher.create(writer.format);
      const encoder = writer.textEncoder;
      const table = buildSwissTable(items, hasher, (h, item) => key.hash(h, item[0], encoder));
      capacity = table.capacity;

      // Buckets hold item indexes (ArchivedUsize), written from the highest
      // slot down to slot 0; empty buckets are zeroed.
      writer.align(writer.format.aligned ? l.pb : 1);
      for (let slot = capacity - 1; slot >= 0; slot--) {
        const item = table.slotToItem[slot];
        writer.writeUsize(item < 0 ? 0 : item);
      }
      controlBytesPos = writer.writeBytes(table.controlBytes);
    }

    // Per-entry dependencies in insertion order.
    const keyResolvers: unknown[] = new Array<unknown>(items.length);
    const valueResolvers: unknown[] = new Array<unknown>(items.length);
    for (let i = 0; i < items.length; i++) {
      keyResolvers[i] = key.inline ? undefined : key.archive(writer, items[i][0]);
      valueResolvers[i] = val.inline ? undefined : val.archive(writer, items[i][1]);
    }

    // Entries array in insertion order. The aligned position is recorded
    // even for empty maps — rkyv's entries pointer is always real.
    writer.align(g.entryAlign);
    const entriesPos = writer.pos;
    for (let i = 0; i < items.length; i++) {
      const entryStart = writer.pos;
      key.resolve(writer, items[i][0], keyResolvers[i]);
      writer.padTo(entryStart + g.valueOffset);
      val.resolve(writer, items[i][1], valueResolvers[i]);
      writer.padTo(entryStart + g.entrySize);
    }

    return { len: items.length, capacity, controlBytesPos, entriesPos };
  }

  resolve(writer: RkyvWriter, _value: Map<K, V>, resolver: IndexResolver): number {
    const pos = writer.pos;
    const tablePtrPos = writer.reserveRelPtr();
    writer.writeUsize(resolver.len);
    writer.writeUsize(resolver.capacity);
    if (resolver.len > 0) {
      writer.writeRelPtrAt(tablePtrPos, resolver.controlBytesPos);
    } else {
      writer.writeInvalidPtrAt(tablePtrPos);
    }
    const entriesPtrPos = writer.reserveRelPtr();
    writer.writeRelPtrAt(entriesPtrPos, resolver.entriesPos);
    return pos;
  }
}

/**
 * indexmap::IndexMap<K, V> — insertion-order preserving hash map.
 *
 * @example
 * ```typescript
 * import { indexMap } from 'rkyv-js/lib/indexmap';
 * const Settings = indexMap(r.string, r.u32);
 * ```
 */
export function indexMap<K extends AnyCodec, V extends AnyCodec>(
  keyCodec: K,
  valueCodec: V,
  options?: HashTableOptions,
): Codec<Map<Infer<K>, Infer<V>>> {
  return new IndexMapCodec(keyCodec, valueCodec, options?.hasher);
}

/**
 * indexmap::IndexSet<T> — a thin wrapper over `IndexMap<T, ()>`.
 */
export function indexSet<E extends AnyCodec>(
  element: E,
  options?: HashTableOptions,
): Codec<Set<Infer<E>>> {
  return new SetOfMapCodec(new IndexMapCodec<Infer<E>, null>(element, unit, options?.hasher));
}
