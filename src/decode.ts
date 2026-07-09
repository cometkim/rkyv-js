/**
 * Decode-only intrinsic codecs for rkyv-js.
 *
 * Every read half lives here exactly once: the full codecs in
 * `./primitives.ts` extend these classes and add a contained encode
 * delegate. A decode-only consumer imports this module instead and never
 * pulls in the writer, the hasher, or any archive/resolve machinery.
 *
 * The factories mirror `./primitives.ts` name-for-name (struct, vec,
 * option, box, rc, weak, array, tuple, taggedEnum, union, transform,
 * newtype, lazy, plus the primitive singletons and string), so generated
 * bindings can switch direction by switching the import path.
 */

import type { Infer, Layout } from './core/base.ts';
import type { RkyvFormat } from './core/format.ts';
import {
  BaseDecoder,
  type Decoder,
  FormatBoundDecoder,
  type AnyDecoder,
} from './core/decoder.ts';
import type { RkyvReader } from './core/reader.ts';
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

export { BaseDecoder, FormatBoundDecoder } from './core/decoder.ts';
export type { AnyDecoder, Decoder, Lazy, LazyList } from './core/decoder.ts';
export { Kind, OPAQUE_META, type CodecMeta, type PrimitiveKindTag } from './core/meta.ts';
export type { Infer, Layout } from './core/base.ts';
export { DEFAULT_FORMAT, format, type RkyvFormat } from './core/format.ts';
export { RkyvReader } from './core/reader.ts';

// ============================================================================
// Primitive Codecs
// ============================================================================

export class PrimitiveDecoder<T> extends BaseDecoder<T> {
  /** Numeric-kind tag consumed by vec's monomorphic bulk paths. */
  readonly kind: PrimitiveKindTag;
  #aligned: Layout;
  #packed: Layout;
  #read: (reader: RkyvReader, offset: number) => T;

  constructor(
    size: number,
    align: number,
    kind: PrimitiveKindTag,
    read: (reader: RkyvReader, offset: number) => T,
    // `hashable` is direction-neutral metadata (containers derive theirs
    // from it); the hashing itself lives on the encode side.
    hashable: boolean = false,
  ) {
    super({ inline: true, hashable });
    this.kind = kind;
    this.#aligned = { size, align };
    this.#packed = { size, align: 1 };
    this.#read = read;
    this.meta = { kind };
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return fmt.aligned ? this.#aligned : this.#packed;
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#read(reader, offset);
  }
}

// Integer codecs.
export const u8: Decoder<number> = new PrimitiveDecoder(1, 1, Kind.u8, (r, o) => r.readU8(o), true);
export const i8: Decoder<number> = new PrimitiveDecoder(1, 1, Kind.i8, (r, o) => r.readI8(o), true);
export const u16: Decoder<number> = new PrimitiveDecoder(2, 2, Kind.u16, (r, o) => r.readU16(o), true);
export const i16: Decoder<number> = new PrimitiveDecoder(2, 2, Kind.i16, (r, o) => r.readI16(o), true);
export const u32: Decoder<number> = new PrimitiveDecoder(4, 4, Kind.u32, (r, o) => r.readU32(o), true);
export const i32: Decoder<number> = new PrimitiveDecoder(4, 4, Kind.i32, (r, o) => r.readI32(o), true);
export const u64: Decoder<bigint> = new PrimitiveDecoder(8, 8, Kind.u64, (r, o) => r.readU64(o), true);
export const i64: Decoder<bigint> = new PrimitiveDecoder(8, 8, Kind.i64, (r, o) => r.readI64(o), true);

// Float codecs (floats are not `Eq` in Rust, so they never hash).
export const f32: Decoder<number> = new PrimitiveDecoder(4, 4, Kind.f32, (r, o) => r.readF32(o));
export const f64: Decoder<number> = new PrimitiveDecoder(8, 8, Kind.f64, (r, o) => r.readF64(o));

// Boolean codec.
export const bool: Decoder<boolean> = new PrimitiveDecoder(1, 1, Kind.bool, (r, o) => r.readBool(o), true);

// Unit codec — zero-sized.
export const unit: Decoder<null> = new PrimitiveDecoder<null>(0, 1, Kind.other, () => null, true);

// Char codec — a Unicode scalar value stored as u32 (Kind.other: bulk
// paths cannot batch it because reading materializes a string).
export const char: Decoder<string> = new PrimitiveDecoder(
  4,
  4,
  Kind.other,
  (r, o) => String.fromCodePoint(r.readU32(o)),
  true,
);

