/**
 * uuid::Uuid decoder for rkyv-js
 *
 * Supports the `uuid-1` feature in rkyv.
 * @see https://docs.rs/uuid/1
 */

import {
  BaseDecoder,
  type Decoder,
  type Layout,
  type RkyvFormat,
  type RkyvReader,
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

const UUID_ALIGNED: Layout = { size: 16, align: 1 };

export class UuidDecoder extends BaseDecoder<string> {
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
}

/**
 * uuid::Uuid — 128-bit UUID, archived as `[u8; 16]` and decoded as a
 * formatted string (`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`).
 */
export const uuid: Decoder<string> = new UuidDecoder();
