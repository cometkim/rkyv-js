/**
 * uuid::Uuid codec for rkyv-js
 *
 * Supports the `uuid-1` feature in rkyv.
 * @see https://docs.rs/uuid/1
 *
 * The logic lives once per direction: the full codec here EXTENDS the read
 * class from `./uuid.decode.ts` and CONTAINS the encode class from
 * `./uuid.encode.ts`, delegating `resolve`/`hash` to it. One-direction
 * consumers import those modules directly instead.
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

import { UuidDecoder } from './uuid.decode.ts';
import { UuidEncoder } from './uuid.encode.ts';

export { UuidDecoder } from './uuid.decode.ts';
export { UuidEncoder } from './uuid.encode.ts';

export class UuidCodec extends UuidDecoder {
  #write: UuidEncoder = new UuidEncoder();

  archive(writer: RkyvWriter, value: string): undefined {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: string, resolver: undefined): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: string, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: string, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: string): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * uuid::Uuid — 128-bit UUID, archived as `[u8; 16]` and decoded as a
 * formatted string (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
 */
export const uuid: Codec<string> = new UuidCodec();
