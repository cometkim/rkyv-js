/**
 * User-provided codec for the remote type `Coord`.
 *
 * On the Rust side, `Coord` is serialized as a JSON string via the `AsJson`
 * ArchiveWith wrapper. The archived form is `ArchivedString` — a standard
 * rkyv string (relative pointer + length) containing UTF-8 JSON text like
 * `{"x":1.5,"y":-2.25}`.
 *
 * This codec delegates to `r.string` for binary I/O and adds JSON
 * parse/stringify on top. This proves the custom codec is truly arbitrary
 * — not tied to rkyv's struct layout.
 */

import type { RkyvCodec } from 'rkyv-js/codec';
import type { RkyvReader } from 'rkyv-js/reader';
import type { RkyvWriter } from 'rkyv-js/writer';
import { string } from 'rkyv-js/primitives';

export interface Coord {
  x: number;
  y: number;
}

export const Coord: RkyvCodec<Coord> = {
  // Same as ArchivedString layout
  size: string.size,
  align: string.align,

  access(reader: RkyvReader, offset: number): Coord {
    const json = string.access(reader, offset);
    return JSON.parse(json);
  },

  decode(reader: RkyvReader, offset: number): Coord {
    const json = string.decode(reader, offset);
    return JSON.parse(json);
  },

  _archive(writer: RkyvWriter, value: Coord) {
    const json = JSON.stringify(value);
    return string._archive(writer, json);
  },

  _resolve(writer: RkyvWriter, value: Coord, resolver) {
    const json = JSON.stringify(value);
    return string._resolve(writer, json, resolver);
  },

  encode(writer: RkyvWriter, value: Coord) {
    const json = JSON.stringify(value);
    return string.encode(writer, json);
  },
};
