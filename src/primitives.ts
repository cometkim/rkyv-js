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
 */

import { alignOffset, Codec, type AnyCodec, type Infer, type Layout } from './core/codec.ts';
import type { RkyvFormat } from './core/format.ts';
import type { RkyvHasher } from './core/hasher.ts';
import type { RkyvReader } from './core/reader.ts';
import type { RkyvTextEncoder, RkyvWriter } from './core/writer.ts';

function pointerBytes(fmt: RkyvFormat): 2 | 4 | 8 {
  return (fmt.pointerWidth / 8) as 2 | 4 | 8;
}

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

// Numeric element kinds for monomorphic vec fast paths. Each primitive
// codec carries its own kind (no module-scope instance registry — top-level
// registrations would retain every primitive in any bundle that touches
// this module, defeating tree-shaking of the unused ones).
const KIND_OTHER = 0;
const KIND_U8 = 1;
const KIND_I8 = 2;
const KIND_U16 = 3;
const KIND_I16 = 4;
const KIND_U32 = 5;
const KIND_I32 = 6;
const KIND_U64 = 7;
const KIND_I64 = 8;
const KIND_F32 = 9;
const KIND_F64 = 10;
const KIND_BOOL = 11;

// ============================================================================
// Primitive Codecs
// ============================================================================

class PrimitiveCodec<T> extends Codec<T, undefined> {
  /** Numeric-kind tag consumed by vec's monomorphic bulk paths. */
  readonly kind: number;
  #aligned: Layout;
  #packed: Layout;
  #read: (reader: RkyvReader, offset: number) => T;
  #write: (writer: RkyvWriter, value: T) => number;
  #hash: ((hasher: RkyvHasher, value: T) => void) | undefined;

