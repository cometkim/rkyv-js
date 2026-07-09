/**
 * std::collections::HashMap / HashSet decoders (also hashbrown's).
 *
 * The archived format is rkyv's `ArchivedHashTable<Entry<K, V>>`:
 *
 * - header: ptr (RelPtr to control bytes) + len + cap, each pointer-width
 * - bucket entries stored BEFORE the control bytes: slot `i` lives at
 *   `controlBytes - (i + 1) * entrySize`; empty buckets are zero-filled
 * - control bytes: one byte per slot (0xff empty, else h2), rounded up to
 *   the probe group width, with early bytes mirrored past `capacity`
 *
 * Reading walks the control bytes and never hashes, so the read factories
 * take no hasher option and keys are not required to be hashable — the
 * swiss-table builder and the fxhash implementation live entirely on the
 * encode side (`./hashmap.encode.ts`).
 */

import {
  alignOffset,
  BaseDecoder,
  type Decoder,
  type AnyDecoder,
  type Infer,
  type Layout,
  type RkyvFormat,
  type RkyvReader,
} from 'rkyv-js/core';

import { unit } from '../decode.ts';
import { SetOfMapDecoder } from './internal/map-set.decode.ts';

export interface TableLayout extends Layout {
  pb: 2 | 4 | 8;
}

interface EntryGeometry {
  entryAlign: number;
  valueOffset: number;
  entrySize: number;
}

export class HashMapDecoder<K, V> extends BaseDecoder<Map<K, V>, TableLayout> {
  #key: Decoder<K>;
  #value: Decoder<V>;
  #geometryFormat: RkyvFormat | null = null;
  #geometry: EntryGeometry | null = null;

  constructor(keyCodec: Decoder<K>, valueCodec: Decoder<V>) {
    super({ inline: false, hashable: false });
    this.#key = keyCodec;
    this.#value = valueCodec;
  }

  // Header layout never depends on the entry types (maps are valid recursion
  // points in Rust); entry geometry is memoized separately and computed only
  // at read time.
  computeLayout(fmt: RkyvFormat): TableLayout {
    const pb = (fmt.pointerWidth / 8) as 2 | 4 | 8;
    return { size: pb * 3, align: fmt.aligned ? pb : 1, pb };
  }

  #entryGeometry(fmt: RkyvFormat): EntryGeometry {
    if (fmt !== this.#geometryFormat) {
      const k = this.#key.layout(fmt);
      const v = this.#value.layout(fmt);
      const entryAlign = Math.max(k.align, v.align);
      const valueOffset = alignOffset(k.size, v.align);
      this.#geometry = {
        entryAlign,
        valueOffset,
        entrySize: alignOffset(valueOffset + v.size, entryAlign),
      };
      this.#geometryFormat = fmt;
    }
    return this.#geometry as EntryGeometry;
  }

  read(reader: RkyvReader, offset: number): Map<K, V> {
    const l = this.layout(reader.format);
    const result = new Map<K, V>();
    const length = reader.readUsize(offset + l.pb);
    if (length === 0) return result;

    const g = this.#entryGeometry(reader.format);
    const capacity = reader.readUsize(offset + l.pb * 2);
    const controlBytesOffset = reader.readRelPtr(offset);

    let remaining = length;
    for (let slot = 0; slot < capacity && remaining > 0; slot++) {
      if (reader.readU8(controlBytesOffset + slot) < 0x80) {
        const entryOffset = controlBytesOffset - (slot + 1) * g.entrySize;
        result.set(
          this.#key.read(reader, entryOffset),
          this.#value.read(reader, entryOffset + g.valueOffset),
        );
        remaining--;
      }
    }
    return result;
  }
}

/**
 * HashMap<K, V> — rkyv's swiss-table hash map (read half).
 *
 * Reading never hashes keys, so there is no hasher option: archives written
 * with any `H` decode identically.
 */
export function hashMap<K extends AnyDecoder, V extends AnyDecoder>(
  keyCodec: K,
  valueCodec: V,
): Decoder<Map<Infer<K>, Infer<V>>> {
  return new HashMapDecoder(keyCodec, valueCodec);
}

/**
 * HashSet<T> — a thin wrapper over `HashMap<T, ()>` (the archived formats
 * are identical; unit values are zero-sized).
 */
export function hashSet<E extends AnyDecoder>(element: E): Decoder<Set<Infer<E>>> {
  return new SetOfMapDecoder(new HashMapDecoder<Infer<E>, null>(element, unit));
}
