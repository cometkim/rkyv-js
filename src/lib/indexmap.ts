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
 *
 * The logic lives once per direction: the full codec here EXTENDS the read
 * class from `./indexmap.decode.ts` and CONTAINS the encode class from
 * `./indexmap.encode.ts`, delegating `archive`/`resolve`/`hash` to it.
 * One-direction consumers import those modules directly instead.
 */

import {
  DEFAULT_FORMAT,
  encodeIntoWriter,
  encodePooled,
  type AnyCodec,
  type Codec,
  type Infer,
  type RkyvBuildHasher,
  type RkyvFormat,
  type RkyvHasher,
  type RkyvTextEncoder,
  type RkyvWriter,
} from 'rkyv-js/core';
import { unit } from 'rkyv-js/primitives';

import type { HashTableOptions } from './hashmap.encode.ts';
import { IndexMapDecoder } from './indexmap.decode.ts';
import { IndexMapEncoder, type IndexResolver } from './indexmap.encode.ts';
import { SetOfMapCodec } from './internal/map-set.ts';

export { IndexMapDecoder } from './indexmap.decode.ts';
export { IndexMapEncoder } from './indexmap.encode.ts';

export class IndexMapCodec<K, V> extends IndexMapDecoder<K, V> {
  #write: IndexMapEncoder<K, V>;

  constructor(keyCodec: Codec<K>, valueCodec: Codec<V>, buildHasher?: RkyvBuildHasher) {
    super(keyCodec, valueCodec);
    this.#write = new IndexMapEncoder(keyCodec, valueCodec, buildHasher);
  }

  archive(writer: RkyvWriter, value: Map<K, V>): IndexResolver {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: Map<K, V>, resolver: IndexResolver): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: Map<K, V>, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: Map<K, V>, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: Map<K, V>): Uint8Array {
    return encodeIntoWriter(this, writer, value);
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
