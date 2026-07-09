/**
 * Encode-only intrinsic codecs for rkyv-js.
 *
 * Every write half lives here exactly once: the full codecs in
 * `./primitives.ts` contain one of these and delegate
 * `archive`/`resolve`/`hash` to it. An encode-only consumer imports this
 * module instead and never pulls in the reader or the lazy-view machinery.
 *
 * Children are typed as {@link Encoder}, the structural write contract —
 * encode-only codecs and full codecs both satisfy it.
 *
 * The factories mirror `./primitives.ts` name-for-name (struct, vec,
 * option, box, rc, weak, array, tuple, taggedEnum, union, transform,
 * newtype, lazy, plus the primitive singletons and string), so generated
 * bindings can switch direction by switching the import path.
 */

import type { Infer, Layout } from './core/base.ts';
import type { RkyvFormat } from './core/format.ts';
import type { RkyvHasher } from './core/hasher.ts';
import type { RkyvReader } from './core/reader.ts';
import { BaseEncoder, type AnyEncoder, type Encoder } from './core/encoder.ts';
import type { RkyvTextEncoder, RkyvWriter } from './core/writer.ts';
import { Kind, primitiveKindOf, type PrimitiveKindTag } from './core/meta.ts';
import {
  arrayLayout,
  elementStride,
  enumLayout,
  optionLayout,
  ptrLayout,
  stringLayout,
  structLayout,
  unionLayout,
  vecLayout,
  type ArrayLayout,
  type EnumLayout,
  type OptionLayout,
  type StringLayout,
  type StructLayout,
  type VecLayout,
} from './layout.ts';

export { BaseEncoder } from './core/encoder.ts';
export type { AnyEncoder, Encoder } from './core/encoder.ts';
export { Kind, OPAQUE_META, type CodecMeta, type PrimitiveKindTag } from './core/meta.ts';
export type { Infer, Layout } from './core/base.ts';
export { DEFAULT_FORMAT, format, type RkyvFormat } from './core/format.ts';
export { RkyvWriter } from './core/writer.ts';
export type { RkyvTextEncoder } from './core/writer.ts';
export type { RkyvHasher } from './core/hasher.ts';

/**
 * Encode a short ASCII string without TextEncoder (returns null when the
 * string contains non-ASCII characters).
 */
function encodeShortAscii(value: string): Uint8Array | null {
  const len = value.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    const c = value.charCodeAt(i);
    if (c > 0x7f) return null;
    bytes[i] = c;
  }
  return bytes;
}

// Growable scratch buffer for allocation-free string hashing.
let hashScratch = new Uint8Array(256);

function hashStringInto(hasher: RkyvHasher, value: string, encoder: RkyvTextEncoder): void {
  const len = value.length;
  if (len * 3 > hashScratch.length) {
    hashScratch = new Uint8Array(len * 3);
  }
  let i = 0;
  for (; i < len; i++) {
    const c = value.charCodeAt(i);
    if (c > 0x7f) break;
    hashScratch[i] = c;
  }
  if (i === len) {
    hasher.writeBytes(hashScratch, 0, len);
  } else {
    const { written } = encoder.encodeInto(value, hashScratch);
    hasher.writeBytes(hashScratch, 0, written);
  }
  hasher.writeU8(0xff);
}

// ============================================================================
// Primitive Codecs
// ============================================================================

export class PrimitiveEncoder<T> extends BaseEncoder<T, undefined> {
  /** Numeric-kind tag consumed by vec's monomorphic bulk paths. */
  readonly kind: PrimitiveKindTag;
  #aligned: Layout;
  #packed: Layout;
  #write: (writer: RkyvWriter, value: T) => number;
  #hash: ((hasher: RkyvHasher, value: T) => void) | undefined;

  constructor(
    size: number,
    align: number,
    kind: PrimitiveKindTag,
    write: (writer: RkyvWriter, value: T) => number,
    // Primitive hashes never involve text, so the encoder is not threaded.
    hash?: (hasher: RkyvHasher, value: T) => void,
  ) {
    super({ inline: true, hashable: hash !== undefined });
    this.kind = kind;
    this.#aligned = { size, align };
    this.#packed = { size, align: 1 };
    this.#write = write;
    this.#hash = hash;
    this.meta = { kind };
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return fmt.aligned ? this.#aligned : this.#packed;
  }

  resolve(writer: RkyvWriter, value: T, _resolver: undefined): number {
    return this.#write(writer, value);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    if (this.#hash === undefined) {
      super.hash(hasher, value, encoder);
      return;
    }
    this.#hash(hasher, value);
  }
}

