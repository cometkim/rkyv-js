/**
 * Shared Set-over-Map derivation, write half.
 *
 * Rust's set collections archive exactly as their map counterparts with unit
 * values (`HashSet<T>` = `HashMap<T, ()>`, etc.), so every set encoder is a
 * thin wrapper converting between `Set<T>` and `Map<T, null>` around a map
 * encoder built first.
 */

import {
  BaseEncoder,
  type Encoder,
  type Layout,
  type RkyvFormat,
  type RkyvWriter,
} from 'rkyv-js/core';

// Map codecs only consult the resolver in `resolve`, never the value.
const EMPTY_MAP: Map<unknown, null> = new Map<unknown, null>();

export class SetOfMapEncoder<T, R> extends BaseEncoder<Set<T>, R> {
  #map: Encoder<Map<T, null>, R>;

  constructor(map: Encoder<Map<T, null>, R>) {
    super({ inline: false, hashable: false });
    this.#map = map;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#map.layout(fmt);
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
