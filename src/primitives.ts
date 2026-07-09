/**
 * Intrinsic codecs for rkyv-js
 *
 * This module provides all built-in codecs:
 * - Primitives: u8, i8, u16, i16, u32, i32, u64, i64, f32, f64, bool, unit, char, string
 * - Containers: vec, option, box, array, tuple
 * - Structs & Enums: struct, taggedEnum, union
 * - Smart pointers: rc, weak
 * - Utilities: transform, newtype, lazy
 *
 * Every codec is a self-contained {@link Codec}: encode/decode/access live on
 * the codec object itself, so generated bindings need no extra imports.
 *
 * The logic lives once per direction: each full codec here EXTENDS its
 * read class from `./decode.ts` and CONTAINS its encode class from
 * `./encode.ts`, delegating `archive`/`resolve`/`hash` to it. One-direction
 * consumers import those modules directly instead.
 */

import {
  encodeIntoWriter,
  encodePooled,
  type AnyCodec,
  type Codec,
  type Infer,
} from './core/codec.ts';
import { DEFAULT_FORMAT, type RkyvFormat } from './core/format.ts';
import type { RkyvHasher } from './core/hasher.ts';
import type { RkyvReader } from './core/reader.ts';
import type { RkyvTextEncoder, RkyvWriter } from './core/writer.ts';
import {
  ArrayDecoder,
  BoxDecoder,
  EnumDecoder,
  LazyDecoder,
  Kind,
  OptionDecoder,
  PrimitiveDecoder,
  StringDecoder,
  StructDecoder,
  TransformDecoder,
  TupleDecoder,
  UnionDecoder,
  VecDecoder,
  WeakDecoder,
  type PrimitiveKindTag,
} from './decode.ts';
import {
  ArrayEncoder,
  BoxEncoder,
  EnumEncoder,
  LazyEncoder,
  OptionEncoder,
  PrimitiveEncoder,
  StringEncoder,
  StructEncoder,
  TransformEncoder,
  TupleEncoder,
  UnionEncoder,
  VecEncoder,
  WeakEncoder,
  type PtrResolver,
  type StringResolver,
  type VecResolver,
} from './encode.ts';

// ============================================================================
// Primitive Codecs
// ============================================================================

export class PrimitiveCodec<T> extends PrimitiveDecoder<T> {
  #write: PrimitiveEncoder<T>;

  constructor(
    size: number,
    align: number,
    kind: PrimitiveKindTag,
    read: (reader: RkyvReader, offset: number) => T,
    write: (writer: RkyvWriter, value: T) => number,
    // Primitive hashes never involve text, so the encoder is not threaded.
    hash?: (hasher: RkyvHasher, value: T) => void,
  ) {
    super(size, align, kind, read, hash !== undefined);
    this.#write = new PrimitiveEncoder(size, align, kind, write, hash);
  }

  archive(writer: RkyvWriter, value: T): undefined {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: undefined): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

// Integer codecs. `hash` mirrors Rust's `Hash` impls: unsigned ints write
// their value; signed ints forward with a two's-complement cast.
export const u8: Codec<number> = new PrimitiveCodec(1, 1, Kind.u8, (r, o) => r.readU8(o), (w, v) => w.writeU8(v), (h, v) => h.writeU8(v));
export const i8: Codec<number> = new PrimitiveCodec(1, 1, Kind.i8, (r, o) => r.readI8(o), (w, v) => w.writeI8(v), (h, v) => h.writeU8(v & 0xff));
export const u16: Codec<number> = new PrimitiveCodec(2, 2, Kind.u16, (r, o) => r.readU16(o), (w, v) => w.writeU16(v), (h, v) => h.writeU16(v));
export const i16: Codec<number> = new PrimitiveCodec(2, 2, Kind.i16, (r, o) => r.readI16(o), (w, v) => w.writeI16(v), (h, v) => h.writeU16(v & 0xffff));
export const u32: Codec<number> = new PrimitiveCodec(4, 4, Kind.u32, (r, o) => r.readU32(o), (w, v) => w.writeU32(v), (h, v) => h.writeU32(v));
export const i32: Codec<number> = new PrimitiveCodec(4, 4, Kind.i32, (r, o) => r.readI32(o), (w, v) => w.writeI32(v), (h, v) => h.writeU32(v));
export const u64: Codec<bigint> = new PrimitiveCodec(8, 8, Kind.u64, (r, o) => r.readU64(o), (w, v) => w.writeU64(v), (h, v) => h.writeU64(v));
export const i64: Codec<bigint> = new PrimitiveCodec(8, 8, Kind.i64, (r, o) => r.readI64(o), (w, v) => w.writeI64(v), (h, v) => h.writeU64(v));

// Float codecs (floats are not `Eq` in Rust, so they never hash).
export const f32: Codec<number> = new PrimitiveCodec(4, 4, Kind.f32, (r, o) => r.readF32(o), (w, v) => w.writeF32(v));
export const f64: Codec<number> = new PrimitiveCodec(8, 8, Kind.f64, (r, o) => r.readF64(o), (w, v) => w.writeF64(v));

// Boolean codec.
export const bool: Codec<boolean> = new PrimitiveCodec(
  1,
  1,
  Kind.bool,
  (r, o) => r.readBool(o),
  (w, v) => w.writeBool(v),
  (h, v) => h.writeU8(v ? 1 : 0),
);

// Unit codec — zero-sized; hashing is a no-op, exactly like `Hash for ()`.
export const unit: Codec<null> = new PrimitiveCodec<null>(
  0,
  1,
  Kind.other,
  () => null,
  (w) => w.pos,
  () => {},
);

function codePoint(value: string): number {
  const cp = value.codePointAt(0);
  if (cp === undefined || value.length !== (cp > 0xffff ? 2 : 1)) {
    throw new Error(`char codec expects exactly one Unicode scalar value, got ${JSON.stringify(value)}`);
  }
  return cp;
}

// Char codec — a Unicode scalar value stored as u32 (`Kind.other`:
// bulk paths cannot batch it because reading materializes a string).
export const char: Codec<string> = new PrimitiveCodec(
  4,
  4,
  Kind.other,
  (r, o) => String.fromCodePoint(r.readU32(o)),
  (w, v) => w.writeU32(codePoint(v)),
  (h, v) => h.writeU32(codePoint(v)),
);

// ============================================================================
// String Codec (rkyv 0.8 inline/out-of-line hybrid repr)
// ============================================================================

export class StringCodec extends StringDecoder {
  #write: StringEncoder = new StringEncoder();