// Integer codecs. `hash` mirrors Rust's `Hash` impls: unsigned ints write
// their value; signed ints forward with a two's-complement cast.
export const u8: Encoder<number> = new PrimitiveEncoder(1, 1, Kind.u8, (w, v) => w.writeU8(v), (h, v) => h.writeU8(v));
export const i8: Encoder<number> = new PrimitiveEncoder(1, 1, Kind.i8, (w, v) => w.writeI8(v), (h, v) => h.writeU8(v & 0xff));
export const u16: Encoder<number> = new PrimitiveEncoder(2, 2, Kind.u16, (w, v) => w.writeU16(v), (h, v) => h.writeU16(v));
export const i16: Encoder<number> = new PrimitiveEncoder(2, 2, Kind.i16, (w, v) => w.writeI16(v), (h, v) => h.writeU16(v & 0xffff));
export const u32: Encoder<number> = new PrimitiveEncoder(4, 4, Kind.u32, (w, v) => w.writeU32(v), (h, v) => h.writeU32(v));
export const i32: Encoder<number> = new PrimitiveEncoder(4, 4, Kind.i32, (w, v) => w.writeI32(v), (h, v) => h.writeU32(v));
export const u64: Encoder<bigint> = new PrimitiveEncoder(8, 8, Kind.u64, (w, v) => w.writeU64(v), (h, v) => h.writeU64(v));
export const i64: Encoder<bigint> = new PrimitiveEncoder(8, 8, Kind.i64, (w, v) => w.writeI64(v), (h, v) => h.writeU64(v));

// Float codecs (floats are not `Eq` in Rust, so they never hash).
export const f32: Encoder<number> = new PrimitiveEncoder(4, 4, Kind.f32, (w, v) => w.writeF32(v));
export const f64: Encoder<number> = new PrimitiveEncoder(8, 8, Kind.f64, (w, v) => w.writeF64(v));

// Boolean codec.
export const bool: Encoder<boolean> = new PrimitiveEncoder(
  1,
  1,
  Kind.bool,
  (w, v) => w.writeBool(v),
  (h, v) => h.writeU8(v ? 1 : 0),
);