// ============================================================================
// String Codec (rkyv 0.8 inline/out-of-line hybrid repr)
// ============================================================================

export class StringDecoder extends BaseDecoder<string, StringLayout> {
  constructor() {
    super({ inline: false, hashable: true });
    this.meta = { kind: Kind.string, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): StringLayout {
    return stringLayout(fmt);
  }

  /** Decode the out-of-line length field (marker bits removed). */
  #readOutOfLineLen(reader: RkyvReader, offset: number, l: StringLayout): number {
    if (reader.format.endian === 'little') {
      // Stored: (len & 0x3f) | 0x80 | ((len & ~0x3f) << 2) — the low byte
      // carries the marker, upper bits shift up by 2.
      const v = reader.readUsize(offset);
      return (v & 0x3f) + Math.floor(v / 256) * 64;
    }
    // Big-endian: plain value with the top two bits as the marker.
    if (l.pb === 8) {
      return Number(reader.readU64(offset) & 0x3fff_ffff_ffff_ffffn);
    }
    const mask = 2 ** (l.pb * 8 - 2) - 1;
    return reader.readUsize(offset) & mask;
  }

  read(reader: RkyvReader, offset: number): string {
    const l = this.layout(reader.format);
    const buffer = reader.buffer;
    if ((buffer[offset] & 0xc0) !== 0x80) {
      // Inline: bytes padded with 0xff (0xff never appears in valid UTF-8).
      // Single pass for the common ASCII case.
      let out = '';
      let i = 0;
      for (; i < l.inlineCapacity; i++) {
        const b = buffer[offset + i];
        if (b === 0xff) return out;
        if (b > 0x7f) break;
        out += String.fromCharCode(b);
      }
      if (i === l.inlineCapacity) return out;
      // Non-ASCII inline: locate the terminator, then decode as UTF-8.
      let length = i + 1;
      while (length < l.inlineCapacity && buffer[offset + length] !== 0xff) {
        length++;
      }
      return reader.readText(offset, length);
    }
    const length = this.#readOutOfLineLen(reader, offset, l);
    const dataOffset = offset + reader.readRelPtrOffset(offset + l.pb);
    return reader.readText(dataOffset, length);
  }
}

export const string: Decoder<string> = new StringDecoder();

// ============================================================================
// Vec<T>
// ============================================================================

/**
 * Lazy view over an archived sequence; elements decode on first access.
 */
class LazyVecView<E> {
  #reader: RkyvReader;
  #dataOffset: number;
  #element: Decoder<E>;
  #stride: number;
  #cache: unknown[];
  readonly length: number;

  constructor(reader: RkyvReader, dataOffset: number, length: number, element: Decoder<E>, stride: number) {
    this.#reader = reader;
    this.#dataOffset = dataOffset;
    this.#element = element;
    this.#stride = stride;
    this.#cache = new Array<unknown>(length);
    this.length = length;
  }

  at(index: number): unknown {
    if (index < 0 || index >= this.length) return undefined;
    let value = this.#cache[index];
    if (value === undefined) {
      value = this.#element.readLazy(this.#reader, this.#dataOffset + index * this.#stride);
      this.#cache[index] = value;
    }
    return value;
  }

  *[Symbol.iterator](): IterableIterator<unknown> {
    for (let i = 0; i < this.length; i++) {
      yield this.at(i);
    }
  }

  toArray(): E[] {
    const result: E[] = new Array<E>(this.length);
    for (let i = 0; i < this.length; i++) {
      result[i] = this.#element.read(this.#reader, this.#dataOffset + i * this.#stride);
    }
    return result;
  }

  toJSON(): E[] {
    return this.toArray();
  }
}

export class VecDecoder<T> extends BaseDecoder<T[], VecLayout> {
  /** Element codec (introspection surface, also consumed by JIT compilers). */
  readonly element: Decoder<T>;
  #kind: number;
  #strideFormat: RkyvFormat | null = null;
  #stride = 0;

  constructor(element: Decoder<T>) {
    super({ inline: false, hashable: false });
    this.element = element;
    this.#kind = primitiveKindOf(element.meta);
    this.meta = { kind: Kind.vec, element, layout: (fmt) => this.layout(fmt) };
  }

