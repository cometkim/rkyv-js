/**
 * indexmap codecs for rkyv-js
 *
 * Supports the `indexmap-2` feature in rkyv.
 * @see https://docs.rs/indexmap
 *
 * rkyv's ArchivedIndexMap uses a Swiss Table for O(1) lookups plus a separate
 * entries array that preserves insertion order. For iteration, we read directly
 * from the entries array.
 */

import { alignOffset, type RkyvCodec, type Resolver } from 'rkyv-js/codec';
import type { RkyvReader } from 'rkyv-js/reader';
import type { RkyvWriter } from 'rkyv-js/writer';
import {
  hashString,
  h2,
  capacityFromLen,
  probeCap,
  controlCount,
} from './internal/swiss-table.ts';

/**
 * ArchivedIndexMap layout:
 *
 * struct ArchivedIndexMap<K, V> {
 *     table: ArchivedHashTable<ArchivedUsize>,  // 12 bytes
 *     entries: RelPtr<Entry<K, V>>,             // 4 bytes
 * }
 *
 * struct ArchivedHashTable<T> {
 *     ptr: RawRelPtr,      // 4 bytes - points to control bytes
 *     len: ArchivedUsize,  // 4 bytes - number of entries
 *     cap: ArchivedUsize,  // 4 bytes - capacity
 * }
 *
 * Entry<K, V> is a simple (K, V) tuple stored contiguously.
 *
 * Memory layout for Swiss Table:
 * - Buckets are stored BEFORE control bytes (at negative offsets from ptr)
 * - bucket[i] is at ptr - (i + 1) * 4
 * - Control bytes start at ptr and extend for controlCount bytes
 *
 * Total ArchivedIndexMap size: 16 bytes, align: 4
 */

/**
 * indexmap::IndexMap<K, V> - Insertion-order preserving hash map
 *
 * When archived, IndexMap stores entries in a separate array that preserves
 * insertion order. The Swiss Table is used only for O(1) key lookups.
 *
 * @example
 * ```typescript
 * import { r } from 'rkyv-js';
 *
 * // IndexMap<String, u32> in Rust
 * const ConfigCodec = r.struct({
 *   settings: r.lib.indexMap(r.string, r.u32),
 * });
 * ```
 */
