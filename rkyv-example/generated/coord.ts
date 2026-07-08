/**
 * Hand-written codec for the remote `Coord` type (src/remote.rs).
 *
 * The Rust side archives `Coord` through the `AsJson` wrapper
 * (src/lib.rs), so the wire representation is an rkyv string containing
 * JSON text. This codec mirrors that: decode parses the JSON, encode
 * stringifies it back.
 */

import * as r from 'rkyv-js';

export interface CoordValue {
  x: number;
  y: number;
}

export const Coord: r.Codec<CoordValue> = r.transform(
  r.string,
  (json) => JSON.parse(json) as CoordValue,
  (coord) => JSON.stringify(coord),
);
