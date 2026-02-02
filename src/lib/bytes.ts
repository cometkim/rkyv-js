/**
 * bytes::Bytes codec for rkyv-js
 *
 * Supports the `bytes-1` feature in rkyv.
 * @see https://docs.rs/bytes/1
 */

import type { RkyvCodec } from 'rkyv-js/codec';
import type { RkyvReader } from 'rkyv-js/reader';
import type { RkyvWriter } from 'rkyv-js/writer';

/**
 * bytes::Bytes - A cheaply cloneable and sliceable chunk of contiguous memory
 *
 * Same archived layout as Vec<u8>: `{ ptr: RelPtr32, len: u32 }`
 * Decoded as Uint8Array instead of number[].
 *
 * This is more efficient than `r.vec(r.u8)` because it:
 * - Returns a Uint8Array directly (no array conversion)
 * - Uses a single buffer slice instead of element-by-element decoding
 *
 * @example
 * ```typescript
 * import { r } from 'rkyv-js';
 *
 * const MessageCodec = r.struct({
 *   payload: r.lib.bytes,
 * });
 *
 * const msg = r.decode(MessageCodec, data);
 * console.log(msg.payload); // Uint8Array
 * ```
 */
export const bytes: RkyvCodec<Uint8Array> = {
  size: 8, // relptr (4) + len (4)
  align: 4,

  access(reader: RkyvReader, offset: number): Uint8Array {
    return this.decode(reader, offset);
  },

  decode(reader: RkyvReader, offset: number): Uint8Array {
    const dataOffset = reader.readRelPtr32(offset);
    const length = reader.readU32(offset + 4);
    return reader.readBytes(dataOffset, length);
  },

  _archive(writer: RkyvWriter, value: Uint8Array) {
    if (value.length === 0) {
      return { pos: writer.pos, len: 0 };
    }
    const pos = writer.writeBytes(value);
    return { pos, len: value.length };
  },

  _resolve(writer: RkyvWriter, _value: Uint8Array, resolver) {
    writer.align(4);
    const structPos = writer.pos;
    const ptrPos = writer.reserveRelPtr32();
    const r = resolver as { pos: number; len: number };
    writer.writeU32(r.len);

    if (r.len > 0) {
      writer.writeRelPtr32At(ptrPos, r.pos);
    } else {
      writer.writeRelPtr32At(ptrPos, 0);
    }
    return structPos;
  },

  encode(writer: RkyvWriter, value: Uint8Array): number {
    const resolver = this._archive(writer, value);
    return this._resolve(writer, value, resolver);
  },
};