export function indexMap<K, V>(
  keyCodec: RkyvCodec<K>,
  valueCodec: RkyvCodec<V>,
): RkyvCodec<Map<K, V>> {
  // Entry layout: (K, V) tuple with C-style alignment
  const entryAlign = Math.max(keyCodec.align, valueCodec.align);
  const valueOffset = alignOffset(keyCodec.size, valueCodec.align);
  const entrySize = alignOffset(valueOffset + valueCodec.size, entryAlign);

  return {
    // ArchivedIndexMap: table (12) + entries (4) = 16 bytes
    size: 16,
    align: 4,

    // For IndexMap, access uses decode since Map doesn't benefit from lazy access
    access(reader: RkyvReader, offset: number): Map<K, V> {
      return this.decode(reader, offset);
    },

    decode(reader: RkyvReader, offset: number): Map<K, V> {
      // ArchivedHashTable at offset:
      //   ptr (4) + len (4) + cap (4) = 12 bytes
      // Then entries RelPtr at offset + 12

      // Read len from table (at offset + 4)
      const length = reader.readU32(offset + 4);

      // Read entries pointer (at offset + 12)
      const entriesOffset = reader.readRelPtr32(offset + 12);

      const result = new Map<K, V>();

      let currentOffset = entriesOffset;
      for (let i = 0; i < length; i++) {
        currentOffset = alignOffset(currentOffset, entryAlign);
        const key = keyCodec.decode(reader, currentOffset);
        const value = valueCodec.decode(reader, currentOffset + valueOffset);
        result.set(key, value);
        currentOffset += entrySize;
      }
      return result;
    },

    _archive(writer: RkyvWriter, value: Map<K, V>) {
      if (value.size === 0) {
        return {
          pos: 0,
          entriesPos: 0,
          controlBytesPos: 0,
          len: 0,
          capacity: 0,
        };
      }

      const len = value.size;
      const capacity = capacityFromLen(len);
      const probeCapacity = probeCap(capacity);
      const ctrlCount = controlCount(probeCapacity);

      // Initialize control bytes to empty (0xFF)
      const controlBytes = new Uint8Array(ctrlCount);
      controlBytes.fill(0xff);

      // Initialize bucket indices (0..len as indices into entries array)
      const bucketIndices = new Uint32Array(capacity);

      // First pass: collect entries and compute hash table layout
      const entries: Array<{ key: K; value: V; hash: bigint }> = [];

      let itemIndex = 0;
      for (const [k, v] of value) {
        // Compute hash for string keys
        const hash = typeof k === 'string' ? hashString(writer, k) : 0n;
        entries.push({ key: k, value: v, hash });

        // Insert into Swiss Table using linear probing within capacity
        const h2Hash = h2(hash);
        const initialSlot = Number(hash % BigInt(capacity));

        let slot = initialSlot;
        for (let probe = 0; probe < capacity; probe++) {
          if (controlBytes[slot] === 0xff) {
            controlBytes[slot] = h2Hash;
            // Mirror at end for wraparound reads
            if (slot < ctrlCount - capacity) {
              controlBytes[capacity + slot] = h2Hash;
            }
            bucketIndices[slot] = itemIndex;
            break;
          }
          slot = (slot + 1) % capacity;
        }

        itemIndex++;
      }

      // Step 1: Write buckets (in reverse order, stored BEFORE control bytes)
      writer.align(4);
      for (let i = capacity - 1; i >= 0; i--) {
        writer.writeU32(bucketIndices[i]);
      }

      // Step 2: Write control bytes immediately after buckets
      const controlBytesPos = writer.pos;
      for (let i = 0; i < ctrlCount; i++) {
        writer.writeU8(controlBytes[i]);
      }

      // Step 3: Archive entry dependencies (writes string data for out-of-line strings)
      const entryResolvers: Array<{ keyResolver: Resolver; valueResolver: Resolver }> = [];
      for (const entry of entries) {
        const keyResolver = keyCodec._archive(writer, entry.key);
        const valueResolver = valueCodec._archive(writer, entry.value);
        entryResolvers.push({ keyResolver, valueResolver });
      }

      // Step 4: Write entries array
      writer.align(entryAlign);
      const entriesStartPos = writer.pos;

      for (let i = 0; i < entries.length; i++) {
        writer.align(entryAlign);
        const entryStart = writer.pos;
        keyCodec._resolve(writer, entries[i].key, entryResolvers[i].keyResolver);
        writer.padTo(entryStart + valueOffset);
        valueCodec._resolve(writer, entries[i].value, entryResolvers[i].valueResolver);
        writer.padTo(entryStart + entrySize);
      }

      return {
        pos: entriesStartPos,
        entriesPos: entriesStartPos,
        controlBytesPos,
        len,
        capacity,
      };
    },

    _resolve(writer: RkyvWriter, _value: Map<K, V>, resolver) {
      writer.align(4);
      const structPos = writer.pos;
      const r = resolver as unknown as {
        entriesPos: number;
        controlBytesPos: number;
        len: number;
        capacity: number;
      };

      if (r.len > 0) {
        // Write ArchivedHashTable: ptr (4) + len (4) + cap (4)
        // ptr points to control bytes
        const tablePtrPos = writer.reserveRelPtr32();
        writer.writeU32(r.len);
        writer.writeU32(r.capacity);

        // Write relative pointer to control bytes
        writer.writeRelPtr32At(tablePtrPos, r.controlBytesPos);

        // Write entries RelPtr
        const entriesPtrPos = writer.reserveRelPtr32();
        writer.writeRelPtr32At(entriesPtrPos, r.entriesPos);
      } else {
        // Empty map
        writer.writeI32(0); // null ptr
        writer.writeU32(0); // len
        writer.writeU32(0); // cap
        writer.writeI32(0); // entries ptr (null)
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
 * ArchivedIndexSet layout:
 *
 * struct ArchivedIndexSet<T> {
 *     table: ArchivedHashTable<ArchivedUsize>,  // 12 bytes
 *     entries: RelPtr<T>,                       // 4 bytes
 * }
 *
 * Total: 16 bytes, align: 4
 */

/**
 * indexmap::IndexSet<T> - Insertion-order preserving hash set
 *
 * When archived, IndexSet stores elements in a separate array that preserves
 * insertion order. The Swiss Table is used only for O(1) membership lookups.
 *
 * @example
 * ```typescript
 * import { r } from 'rkyv-js';
 *
 * // IndexSet<String> in Rust
 * const TagsCodec = r.struct({
 *   tags: r.lib.indexSet(r.string),
 * });
 * ```
 */
export function indexSet<T>(element: RkyvCodec<T>): RkyvCodec<Set<T>> {
  // Compute elementStride lazily to support recursive types via r.lazy
  let _elementStride: number | null = null;
  const getElementStride = () => {
    if (_elementStride === null) {
      _elementStride = alignOffset(element.size, element.align);
    }
    return _elementStride;
  };

  return {
    // ArchivedIndexSet: table (12) + entries (4) = 16 bytes
    size: 16,
    align: 4,

    // For IndexSet, access uses decode since Set doesn't benefit from lazy access
    access(reader: RkyvReader, offset: number): Set<T> {
      return this.decode(reader, offset);
    },

    decode(reader: RkyvReader, offset: number): Set<T> {
      // Read len from table (at offset + 4)
      const length = reader.readU32(offset + 4);

      // Read entries pointer (at offset + 12)
      const entriesOffset = reader.readRelPtr32(offset + 12);

      const result = new Set<T>();
      const elementStride = getElementStride();

      let currentOffset = entriesOffset;
      for (let i = 0; i < length; i++) {
        currentOffset = alignOffset(currentOffset, element.align);
        result.add(element.decode(reader, currentOffset));
        currentOffset += elementStride;
      }
      return result;
    },

    _archive(writer: RkyvWriter, value: Set<T>) {
      if (value.size === 0) {
        return {
          pos: 0,
          entriesPos: 0,
          controlBytesPos: 0,
          len: 0,
          capacity: 0,
        };
      }

      const len = value.size;
      const capacity = capacityFromLen(len);
      const probeCapacity = probeCap(capacity);
      const ctrlCount = controlCount(probeCapacity);

      // Initialize control bytes to empty (0xFF)
      const controlBytes = new Uint8Array(ctrlCount);
      controlBytes.fill(0xff);

      // Initialize bucket indices
      const bucketIndices = new Uint32Array(capacity);

      // First pass: collect elements and compute hash table layout
      const elements: Array<{ value: T; hash: bigint }> = [];

      let itemIndex = 0;
      for (const v of value) {
        // Compute hash for string elements
        const hash = typeof v === 'string' ? hashString(writer, v) : 0n;
        elements.push({ value: v, hash });

        // Insert into Swiss Table using linear probing within capacity
        const h2Hash = h2(hash);
        const initialSlot = Number(hash % BigInt(capacity));

        let slot = initialSlot;
        for (let probe = 0; probe < capacity; probe++) {
          if (controlBytes[slot] === 0xff) {
            controlBytes[slot] = h2Hash;
            // Mirror at end for wraparound reads
            if (slot < ctrlCount - capacity) {
              controlBytes[capacity + slot] = h2Hash;
            }
            bucketIndices[slot] = itemIndex;
            break;
          }
          slot = (slot + 1) % capacity;
        }

        itemIndex++;
      }

      // Step 1: Write buckets (in reverse order, stored BEFORE control bytes)
      writer.align(4);
      for (let i = capacity - 1; i >= 0; i--) {
        writer.writeU32(bucketIndices[i]);
      }

      // Step 2: Write control bytes
      const controlBytesPos = writer.pos;
      for (let i = 0; i < ctrlCount; i++) {
        writer.writeU8(controlBytes[i]);
      }

      // Step 3: Archive element dependencies (writes string data for out-of-line strings)
      const elementResolvers: Resolver[] = [];
      for (const elem of elements) {
        elementResolvers.push(element._archive(writer, elem.value));
      }

      // Step 4: Write entries array
      writer.align(element.align);
      const entriesStartPos = writer.pos;

      for (let i = 0; i < elements.length; i++) {
        writer.align(element.align);
        element._resolve(writer, elements[i].value, elementResolvers[i]);
      }

      return {
        pos: entriesStartPos,
        entriesPos: entriesStartPos,
        controlBytesPos,
        len,
        capacity,
      };
    },

    _resolve(writer: RkyvWriter, _value: Set<T>, resolver) {
      writer.align(4);
      const structPos = writer.pos;
      const r = resolver as unknown as {
        entriesPos: number;
        controlBytesPos: number;
        len: number;
        capacity: number;
      };

      if (r.len > 0) {
        // Write ArchivedHashTable: ptr (4) + len (4) + cap (4)
        const tablePtrPos = writer.reserveRelPtr32();
        writer.writeU32(r.len);
        writer.writeU32(r.capacity);

        // Write relative pointer to control bytes
        writer.writeRelPtr32At(tablePtrPos, r.controlBytesPos);

        // Write entries RelPtr
        const entriesPtrPos = writer.reserveRelPtr32();
        writer.writeRelPtr32At(entriesPtrPos, r.entriesPos);
      } else {
        writer.writeI32(0);
        writer.writeU32(0);
        writer.writeU32(0);
        writer.writeI32(0);
      }

      return structPos;
    },

    encode(writer: RkyvWriter, value: Set<T>): number {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}