  archive(writer: RkyvWriter, value: string): StringResolver {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: string, resolver: StringResolver): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: string, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: string, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: string): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

export const string: Codec<string> = new StringCodec();

// ============================================================================
// Vec<T>
// ============================================================================

export class VecCodec<T> extends VecDecoder<T> {
  #write: VecEncoder<T>;

  constructor(element: Codec<T>) {
    super(element);
    // The write delegate derives its bulk-path kind from the element's own
    // meta, so full-codec elements (which extend the read chain) work as-is.
    this.#write = new VecEncoder(element);
  }

  archive(writer: RkyvWriter, value: T[]): VecResolver {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T[], resolver: VecResolver): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T[], encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T[], format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T[]): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Vec<T> — variable-length sequence (also `VecDeque`, `ThinVec`, `SmallVec`,
 * `ArrayVec`, `TinyVec` — they all archive to `ArchivedVec`).
 */
export function vec<C extends AnyCodec>(element: C): Codec<Infer<C>[]> {
  return new VecCodec(element);
}

// ============================================================================
// Option<T>
// ============================================================================

export class OptionCodec<T> extends OptionDecoder<T> {
  #write: OptionEncoder<T>;

  constructor(inner: Codec<T>) {
    super(inner);
    this.#write = new OptionEncoder(inner);
  }

  archive(writer: RkyvWriter, value: T | null): unknown {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T | null, resolver: unknown): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T | null, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T | null, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T | null): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Option<T> — tag byte followed by the padded value.
 */
export function option<C extends AnyCodec>(inner: C): Codec<Infer<C> | null> {
  return new OptionCodec(inner);
}

// ============================================================================
// Box<T> / Rc<T> / Arc<T> / Weak<T>
// ============================================================================

export class BoxCodec<T> extends BoxDecoder<T> {
  #write: BoxEncoder<T>;

  constructor(inner: Codec<T>) {
    super(inner);
    this.#write = new BoxEncoder(inner);
  }

  archive(writer: RkyvWriter, value: T): PtrResolver {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: PtrResolver): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Box<T> — an owned pointer to out-of-line data.
 */
export function box<C extends AnyCodec>(inner: C): Codec<Infer<C>> {
  return new BoxCodec(inner);
}

/**
 * Rc<T> / Arc<T> — reference-counted pointers.
 *
 * In rkyv these archive to the same format as `Box<T>`. Note that rkyv
 * deduplicates shared pointers on the Rust side; rkyv-js writes one copy per
 * occurrence (semantically equivalent, not byte-identical for shared data).
 *
 * @alias box
 */
export const rc: typeof box = box;

export class WeakCodec<T> extends WeakDecoder<T> {
  #write: WeakEncoder<T>;

  constructor(inner: Codec<T>) {
    super(inner);
    this.#write = new WeakEncoder(inner);
  }

