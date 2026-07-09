/**
 * bytes::Bytes codec for rkyv-js
 *
 * Supports the `bytes-1` feature in rkyv.
 * @see https://docs.rs/bytes/1
 *
 * The logic lives once per direction: the full codec here EXTENDS the read
 * class from `./bytes.decode.ts` and CONTAINS the encode class from
 * `./bytes.encode.ts`, delegating `archive`/`resolve`/`hash` to it.
 * One-direction consumers import those modules directly instead.
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

import { BytesDecoder } from './bytes.decode.ts';
import { BytesEncoder, type BytesResolver } from './bytes.encode.ts';

export { BytesDecoder } from './bytes.decode.ts';
export { BytesEncoder } from './bytes.encode.ts';

export class BytesCodec extends BytesDecoder {
  #write: BytesEncoder = new BytesEncoder();

  archive(writer: RkyvWriter, value: Uint8Array): BytesResolver {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: Uint8Array, resolver: BytesResolver): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: Uint8Array, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: Uint8Array, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: Uint8Array): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * bytes::Bytes — a contiguous chunk of memory, archived like `Vec<u8>` and
 * decoded as a zero-copy `Uint8Array` view into the archive buffer.
 */
export const bytes: Codec<Uint8Array> = new BytesCodec();
