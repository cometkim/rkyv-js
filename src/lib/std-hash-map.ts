import { alignOffset, type RkyvCodec, type Resolver } from 'rkyv-js/codec';

/**
 * HashMap<K, V> - rkyv's hashbrown-based hash map
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
    size: 8, // relptr (4) + len (4)
    align: 4,

    // For HashMap, access uses decode since Map doesn't benefit from lazy access
    // (iterating a Map requires accessing all entries anyway)
    access(reader, offset) {
      return this.decode(reader, offset);
    },

    decode(reader, offset) {
      const dataOffset = reader.readRelPtr32(offset);
      const length = reader.readU32(offset + 4);
      const result = new Map<K, V>();

      let currentOffset = dataOffset;
      for (let i = 0; i < length; i++) {
        currentOffset = alignOffset(currentOffset, entryAlign);
        const key = keyCodec.decode(reader, currentOffset);
        const value = valueCodec.decode(reader, currentOffset + valueOffset);
        result.set(key, value);
        currentOffset += entrySize;
      }
      return result;
    },

    _archive(writer, value) {
      if (value.size === 0) {
        return { pos: writer.pos, len: 0, entries: [] };
      }

      const entries: Array<{ key: K; value: V; keyResolver: Resolver; valueResolver: Resolver }> = [];
      for (const [k, v] of value) {
        entries.push({
          key: k,
          value: v,
          keyResolver: keyCodec._archive(writer, k),
          valueResolver: valueCodec._archive(writer, v),
        });
      }

      writer.align(entryAlign);
      const entriesStartPos = writer.pos;

      for (const entry of entries) {
        writer.align(entryAlign);
        keyCodec._resolve(writer, entry.key, entry.keyResolver);
        writer.padTo(writer.pos + valueOffset - keyCodec.size);
        valueCodec._resolve(writer, entry.value, entry.valueResolver);
        writer.padTo(writer.pos + entrySize - valueOffset - valueCodec.size);
      }

      return { pos: entriesStartPos, len: value.size, entries };
    },

    _resolve(writer, _value, resolver) {
      writer.align(4);
      const structPos = writer.pos;
      const ptrPos = writer.reserveRelPtr32();
      const r = resolver as { pos: number; len: number };
      writer.writeU32(r.len);

      if (r.len > 0) {
        writer.writeRelPtr32At(ptrPos, r.pos);
      } else {
        writer.writeRelPtr32At(ptrPos, 0);
      }
      return structPos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}
