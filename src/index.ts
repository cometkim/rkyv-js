/**
 * rkyv-js: A TypeScript codec library for rkyv (Rust zero-copy deserialization framework)
 *
 * This library allows you to encode and decode rkyv-serialized binary data in TypeScript/JavaScript.
 * It provides codecs for primitive types, strings, vectors, options, and custom structs/enums.
 *
 * @example
 * ```typescript
 * import { access, toBytes, struct, string, u32, vec } from 'rkyv-js';
 *
 * // Define the schema matching your Rust struct
 * const PersonCodec = struct({
 *   decoder: string,
 *   encoder: stringEncoder,
 * });
 *
 * // Decode from rkyv bytes
 * const person = access(bytes, PersonDecoder);
 * console.log(person.name, person.age);
 *
 * // Encode to rkyv bytes
 * const bytes = toBytes(person, PersonEncoder);
 * ```
 *
 * @packageDocumentation
 */

export { RkyvReader, DEFAULT_CONFIG } from './reader.js';
export type { RkyvConfig } from './reader.js';

export type { RkyvDecoder } from './types.js';

export {
  // Primitive types
  u8,
  i8,
  u16,
  i16,
  u32,
  i32,
  u64,
  i64,
  f32,
  f64,
  bool,
  unit,
  char,
  // Container types
  string,
  vec,
  option,
  box as box_,
  array,
  tuple,
  // Utilities
  alignOffset,
} from './types.js';

export {
  struct,
  enumType,
  newtype,
  hashMap,
  map,
  lazy,
  union,
  taggedUnion,
} from './schema.js';

export type { FieldDef, VariantDef, EnumValue, UnionValue, UnionDecoder } from './schema.js';

// === Encoder exports ===

export { RkyvWriter } from './writer.js';
export type { Resolver, StringResolver, VecResolver } from './writer.js';

export type { RkyvEncoder } from './encoder.js';
export {
  // Primitive encoders
  u8Encoder,
  i8Encoder,
  u16Encoder,
  i16Encoder,
  u32Encoder,
  i32Encoder,
  u64Encoder,
  i64Encoder,
  f32Encoder,
  f64Encoder,
  boolEncoder,
  unitEncoder,
  charEncoder,
  // Container encoders
  stringEncoder,
  vecEncoder,
  optionEncoder,
  boxEncoder,
  arrayEncoder,
  tupleEncoder,
} from './encoder.js';

export {
  structEncoder,
  enumEncoder,
  unionEncoder,
  taggedUnionEncoder,
} from './schema-encoder.js';

export type { UnionEncoderType } from './schema-encoder.js';

import { RkyvReader } from './reader.js';
import { RkyvWriter } from './writer.js';
import { RkyvDecoder } from './types.js';
import { RkyvEncoder } from './encoder.js';

/**
 * Access (decode) the root object from an rkyv archive.
 *
 * In rkyv, objects are laid out depth-first from leaves to root,
 * so the root object is at the end of the buffer.
 *
 * @param buffer - The rkyv-serialized bytes
 * @param decoder - The decoder for the root type
 * @returns The decoded value
 *
 * @example
 * ```typescript
 * const data = access(bytes, MyStructDecoder);
 * ```
 */
export function access<T>(
  buffer: ArrayBuffer | Uint8Array,
  decoder: RkyvDecoder<T>
): T {
  const reader = new RkyvReader(buffer);
  const rootPosition = reader.getRootPosition(decoder.size);
  return decoder.decode(reader, rootPosition);
}

/**
 * Access (decode) an object at a specific offset in the buffer.
 *
 * This is useful when you know the exact position of the object,
 * or when dealing with nested structures manually.
 *
 * @param buffer - The rkyv-serialized bytes
 * @param decoder - The decoder for the type
 * @param offset - The byte offset where the object is located
 * @returns The decoded value
 */
export function accessAt<T>(
  buffer: ArrayBuffer | Uint8Array,
  decoder: RkyvDecoder<T>,
  offset: number
): T {
  const reader = new RkyvReader(buffer);
  return decoder.decode(reader, offset);
}

/**
 * Create a reusable archive accessor.
 *
 * This is more efficient when you need to decode multiple values
 * from the same buffer.
 *
 * @param buffer - The rkyv-serialized bytes
 * @returns An accessor object with methods to decode values
 *
 * @example
 * ```typescript
 * const archive = createArchive(bytes);
 * const root = archive.root(MyStructDecoder);
 * const nested = archive.at(someOffset, NestedDecoder);
 * ```
 */
export function createArchive(buffer: ArrayBuffer | Uint8Array) {
  const reader = new RkyvReader(buffer);

  return {
    /**
     * The underlying reader for advanced use cases.
     */
    reader,

    /**
     * The length of the buffer in bytes.
     */
    get length() {
      return reader.length;
    },

    /**
     * Decode the root object.
     */
    root<T>(decoder: RkyvDecoder<T>): T {
      const rootPosition = reader.getRootPosition(decoder.size);
      return decoder.decode(reader, rootPosition);
    },

    /**
     * Decode an object at a specific offset.
     */
    at<T>(offset: number, decoder: RkyvDecoder<T>): T {
      return decoder.decode(reader, offset);
    },
  };
}

/**
 * Utility type: Infer the TypeScript type from a decoder.
 *
 * @example
 * ```typescript
 * const PersonDecoder = struct({
 *   name: { decoder: string },
 *   age: { decoder: u32 },
 * });
 *
 * type Person = Infer<typeof PersonDecoder>;
 * // { name: string; age: number }
 * ```
 */
export type Infer<D> = D extends RkyvDecoder<infer T> ? T : never;

// === Encoding Functions ===

/**
 * Serialize a value to rkyv bytes.
 *
 * @param value - The value to serialize
 * @param encoder - The encoder for the type
 * @returns A Uint8Array containing the serialized data
 *
 * @example
 * ```typescript
 * const bytes = toBytes({ x: 10, y: 20 }, PointEncoder);
 * ```
 */
export function toBytes<T>(value: T, encoder: RkyvEncoder<T>): Uint8Array {
  const writer = new RkyvWriter();
  encoder.encode(writer, value);
  return writer.finish();
}

/**
 * Serialize a value using a provided writer.
 * Returns the position where the root object was written.
 *
 * @param writer - The writer to use
 * @param value - The value to serialize
 * @param encoder - The encoder for the type
 * @returns The position of the root object
 */
export function serialize<T>(
  writer: RkyvWriter,
  value: T,
  encoder: RkyvEncoder<T>
): number {
  return encoder.encode(writer, value);
}
