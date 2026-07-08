/**
 * Shared Set-over-Map derivation.
 *
 * Rust's set collections archive exactly as their map counterparts with unit
 * values (`HashSet<T>` = `HashMap<T, ()>`, etc.), so every set codec is a
 * thin wrapper converting between `Set<T>` and `Map<T, null>` around a map
 * codec built first.
 */

import {
  Codec,
  type Layout,
  type RkyvFormat,
  type RkyvReader,
  type RkyvWriter,
} from 'rkyv-js/core';

// Map codecs only consult the resolver in `resolve`, never the value.
const EMPTY_MAP: Map<unknown, null> = new Map<unknown, null>();

export class SetOfMapCodec<T, R> extends Codec<Set<T>, R> {
  #map: Codec<Map<T, null>, R>;

  constructor(map: Codec<Map<T, null>, R>) {
    super({ inline: false, hashable: false });
    this.#map = map;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#map.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): Set<T> {
    return new Set(this.#map.read(reader, offset).keys());
  }

  archive(writer: RkyvWriter, value: Set<T>): R {
    const map = new Map<T, null>();
    for (const item of value) {
      map.set(item, null);
    }
    return this.#map.archive(writer, map);
  }

  resolve(writer: RkyvWriter, _value: Set<T>, resolver: R): number {
    return this.#map.resolve(writer, EMPTY_MAP as Map<T, null>, resolver);
  }
}