  archive(writer: RkyvWriter, value: T | null): PtrResolver | null {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T | null, resolver: PtrResolver | null): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T | null, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T | null, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T | null): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Weak<T> — `rc::Weak` / `sync::Weak`; `null` when the pointer is dead.
 */
export function weak<C extends AnyCodec>(inner: C): Codec<Infer<C> | null> {
  return new WeakCodec(inner);
}

// ============================================================================
// [T; N] — fixed-size array
// ============================================================================

export class ArrayCodec<T> extends ArrayDecoder<T> {
  #write: ArrayEncoder<T>;

  constructor(element: Codec<T>, length: number) {
    super(element, length);
    this.#write = new ArrayEncoder(element, length);
  }

  archive(writer: RkyvWriter, value: T[]): unknown[] | undefined {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T[], resolver: unknown[] | undefined): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T[], encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T[], format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T[]): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * [T; N] — fixed-size array.
 */
export function array<C extends AnyCodec>(element: C, length: number): Codec<Infer<C>[]> {
  return new ArrayCodec(element, length);
}

// ============================================================================
// Tuple
// ============================================================================

export class TupleCodec<T extends unknown[]> extends TupleDecoder<T> {
  #write: TupleEncoder<T>;

  constructor(codecs: AnyCodec[]) {
    super(codecs);
    this.#write = new TupleEncoder(codecs);
  }

  archive(writer: RkyvWriter, value: T): unknown[] | undefined {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: unknown[] | undefined): number {
    return this.#write.resolve(writer, value, resolver);
  }

  // Hash for tuples hashes fields in order with no prefix.
  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * (T1, T2, ...) — heterogeneous fixed-size collection.
 */
export function tuple<const C extends AnyCodec[]>(
  ...codecs: C
): Codec<{ [K in keyof C]: Infer<C[K]> }> {
  return new TupleCodec(codecs);
}

// ============================================================================
// Struct
// ============================================================================

export interface StructField {
  readonly name: string;
  readonly codec: AnyCodec;
}

/**
 * Struct — C-style struct with named fields. Exposes `fields` so enum codecs
 * can flatten variant bodies into rkyv's `repr(u8)` enum layout.
 */
export class StructCodec<T extends Record<string, unknown>> extends StructDecoder<T> {
  // Narrows the inherited read-side field list: fields of a full struct
  // codec are full codecs (this is what the constructor was given).
  declare readonly fields: readonly StructField[];
  #write: StructEncoder<T>;

  constructor(fields: { [K in keyof T]: Codec<T[K]> }) {
    super(fields);
    this.#write = new StructEncoder(fields);
  }

  archive(writer: RkyvWriter, value: T): unknown[] | undefined {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: unknown[] | undefined): number {
    return this.#write.resolve(writer, value, resolver);
  }

  // #[derive(Hash)] hashes fields in declaration order with no prefix.
  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Struct — C-style struct with named fields.
 *
 * @example
 * ```typescript
 * const Point = r.struct({
 *   x: r.f64,
 *   y: r.f64,
 * });
 * ```
 */
export function struct<F extends Record<string, AnyCodec>>(
  fields: F
): StructCodec<{ [K in keyof F]: Infer<F[K]> }> {
  type T = { [K in keyof F]: Infer<F[K]> };
  return new StructCodec<T>(fields as unknown as { [K in keyof T]: Codec<T[K]> });
}

// ============================================================================
// Tagged enum
// ============================================================================

/**
 * A tagged-enum variant definition:
 * - `null` — unit variant
 * - an array of codecs — tuple variant (`Color: [r.u8, r.u8, r.u8]`),
 *   valued as an array; a single-element array is a newtype variant
 * - a record of codecs — struct variant (`Move: { x: r.i32, y: r.i32 }`)
 * - a struct codec — struct variant, fields flattened into the enum layout
 * - any other codec — newtype variant (`Write: r.string`), value is the
 *   inner value itself
 */
export type EnumVariantDef =
  | null
  | AnyCodec
  | readonly AnyCodec[]
  | Record<string, AnyCodec>;

export type EnumVariants = Record<string, EnumVariantDef>;

export type EnumVariantValue<D> = D extends null
  ? null
  : D extends readonly [AnyCodec]
    ? Infer<D[0]>
    : D extends readonly AnyCodec[]
      ? { [K in keyof D]: Infer<D[K]> }
      : D extends StructCodec<infer T>
        ? T
        : D extends Codec<infer T, any, any>
          ? T
          : D extends Record<string, AnyCodec>
            ? { [K in keyof D]: Infer<D[K]> }
            : never;

/**
 * Tagged enum value: `{ tag, value }` discriminated union.
 */
export type EnumValue<V extends EnumVariants> = {
  [K in keyof V]: { tag: K; value: EnumVariantValue<V[K]> };
}[keyof V];

export class EnumCodec<V extends EnumVariants> extends EnumDecoder<EnumValue<V>> {
  #write: EnumEncoder<EnumValue<V>>;

