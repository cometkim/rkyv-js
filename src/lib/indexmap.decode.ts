/**
 * indexmap::IndexMap / IndexSet decoders (rkyv's `indexmap-2` feature).
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
 * `entries` array. Reading walks that entries array directly and never
 * touches the table or hashes keys, so the read factories take no hasher
 * option — the swiss-table builder and the fxhash implementation live
 * entirely on the encode side (`./indexmap.encode.ts`).
 */

import {
  alignOffset,
  BaseDecoder,
  type Decoder,
  type AnyDecoder,
  type Infer,
  type Layout,
  type RkyvFormat,
  type RkyvReader,
} from 'rkyv-js/core';

import { unit } from '../decode.ts';
import { SetOfMapDecoder } from './internal/map-set.decode.ts';

export interface IndexLayout extends Layout {
  pb: 2 | 4 | 8;
}

interface EntryGeometry {
  entryAlign: number;
  valueOffset: number;
  entrySize: number;
}

export class IndexMapDecoder<K, V> extends BaseDecoder<Map<K, V>, IndexLayout> {
  #key: Decoder<K>;
  #value: Decoder<V>;
  #geometryFormat: RkyvFormat | null = null;
  #geometry: EntryGeometry | null = null;

  constructor(keyCodec: Decoder<K>, valueCodec: Decoder<V>) {
    super({ inline: false, hashable: false });
    this.#key = keyCodec;
    this.#value = valueCodec;
  }

  // Header layout never depends on the entry types (maps are valid recursion
  // points in Rust); entry geometry is memoized separately and computed only
  // at read time.
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
}

/**
 * indexmap::IndexMap<K, V> — insertion-order preserving hash map (read
 * half). Reading never hashes keys, so there is no hasher option.
 */
export function indexMap<K extends AnyDecoder, V extends AnyDecoder>(
  keyCodec: K,
  valueCodec: V,
): Decoder<Map<Infer<K>, Infer<V>>> {
  return new IndexMapDecoder(keyCodec, valueCodec);
}

/**
 * indexmap::IndexSet<T> — a thin wrapper over `IndexMap<T, ()>`.
 */
export function indexSet<E extends AnyDecoder>(element: E): Decoder<Set<Infer<E>>> {
  return new SetOfMapDecoder(new IndexMapDecoder<Infer<E>, null>(element, unit));
}