  constructor(
    size: number,
    align: number,
    kind: number,
    read: (reader: RkyvReader, offset: number) => T,
    write: (writer: RkyvWriter, value: T) => number,
    // Primitive hashes never involve text, so the encoder is not threaded.
    hash?: (hasher: RkyvHasher, value: T) => void,
  ) {
    super({ inline: true, hashable: hash !== undefined });
    this.kind = kind;
    this.#aligned = { size, align };
    this.#packed = { size, align: 1 };
    this.#read = read;
    this.#write = write;
    this.#hash = hash;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return fmt.aligned ? this.#aligned : this.#packed;
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#read(reader, offset);
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
export const u8: Codec<number> = new PrimitiveCodec(1, 1, KIND_U8, (r, o) => r.readU8(o), (w, v) => w.writeU8(v), (h, v) => h.writeU8(v));
export const i8: Codec<number> = new PrimitiveCodec(1, 1, KIND_I8, (r, o) => r.readI8(o), (w, v) => w.writeI8(v), (h, v) => h.writeU8(v & 0xff));
export const u16: Codec<number> = new PrimitiveCodec(2, 2, KIND_U16, (r, o) => r.readU16(o), (w, v) => w.writeU16(v), (h, v) => h.writeU16(v));
export const i16: Codec<number> = new PrimitiveCodec(2, 2, KIND_I16, (r, o) => r.readI16(o), (w, v) => w.writeI16(v), (h, v) => h.writeU16(v & 0xffff));
export const u32: Codec<number> = new PrimitiveCodec(4, 4, KIND_U32, (r, o) => r.readU32(o), (w, v) => w.writeU32(v), (h, v) => h.writeU32(v));
export const i32: Codec<number> = new PrimitiveCodec(4, 4, KIND_I32, (r, o) => r.readI32(o), (w, v) => w.writeI32(v), (h, v) => h.writeU32(v));
export const u64: Codec<bigint> = new PrimitiveCodec(8, 8, KIND_U64, (r, o) => r.readU64(o), (w, v) => w.writeU64(v), (h, v) => h.writeU64(v));
export const i64: Codec<bigint> = new PrimitiveCodec(8, 8, KIND_I64, (r, o) => r.readI64(o), (w, v) => w.writeI64(v), (h, v) => h.writeU64(v));

// Float codecs (floats are not `Eq` in Rust, so they never hash).
export const f32: Codec<number> = new PrimitiveCodec(4, 4, KIND_F32, (r, o) => r.readF32(o), (w, v) => w.writeF32(v));
export const f64: Codec<number> = new PrimitiveCodec(8, 8, KIND_F64, (r, o) => r.readF64(o), (w, v) => w.writeF64(v));

// Boolean codec.
export const bool: Codec<boolean> = new PrimitiveCodec(
  1,
  1,
  KIND_BOOL,
  (r, o) => r.readBool(o),
  (w, v) => w.writeBool(v),
  (h, v) => h.writeU8(v ? 1 : 0),
);

// Unit codec — zero-sized; hashing is a no-op, exactly like `Hash for ()`.
export const unit: Codec<null> = new PrimitiveCodec<null>(
  0,
  1,
  KIND_OTHER,
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

// Char codec — a Unicode scalar value stored as u32 (KIND_OTHER: bulk
// paths cannot batch it because reading materializes a string).
export const char: Codec<string> = new PrimitiveCodec(
  4,
  4,
  KIND_OTHER,
  (r, o) => String.fromCodePoint(r.readU32(o)),
  (w, v) => w.writeU32(codePoint(v)),
  (h, v) => h.writeU32(codePoint(v)),
);

// ============================================================================
// String Codec (rkyv 0.8 inline/out-of-line hybrid repr)
// ============================================================================

interface StringLayout extends Layout {
  /** Bytes of an ArchivedUsize / relative pointer. */
  pb: 2 | 4 | 8;
  /** INLINE_CAPACITY = size_of::<OutOfLineRepr>() = 2 * pb. */
  inlineCapacity: number;
  /** OUT_OF_LINE_CAPACITY = (1 << (BITS - 2)) - 1. */
  maxLength: number;
}

interface StringResolver {
  pos: number;
  len: number;
  /** Encoded bytes, retained only when the string is inline. */
  bytes: Uint8Array | null;
}

class StringCodec extends Codec<string, StringResolver, StringLayout> {
  constructor() {
    super({ inline: false, hashable: true });
  }

  computeLayout(fmt: RkyvFormat): StringLayout {
    const pb = pointerBytes(fmt);
    return {
      size: pb * 2,
      align: fmt.aligned ? pb : 1,
      pb,
      inlineCapacity: pb * 2,
      maxLength: pb === 8 ? Number.MAX_SAFE_INTEGER : 2 ** (pb * 8 - 2) - 1,
    };
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

export const string: Codec<string> = new StringCodec();

// ============================================================================
// Vec<T>
// ============================================================================

/**
 * Lazy view over an archived sequence; elements decode on first access.
 */
class LazyVecView<E> {
  #reader: RkyvReader;
  #dataOffset: number;
  #element: Codec<E>;
  #stride: number;
  #cache: unknown[];
  readonly length: number;

  constructor(reader: RkyvReader, dataOffset: number, length: number, element: Codec<E>, stride: number) {
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

interface VecLayout extends Layout {
  pb: 2 | 4 | 8;
}

interface VecResolver {
  pos: number;
  len: number;
}

class VecCodec<T> extends Codec<T[], VecResolver, VecLayout> {
  #element: Codec<T>;
  #kind: number;
  #strideFormat: RkyvFormat | null = null;
  #stride = 0;

  constructor(element: Codec<T>) {
    super({ inline: false, hashable: false });
    this.#element = element;
    this.#kind = element instanceof PrimitiveCodec ? element.kind : KIND_OTHER;
  }

  // The vec header's layout never depends on the element — that is what
  // makes recursive types (`struct Tree { children: Vec<Tree> }`) legal.
  // Element geometry is memoized separately and only computed at
  // read/write time, when any recursion has already bottomed out.
  computeLayout(fmt: RkyvFormat): VecLayout {
    const pb = pointerBytes(fmt);
    return { size: pb * 2, align: fmt.aligned ? pb : 1, pb };
  }

  #elementStride(fmt: RkyvFormat): number {
    if (fmt !== this.#strideFormat) {
      const el = this.#element.layout(fmt);
      this.#stride = alignOffset(el.size, el.align);
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
    if (this.#kind !== KIND_OTHER) {
      this.#readPrimitive(reader, dataOffset, length, stride, result as unknown[]);
      return result;
    }
    const element = this.#element;
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
        case KIND_U16:
          for (let i = 0; i < length; i++) out[i] = view.getUint16(base + i * stride, le);
          return;
        case KIND_I16:
          for (let i = 0; i < length; i++) out[i] = view.getInt16(base + i * stride, le);
          return;
        case KIND_U32:
          for (let i = 0; i < length; i++) out[i] = view.getUint32(base + i * stride, le);
          return;
        case KIND_I32:
          for (let i = 0; i < length; i++) out[i] = view.getInt32(base + i * stride, le);
          return;
        case KIND_U64:
          for (let i = 0; i < length; i++) out[i] = view.getBigUint64(base + i * stride, le);
          return;
        case KIND_I64:
          for (let i = 0; i < length; i++) out[i] = view.getBigInt64(base + i * stride, le);
          return;
        case KIND_F32:
          for (let i = 0; i < length; i++) out[i] = view.getFloat32(base + i * stride, le);
          return;
        case KIND_F64:
          for (let i = 0; i < length; i++) out[i] = view.getFloat64(base + i * stride, le);
          return;
      }
    }
    switch (this.#kind) {
      case KIND_U8:
        for (let i = 0; i < length; i++) out[i] = reader.readU8(base + i * stride);
        break;
      case KIND_I8:
        for (let i = 0; i < length; i++) out[i] = reader.readI8(base + i * stride);
        break;
      case KIND_U16:
        for (let i = 0; i < length; i++) out[i] = reader.readU16(base + i * stride);
        break;
      case KIND_I16:
        for (let i = 0; i < length; i++) out[i] = reader.readI16(base + i * stride);
        break;
      case KIND_U32:
        for (let i = 0; i < length; i++) out[i] = reader.readU32(base + i * stride);
        break;
      case KIND_I32:
        for (let i = 0; i < length; i++) out[i] = reader.readI32(base + i * stride);
        break;
      case KIND_U64:
        for (let i = 0; i < length; i++) out[i] = reader.readU64(base + i * stride);
        break;
      case KIND_I64:
        for (let i = 0; i < length; i++) out[i] = reader.readI64(base + i * stride);
        break;
      case KIND_F32:
        for (let i = 0; i < length; i++) out[i] = reader.readF32(base + i * stride);
        break;
      case KIND_F64:
        for (let i = 0; i < length; i++) out[i] = reader.readF64(base + i * stride);
        break;
      case KIND_BOOL:
        for (let i = 0; i < length; i++) out[i] = reader.readBool(base + i * stride);
        break;
    }
  }

  #writePrimitive(writer: RkyvWriter, value: readonly unknown[]): void {
    switch (this.#kind) {
      case KIND_U8:
        for (let i = 0; i < value.length; i++) writer.writeU8(value[i] as number);
        break;
      case KIND_I8:
        for (let i = 0; i < value.length; i++) writer.writeI8(value[i] as number);
        break;
      case KIND_U16:
        for (let i = 0; i < value.length; i++) writer.writeU16(value[i] as number);
        break;
      case KIND_I16:
        for (let i = 0; i < value.length; i++) writer.writeI16(value[i] as number);
        break;
      case KIND_U32:
        for (let i = 0; i < value.length; i++) writer.writeU32(value[i] as number);
        break;
      case KIND_I32:
        for (let i = 0; i < value.length; i++) writer.writeI32(value[i] as number);
        break;
      case KIND_U64:
        for (let i = 0; i < value.length; i++) writer.writeU64(value[i] as bigint);
        break;
      case KIND_I64:
        for (let i = 0; i < value.length; i++) writer.writeI64(value[i] as bigint);
        break;
      case KIND_F32:
        for (let i = 0; i < value.length; i++) writer.writeF32(value[i] as number);
        break;
      case KIND_F64:
        for (let i = 0; i < value.length; i++) writer.writeF64(value[i] as number);
        break;
      case KIND_BOOL:
        for (let i = 0; i < value.length; i++) writer.writeBool(value[i] as boolean);
        break;
    }
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    const l = this.layout(reader.format);
    const dataOffset = reader.readRelPtr(offset);
    const length = reader.readUsize(offset + l.pb);
    return new LazyVecView(reader, dataOffset, length, this.#element, this.#elementStride(reader.format));
  }

  archive(writer: RkyvWriter, value: T[]): VecResolver {
    const element = this.#element;
    const el = element.layout(writer.format);
    const stride = this.#elementStride(writer.format);

    if (this.#kind !== KIND_OTHER) {
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
export function vec<C extends AnyCodec>(element: C): Codec<Infer<C>[]> {
  return new VecCodec(element);
}

// ============================================================================
// Option<T>
// ============================================================================

interface OptionLayout extends Layout {
  valueOffset: number;
}

class OptionCodec<T> extends Codec<T | null, unknown, OptionLayout> {
  #inner: Codec<T>;

  constructor(inner: Codec<T>) {
    super({ inline: inner.inline, hashable: false });
    this.#inner = inner;
  }

  computeLayout(fmt: RkyvFormat): OptionLayout {
    const el = this.#inner.layout(fmt);
    const valueOffset = alignOffset(1, el.align);
    return {
      size: valueOffset + el.size,
      align: Math.max(1, el.align),
      valueOffset,
    };
  }

  read(reader: RkyvReader, offset: number): T | null {
    if (reader.readU8(offset) === 0) return null;
    return this.#inner.read(reader, offset + this.layout(reader.format).valueOffset);
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    if (reader.readU8(offset) === 0) return null;
    return this.#inner.readLazy(reader, offset + this.layout(reader.format).valueOffset);
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
export function option<C extends AnyCodec>(inner: C): Codec<Infer<C> | null> {
  return new OptionCodec(inner);
}

// ============================================================================
// Box<T> / Rc<T> / Arc<T> / Weak<T>
// ============================================================================

interface PtrResolver {
  pos: number;
}

class BoxCodec<T> extends Codec<T, PtrResolver> {
  #inner: Codec<T>;

  constructor(inner: Codec<T>) {
    super({ inline: false, hashable: false });
    this.#inner = inner;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    const pb = pointerBytes(fmt);
    return { size: pb, align: fmt.aligned ? pb : 1 };
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#inner.read(reader, reader.readRelPtr(offset));
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.#inner.readLazy(reader, reader.readRelPtr(offset));
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

class WeakCodec<T> extends Codec<T | null, PtrResolver | null> {
  #inner: Codec<T>;

  constructor(inner: Codec<T>) {
    super({ inline: false, hashable: false });
    this.#inner = inner;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    const pb = pointerBytes(fmt);
    return { size: pb, align: fmt.aligned ? pb : 1 };
  }

  read(reader: RkyvReader, offset: number): T | null {
    if (reader.isInvalidPtr(offset)) return null;
    return this.#inner.read(reader, reader.readRelPtr(offset));
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    if (reader.isInvalidPtr(offset)) return null;
    return this.#inner.readLazy(reader, reader.readRelPtr(offset));
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
export function weak<C extends AnyCodec>(inner: C): Codec<Infer<C> | null> {
  return new WeakCodec(inner);
}

// ============================================================================
// [T; N] — fixed-size array
// ============================================================================

interface ArrayLayout extends Layout {
  stride: number;
}

class ArrayCodec<T> extends Codec<T[], unknown[] | undefined, ArrayLayout> {
  #element: Codec<T>;
  #length: number;

  constructor(element: Codec<T>, length: number) {
    super({ inline: element.inline, hashable: false });
    this.#element = element;
    this.#length = length;
  }

  computeLayout(fmt: RkyvFormat): ArrayLayout {
    const el = this.#element.layout(fmt);
    const stride = alignOffset(el.size, el.align);
    return { size: stride * this.#length, align: el.align, stride };
  }

  #checkLength(value: T[]): void {
    if (value.length !== this.#length) {
      throw new Error(`Array length mismatch: expected ${this.#length}, got ${value.length}`);
    }
  }

  read(reader: RkyvReader, offset: number): T[] {
    const l = this.layout(reader.format);
    const element = this.#element;
    const result: T[] = new Array<T>(this.#length);
    for (let i = 0; i < this.#length; i++) {
      result[i] = element.read(reader, offset + i * l.stride);
    }
    return result;
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return new LazyVecView(reader, offset, this.#length, this.#element, this.layout(reader.format).stride);
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
export function array<C extends AnyCodec>(element: C, length: number): Codec<Infer<C>[]> {
  return new ArrayCodec(element, length);
}

// ============================================================================
// Tuple
// ============================================================================

interface TupleLayout extends Layout {
  offsets: number[];
}

class TupleCodec<T extends unknown[]> extends Codec<T, unknown[] | undefined, TupleLayout> {
  #codecs: AnyCodec[];

  constructor(codecs: AnyCodec[]) {
    super({
      inline: codecs.every((c) => c.inline),
      hashable: codecs.every((c) => c.hashable),
    });
    this.#codecs = codecs;
  }

  computeLayout(fmt: RkyvFormat): TupleLayout {
    const codecs = this.#codecs;
    let size = 0;
    let align = 1;
    const offsets: number[] = new Array<number>(codecs.length);
    for (let i = 0; i < codecs.length; i++) {
      const el = codecs[i].layout(fmt);
      size = alignOffset(size, el.align);
      offsets[i] = size;
      size += el.size;
      align = Math.max(align, el.align);
    }
    return { size: alignOffset(size, align), align, offsets };
  }

  read(reader: RkyvReader, offset: number): T {
    const l = this.layout(reader.format);
    const codecs = this.#codecs;
    const result: unknown[] = new Array<unknown>(codecs.length);
    for (let i = 0; i < codecs.length; i++) {
      result[i] = codecs[i].read(reader, offset + l.offsets[i]);
    }
    return result as T;
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

interface StructLayout extends Layout {
  offsets: number[];
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
 * can flatten variant bodies into rkyv's `repr(u8)` enum layout.
 */
export class StructCodec<T extends Record<string, unknown>> extends Codec<
  T,
  unknown[] | undefined,
  StructLayout
> {
  readonly fields: readonly StructField[];
  #names: string[];
  #codecs: AnyCodec[];
  #viewFormat: RkyvFormat | null = null;
  #ViewClass: LazyViewConstructor | null = null;

  constructor(fields: { [K in keyof T]: Codec<T[K]> }) {
    const names = Object.keys(fields);
    const codecs = names.map((name) => fields[name] as AnyCodec);
    super({
      inline: codecs.every((c) => c.inline),
      hashable: codecs.every((c) => c.hashable),
    });
    this.#names = names;
    this.#codecs = codecs;
    this.fields = names.map((name, i) => ({ name, codec: codecs[i] }));
  }

  computeLayout(fmt: RkyvFormat): StructLayout {
    const codecs = this.#codecs;
    let size = 0;
    let align = 1;
    const offsets: number[] = new Array<number>(codecs.length);
    for (let i = 0; i < codecs.length; i++) {
      const el = codecs[i].layout(fmt);
      size = alignOffset(size, el.align);
      offsets[i] = size;
      size += el.size;
      align = Math.max(align, el.align);
    }
    return { size: alignOffset(size, align), align, offsets };
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
 * - a record of codecs — struct variant (`Move: { x: r.i32, y: r.i32 }`)
 * - a struct codec — struct variant, fields flattened into the enum layout
 * - any other codec — newtype variant (`Write: r.string`), value is the
 *   inner value itself
 */
export type EnumVariantDef = null | AnyCodec | Record<string, AnyCodec>;

export type EnumVariants = Record<string, EnumVariantDef>;

export type EnumVariantValue<D> = D extends null
  ? null
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

interface VariantField {
  /** Field name in the value object, or null for newtype variants. */
  name: string | null;
  codec: AnyCodec;
}

interface VariantLayout {
  fieldOffsets: number[];
}

interface EnumLayout extends Layout {
  discSize: 1 | 2;
  variants: VariantLayout[];
}

class EnumCodec<V extends EnumVariants> extends Codec<EnumValue<V>, unknown[] | null, EnumLayout> {
  #names: string[];
  #variantFields: VariantField[][];
  #variantIndex: Map<string, number>;

  constructor(variants: V) {
    const names = Object.keys(variants);
    // rkyv's derive rejects enums with more than 256 variants (u8 tag only).
    if (names.length > 256) {
      throw new Error(`taggedEnum supports at most 256 variants (rkyv's limit), got ${names.length}`);
    }
    // Normalize every variant to a flat field list.
    const variantFields: VariantField[][] = names.map((name) => {
      const def = variants[name];
      if (def === null) return [];
      if (def instanceof StructCodec) {
        return def.fields.map((f) => ({ name: f.name, codec: f.codec }));
      }
      if (def instanceof Codec) {
        return [{ name: null, codec: def as AnyCodec }];
      }
      return Object.entries(def).map(([fieldName, codec]) => ({ name: fieldName, codec }));
    });
    super({
      inline: variantFields.every((fields) => fields.every((f) => f.codec.inline)),
      hashable: false,
    });
    this.#names = names;
    this.#variantFields = variantFields;
    this.#variantIndex = new Map(names.map((name, i) => [name, i]));
  }

  computeLayout(fmt: RkyvFormat): EnumLayout {
    const count = this.#names.length;
    const discSize: 1 | 2 = count <= 256 ? 1 : 2;
    const discAlign = fmt.aligned ? discSize : 1;
    let enumAlign: number = discAlign;
    let maxVariantSize: number = discSize;

    // Each variant is a repr(C) struct `{ tag, ...fields }` with fields laid
    // out directly after the tag (RFC 2195); the enum is their union.
    const variants: VariantLayout[] = this.#variantFields.map((fields) => {
      let off: number = discSize;
      let variantAlign: number = discAlign;
      const fieldOffsets: number[] = new Array<number>(fields.length);
      for (let i = 0; i < fields.length; i++) {
        const el = fields[i].codec.layout(fmt);
        off = alignOffset(off, el.align);
        fieldOffsets[i] = off;
        off += el.size;
        variantAlign = Math.max(variantAlign, el.align);
      }
      enumAlign = Math.max(enumAlign, variantAlign);
      maxVariantSize = Math.max(maxVariantSize, alignOffset(off, variantAlign));
      return { fieldOffsets };
    });

    return {
      size: alignOffset(maxVariantSize, enumAlign),
      align: enumAlign,
      discSize,
      variants,
    };
  }

  #readValue(reader: RkyvReader, offset: number, lazy: boolean): EnumValue<V> {
    const l = this.layout(reader.format);
    const disc = l.discSize === 1 ? reader.readU8(offset) : reader.readU16(offset);
    const tag = this.#names[disc];
    if (tag === undefined) {
      throw new Error(`invalid enum discriminant ${disc}`);
    }
    const fields = this.#variantFields[disc];
    if (fields.length === 0) {
      return { tag, value: null } as EnumValue<V>;
    }
    const offsets = l.variants[disc].fieldOffsets;
    if (fields.length === 1 && fields[0].name === null) {
      const codec = fields[0].codec;
      const fieldOffset = offset + offsets[0];
      const value = lazy ? codec.readLazy(reader, fieldOffset) : codec.read(reader, fieldOffset);
      return { tag, value } as EnumValue<V>;
    }
    const value: Record<string, unknown> = {};
    for (let i = 0; i < fields.length; i++) {
      const codec = fields[i].codec;
      const fieldOffset = offset + offsets[i];
      value[fields[i].name as string] = lazy
        ? codec.readLazy(reader, fieldOffset)
        : codec.read(reader, fieldOffset);
    }
    return { tag, value } as EnumValue<V>;
  }

  read(reader: RkyvReader, offset: number): EnumValue<V> {
    return this.#readValue(reader, offset, false);
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.#readValue(reader, offset, true);
  }

  #discriminant(tag: string): number {
    const disc = this.#variantIndex.get(tag);
    if (disc === undefined) {
      throw new Error(`unknown enum variant ${tag}`);
    }
    return disc;
  }

  #fieldValues(fields: VariantField[], value: unknown): unknown[] {
    if (fields.length === 1 && fields[0].name === null) return [value];
    const record = value as Record<string, unknown>;
    return fields.map((f) => record[f.name as string]);
  }

  archive(writer: RkyvWriter, value: EnumValue<V>): unknown[] | null {
    const disc = this.#discriminant(value.tag as string);
    const fields = this.#variantFields[disc];
    if (fields.length === 0) return null;
    const values = this.#fieldValues(fields, value.value);
    const resolvers: unknown[] = new Array<unknown>(fields.length);
    for (let i = 0; i < fields.length; i++) {
      const codec = fields[i].codec;
      resolvers[i] = codec.inline ? undefined : codec.archive(writer, values[i]);
    }
    return resolvers;
  }

  resolve(writer: RkyvWriter, value: EnumValue<V>, resolver: unknown[] | null): number {
    const l = this.layout(writer.format);
    const disc = this.#discriminant(value.tag as string);
    const pos = writer.pos;
    if (l.discSize === 1) {
      writer.writeU8(disc);
    } else {
      writer.writeU16(disc);
    }
    const fields = this.#variantFields[disc];
    if (fields.length > 0) {
      const offsets = l.variants[disc].fieldOffsets;
      const values = this.#fieldValues(fields, value.value);
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

class UnionCodec<V extends Record<string, unknown>> extends Codec<UnionValue<V>, unknown> {
  #discriminate: (reader: RkyvReader, offset: number) => keyof V;
  #variants: { [K in keyof V]: Codec<V[K]> };
  #names: (keyof V)[];

  constructor(
    discriminate: (reader: RkyvReader, offset: number) => keyof V,
    variants: { [K in keyof V]: Codec<V[K]> },
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
    let size = 0;
    let align = 1;
    for (const name of this.#names) {
      const el = this.#variants[name].layout(fmt);
      size = Math.max(size, el.size);
      align = Math.max(align, el.align);
    }
    return { size: alignOffset(size, align), align };
  }

  read(reader: RkyvReader, offset: number): UnionValue<V> {
    const type = this.#discriminate(reader, offset);
    return { type, value: this.#variants[type].read(reader, offset) } as UnionValue<V>;
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

class TransformCodec<T, U> extends Codec<U, unknown> {
  #inner: Codec<T>;
  #decode: (value: T) => U;
  #encode: (value: U) => T;

  constructor(inner: Codec<T>, decode: (value: T) => U, encode: (value: U) => T) {
    super({ inline: inner.inline, hashable: inner.hashable });
    this.#inner = inner;
    this.#decode = decode;
    this.#encode = encode;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#inner.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): U {
    return this.#decode(this.#inner.read(reader, offset));
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

class LazyCodec<T> extends Codec<T> {
  #getCodec: () => Codec<T>;
  #cached: Codec<T> | null = null;

  constructor(getCodec: () => Codec<T>) {
    // Recursive types necessarily contain indirection, so a lazy codec always
    // participates in the archive pass; they never serve as map keys.
    super({ inline: false, hashable: false });
    this.#getCodec = getCodec;
  }

  #get(): Codec<T> {
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
export function lazy<T>(getCodec: () => Codec<T>): Codec<T> {
  return new LazyCodec(getCodec);
}