  // The vec header's layout never depends on the element — that is what
  // makes recursive types (`struct Tree { children: Vec<Tree> }`) legal.
  // Element geometry is memoized separately and only computed at
  // read/write time, when any recursion has already bottomed out.
  computeLayout(fmt: RkyvFormat): VecLayout {
    return vecLayout(fmt);
  }

  #elementStride(fmt: RkyvFormat): number {
    if (fmt !== this.#strideFormat) {
      this.#stride = elementStride(fmt, this.element);
      this.#strideFormat = fmt;
    }
    return this.#stride;
  }

  read(reader: RkyvReader, offset: number): T[] {
    const l = this.layout(reader.format);
    const stride = this.#elementStride(reader.format);
    const dataOffset = reader.readRelPtr(offset);
    const length = reader.readUsize(offset + l.pb);
    const result: T[] = new Array<T>(length);
    if (this.#kind !== Kind.other) {
      this.#readPrimitive(reader, dataOffset, length, stride, result as unknown[]);
      return result;
    }
    const element = this.element;
    for (let i = 0; i < length; i++) {
      result[i] = element.read(reader, dataOffset + i * stride);
    }
    return result;
  }

  /**
   * Monomorphic loops for primitive elements (no per-element dispatch).
   * Reader construction avoids DataView (a fixed cost that dominates tiny
   * decodes), so short runs read via byte math / the shared scratch; long
   * runs materialize the reader's lazy DataView once — V8's intrinsified
   * DataView reads beat per-element byte math when amortized.
   */
  #readPrimitive(reader: RkyvReader, base: number, length: number, stride: number, out: unknown[]): void {
    if (length >= 16) {
      const view = reader.view;
      const le = reader.littleEndian;
      switch (this.#kind) {
        case Kind.u16:
          for (let i = 0; i < length; i++) out[i] = view.getUint16(base + i * stride, le);
          return;
        case Kind.i16:
          for (let i = 0; i < length; i++) out[i] = view.getInt16(base + i * stride, le);
          return;
        case Kind.u32:
          for (let i = 0; i < length; i++) out[i] = view.getUint32(base + i * stride, le);
          return;
        case Kind.i32:
          for (let i = 0; i < length; i++) out[i] = view.getInt32(base + i * stride, le);
          return;
        case Kind.u64:
          for (let i = 0; i < length; i++) out[i] = view.getBigUint64(base + i * stride, le);
          return;
        case Kind.i64:
          for (let i = 0; i < length; i++) out[i] = view.getBigInt64(base + i * stride, le);
          return;
        case Kind.f32:
          for (let i = 0; i < length; i++) out[i] = view.getFloat32(base + i * stride, le);
          return;
        case Kind.f64:
          for (let i = 0; i < length; i++) out[i] = view.getFloat64(base + i * stride, le);
          return;
      }
    }
    switch (this.#kind) {
      case Kind.u8:
        for (let i = 0; i < length; i++) out[i] = reader.readU8(base + i * stride);
        break;
      case Kind.i8:
        for (let i = 0; i < length; i++) out[i] = reader.readI8(base + i * stride);
        break;
      case Kind.u16:
        for (let i = 0; i < length; i++) out[i] = reader.readU16(base + i * stride);
        break;
      case Kind.i16:
        for (let i = 0; i < length; i++) out[i] = reader.readI16(base + i * stride);
        break;
      case Kind.u32:
        for (let i = 0; i < length; i++) out[i] = reader.readU32(base + i * stride);
        break;
      case Kind.i32:
        for (let i = 0; i < length; i++) out[i] = reader.readI32(base + i * stride);
        break;
      case Kind.u64:
        for (let i = 0; i < length; i++) out[i] = reader.readU64(base + i * stride);
        break;
      case Kind.i64:
        for (let i = 0; i < length; i++) out[i] = reader.readI64(base + i * stride);
        break;
      case Kind.f32:
        for (let i = 0; i < length; i++) out[i] = reader.readF32(base + i * stride);
        break;
      case Kind.f64:
        for (let i = 0; i < length; i++) out[i] = reader.readF64(base + i * stride);
        break;
      case Kind.bool:
        for (let i = 0; i < length; i++) out[i] = reader.readBool(base + i * stride);
        break;
    }
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    const l = this.layout(reader.format);
    const dataOffset = reader.readRelPtr(offset);
    const length = reader.readUsize(offset + l.pb);
    return new LazyVecView(reader, dataOffset, length, this.element, this.#elementStride(reader.format));
  }
}

