/**
 * uuid::Uuid codec for rkyv-js
 *
 * Supports the `uuid-1` feature in rkyv.
 * @see https://docs.rs/uuid/1
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

const UUID_ALIGNED: Layout = { size: 16, align: 1 };

class UuidCodec extends Codec<string, undefined> {
  constructor() {
    super({ inline: true, hashable: true });
  }

  computeLayout(_fmt: RkyvFormat): Layout {
    // [u8; 16] — alignment 1 under every format.
    return UUID_ALIGNED;
  }

  read(reader: RkyvReader, offset: number): string {
    return bytesToUuid(reader.readBytes(offset, 16));
  }

  resolve(writer: RkyvWriter, value: string, _resolver: undefined): number {
    return writer.writeBytes(uuidToBytes(value));
  }

  // Uuid is a newtype over [u8; 16]; arrays hash as slices: length prefix,
  // then (for u8 elements) the raw bytes.
  hash(hasher: RkyvHasher, value: string, _encoder: RkyvTextEncoder): void {
    hasher.writeUsize(16);
    hasher.writeBytes(uuidToBytes(value));
  }
}

/**
 * uuid::Uuid — 128-bit UUID, archived as `[u8; 16]` and decoded as a
 * formatted string (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
 */
export const uuid: Codec<string> = new UuidCodec();
