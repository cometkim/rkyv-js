/**
 * bytes::Bytes decoder for rkyv-js
 *
 * Supports the `bytes-1` feature in rkyv.
 * @see https://docs.rs/bytes/1
 */

import {
  BaseDecoder,
  type Decoder,
  type Layout,
  type RkyvFormat,
  type RkyvReader,
} from 'rkyv-js/core';

export interface BytesLayout extends Layout {
  pb: 2 | 4 | 8;
}

export class BytesDecoder extends BaseDecoder<Uint8Array, BytesLayout> {
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
}

/**
 * bytes::Bytes — a contiguous chunk of memory, archived like `Vec<u8>` and
 * decoded as a zero-copy `Uint8Array` view into the archive buffer.
 */
export const bytes: Decoder<Uint8Array> = new BytesDecoder();