// Unit codec — zero-sized; hashing is a no-op, exactly like `Hash for ()`.
export const unit: Encoder<null> = new PrimitiveEncoder<null>(
  0,
  1,
  Kind.other,
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

// Char codec — a Unicode scalar value stored as u32.
export const char: Encoder<string> = new PrimitiveEncoder(
  4,
  4,
  Kind.other,
  (w, v) => w.writeU32(codePoint(v)),
  (h, v) => h.writeU32(codePoint(v)),
);

// ============================================================================
// String Codec (rkyv 0.8 inline/out-of-line hybrid repr)
// ============================================================================

export interface StringResolver {
  pos: number;
  len: number;
  /** Encoded bytes, retained only when the string is inline. */
  bytes: Uint8Array | null;
}

export class StringEncoder extends BaseEncoder<string, StringResolver, StringLayout> {
  constructor() {
    super({ inline: false, hashable: true });
    this.meta = { kind: Kind.string, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): StringLayout {
    return stringLayout(fmt);
  }

  /** Encode the out-of-line length field (with `10` marker bits). */
  #writeOutOfLineLen(writer: RkyvWriter, len: number, l: StringLayout): void {
    if (writer.format.endian === 'little') {
      const encoded = ((len & 0x3f) | 0x80) + (len - (len & 0x3f)) * 4;
      if (l.pb === 8) {
        writer.writeU64(BigInt(encoded));
      } else {
        writer.writeUsize(encoded);
      }
      return;
    }
    if (l.pb === 8) {
      writer.writeU64(BigInt(len) | (1n << 63n));
    } else {
      writer.writeUsize(len | (2 << (l.pb * 8 - 2)));
    }
  }

  archive(writer: RkyvWriter, value: string): StringResolver {
    const l = this.layout(writer.format);
    if (value.length > l.inlineCapacity) {
      // Definitely out-of-line (UTF-8 length >= UTF-16 length): encode
      // straight into the buffer, no intermediate allocation.
      const pos = writer.pos;
      const len = writer.writeText(value);
      if (len > l.maxLength) {
        throw new Error(
          `string of ${len} bytes exceeds the out-of-line capacity for pointer width ${writer.format.pointerWidth}`,
        );
      }
      return { pos, len, bytes: null };
    }
    const bytes = encodeShortAscii(value) ?? writer.encodeText(value);
    if (bytes.length > l.inlineCapacity) {
      return { pos: writer.writeBytes(bytes), len: bytes.length, bytes: null };
    }
    return { pos: 0, len: bytes.length, bytes };
  }

  resolve(writer: RkyvWriter, _value: string, resolver: StringResolver): number {
    const l = this.layout(writer.format);
    const structPos = writer.pos;
    if (resolver.bytes !== null) {
      writer.writeBytes(resolver.bytes);
      for (let i = resolver.len; i < l.inlineCapacity; i++) {
        writer.writeU8(0xff);
      }
    } else {
      this.#writeOutOfLineLen(writer, resolver.len, l);
      const ptrPos = writer.reserveRelPtr();
      // The out-of-line offset is relative to the REPR start, not the field.
      writer.writeRelPtrOffsetAt(ptrPos, resolver.pos - structPos);
    }
    return structPos;
  }

  hash(hasher: RkyvHasher, value: string, encoder: RkyvTextEncoder): void {
    hashStringInto(hasher, value, encoder);
  }
}

export const string: Encoder<string> = new StringEncoder();

// ============================================================================
// Vec<T>
// ============================================================================

export interface VecResolver {
  pos: number;
  len: number;
}

export class VecEncoder<T> extends BaseEncoder<T[], VecResolver, VecLayout> {
  #element: Encoder<T>;
  #kind: number;
  #strideFormat: RkyvFormat | null = null;
  #stride = 0;

  constructor(element: Encoder<T>) {
    super({ inline: false, hashable: false });
    this.#element = element;
    // Meta-driven: any element declaring a batchable primitive shape gets
    // the monomorphic bulk write path, whichever chain it comes from.
    this.#kind = primitiveKindOf(element.meta);
    this.meta = { kind: Kind.vec, element, layout: (fmt) => this.layout(fmt) };
  }

  // The vec header's layout never depends on the element — element geometry
  // is memoized separately and only computed at write time, when any
  // recursion has already bottomed out.
  computeLayout(fmt: RkyvFormat): VecLayout {
    return vecLayout(fmt);
  }

  #elementStride(fmt: RkyvFormat): number {
    if (fmt !== this.#strideFormat) {
      this.#stride = elementStride(fmt, this.#element);
      this.#strideFormat = fmt;
    }
    return this.#stride;
  }

  #writePrimitive(writer: RkyvWriter, value: readonly unknown[]): void {
    switch (this.#kind) {
      case Kind.u8:
        for (let i = 0; i < value.length; i++) writer.writeU8(value[i] as number);
        break;
      case Kind.i8:
        for (let i = 0; i < value.length; i++) writer.writeI8(value[i] as number);
        break;
      case Kind.u16:
        for (let i = 0; i < value.length; i++) writer.writeU16(value[i] as number);
        break;
      case Kind.i16:
        for (let i = 0; i < value.length; i++) writer.writeI16(value[i] as number);
        break;
      case Kind.u32:
        for (let i = 0; i < value.length; i++) writer.writeU32(value[i] as number);
        break;
      case Kind.i32:
        for (let i = 0; i < value.length; i++) writer.writeI32(value[i] as number);
        break;
      case Kind.u64:
        for (let i = 0; i < value.length; i++) writer.writeU64(value[i] as bigint);
        break;
      case Kind.i64:
        for (let i = 0; i < value.length; i++) writer.writeI64(value[i] as bigint);
        break;
      case Kind.f32:
        for (let i = 0; i < value.length; i++) writer.writeF32(value[i] as number);
        break;
      case Kind.f64:
        for (let i = 0; i < value.length; i++) writer.writeF64(value[i] as number);
        break;
      case Kind.bool:
        for (let i = 0; i < value.length; i++) writer.writeBool(value[i] as boolean);
        break;
    }
  }

  archive(writer: RkyvWriter, value: T[]): VecResolver {
    const element = this.#element;
    const el = element.layout(writer.format);
    const stride = this.#elementStride(writer.format);

    if (this.#kind !== Kind.other) {
      // Primitive elements: stride === size, single monomorphic pass.
      writer.align(el.align);
      const pos = writer.pos;
      this.#writePrimitive(writer, value);
      return { pos, len: value.length };
    }

    if (element.inline) {
      // Inline elements: single pass.
      const needsPad = stride !== el.size;
      writer.align(el.align);
      const pos = writer.pos;
      for (let i = 0; i < value.length; i++) {
        element.resolve(writer, value[i], undefined);
        if (needsPad) writer.padTo(pos + (i + 1) * stride);
      }
      return { pos, len: value.length };
    }

    const resolvers: unknown[] = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) {
      resolvers[i] = element.archive(writer, value[i]);
    }
    writer.align(el.align);
    const pos = writer.pos;
    for (let i = 0; i < value.length; i++) {
      element.resolve(writer, value[i], resolvers[i]);
      writer.padTo(pos + (i + 1) * stride);
    }
    return { pos, len: value.length };
  }

  resolve(writer: RkyvWriter, _value: T[], resolver: VecResolver): number {
    const structPos = writer.pos;
    const ptrPos = writer.reserveRelPtr();
    writer.writeUsize(resolver.len);
    writer.writeRelPtrAt(ptrPos, resolver.pos);
    return structPos;
  }
}

