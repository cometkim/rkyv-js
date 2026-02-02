/**
 * Swiss Table implementation for rkyv-js
 *
 * This implements the same Swiss Table format that rkyv uses for HashMap,
 * IndexMap, HashSet, and IndexSet.
 */

import type { RkyvWriter } from 'rkyv-js/writer';

// FxHash64 constants
const ROTATE = 5n;
const SEED = 0x517cc1b727220a95n;
const MASK64 = 0xFFFFFFFFFFFFFFFFn;

function rotateLeft64(value: bigint, bits: bigint): bigint {
  const v = value & MASK64;
  return ((v << bits) | (v >> (64n - bits))) & MASK64;
}

function hashWord(hash: bigint, word: bigint): bigint {
  const rotated = rotateLeft64(hash, ROTATE);
  const xored = rotated ^ (word & MASK64);
  return (xored * SEED) & MASK64;
}

/**
 * Hash bytes using FxHasher64 algorithm
 */
export function fxHashBytes(bytes: Uint8Array): bigint {
  const len = bytes.length;
  let hash = 0n;

  // Process 8 bytes at a time
  for (let i = 0; i < Math.floor(len / 8); i++) {
    const offset = i * 8;
    let word = 0n;
    for (let j = 0; j < 8; j++) {
      word |= BigInt(bytes[offset + j]) << (BigInt(j) * 8n);
    }
    hash = hashWord(hash, word);
  }

  // 4-byte chunk: offset = len & ~7
  if ((len & 4) !== 0) {
    const offset = len & ~7;
    let word = 0n;
    for (let j = 0; j < 4; j++) {
      word |= BigInt(bytes[offset + j]) << (BigInt(j) * 8n);
    }
    hash = hashWord(hash, word);
  }

  // 2-byte chunk: offset = len & ~3
  if ((len & 2) !== 0) {
    const offset = len & ~3;
    let word = 0n;
    for (let j = 0; j < 2; j++) {
      word |= BigInt(bytes[offset + j]) << (BigInt(j) * 8n);
    }
    hash = hashWord(hash, word);
  }

  // 1-byte chunk: last byte
  if ((len & 1) !== 0) {
    const byte = BigInt(bytes[len - 1]);
    hash = hashWord(hash, byte);
  }

  return hash;
}

/**
 * Hash a u8 value
 */
export function fxHashU8(hash: bigint, value: number): bigint {
  return hashWord(hash, BigInt(value));
}

/**
 * Hash a u32 value
 */
export function fxHashU32(hash: bigint, value: number): bigint {
  return hashWord(hash, BigInt(value));
}

/**
 * Hash a string using FxHash64 (same way Rust hashes strings)
 *
 * Rust's str Hash implementation writes the bytes then a 0xFF terminator.
 */
export function hashString(writer: RkyvWriter, s: string): bigint {
  const bytes = writer.encodeText(s);
  let hash = fxHashBytes(bytes);
  hash = fxHashU8(hash, 0xff); // Terminator
  return hash;
}

/**
 * Hash a u32 using FxHash64 (same way Rust hashes u32)
 */
export function hashU32(n: number): bigint {
  return hashWord(0n, BigInt(n));
}

/**
 * h1 - primary hash (used for bucket selection)
 * In rkyv's implementation, h1 is just the full hash.
 */
export function h1(hash: bigint): bigint {
  return hash;
}

/**
 * h2 - secondary hash (stored in control bytes)
 * Top 7 bits of the hash, excluding the sign bit.
 */
export function h2(hash: bigint): number {
  return Number((hash >> 57n) & 0x7Fn);
}

const MAX_GROUP_WIDTH = 16;

/**
 * Calculate capacity from length using rkyv's load factor (7/8)
 */
export function capacityFromLen(len: number): number {
  if (len === 0) return 0;
  // capacity = ceil(len * 8 / 7) but at least len + 1
  return Math.max(Math.ceil(len * 8 / 7), len + 1);
}

/**
 * Calculate probe capacity (rounded up to MAX_GROUP_WIDTH)
 */
export function probeCap(capacity: number): number {
  if (capacity === 0) return 0;
  return Math.ceil(capacity / MAX_GROUP_WIDTH) * MAX_GROUP_WIDTH;
}

/**
 * Calculate control byte count
 */
export function controlCount(probeCapacity: number): number {
  if (probeCapacity === 0) return 0;
  return probeCapacity + MAX_GROUP_WIDTH - 1;
}

/**
 * Calculate bucket mask for probing
 */
export function bucketMask(probeCapacity: number): number {
  if (probeCapacity === 0) return 0;
  // Next power of 2 minus 1
  let mask = 1;
  while (mask < probeCapacity) {
    mask *= 2;
  }
  return mask - 1;
}

/**
 * Swiss Table probe sequence
 */
export class ProbeSeq {
  pos: number;
  stride: number;

  constructor(hash: bigint, capacity: number) {
    // Note: rkyv uses hash % capacity, not hash % probeCapacity
    this.pos = Number(h1(hash) % BigInt(capacity));
    this.stride = 0;
  }

  moveNext(mask: number): void {
    this.stride += MAX_GROUP_WIDTH;
    this.pos += this.stride;
    this.pos &= mask;
  }
}

/**
 * Find empty slots in control bytes group
 */
function findEmptySlot(
  controlBytes: Uint8Array,
  startIndex: number,
  probeCapacity: number,
): number | null {
  for (let i = 0; i < MAX_GROUP_WIDTH; i++) {
    const idx = (startIndex + i) % probeCapacity;
    if (controlBytes[idx] === 0xff) {
      return idx;
    }
  }
  return null;
}

export interface SwissTable {
  controlBytes: Uint8Array;
  bucketIndices: Uint32Array;
  capacity: number;
  probeCapacity: number;
}

/**
 * Build a Swiss Table for the given hashes
 */
export function buildSwissTable(hashes: bigint[]): SwissTable {
  const len = hashes.length;

  if (len === 0) {
    return {
      controlBytes: new Uint8Array(0),
      bucketIndices: new Uint32Array(0),
      capacity: 0,
      probeCapacity: 0,
    };
  }

  const capacity = capacityFromLen(len);
  const probeCapacity = probeCap(capacity);
  const ctrlCount = controlCount(probeCapacity);
  const mask = bucketMask(probeCapacity);

  // Initialize control bytes to empty (0xFF)
  const controlBytes = new Uint8Array(ctrlCount);
  controlBytes.fill(0xff);

  // Initialize bucket indices
  const bucketIndices = new Uint32Array(capacity);

  // Insert each item
  for (let itemIndex = 0; itemIndex < hashes.length; itemIndex++) {
    const hash = hashes[itemIndex];
    const h2Hash = h2(hash);
    const probeSeq = new ProbeSeq(hash, probeCapacity);

    while (true) {
      const emptySlot = findEmptySlot(controlBytes, probeSeq.pos, probeCapacity);

      if (emptySlot !== null) {
        // Set control byte
        controlBytes[emptySlot] = h2Hash;

        // Mirror at end if in first (MAX_GROUP_WIDTH - 1) positions
        if (emptySlot < MAX_GROUP_WIDTH - 1) {
          controlBytes[probeCapacity + emptySlot] = h2Hash;
        }

        bucketIndices[emptySlot] = itemIndex;
        break;
      }

      // Move to next probe position
      probeSeq.moveNext(mask);
    }
  }

  return { controlBytes, bucketIndices, capacity, probeCapacity };
}
