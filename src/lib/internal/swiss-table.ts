/**
 * Swiss table builder for rkyv-js.
 *
 * This is an exact port of `ArchivedHashTable::serialize_from_iter` from
 * rkyv 0.8 (`src/collections/swiss_table/table.rs`), which backs the
 * archived `HashMap`, `HashSet`, `IndexMap`, and `IndexSet` formats:
 *
 * - `capacity = max(len * 8 / 7, len + 1)` with integer (floor) division —
 *   the `(7, 8)` load factor rkyv passes for all swiss-table collections.
 * - Probing starts at `h1 % capacity` and scans one MAX_GROUP_WIDTH-wide
 *   group of control bytes for the first EMPTY (0xff) byte; the insertion
 *   index wraps modulo `capacity`.
 * - On a full group, the sequence strides triangularly
 *   (`stride += 16; pos = (pos + stride) & bucketMask`) where `bucketMask`
 *   is `nextPow2(controlCount) - 1`, skipping positions >= probeCapacity.
 * - Control bytes near the start are mirrored past `capacity` so lookups can
 *   read full groups without wrapping.
 *
 * Any deviation from this algorithm produces tables that Rust-side `get()`
 * cannot search correctly, even though iteration still works.
 */

import type { RkyvHasher } from 'rkyv-js/core';

export const MAX_GROUP_WIDTH = 16;

/** `h2` — the top 7 bits of a key digest, stored in control bytes. */
export function digestH2(hi: number): number {
  return hi >>> 25;
}

/**
 * `h1 % capacity` — the home slot of a key digest for a table with
 * `capacity` buckets, computed exactly (base-2^16 Horner over the u32
 * halves; no precision loss for any u32 capacity).
 */
export function digestMod(hi: number, lo: number, capacity: number): number {
  let r = (hi >>> 16) % capacity;
  r = (r * 0x10000 + (hi & 0xffff)) % capacity;
  r = (r * 0x10000 + (lo >>> 16)) % capacity;
  r = (r * 0x10000 + (lo & 0xffff)) % capacity;
  return r;
}

export interface SwissTableLayout {
  capacity: number;
  probeCapacity: number;
  controlCount: number;
  bucketMask: number;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * `capacity_from_len` + `probe_cap` + `control_count` + `bucket_mask` for a
 * non-empty table.
 */
export function swissTableLayout(len: number): SwissTableLayout {
  const capacity = Math.max(Math.floor((len * 8) / 7), len + 1);
  const probeCapacity = Math.ceil(capacity / MAX_GROUP_WIDTH) * MAX_GROUP_WIDTH;
  const controlCount = probeCapacity + MAX_GROUP_WIDTH - 1;
  return {
    capacity,
    probeCapacity,
    controlCount,
    bucketMask: nextPow2(controlCount) - 1,
  };
}

export interface SwissTable extends SwissTableLayout {
  /** Control bytes (0xff = empty, otherwise the key hash's h2). */
  controlBytes: Uint8Array;
  /** For each slot in 0..capacity: the item index placed there, or -1. */
  slotToItem: Int32Array;
}

/**
 * Assign every item a slot exactly like rkyv's insertion loop. `hashItem`
 * must feed the item's KEY to the hasher the way Rust's `Hash` impl would.
 */
export function buildSwissTable<T>(
  items: readonly T[],
  hasher: RkyvHasher,
  hashItem: (hasher: RkyvHasher, item: T) => void,
): SwissTable {
  const layout = swissTableLayout(items.length);
  const { capacity, probeCapacity, controlCount, bucketMask } = layout;

  const controlBytes = new Uint8Array(controlCount).fill(0xff);
  const slotToItem = new Int32Array(capacity).fill(-1);

  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    hasher.reset();
    hashItem(hasher, items[itemIndex]);
    hasher.finish();
    const h2 = digestH2(hasher.hi);
    let pos = digestMod(hasher.hi, hasher.lo, capacity);
    let stride = 0;

    let placed = false;
    // The triangular sequence over a power-of-two mask visits every group,
    // and capacity > len guarantees an empty slot; bound the walk anyway so
    // a bug can never spin forever or drop an item silently.
    for (let attempt = 0; attempt <= controlCount; attempt++) {
      let bit = -1;
      for (let i = 0; i < MAX_GROUP_WIDTH; i++) {
        if (controlBytes[pos + i] === 0xff) {
          bit = i;
          break;
        }
      }
      if (bit >= 0) {
        const index = (pos + bit) % capacity;
        controlBytes[index] = h2;
        // Mirror early control bytes past the end for wraparound reads.
        if (index < controlCount - capacity) {
          controlBytes[capacity + index] = h2;
        }
        slotToItem[index] = itemIndex;
        placed = true;
        break;
      }
      do {
        stride += MAX_GROUP_WIDTH;
        pos = (pos + stride) & bucketMask;
      } while (pos >= probeCapacity);
    }
    if (!placed) {
      throw new Error('swiss table insertion failed to find an empty slot (this is a bug in rkyv-js)');
    }
  }

  return { ...layout, controlBytes, slotToItem };
}
