import { type RkyvCodec } from 'rkyv-js/codec';
import { unit } from 'rkyv-js/primitives';

import { hashMap } from './std-hash-map.ts';

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