/**
 * Vec<T> — variable-length sequence (also `VecDeque`, `ThinVec`, `SmallVec`,
 * `ArrayVec`, `TinyVec` — they all archive to `ArchivedVec`).
 */
export function vec<C extends AnyDecoder>(element: C): Decoder<Infer<C>[]> {
  return new VecDecoder(element);
}

// ============================================================================
// Option<T>
// ============================================================================

export class OptionDecoder<T> extends BaseDecoder<T | null, OptionLayout> {
  /** Inner codec (introspection surface). */
  readonly inner: Decoder<T>;

  constructor(inner: Decoder<T>) {
    super({ inline: inner.inline, hashable: false });
    this.inner = inner;
    this.meta = { kind: Kind.option, inner, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): OptionLayout {
    return optionLayout(fmt, this.inner);
  }

  read(reader: RkyvReader, offset: number): T | null {
    if (reader.readU8(offset) === 0) return null;
    return this.inner.read(reader, offset + this.layout(reader.format).valueOffset);
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    if (reader.readU8(offset) === 0) return null;
    return this.inner.readLazy(reader, offset + this.layout(reader.format).valueOffset);
  }
}

/**
 * Option<T> — tag byte followed by the padded value.
 */
export function option<C extends AnyDecoder>(inner: C): Decoder<Infer<C> | null> {
  return new OptionDecoder(inner);
}

// ============================================================================
// Box<T> / Rc<T> / Arc<T> / Weak<T>
// ============================================================================

export class BoxDecoder<T> extends BaseDecoder<T> {
  /** Inner codec (introspection surface). */
  readonly inner: Decoder<T>;

  constructor(inner: Decoder<T>) {
    super({ inline: false, hashable: false });
    this.inner = inner;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return ptrLayout(fmt);
  }

  read(reader: RkyvReader, offset: number): T {
    return this.inner.read(reader, reader.readRelPtr(offset));
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.inner.readLazy(reader, reader.readRelPtr(offset));
  }
}

/**
 * Box<T> — an owned pointer to out-of-line data.
 */
export function box<C extends AnyDecoder>(inner: C): Decoder<Infer<C>> {
  return new BoxDecoder(inner);
}

/**
 * Rc<T> / Arc<T> — reference-counted pointers (same archived format as
 * `Box<T>`).
 *
 * @alias box
 */
export const rc: typeof box = box;

export class WeakDecoder<T> extends BaseDecoder<T | null> {
  /** Inner codec (introspection surface). */
  readonly inner: Decoder<T>;

  constructor(inner: Decoder<T>) {
    super({ inline: false, hashable: false });
    this.inner = inner;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return ptrLayout(fmt);
  }

  read(reader: RkyvReader, offset: number): T | null {
    if (reader.isInvalidPtr(offset)) return null;
    return this.inner.read(reader, reader.readRelPtr(offset));
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    if (reader.isInvalidPtr(offset)) return null;
    return this.inner.readLazy(reader, reader.readRelPtr(offset));
  }
}

/**
 * Weak<T> — `rc::Weak` / `sync::Weak`; `null` when the pointer is dead.
 */
export function weak<C extends AnyDecoder>(inner: C): Decoder<Infer<C> | null> {
  return new WeakDecoder(inner);
}

// ============================================================================
// [T; N] — fixed-size array
// ============================================================================

export class ArrayDecoder<T> extends BaseDecoder<T[], ArrayLayout> {
  /** Element codec (introspection surface). */
  readonly element: Decoder<T>;
  /** Fixed element count (introspection surface). */
  readonly length: number;

  constructor(element: Decoder<T>, length: number) {
    super({ inline: element.inline, hashable: false });
    this.element = element;
    this.length = length;
    this.meta = { kind: Kind.array, element, length, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): ArrayLayout {
    return arrayLayout(fmt, this.element, this.length);
  }

  read(reader: RkyvReader, offset: number): T[] {
    const l = this.layout(reader.format);
    const element = this.element;
    const result: T[] = new Array<T>(this.length);
    for (let i = 0; i < this.length; i++) {
      result[i] = element.read(reader, offset + i * l.stride);
    }
    return result;
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return new LazyVecView(reader, offset, this.length, this.element, this.layout(reader.format).stride);
  }
}

/**
 * [T; N] — fixed-size array.
 */
export function array<C extends AnyDecoder>(element: C, length: number): Decoder<Infer<C>[]> {
  return new ArrayDecoder(element, length);
}

// ============================================================================
// Tuple
// ============================================================================

export class TupleDecoder<T extends unknown[]> extends BaseDecoder<T, StructLayout> {
  /** Element codecs in order (introspection surface). */
  readonly elements: readonly AnyDecoder[];

