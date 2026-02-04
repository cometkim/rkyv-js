import { type RkyvCodec } from 'rkyv-js/codec';
import { unit } from 'rkyv-js/primitives';

import { btreeMap } from './std-btree-map.ts';

/**
 * BTreeSet<T> - rkyv's B-tree set
 *
 * Implemented as BTreeMap<T, ()> since BTreeSet is just a map with unit values.
 * The unit type has size 0, so the entry layout is just the key.
 */
export function btreeSet<T>(element: RkyvCodec<T>, E: number = 5): RkyvCodec<Set<T>> {
  // Use BTreeMap<T, ()> internally
  const mapCodec = btreeMap(element, unit, E);

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
