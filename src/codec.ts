import { RkyvReader } from './reader.ts';
import { RkyvWriter } from './writer.ts';

/**
 * Resolver holds the position of archived data written during serialization.
 * This is used to compute relative pointers when the containing struct is written.
 */
export interface Resolver {
  /**
   * The position where the archived data was written.
   */
  pos: number;
}

/**
 * String resolver containing the position of string bytes.
 */
export interface StringResolver extends Resolver {
  len: number;
}

/**
 * Vec resolver containing the position of array elements.
 */
export interface VecResolver extends Resolver {
  len: number;
}

/**
 * A codec that can both encode and decode a type T.
 */
export interface RkyvCodec<T> {
  /** Size in bytes of the archived representation */
  readonly size: number;
  /** Alignment requirement */
  readonly align: number;

  /**
   * Lazy access - returns a lazy proxy that decodes fields on demand.
   * This is the most efficient way to read a large rkyv data when you don't need all fields.
   */
  access(reader: RkyvReader, offset: number): T;

  /**
   * Decode rkyv data into a plain object.
   */
  decode(reader: RkyvReader, offset: number): T;

  /** Encode value, writing dependencies first, then the value */
  encode(writer: RkyvWriter, value: T): number;

  // Internal methods for two-phase serialization
  /** @internal Archive dependencies and return resolver */
  _archive(writer: RkyvWriter, value: T): Resolver;
  /** @internal Write the value using resolver */
  _resolve(writer: RkyvWriter, value: T, resolver: Resolver): number;
}

/**
 * Infer the TypeScript type from a codec.
 */
export type Infer<C> = C extends RkyvCodec<infer T> ? T : never;

/**
 * Align an offset to the given alignment
 */
export function alignOffset(offset: number, align: number): number {
  const remainder = offset % align;
  return remainder === 0 ? offset : offset + (align - remainder);
}

/**
 * Lazy access to the root value from rkyv bytes.
 *
 * Returns a lazy Proxy that decodes fields only when accessed.
 * This is the most efficient method when you don't need all fields.
 *
 * Note: The returned object is a Proxy and may not work with all serialization
 * or deep-comparison utilities. Use `decode()` if you need a plain object.
 *
 * @example
 * ```typescript
 * const person = r.access(Person, bytes);
 * console.log(person.name); // Only 'name' is decoded
 * ```
 */
export function access<T>(codec: RkyvCodec<T>, bytes: ArrayBuffer | Uint8Array): T {
  const reader = new RkyvReader(bytes);
  const rootPosition = reader.getRootPosition(codec.size);
  return codec.access(reader, rootPosition);
}

/**
 * Eagerly decode the root value from rkyv bytes into a plain object.
 *
 * Use this when you need all fields or when passing to code that
 * doesn't work well with Proxies (serialization, deep equality, etc.).
 *
 * @example
 * ```typescript
 * const person = r.decode(Person, bytes);
 * ```
 */
export function decode<T>(codec: RkyvCodec<T>, bytes: ArrayBuffer | Uint8Array): T {
  const reader = new RkyvReader(bytes);
  const rootPosition = reader.getRootPosition(codec.size);
  return codec.decode(reader, rootPosition);
}

/**
 * Encode a value to rkyv bytes.
 *
 * @example
 * ```typescript
 * const bytes = r.encode(Person, { name: 'Alice', age: 30 });
 * ```
 */
export function encode<T>(codec: RkyvCodec<T>, value: T): Uint8Array {
  const writer = new RkyvWriter();
  codec.encode(writer, value);
  return writer.finish();
}