  constructor(variants: V) {
    super(variants);
    // The read base already normalized the variants (its `instanceof` on the
    // read classes covers full codecs too, since they extend them); hand the
    // same normalized inputs to the write delegate.
    this.#write = new EnumEncoder(
      this.variants.map((v) => v.name),
      this.variants.map((v) => v.fields.map((f) => ({ name: f.name, codec: f.codec as AnyCodec }))),
    );
  }

  archive(writer: RkyvWriter, value: EnumValue<V>): unknown[] | null {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: EnumValue<V>, resolver: unknown[] | null): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: EnumValue<V>, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: EnumValue<V>, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: EnumValue<V>): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Rust enum — tagged union with rkyv's `repr(u8)`/`repr(u16)` layout.
 *
 * Each variant is laid out as a C struct `{ tag, ...fields }` with fields
 * flattened directly after the tag (RFC 2195), NOT as a tag followed by an
 * aligned opaque body — the distinction matters whenever a variant's first
 * field has smaller alignment than its widest field.
 *
 * @example
 * ```typescript
 * const Message = r.taggedEnum({
 *   Quit: null,
 *   Move: { x: r.i32, y: r.i32 },
 *   Write: r.string,
 * });
 * ```
 */
export function taggedEnum<const V extends EnumVariants>(variants: V): Codec<EnumValue<V>> {
  return new EnumCodec(variants);
}

// ============================================================================
// Untagged union
// ============================================================================

export type UnionValue<V extends Record<string, unknown>> = {
  [K in keyof V]: { type: K; value: V[K] };
}[keyof V];

class UnionCodec<V extends Record<string, unknown>> extends UnionDecoder<V> {
  #write: UnionEncoder<V>;

  constructor(
    discriminate: (reader: RkyvReader, offset: number) => keyof V,
    variants: { [K in keyof V]: Codec<V[K]> },
  ) {
    super(discriminate, variants);
    this.#write = new UnionEncoder<V>(variants);
  }

  archive(writer: RkyvWriter, value: UnionValue<V>): unknown {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: UnionValue<V>, resolver: unknown): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: UnionValue<V>, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: UnionValue<V>, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: UnionValue<V>): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Untagged union — discriminated by a user-provided function.
 *
 * @example
 * ```typescript
 * const Shape = r.union(
 *   (reader, offset) => reader.readU8(offset) === 0 ? 'circle' : 'rect',
 *   {
 *     circle: r.struct({ radius: r.f64 }),
 *     rect: r.struct({ width: r.f64, height: r.f64 }),
 *   }
 * );
 * ```
 */
export function union<V extends Record<string, unknown>>(
  discriminate: (reader: RkyvReader, offset: number) => keyof V,
  variants: { [K in keyof V]: Codec<V[K]> }
): Codec<UnionValue<V>> {
  return new UnionCodec(discriminate, variants);
}

// ============================================================================
// Utility Codecs
// ============================================================================

class TransformCodec<T, U> extends TransformDecoder<T, U> {
  #write: TransformEncoder<T, U>;

  constructor(inner: Codec<T>, decode: (value: T) => U, encode: (value: U) => T) {
    super(inner, decode);
    this.#write = new TransformEncoder(inner, encode);
  }

  archive(writer: RkyvWriter, value: U): unknown {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: U, resolver: unknown): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: U, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: U, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: U): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Transform a codec's output/input with mapping functions.
 */
export function transform<T, U>(
  codec: Codec<T>,
  decode: (value: T) => U,
  encode: (value: U) => T
): Codec<U> {
  return new TransformCodec(codec, decode, encode);
}

/**
 * Newtype wrapper — same binary representation, branded TS type.
 */
export function newtype<T, const Brand extends string>(
  inner: Codec<T>,
  _brand: Brand
): Codec<T & { readonly __brand: Brand }> {
  return inner as Codec<T & { readonly __brand: Brand }>;
}

class LazyCodec<T> extends LazyDecoder<T> {
  #write: LazyEncoder<T>;

  constructor(getCodec: () => Codec<T>) {
    super(getCodec);
    this.#write = new LazyEncoder(getCodec);
  }

  archive(writer: RkyvWriter, value: T): unknown {
    return this.#write.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: unknown): number {
    return this.#write.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.#write.hash(hasher, value, encoder);
  }

  encode(value: T, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  encodeInto(writer: RkyvWriter, value: T): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * Lazy codec for recursive types.
 */
export function lazy<T>(getCodec: () => Codec<T>): Codec<T> {
  return new LazyCodec(getCodec);
}
