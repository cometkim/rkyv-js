/**
 * uuid::Uuid encoder for rkyv-js
 *
 * Supports the `uuid-1` feature in rkyv.
 * @see https://docs.rs/uuid/1
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

export class UuidEncoder extends BaseEncoder<string, undefined> {
  constructor() {
    super({ inline: true, hashable: true });
  }

  computeLayout(_fmt: RkyvFormat): Layout {
    // [u8; 16] — alignment 1 under every format.
    return UUID_ALIGNED;
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
 * uuid::Uuid — 128-bit UUID, archived as `[u8; 16]` from its formatted
 * string form (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
 */
export const uuid: Encoder<string> = new UuidEncoder();