  constructor(codecs: AnyDecoder[]) {
    super({
      inline: codecs.every((c) => c.inline),
      hashable: codecs.every((c) => c.hashable),
    });
    this.elements = codecs;
    this.meta = { kind: Kind.tuple, elements: codecs, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): StructLayout {
    return structLayout(fmt, this.elements);
  }

  read(reader: RkyvReader, offset: number): T {
    const l = this.layout(reader.format);
    const codecs = this.elements;
    const result: unknown[] = new Array<unknown>(codecs.length);
    for (let i = 0; i < codecs.length; i++) {
      result[i] = codecs[i].read(reader, offset + l.offsets[i]);
    }
    return result as T;
  }
}

/**
 * (T1, T2, ...) — heterogeneous fixed-size collection.
 */
export function tuple<const C extends AnyDecoder[]>(
  ...codecs: C
): Decoder<{ [K in keyof C]: Infer<C[K]> }> {
  return new TupleDecoder(codecs);
}

// ============================================================================
// Struct
// ============================================================================

export interface StructField {
  readonly name: string;
  readonly codec: AnyDecoder;
}

interface LazyView {
  [key: string]: unknown;
}

type LazyViewConstructor = new (reader: RkyvReader, offset: number) => LazyView;

// Symbol keys keep the view's internals out of Object.keys/spread.
const VIEW_READER = Symbol('reader');
const VIEW_OFFSET = Symbol('offset');

/**
 * Struct — C-style struct with named fields. Exposes `fields` so enum codecs
 * can flatten variant bodies into rkyv's `repr(u8)` enum layout (and so JIT
 * compilers can inspect the codec tree).
 */
export class StructDecoder<T extends Record<string, unknown>> extends BaseDecoder<T, StructLayout> {
  readonly fields: readonly StructField[];
  #names: string[];
  #codecs: AnyDecoder[];
  #viewFormat: RkyvFormat | null = null;
  #ViewClass: LazyViewConstructor | null = null;

