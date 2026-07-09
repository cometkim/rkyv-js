/**
 * bytes::Bytes encoder for rkyv-js
 *
 * Supports the `bytes-1` feature in rkyv.
 * @see https://docs.rs/bytes/1
 */

import {
  BaseEncoder,
  type Encoder,
  type Layout,
  type RkyvFormat,
  type RkyvHasher,
  type RkyvTextEncoder,
  type RkyvWriter,
} from 'rkyv-js/core';

export interface BytesLayout extends Layout {
  pb: 2 | 4 | 8;
}

export interface BytesResolver {
  pos: number;
  len: number;
}

export class BytesEncoder extends BaseEncoder<Uint8Array, BytesResolver, BytesLayout> {
  constructor() {
    super({ inline: false, hashable: true });
  }

  computeLayout(fmt: RkyvFormat): BytesLayout {
    const pb = (fmt.pointerWidth / 8) as 2 | 4 | 8;
    return { size: pb * 2, align: fmt.aligned ? pb : 1, pb };
  }

  archive(writer: RkyvWriter, value: Uint8Array): BytesResolver {
    // Bytes are align-1; the current position is the data position even for
    // empty values (mirroring ArchivedVec's always-real pointer).
    return { pos: writer.writeBytes(value), len: value.length };
  }

  resolve(writer: RkyvWriter, _value: Uint8Array, resolver: BytesResolver): number {
    const structPos = writer.pos;
    const ptrPos = writer.reserveRelPtr();
    writer.writeUsize(resolver.len);
    writer.writeRelPtrAt(ptrPos, resolver.pos);
    return structPos;
  }

  // Hash for Bytes derefs to [u8]: length prefix, then the raw bytes.
  hash(hasher: RkyvHasher, value: Uint8Array, _encoder: RkyvTextEncoder): void {
    hasher.writeUsize(value.length);
    hasher.writeBytes(value);
  }
}

/**
 * bytes::Bytes — a contiguous chunk of memory, archived like `Vec<u8>`.
 */
export const bytes: Encoder<Uint8Array> = new BytesEncoder();
