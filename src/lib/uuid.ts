/**
 * uuid::Uuid codec for rkyv-js
 *
 * Supports the `uuid-1` feature in rkyv.
 * @see https://docs.rs/uuid/1
 */

import type { RkyvCodec } from 'rkyv-js/codec';
import type { RkyvReader } from 'rkyv-js/reader';
import type { RkyvWriter } from 'rkyv-js/writer';

/**
 * Convert bytes to a formatted UUID string.
 * Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 */
function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Convert a UUID string to 16 bytes.
 * Accepts format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx or continuous hex
 */
function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  if (hex.length !== 32) {
    throw new Error(`Invalid UUID: ${uuid}`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * uuid::Uuid - 128-bit UUID
 *
 * Archived as a fixed 16-byte array `[u8; 16]`.
 * Decoded as a formatted UUID string (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).
 *
 * @example
 * ```typescript
 * import * as r from 'rkyv-js';
 * import { uuid } from 'rkyv-js/lib/uuid';
 *
 * const UserCodec = r.struct({
 *   id: uuid,
 *   name: r.string,
 * });
 *
 * const user = r.decode(UserCodec, bytes);
 * console.log(user.id); // "550e8400-e29b-41d4-a716-446655440000"
 * ```
 */
export const uuid: RkyvCodec<string> = {
  size: 16,
  align: 1,

  access(reader: RkyvReader, offset: number): string {
    return bytesToUuid(reader.readBytes(offset, 16));
  },

  decode(reader: RkyvReader, offset: number): string {
    return bytesToUuid(reader.readBytes(offset, 16));
  },

  _archive(_writer: RkyvWriter, _value: string) {
    return { pos: 0 };
  },

  _resolve(writer: RkyvWriter, value: string, _resolver) {
    writer.align(1);
    const pos = writer.pos;
    const bytes = uuidToBytes(value);
    for (let i = 0; i < 16; i++) {
      writer.writeU8(bytes[i]);
    }
    return pos;
  },

  encode(writer: RkyvWriter, value: string): number {
    return this._resolve(writer, value, this._archive(writer, value));
  },
};
