/**
 * Shared Set-over-Map derivation.
 *
 * Rust's set collections archive exactly as their map counterparts with unit
 * values (`HashSet<T>` = `HashMap<T, ()>`, etc.), so every set codec is a
 * thin wrapper converting between `Set<T>` and `Map<T, null>` around a map
 * codec built first.
 *
 * The logic lives once per direction: the full codec here EXTENDS the read
 * class from `./map-set.decode.ts` and CONTAINS the write class from
 * `./map-set.encode.ts`, delegating `archive`/`resolve`/`hash` to it.
 */

import {
  DEFAULT_FORMAT,
  encodeIntoWriter,
  encodePooled,
  type Codec,
  type RkyvFormat,
  type RkyvHasher,
  type RkyvTextEncoder,
  type RkyvWriter,
} from 'rkyv-js/core';

import { SetOfMapDecoder } from './map-set.decode.ts';
import { SetOfMapEncoder } from './map-set.encode.ts';

export class SetOfMapCodec<T, R> extends SetOfMapDecoder<T> {
  #write: SetOfMapEncoder<T, R>;

  constructor(map: Codec<Map<T, null>, R>) {
    super(map);
    this.#write = new SetOfMapEncoder(map);
  }

  archive(writer: RkyvWriter, value: Set<T>): R {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: Set<T>, resolver: R): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: Set<T>, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: Set<T>, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: Set<T>): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}
