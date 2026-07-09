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
 *
 * The logic lives once per direction: the full codec here EXTENDS the read
 * class from `./hashmap.decode.ts` and CONTAINS the encode class from
 * `./hashmap.encode.ts`, delegating `archive`/`resolve`/`hash` to it.
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

import { HashMapDecoder } from './hashmap.decode.ts';
import {
  HashMapEncoder,
  type HashTableOptions,
  type TableResolver,
} from './hashmap.encode.ts';
import { SetOfMapCodec } from './internal/map-set.ts';

export { HashMapDecoder } from './hashmap.decode.ts';
export {
  HashMapEncoder,
  requireHashableKey,
  type HashTableOptions,
} from './hashmap.encode.ts';

export class HashMapCodec<K, V> extends HashMapDecoder<K, V> {
  #write: HashMapEncoder<K, V>;

  constructor(keyCodec: Codec<K>, valueCodec: Codec<V>, buildHasher?: RkyvBuildHasher) {
    super(keyCodec, valueCodec);
    this.#write = new HashMapEncoder(keyCodec, valueCodec, buildHasher);
  }

  archive(writer: RkyvWriter, value: Map<K, V>): TableResolver {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: Map<K, V>, resolver: TableResolver): number {
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