  constructor(fields: { [K in keyof T]: Decoder<T[K]> }) {
    const names = Object.keys(fields);
    const codecs = names.map((name) => fields[name] as AnyDecoder);
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

  read(reader: RkyvReader, offset: number): T {
    const l = this.layout(reader.format);
    const names = this.#names;
    const codecs = this.#codecs;
    const result = {} as Record<string, unknown>;
    for (let i = 0; i < codecs.length; i++) {
      result[names[i]] = codecs[i].read(reader, offset + l.offsets[i]);
    }
    return result as T;
  }

  /**
   * Lazy view class, built once per (codec, format): prototype getters that
   * decode a field on first access and memoize it as an own property.
   */
  #getViewClass(fmt: RkyvFormat): LazyViewConstructor {
    if (fmt !== this.#viewFormat) {
      const l = this.layout(fmt);
      const names = this.#names;
      const codecs = this.#codecs;
      const count = codecs.length;

      class View {
        [VIEW_READER]: RkyvReader;
        [VIEW_OFFSET]: number;
        constructor(reader: RkyvReader, offset: number) {
          this[VIEW_READER] = reader;
          this[VIEW_OFFSET] = offset;
        }
        toJSON(): Record<string, unknown> {
          const out: Record<string, unknown> = {};
          for (let i = 0; i < count; i++) {
            out[names[i]] = codecs[i].read(this[VIEW_READER], this[VIEW_OFFSET] + l.offsets[i]);
          }
          return out;
        }
      }

      for (let i = 0; i < count; i++) {
        const name = names[i];
        const codec = codecs[i];
        const fieldOffset = l.offsets[i];
        Object.defineProperty(View.prototype, name, {
          enumerable: false,
          configurable: true,
          get(this: View) {
            const value = codec.readLazy(this[VIEW_READER], this[VIEW_OFFSET] + fieldOffset);
            // Memoize: shadow the prototype getter with an own value.
            Object.defineProperty(this, name, {
              value,
              enumerable: true,
              configurable: true,
              writable: false,
            });
            return value;
          },
        });
      }

      this.#ViewClass = View as unknown as LazyViewConstructor;
      this.#viewFormat = fmt;
    }
    return this.#ViewClass as LazyViewConstructor;
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    const View = this.#getViewClass(reader.format);
    return new View(reader, offset);
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
export function struct<F extends Record<string, AnyDecoder>>(
  fields: F
): StructDecoder<{ [K in keyof F]: Infer<F[K]> }> {
  type T = { [K in keyof F]: Infer<F[K]> };
  return new StructDecoder<T>(fields as unknown as { [K in keyof T]: Decoder<T[K]> });
}

// ============================================================================
// Tagged enum
// ============================================================================

/**
 * A tagged-enum variant definition:
 * - `null` — unit variant
 * - a record of codecs — struct variant (`Move: { x: r.i32, y: r.i32 }`)
 * - a struct codec — struct variant, fields flattened into the enum layout
 * - any other codec — newtype variant (`Write: r.string`), value is the
 *   inner value itself
 */
export type EnumVariantDef = null | AnyDecoder | Record<string, AnyDecoder>;

export type EnumVariants = Record<string, EnumVariantDef>;

export type EnumVariantValue<D> = D extends null
  ? null
  : D extends StructDecoder<infer T>
    ? T
    : D extends BaseDecoder<infer T, any>
      ? T
      : D extends Record<string, AnyDecoder>
        ? { [K in keyof D]: Infer<D[K]> }
        : never;

/**
 * Tagged enum value: `{ tag, value }` discriminated union.
 */
export type EnumValue<V extends EnumVariants> = {
  [K in keyof V]: { tag: K; value: EnumVariantValue<V[K]> };
}[keyof V];

/** One flattened field of a normalized enum variant. */
export interface EnumVariantField {
  /** Field name in the value object, or null for newtype variants. */
  readonly name: string | null;
  readonly codec: AnyDecoder;
}

/** A normalized enum variant: its tag name and flattened field list. */
export interface EnumVariant {
  readonly name: string;
  readonly fields: readonly EnumVariantField[];
}

export class EnumDecoder<T> extends BaseDecoder<T, EnumLayout> {
  /** Normalized variants in discriminant order (introspection surface). */
  readonly variants: readonly EnumVariant[];
  #names: string[];
  #variantFields: (readonly EnumVariantField[])[];

  constructor(variants: EnumVariants) {
    const names = Object.keys(variants);
    // rkyv's derive rejects enums with more than 256 variants (u8 tag only).
    if (names.length > 256) {
      throw new Error(`taggedEnum supports at most 256 variants (rkyv's limit), got ${names.length}`);
    }
    // Normalize every variant to a flat field list. `instanceof` on the read
    // bases covers both read-only and full codecs (full codecs extend them).
    const variantFields: (readonly EnumVariantField[])[] = names.map((name) => {
      const def = variants[name];
      if (def === null) return [];
      if (def instanceof StructDecoder) {
        return def.fields.map((f) => ({ name: f.name, codec: f.codec }));
      }
      if (def instanceof BaseDecoder) {
        return [{ name: null, codec: def as AnyDecoder }];
      }
      return Object.entries(def).map(([fieldName, codec]) => ({ name: fieldName, codec }));
    });
    super({
      inline: variantFields.every((fields) => fields.every((f) => f.codec.inline)),
      hashable: false,
    });
    this.#names = names;
    this.#variantFields = variantFields;
    this.variants = names.map((name, i) => ({ name, fields: variantFields[i] }));
    this.meta = { kind: Kind.enum, variants: this.variants, layout: (fmt) => this.layout(fmt) };
  }

  computeLayout(fmt: RkyvFormat): EnumLayout {
    return enumLayout(
      fmt,
      this.#variantFields.map((fields) => fields.map((f) => f.codec)),
    );
  }

  #readValue(reader: RkyvReader, offset: number, lazy: boolean): unknown {
    const l = this.layout(reader.format);
    const disc = l.discSize === 1 ? reader.readU8(offset) : reader.readU16(offset);
    const tag = this.#names[disc];
    if (tag === undefined) {
      throw new Error(`invalid enum discriminant ${disc}`);
    }
    const fields = this.#variantFields[disc];
    if (fields.length === 0) {
      return { tag, value: null };
    }
    const offsets = l.variants[disc].fieldOffsets;
    if (fields.length === 1 && fields[0].name === null) {
      const codec = fields[0].codec;
      const fieldOffset = offset + offsets[0];
      const value = lazy ? codec.readLazy(reader, fieldOffset) : codec.read(reader, fieldOffset);
      return { tag, value };
    }
    const value: Record<string, unknown> = {};
    for (let i = 0; i < fields.length; i++) {
      const codec = fields[i].codec;
      const fieldOffset = offset + offsets[i];
      value[fields[i].name as string] = lazy
        ? codec.readLazy(reader, fieldOffset)
        : codec.read(reader, fieldOffset);
    }
    return { tag, value };
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#readValue(reader, offset, false) as T;
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.#readValue(reader, offset, true);
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
export function taggedEnum<const V extends EnumVariants>(variants: V): Decoder<EnumValue<V>> {
  return new EnumDecoder<EnumValue<V>>(variants);
}

// ============================================================================
// Untagged union
// ============================================================================

export type UnionValue<V extends Record<string, unknown>> = {
  [K in keyof V]: { type: K; value: V[K] };
}[keyof V];

export class UnionDecoder<V extends Record<string, unknown>> extends BaseDecoder<UnionValue<V>> {
  #discriminate: (reader: RkyvReader, offset: number) => keyof V;
  #variants: { [K in keyof V]: Decoder<V[K]> };
  #names: (keyof V)[];

  constructor(
    discriminate: (reader: RkyvReader, offset: number) => keyof V,
    variants: { [K in keyof V]: Decoder<V[K]> },
  ) {
    const names = Object.keys(variants) as (keyof V)[];
    super({
      inline: names.every((name) => variants[name].inline),
      hashable: false,
    });
    this.#discriminate = discriminate;
    this.#variants = variants;
    this.#names = names;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return unionLayout(
      fmt,
      this.#names.map((name) => this.#variants[name]),
    );
  }

  read(reader: RkyvReader, offset: number): UnionValue<V> {
    const type = this.#discriminate(reader, offset);
    return { type, value: this.#variants[type].read(reader, offset) } as UnionValue<V>;
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
  variants: { [K in keyof V]: Decoder<V[K]> }
): Decoder<UnionValue<V>> {
  return new UnionDecoder(discriminate, variants);
}

// ============================================================================
// Utility Codecs
// ============================================================================

export class TransformDecoder<T, U> extends BaseDecoder<U> {
  #inner: Decoder<T>;
  #decode: (value: T) => U;

  constructor(inner: Decoder<T>, decode: (value: T) => U) {
    super({ inline: inner.inline, hashable: inner.hashable });
    this.#inner = inner;
    this.#decode = decode;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#inner.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): U {
    return this.#decode(this.#inner.read(reader, offset));
  }
}

/**
 * Transform a codec's output with a mapping function.
 *
 * The third parameter (the encode-direction mapping) is accepted for
 * call-shape parity with the full and encode-only factories and ignored.
 */
export function transform<T, U>(
  codec: Decoder<T>,
  decode: (value: T) => U,
  _encode?: (value: U) => T
): Decoder<U> {
  return new TransformDecoder(codec, decode);
}

/**
 * Newtype wrapper — same binary representation, branded TS type.
 */
export function newtype<T, const Brand extends string>(
  inner: Decoder<T>,
  _brand: Brand
): Decoder<T & { readonly __brand: Brand }> {
  return inner as Decoder<T & { readonly __brand: Brand }>;
}

export class LazyDecoder<T> extends BaseDecoder<T> {
  #getCodec: () => Decoder<T>;
  #cached: Decoder<T> | null = null;

  constructor(getCodec: () => Decoder<T>) {
    // Recursive types necessarily contain indirection, so a lazy codec always
    // participates in the archive pass; they never serve as map keys.
    super({ inline: false, hashable: false });
    this.#getCodec = getCodec;
  }

  #get(): Decoder<T> {
    if (this.#cached === null) this.#cached = this.#getCodec();
    return this.#cached;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#get().layout(fmt);
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#get().read(reader, offset);
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.#get().readLazy(reader, offset);
  }
}

/**
 * Lazy codec for recursive types.
 */
export function lazy<T>(getCodec: () => Decoder<T>): Decoder<T> {
  return new LazyDecoder(getCodec);
}

/**
 * Pin a read codec's root operations (`decode`/`access`) to a specific
 * format.
 */
export function withFormat<T>(codec: Decoder<T, any>, format: RkyvFormat): Decoder<T> {
  return new FormatBoundDecoder(codec, format);
}