/**
 * Vec<T> — variable-length sequence (also `VecDeque`, `ThinVec`, `SmallVec`,
 * `ArrayVec`, `TinyVec` — they all archive to `ArchivedVec`).
 */
export function vec<C extends AnyEncoder>(element: C): Encoder<Infer<C>[]> {
  return new VecEncoder(element);
}

// ============================================================================
// Option<T>
// ============================================================================

export class OptionEncoder<T> extends BaseEncoder<T | null, unknown, OptionLayout> {
  #inner: Encoder<T>;

  constructor(inner: Encoder<T>) {
    super({ inline: inner.inline, hashable: false });
    this.#inner = inner;
    this.meta = { kind: Kind.option, inner, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): OptionLayout {
    return optionLayout(fmt, this.#inner);
  }

  archive(writer: RkyvWriter, value: T | null): unknown {
    if (value === null || this.#inner.inline) return null;
    return this.#inner.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T | null, resolver: unknown): number {
    const l = this.layout(writer.format);
    const pos = writer.pos;
    if (value === null) {
      writer.writeZeros(l.size);
    } else {
      writer.writeU8(1);
      writer.padTo(pos + l.valueOffset);
      this.#inner.resolve(writer, value, resolver);
      writer.padTo(pos + l.size);
    }
    return pos;
  }
}

/**
 * Option<T> — tag byte followed by the padded value.
 */
export function option<C extends AnyEncoder>(inner: C): Encoder<Infer<C> | null> {
  return new OptionEncoder(inner);
}

// ============================================================================
// Box<T> / Rc<T> / Arc<T> / Weak<T>
// ============================================================================

export interface PtrResolver {
  pos: number;
}

export class BoxEncoder<T> extends BaseEncoder<T, PtrResolver> {
  #inner: Encoder<T>;

  constructor(inner: Encoder<T>) {
    super({ inline: false, hashable: false });
    this.#inner = inner;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return ptrLayout(fmt);
  }

  archive(writer: RkyvWriter, value: T): PtrResolver {
    const inner = this.#inner;
    const resolver = inner.inline ? undefined : inner.archive(writer, value);
    writer.align(inner.layout(writer.format).align);
    const pos = writer.pos;
    inner.resolve(writer, value, resolver);
    return { pos };
  }

  resolve(writer: RkyvWriter, _value: T, resolver: PtrResolver): number {
    const pos = writer.pos;
    const ptrPos = writer.reserveRelPtr();
    writer.writeRelPtrAt(ptrPos, resolver.pos);
    return pos;
  }
}

/**
 * Box<T> — an owned pointer to out-of-line data.
 */
export function box<C extends AnyEncoder>(inner: C): Encoder<Infer<C>> {
  return new BoxEncoder(inner);
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

export class WeakEncoder<T> extends BaseEncoder<T | null, PtrResolver | null> {
  #inner: Encoder<T>;

  constructor(inner: Encoder<T>) {
    super({ inline: false, hashable: false });
    this.#inner = inner;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return ptrLayout(fmt);
  }

  archive(writer: RkyvWriter, value: T | null): PtrResolver | null {
    if (value === null) return null;
    const inner = this.#inner;
    const resolver = inner.inline ? undefined : inner.archive(writer, value);
    writer.align(inner.layout(writer.format).align);
    const pos = writer.pos;
    inner.resolve(writer, value, resolver);
    return { pos };
  }

  resolve(writer: RkyvWriter, _value: T | null, resolver: PtrResolver | null): number {
    const pos = writer.pos;
    const ptrPos = writer.reserveRelPtr();
    if (resolver === null) {
      // A dead weak pointer is rkyv's invalid sentinel (raw offset 1).
      writer.writeInvalidPtrAt(ptrPos);
    } else {
      writer.writeRelPtrAt(ptrPos, resolver.pos);
    }
    return pos;
  }
}

/**
 * Weak<T> — `rc::Weak` / `sync::Weak`; `null` when the pointer is dead.
 */
export function weak<C extends AnyEncoder>(inner: C): Encoder<Infer<C> | null> {
  return new WeakEncoder(inner);
}

// ============================================================================
// [T; N] — fixed-size array
// ============================================================================

export class ArrayEncoder<T> extends BaseEncoder<T[], unknown[] | undefined, ArrayLayout> {
  #element: Encoder<T>;
  #length: number;

  constructor(element: Encoder<T>, length: number) {
    super({ inline: element.inline, hashable: false });
    this.#element = element;
    this.#length = length;
    this.meta = { kind: Kind.array, element, length, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): ArrayLayout {
    return arrayLayout(fmt, this.#element, this.#length);
  }

  #checkLength(value: T[]): void {
    if (value.length !== this.#length) {
      throw new Error(`Array length mismatch: expected ${this.#length}, got ${value.length}`);
    }
  }

  archive(writer: RkyvWriter, value: T[]): unknown[] | undefined {
    this.#checkLength(value);
    const element = this.#element;
    if (element.inline) return undefined;
    const resolvers: unknown[] = new Array<unknown>(this.#length);
    for (let i = 0; i < this.#length; i++) {
      resolvers[i] = element.archive(writer, value[i]);
    }
    return resolvers;
  }

  resolve(writer: RkyvWriter, value: T[], resolver: unknown[] | undefined): number {
    this.#checkLength(value);
    const l = this.layout(writer.format);
    const element = this.#element;
    const pos = writer.pos;
    for (let i = 0; i < this.#length; i++) {
      element.resolve(writer, value[i], resolver === undefined ? undefined : resolver[i]);
      writer.padTo(pos + (i + 1) * l.stride);
    }
    return pos;
  }
}

/**
 * [T; N] — fixed-size array.
 */
export function array<C extends AnyEncoder>(element: C, length: number): Encoder<Infer<C>[]> {
  return new ArrayEncoder(element, length);
}

// ============================================================================
// Tuple
// ============================================================================

export class TupleEncoder<T extends unknown[]> extends BaseEncoder<T, unknown[] | undefined, StructLayout> {
  #codecs: AnyEncoder[];

  constructor(codecs: AnyEncoder[]) {
    super({
      inline: codecs.every((c) => c.inline),
      hashable: codecs.every((c) => c.hashable),
    });
    this.#codecs = codecs;
    this.meta = { kind: Kind.tuple, elements: codecs, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): StructLayout {
    return structLayout(fmt, this.#codecs);
  }

  archive(writer: RkyvWriter, value: T): unknown[] | undefined {
    if (this.inline) return undefined;
    const codecs = this.#codecs;
    const resolvers: unknown[] = new Array<unknown>(codecs.length);
    for (let i = 0; i < codecs.length; i++) {
      resolvers[i] = codecs[i].inline ? undefined : codecs[i].archive(writer, value[i]);
    }
    return resolvers;
  }

  resolve(writer: RkyvWriter, value: T, resolver: unknown[] | undefined): number {
    const l = this.layout(writer.format);
    const codecs = this.#codecs;
    const pos = writer.pos;
    for (let i = 0; i < codecs.length; i++) {
      writer.padTo(pos + l.offsets[i]);
      codecs[i].resolve(writer, value[i], resolver === undefined ? undefined : resolver[i]);
    }
    writer.padTo(pos + l.size);
    return pos;
  }

  // Hash for tuples hashes fields in order with no prefix.
  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    const codecs = this.#codecs;
    for (let i = 0; i < codecs.length; i++) {
      codecs[i].hash(hasher, value[i], encoder);
    }
  }
}

/**
 * (T1, T2, ...) — heterogeneous fixed-size collection.
 */
export function tuple<const C extends AnyEncoder[]>(
  ...codecs: C
): Encoder<{ [K in keyof C]: Infer<C[K]> }> {
  return new TupleEncoder(codecs);
}

// ============================================================================
// Struct
// ============================================================================

export interface StructEncodeField {
  readonly name: string;
  readonly codec: AnyEncoder;
}

/**
 * Struct — C-style struct with named fields. Exposes `fields` so enum
 * factories can flatten struct variants into rkyv's `repr(u8)` enum layout.
 */
export class StructEncoder<T extends Record<string, unknown>> extends BaseEncoder<
  T,
  unknown[] | undefined,
  StructLayout
> {
  readonly fields: readonly StructEncodeField[];
  #names: string[];
  #codecs: AnyEncoder[];

  constructor(fields: { [K in keyof T]: Encoder<T[K]> }) {
    const names = Object.keys(fields);
    const codecs = names.map((name) => fields[name] as AnyEncoder);
    super({
      inline: codecs.every((c) => c.inline),
      hashable: codecs.every((c) => c.hashable),
    });
    this.#names = names;
    this.#codecs = codecs;
    this.fields = names.map((name, i) => ({ name, codec: codecs[i] }));
    this.meta = { kind: Kind.struct, fields: this.fields, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): StructLayout {
    return structLayout(fmt, this.#codecs);
  }

  archive(writer: RkyvWriter, value: T): unknown[] | undefined {
    if (this.inline) return undefined;
    const names = this.#names;
    const codecs = this.#codecs;
    const resolvers: unknown[] = new Array<unknown>(codecs.length);
    for (let i = 0; i < codecs.length; i++) {
      resolvers[i] = codecs[i].inline ? undefined : codecs[i].archive(writer, value[names[i]]);
    }
    return resolvers;
  }

  resolve(writer: RkyvWriter, value: T, resolver: unknown[] | undefined): number {
    const l = this.layout(writer.format);
    const names = this.#names;
    const codecs = this.#codecs;
    const pos = writer.pos;
    for (let i = 0; i < codecs.length; i++) {
      writer.padTo(pos + l.offsets[i]);
      codecs[i].resolve(writer, value[names[i]], resolver === undefined ? undefined : resolver[i]);
    }
    writer.padTo(pos + l.size);
    return pos;
  }

  // #[derive(Hash)] hashes fields in declaration order with no prefix.
  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    const names = this.#names;
    const codecs = this.#codecs;
    for (let i = 0; i < codecs.length; i++) {
      codecs[i].hash(hasher, value[names[i]], encoder);
    }
  }
}

/**
 * Struct — C-style struct with named fields.
 */
export function struct<F extends Record<string, AnyEncoder>>(
  fields: F
): StructEncoder<{ [K in keyof F]: Infer<F[K]> }> {
  type T = { [K in keyof F]: Infer<F[K]> };
  return new StructEncoder<T>(fields as unknown as { [K in keyof T]: Encoder<T[K]> });
}

// ============================================================================
// Tagged enum
// ============================================================================

/**
 * A tagged-enum variant definition:
 * - `null` — unit variant
 * - an array of codecs — tuple variant (`Color: [r.u8, r.u8, r.u8]`),
 *   encoded from an array; a single-element array is a newtype variant
 * - a record of codecs — struct variant (`Move: { x: r.i32, y: r.i32 }`)
 * - a struct codec — struct variant, fields flattened into the enum layout
 * - any other codec — newtype variant (`Write: r.string`), value is the
 *   inner value itself
 */
export type EnumVariantDef =
  | null
  | AnyEncoder
  | readonly AnyEncoder[]
  | Record<string, AnyEncoder>;

export type EnumVariants = Record<string, EnumVariantDef>;

export type EnumVariantValue<D> = D extends null
  ? null
  : D extends readonly [AnyEncoder]
    ? Infer<D[0]>
    : D extends readonly AnyEncoder[]
      ? { [K in keyof D]: Infer<D[K]> }
      : D extends StructEncoder<infer T>
        ? T
        : D extends BaseEncoder<infer T, any, any>
          ? T
          : D extends Record<string, AnyEncoder>
            ? { [K in keyof D]: Infer<D[K]> }
            : never;

/**
 * Tagged enum value: `{ tag, value }` discriminated union.
 */
export type EnumValue<V extends EnumVariants> = {
  [K in keyof V]: { tag: K; value: EnumVariantValue<V[K]> };
}[keyof V];

/** One flattened field of a normalized enum variant. */
export interface EnumEncodeVariantField {
  /** Field name in the value object, or null for newtype variants. */
  readonly name: string | null;
  readonly codec: AnyEncoder;
}

/** Normalize a variant definition to a flat field list. */
function normalizeEnumVariant(def: EnumVariantDef): readonly EnumEncodeVariantField[] {
  if (def === null) return [];
  if (Array.isArray(def)) {
    // Tuple variant: positional fields, encoded from an array value.
    return def.map((codec) => ({ name: null, codec: codec as AnyEncoder }));
  }
  if (def instanceof StructEncoder) {
    return def.fields.map((f) => ({ name: f.name, codec: f.codec }));
  }
  if (typeof (def as AnyEncoder).resolve === 'function') {
    // A bare codec. Structural `Encoder`s that expose the struct `fields`
    // introspection surface (full struct codecs) flatten like struct
    // variants; any other codec is a newtype variant.
    const fields = (def as { fields?: readonly { name: string; codec: AnyEncoder }[] }).fields;
    if (Array.isArray(fields)) {
      return fields.map((f) => ({ name: f.name, codec: f.codec }));
    }
    return [{ name: null, codec: def as AnyEncoder }];
  }
  return Object.entries(def as Record<string, AnyEncoder>).map(([fieldName, codec]) => ({
    name: fieldName,
    codec,
  }));
}

export class EnumEncoder<T> extends BaseEncoder<T, unknown[] | null, EnumLayout> {
  #names: readonly string[];
  #variantFields: readonly (readonly EnumEncodeVariantField[])[];
  #variantIndex: Map<string, number>;

  constructor(
    names: readonly string[],
    variantFields: readonly (readonly EnumEncodeVariantField[])[],
  ) {
    // rkyv's derive rejects enums with more than 256 variants (u8 tag only).
    if (names.length > 256) {
      throw new Error(`taggedEnum supports at most 256 variants (rkyv's limit), got ${names.length}`);
    }
    super({
      inline: variantFields.every((fields) => fields.every((f) => f.codec.inline)),
      hashable: false,
    });
    this.#names = names;
    this.#variantFields = variantFields;
    this.#variantIndex = new Map(names.map((name, i) => [name, i]));
    this.meta = {
      kind: Kind.enum,
      variants: names.map((name, i) => ({ name, fields: variantFields[i] })),
      layout: (fmt) => this.layout(fmt),
    };
  }

  computeLayout(fmt: RkyvFormat): EnumLayout {
    return enumLayout(
      fmt,
      this.#variantFields.map((fields) => fields.map((f) => f.codec)),
    );
  }

  #discriminant(tag: string): number {
    const disc = this.#variantIndex.get(tag);
    if (disc === undefined) {
      throw new Error(`unknown enum variant ${tag}`);
    }
    return disc;
  }

  #fieldValues(fields: readonly EnumEncodeVariantField[], value: unknown): unknown[] {
    if (fields.length === 1 && fields[0].name === null) return [value];
    // Tuple variant: the value is already the positional array.
    if (fields[0].name === null) return value as unknown[];
    const record = value as Record<string, unknown>;
    return fields.map((f) => record[f.name as string]);
  }

  archive(writer: RkyvWriter, value: T): unknown[] | null {
    const v = value as { tag: string; value: unknown };
    const disc = this.#discriminant(v.tag);
    const fields = this.#variantFields[disc];
    if (fields.length === 0) return null;
    const values = this.#fieldValues(fields, v.value);
    const resolvers: unknown[] = new Array<unknown>(fields.length);
    for (let i = 0; i < fields.length; i++) {
      const codec = fields[i].codec;
      resolvers[i] = codec.inline ? undefined : codec.archive(writer, values[i]);
    }
    return resolvers;
  }

  resolve(writer: RkyvWriter, value: T, resolver: unknown[] | null): number {
    const v = value as { tag: string; value: unknown };
    const l = this.layout(writer.format);
    const disc = this.#discriminant(v.tag);
    const pos = writer.pos;
    if (l.discSize === 1) {
      writer.writeU8(disc);
    } else {
      writer.writeU16(disc);
    }
    const fields = this.#variantFields[disc];
    if (fields.length > 0) {
      const offsets = l.variants[disc].fieldOffsets;
      const values = this.#fieldValues(fields, v.value);
      for (let i = 0; i < fields.length; i++) {
        writer.padTo(pos + offsets[i]);
        // resolver is null for unit variants and undefined for inline enums.
        fields[i].codec.resolve(writer, values[i], resolver == null ? undefined : resolver[i]);
      }
    }
    writer.padTo(pos + l.size);
    return pos;
  }
}

/**
 * Rust enum — tagged union with rkyv's `repr(u8)`/`repr(u16)` layout.
 *
 * Each variant is laid out as a C struct `{ tag, ...fields }` with fields
 * flattened directly after the tag (RFC 2195).
 */
export function taggedEnum<const V extends EnumVariants>(variants: V): Encoder<EnumValue<V>> {
  const names = Object.keys(variants);
  return new EnumEncoder<EnumValue<V>>(
    names,
    names.map((name) => normalizeEnumVariant(variants[name])),
  );
}

// ============================================================================
// Untagged union
// ============================================================================

export type UnionValue<V extends Record<string, unknown>> = {
  [K in keyof V]: { type: K; value: V[K] };
}[keyof V];

export class UnionEncoder<V extends Record<string, unknown>> extends BaseEncoder<
  UnionValue<V>,
  unknown
> {
  #variants: { [K in keyof V]: Encoder<V[K]> };
  #names: (keyof V)[];

  constructor(variants: { [K in keyof V]: Encoder<V[K]> }) {
    const names = Object.keys(variants) as (keyof V)[];
    super({
      inline: names.every((name) => variants[name].inline),
      hashable: false,
    });
    this.#variants = variants;
    this.#names = names;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return unionLayout(
      fmt,
      this.#names.map((name) => this.#variants[name]),
    );
  }

  archive(writer: RkyvWriter, value: UnionValue<V>): unknown {
    const codec = this.#variants[value.type];
    return codec.inline ? undefined : codec.archive(writer, value.value);
  }

  resolve(writer: RkyvWriter, value: UnionValue<V>, resolver: unknown): number {
    const l = this.layout(writer.format);
    const pos = writer.pos;
    this.#variants[value.type].resolve(writer, value.value, resolver);
    writer.padTo(pos + l.size);
    return pos;
  }
}

/**
 * Untagged union — discriminated by a user-provided function.
 *
 * The discriminate function drives decoding only; it is accepted for
 * call-shape parity with the full and decode-only factories and ignored.
 */
export function union<V extends Record<string, unknown>>(
  _discriminate: (reader: RkyvReader, offset: number) => keyof V,
  variants: { [K in keyof V]: Encoder<V[K]> }
): Encoder<UnionValue<V>> {
  return new UnionEncoder(variants);
}

// ============================================================================
// Utility Codecs
// ============================================================================

export class TransformEncoder<T, U> extends BaseEncoder<U, unknown> {
  #inner: Encoder<T>;
  #encode: (value: U) => T;

  constructor(inner: Encoder<T>, encode: (value: U) => T) {
    super({ inline: inner.inline, hashable: inner.hashable });
    this.#inner = inner;
    this.#encode = encode;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#inner.layout(fmt);
  }

  archive(writer: RkyvWriter, value: U): unknown {
    return this.#inner.archive(writer, this.#encode(value));
  }

  resolve(writer: RkyvWriter, value: U, resolver: unknown): number {
    return this.#inner.resolve(writer, this.#encode(value), resolver);
  }

  hash(hasher: RkyvHasher, value: U, encoder: RkyvTextEncoder): void {
    this.#inner.hash(hasher, this.#encode(value), encoder);
  }
}

/**
 * Transform a codec's input with a mapping function.
 *
 * The second parameter (the decode-direction mapping) is accepted for
 * call-shape parity with the full and decode-only factories and ignored.
 */
export function transform<T, U>(
  codec: Encoder<T>,
  _decode: (value: T) => U,
  encode: (value: U) => T
): Encoder<U> {
  return new TransformEncoder(codec, encode);
}

/**
 * Newtype wrapper — same binary representation, branded TS type.
 */
export function newtype<T, const Brand extends string>(
  inner: Encoder<T>,
  _brand: Brand
): Encoder<T & { readonly __brand: Brand }> {
  return inner as Encoder<T & { readonly __brand: Brand }>;
}

export class LazyEncoder<T> extends BaseEncoder<T> {
  #getCodec: () => Encoder<T>;
  #cached: Encoder<T> | null = null;

  constructor(getCodec: () => Encoder<T>) {
    // Recursive types necessarily contain indirection, so a lazy codec always
    // participates in the archive pass; they never serve as map keys.
    super({ inline: false, hashable: false });
    this.#getCodec = getCodec;
  }

  #get(): Encoder<T> {
    if (this.#cached === null) this.#cached = this.#getCodec();
    return this.#cached;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#get().layout(fmt);
  }

  archive(writer: RkyvWriter, value: T): unknown {
    const codec = this.#get();
    return codec.inline ? undefined : codec.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: unknown): number {
    return this.#get().resolve(writer, value, resolver);
  }
}

/**
 * Lazy codec for recursive types.
 */
export function lazy<T>(getCodec: () => Encoder<T>): Encoder<T> {
  return new LazyEncoder(getCodec);
}

/**
 * Encode-side twin of `withFormat`: pins `encode`'s default format.
 */
export class FormatBoundEncoder<T> extends BaseEncoder<T> {
  readonly inner: Encoder<T>;
  readonly format: RkyvFormat;

  constructor(inner: Encoder<T>, format: RkyvFormat) {
    super({ inline: inner.inline, hashable: inner.hashable });
    this.inner = inner;
    this.format = format;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.inner.layout(fmt);
  }

  archive(writer: RkyvWriter, value: T): any {
    return this.inner.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: any): number {
    return this.inner.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.inner.hash(hasher, value, encoder);
  }

  encode(value: T, format: RkyvFormat = this.format): Uint8Array {
    return super.encode(value, format);
  }
}

/**
 * Pin a write codec's root `encode` to a specific format (as emitted by
 * codegen when the Rust crate uses non-default rkyv format features).
 */
export function withFormat<T>(codec: Encoder<T>, format: RkyvFormat): Encoder<T> {
  return new FormatBoundEncoder(codec, format);
}
