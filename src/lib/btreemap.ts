/**
 * std::collections::BTreeMap / BTreeSet codecs.
 *
 * The archived format is rkyv's B-tree:
 * - header: root pointer (RelPtr) + length (ArchivedUsize)
 * - leaf nodes: kind (u8) + keys[E] + values[E] + len (ArchivedUsize)
 * - inner nodes: kind (u8) + keys[E] + values[E] + lesser_nodes[E] +
 *   greater_node (RelPtrs)
 *
 * Default branching factor E = 5 (entries per node).
 *
 * Entries are sorted by key before archiving — Rust's BTreeMap invariant.
 * String keys sort by Unicode code point, matching Rust's UTF-8 byte order.
 *
 * The logic lives once per direction: the full codec here EXTENDS the read
 * class from `./btreemap.decode.ts` and CONTAINS the encode class from
 * `./btreemap.encode.ts`, delegating `archive`/`resolve`/`hash` to it.
 * One-direction consumers import those modules directly instead.
 */

import {
  DEFAULT_FORMAT,
  encodeIntoWriter,
  encodePooled,
  type AnyCodec,
  type Codec,
  type Infer,
  type RkyvFormat,
  type RkyvHasher,
  type RkyvTextEncoder,
  type RkyvWriter,
} from 'rkyv-js/core';
import { unit } from 'rkyv-js/primitives';

import { BTreeMapDecoder } from './btreemap.decode.ts';
import { BTreeMapEncoder, type BTreeResolver } from './btreemap.encode.ts';
import { SetOfMapCodec } from './internal/map-set.ts';

export { BTreeMapDecoder } from './btreemap.decode.ts';
export { BTreeMapEncoder } from './btreemap.encode.ts';

export class BTreeMapCodec<K, V> extends BTreeMapDecoder<K, V> {
  #write: BTreeMapEncoder<K, V>;

  constructor(
    keyCodec: Codec<K>,
    valueCodec: Codec<V>,
    E: number = 5,
    compare?: (a: K, b: K) => number,
  ) {
    super(keyCodec, valueCodec, E);
    this.#write = new BTreeMapEncoder(keyCodec, valueCodec, E, compare);
  }

  archive(writer: RkyvWriter, value: Map<K, V>): BTreeResolver {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: Map<K, V>, resolver: BTreeResolver): number {
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
 * std::collections::BTreeMap<K, V>.
 *
 * `compare` orders keys like Rust's `Ord` for the key type; the default
 * handles numbers, bigints, and strings (by code point = UTF-8 byte order).
 */
export function btreeMap<K extends AnyCodec, V extends AnyCodec>(
  keyCodec: K,
  valueCodec: V,
  E: number = 5,
  compare?: (a: Infer<K>, b: Infer<K>) => number,
): Codec<Map<Infer<K>, Infer<V>>> {
  return new BTreeMapCodec(keyCodec, valueCodec, E, compare);
}

/**
 * std::collections::BTreeSet<T> — a thin wrapper over `BTreeMap<T, ()>`.
 */
export function btreeSet<E extends AnyCodec>(
  element: E,
  branching: number = 5,
  compare?: (a: Infer<E>, b: Infer<E>) => number,
): Codec<Set<Infer<E>>> {
  return new SetOfMapCodec(new BTreeMapCodec<Infer<E>, null>(element, unit, branching, compare));
}
