import { alignOffset, type RkyvCodec, type Resolver } from 'rkyv-js/codec';
import type { RkyvReader } from 'rkyv-js/reader';
import type { RkyvWriter } from 'rkyv-js/writer';
import { unit } from 'rkyv-js/primitives';

import {
  hashString,
  h2,
  capacityFromLen,
  probeCap,
  controlCount,
} from './internal/swiss-table.ts';

const MAX_GROUP_WIDTH = 16;

/**
 * HashMap<K, V> - rkyv's hashbrown-based hash map
 *
 * The archived format uses a Swiss Table structure:
 * - ptr: RelPtr to control bytes (4 bytes)
 * - len: u32 (4 bytes)
 * - cap: u32 (4 bytes)
 *
 * Total: 12 bytes, align: 4
 *
 * Buckets (entries) are stored BEFORE the control bytes, accessed by
 * subtracting from the control bytes pointer. Empty buckets are zero-filled.
 *
 * Iteration goes through control bytes and for each occupied slot at
 * position `i`, the entry is at `controlBytesPtr - (i + 1) * entrySize`.
 */
export function hashMap<K, V>(
  keyCodec: RkyvCodec<K>,
  valueCodec: RkyvCodec<V>,
): RkyvCodec<Map<K, V>> {
  // Entry layout: (K, V) with C-style alignment
  const entryAlign = Math.max(keyCodec.align, valueCodec.align);
  const valueOffset = alignOffset(keyCodec.size, valueCodec.align);
  const entrySize = alignOffset(valueOffset + valueCodec.size, entryAlign);

  return {
    size: 12, // ptr (4) + len (4) + cap (4)
    align: 4,

    access(reader: RkyvReader, offset: number): Map<K, V> {
      return this.decode(reader, offset);
    },

    decode(reader: RkyvReader, offset: number): Map<K, V> {
      const controlBytesOffset = reader.readRelPtr32(offset);
      const length = reader.readU32(offset + 4);
      const capacity = reader.readU32(offset + 8);

      const result = new Map<K, V>();
      if (length === 0) return result;

      // Iterate through control bytes to find occupied slots
      // Entries are stored BEFORE control bytes, accessed by subtracting
      let itemsLeft = length;
      let groupBase = 0;

      while (itemsLeft > 0 && groupBase < capacity) {
        // Process one group of control bytes
        for (let bit = 0; bit < MAX_GROUP_WIDTH && groupBase + bit < capacity; bit++) {
          const ctrl = reader.readU8(controlBytesOffset + groupBase + bit);
          // Control byte < 0x80 means occupied (h2 hash)
          if (ctrl < 0x80) {
            const slotIndex = groupBase + bit;
            // Entry is at controlBytesPtr - (slotIndex + 1) * entrySize
            const entryOffset = controlBytesOffset - (slotIndex + 1) * entrySize;

            const key = keyCodec.decode(reader, entryOffset);
            const value = valueCodec.decode(reader, entryOffset + valueOffset);
            result.set(key, value);

            itemsLeft--;
            if (itemsLeft === 0) break;
          }
        }
        groupBase += MAX_GROUP_WIDTH;
      }

      return result;
    },

    _archive(writer: RkyvWriter, value: Map<K, V>) {
      if (value.size === 0) {
        return { pos: 0, len: 0, capacity: 0, controlBytesPos: 0 };
      }

      const len = value.size;
      const capacity = capacityFromLen(len);
      const probeCapacity = probeCap(capacity);
      const ctrlCount = controlCount(probeCapacity);

      // Initialize control bytes (0xFF = empty)
      const controlBytes = new Uint8Array(ctrlCount);
      controlBytes.fill(0xff);

      // Initialize bucket array (which entries go in which slots)
      const bucketEntries: Array<{ key: K; value: V } | null> = new Array(capacity).fill(null);

      // Collect entries and assign to hash table slots
      const entries: Array<{ key: K; value: V; keyResolver: Resolver; valueResolver: Resolver; slot: number }> = [];

      for (const [k, v] of value) {
        const hash = typeof k === 'string' ? hashString(writer, k) : 0n;
        const h2Hash = h2(hash);
        let slot = Number(hash % BigInt(capacity));

        // Linear probing to find empty slot
        for (let probe = 0; probe < capacity; probe++) {
          if (controlBytes[slot] === 0xff) {
            controlBytes[slot] = h2Hash;
            // Mirror for wraparound
            if (slot < ctrlCount - capacity) {
              controlBytes[capacity + slot] = h2Hash;
            }
            bucketEntries[slot] = { key: k, value: v };
            entries.push({
              key: k,
              value: v,
              keyResolver: keyCodec._archive(writer, k),
              valueResolver: valueCodec._archive(writer, v),
              slot,
            });
            break;
          }
          slot = (slot + 1) % capacity;
        }
      }

      // Write buckets (entries) in reverse slot order before control bytes
      // Slot 0's entry is at controlBytesPtr - 1 * entrySize
      // Slot N's entry is at controlBytesPtr - (N+1) * entrySize
      // So we write from highest slot to lowest

      writer.align(entryAlign);

      // Write empty/filled buckets from slot (capacity-1) down to slot 0
      for (let slot = capacity - 1; slot >= 0; slot--) {
        const entry = bucketEntries[slot];
        const entryStart = writer.pos;

        if (entry) {
          // Find the resolver for this entry
          const entryData = entries.find(e => e.slot === slot)!;
          keyCodec._resolve(writer, entryData.key, entryData.keyResolver);
          writer.padTo(entryStart + valueOffset);
          valueCodec._resolve(writer, entryData.value, entryData.valueResolver);
        } else {
          // Empty bucket - write zeros
          for (let i = 0; i < entrySize; i++) {
            writer.writeU8(0);
          }
        }
        writer.padTo(entryStart + entrySize);
      }

      // Write control bytes
      const controlBytesPos = writer.pos;
      for (let i = 0; i < ctrlCount; i++) {
        writer.writeU8(controlBytes[i]);
      }

      return {
        pos: controlBytesPos,
        len,
        capacity,
        controlBytesPos,
      };
    },

    _resolve(writer: RkyvWriter, _value: Map<K, V>, resolver) {
      writer.align(4);
      const structPos = writer.pos;
      const r = resolver as unknown as { len: number; capacity: number; controlBytesPos: number };

      const ptrPos = writer.reserveRelPtr32();
      writer.writeU32(r.len);
      writer.writeU32(r.capacity);

      if (r.len > 0) {
        writer.writeRelPtr32At(ptrPos, r.controlBytesPos);
      } else {
        writer.writeRelPtr32At(ptrPos, 0);
      }
      return structPos;
    },

    encode(writer: RkyvWriter, value: Map<K, V>): number {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

/**
 * HashSet<T> - rkyv's hashbrown-based hash set
 *
 * Implemented as HashMap<T, ()> since HashSet is just a map with unit values.
 * The unit type has size 0, so the entry layout is just the key.
 */
export function hashSet<T>(element: RkyvCodec<T>): RkyvCodec<Set<T>> {
  // Use HashMap<T, ()> internally
  const mapCodec = hashMap(element, unit);

  return {
    size: mapCodec.size,
    align: mapCodec.align,

    access(reader, offset) {
      return this.decode(reader, offset);
    },

    decode(reader, offset) {
      const map = mapCodec.decode(reader, offset);
      return new Set(map.keys());
    },

    _archive(writer, value) {
      // Convert Set to Map with null values
      const map = new Map<T, null>();
      for (const item of value) {
        map.set(item, null);
      }
      return mapCodec._archive(writer, map);
    },

    _resolve(writer, _value, resolver) {
      return mapCodec._resolve(writer, new Map(), resolver);
    },

    encode(writer, value) {
      const map = new Map<T, null>();
      for (const item of value) {
        map.set(item, null);
      }
      return mapCodec.encode(writer, map);
    },
  };
}
