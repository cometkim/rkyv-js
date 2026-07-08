/**
 * bytes::Bytes codec for rkyv-js
 *
 * Supports the `bytes-1` feature in rkyv.
 * @see https://docs.rs/bytes/1
 */

import {
  Codec,
  type Layout,
  type RkyvFormat,
  type RkyvHasher,
  type RkyvTextEncoder,
  type RkyvReader,
  type RkyvWriter,
} from 'rkyv-js/core';

interface BytesLayout extends Layout {
  pb: 2 | 4 | 8;
}

interface BytesResolver {
  pos: number;
  len: number;
}

class BytesCodec extends Codec<Uint8Array, BytesResolver, BytesLayout> {
  constructor() {
    super({ inline: false, hashable: true });
  }

  computeLayout(fmt: RkyvFormat): BytesLayout {
    const pb = (fmt.pointerWidth / 8) as 2 | 4 | 8;
    return { size: pb * 2, align: fmt.aligned ? pb : 1, pb };
  }

  read(reader: RkyvReader, offset: number): Uint8Array {
    const l = this.layout(reader.format);
    const dataOffset = reader.readRelPtr(offset);
    const length = reader.readUsize(offset + l.pb);
    // Zero-copy: a view into the archive buffer.
    return reader.readBytes(dataOffset, length);
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
 * bytes::Bytes — a contiguous chunk of memory, archived like `Vec<u8>` and
 * decoded as a zero-copy `Uint8Array` view into the archive buffer.
 */
export const bytes: Codec<Uint8Array> = new BytesCodec();
