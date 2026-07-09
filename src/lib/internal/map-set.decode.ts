/**
 * Shared Set-over-Map derivation, read half.
 *
 * Rust's set collections archive exactly as their map counterparts with unit
 * values (`HashSet<T>` = `HashMap<T, ()>`, etc.), so every set decoder is a
 * thin wrapper converting the keys of an archived `Map<T, null>` into a
 * `Set<T>` around a map decoder built first.
 */

import {
  BaseDecoder,
  type Decoder,
  type Layout,
  type RkyvFormat,
  type RkyvReader,
} from 'rkyv-js/core';

export class SetOfMapDecoder<T> extends BaseDecoder<Set<T>> {
  #map: Decoder<Map<T, null>>;

  constructor(map: Decoder<Map<T, null>>) {
    super({ inline: false, hashable: false });
    this.#map = map;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#map.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): Set<T> {
    return new Set(this.#map.read(reader, offset).keys());
  }
}
