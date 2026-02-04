/**
 * Intrinsic codecs for rkyv-js
 *
 * This module provides all built-in codecs:
 * - Primitives: u8, i8, u16, i16, u32, i32, u64, i64, f32, f64, bool, unit, char, string
 * - Containers: vec, option, box, array, tuple
 * - Structs & Enums: struct, taggedEnum, union
 * - Utilities: transform, newtype, lazy, hashMap
 * - Top-level functions: access, decode, encode
 */

import { alignOffset, type RkyvCodec, type Resolver } from './codec.ts';
import { RkyvReader } from './reader.ts';
import { RkyvWriter } from './writer.ts';

// ============================================================================
// Primitive Codecs
// ============================================================================

function createPrimitiveCodec<T>(
  size: number,
  align: number,
  read: (reader: RkyvReader, offset: number) => T,
  write: (writer: RkyvWriter, value: T) => number
): RkyvCodec<T> {
  return {
    size,
    align,
    access: read, // For primitives, access === decode
    decode: read,
    _archive: () => ({ pos: 0 }),
    _resolve: (writer, value) => write(writer, value),
    encode: (writer, value) => write(writer, value),
  };
}

// Integer Codecs
export const u8: RkyvCodec<number> = createPrimitiveCodec(1, 1, (r, o) => r.readU8(o), (w, v) => w.writeU8(v));
export const i8: RkyvCodec<number> = createPrimitiveCodec(1, 1, (r, o) => r.readI8(o), (w, v) => w.writeI8(v));
export const u16: RkyvCodec<number> = createPrimitiveCodec(2, 2, (r, o) => r.readU16(o), (w, v) => w.writeU16(v));
export const i16: RkyvCodec<number> = createPrimitiveCodec(2, 2, (r, o) => r.readI16(o), (w, v) => w.writeI16(v));
export const u32: RkyvCodec<number> = createPrimitiveCodec(4, 4, (r, o) => r.readU32(o), (w, v) => w.writeU32(v));
export const i32: RkyvCodec<number> = createPrimitiveCodec(4, 4, (r, o) => r.readI32(o), (w, v) => w.writeI32(v));
export const u64: RkyvCodec<bigint> = createPrimitiveCodec(8, 8, (r, o) => r.readU64(o), (w, v) => w.writeU64(v));
export const i64: RkyvCodec<bigint> = createPrimitiveCodec(8, 8, (r, o) => r.readI64(o), (w, v) => w.writeI64(v));

// Float Codecs
export const f32: RkyvCodec<number> = createPrimitiveCodec(4, 4, (r, o) => r.readF32(o), (w, v) => w.writeF32(v));
export const f64: RkyvCodec<number> = createPrimitiveCodec(8, 8, (r, o) => r.readF64(o), (w, v) => w.writeF64(v));

// Boolean Codec
export const bool: RkyvCodec<boolean> = createPrimitiveCodec(1, 1, (r, o) => r.readBool(o), (w, v) => w.writeBool(v));

// Unit Codec
export const unit: RkyvCodec<null> = {
  size: 0,
  align: 1,
  _archive: () => ({ pos: 0 }),
  _resolve: (writer) => writer.pos,
  access: () => null,
  decode: () => null,
  encode: (writer) => writer.pos,
};

// Char Codec
export const char: RkyvCodec<string> = {
  size: 4,
  align: 4,
  _archive: () => ({ pos: 0 }),
  _resolve: (writer, value) => writer.writeU32(value.codePointAt(0) ?? 0),
  access: (reader, offset) => String.fromCodePoint(reader.readU32(offset)),
  decode: (reader, offset) => String.fromCodePoint(reader.readU32(offset)),
  encode(writer, value) {
    return this._resolve(writer, value, this._archive(writer, value));
  },
};

// String Codec (rkyv 0.8 format)
function decodeString(reader: RkyvReader, offset: number): string {
  const firstByte = reader.readU8(offset);
  const isInline = (firstByte & 0xc0) !== 0x80;

  if (isInline) {
    let length = 0;
    while (length < 8) {
      if (reader.readU8(offset + length) === 0xff) break;
      length++;
    }
    return reader.readText(offset, length);
  } else {
    const lenWithMarker = reader.readU32(offset);
    const length = (lenWithMarker & 0x3f) | ((lenWithMarker >>> 8) << 6);
    const relPtr = reader.readI32(offset + 4);
    return reader.readText(offset + relPtr, length);
  }
}

export const string: RkyvCodec<string> = {
  size: 8,
  align: 4,
  access: decodeString, // Strings are immutable, no benefit from lazy access
  decode: decodeString,

  _archive(writer, value) {
    const bytes = writer.encodeText(value);
    if (bytes.length <= 8) {
      return { pos: 0, len: bytes.length };
    } else {
      const pos = writer.writeBytes(bytes);
      return { pos, len: bytes.length };
    }
  },

  _resolve(writer, value, resolver) {
    writer.align(4);
    const structPos = writer.pos;
    const bytes = writer.encodeText(value);

    if (bytes.length <= 8) {
      for (let i = 0; i < bytes.length; i++) writer.writeU8(bytes[i]);
      for (let i = bytes.length; i < 8; i++) writer.writeU8(0xff);
    } else {
      const len = bytes.length;
      const encodedLen = (len & 0x3f) | 0x80 | ((len & ~0x3f) << 2);
      writer.writeU32(encodedLen);
      writer.writeI32((resolver as { pos: number }).pos - structPos);
    }
    return structPos;
  },

  encode(writer, value) {
    const resolver = this._archive(writer, value);
    return this._resolve(writer, value, resolver);
  },
};

// ============================================================================
// Container Codecs
// ============================================================================

/**
 * Vec<T> - Variable-length array
 */
export function vec<T>(element: RkyvCodec<T>): RkyvCodec<T[]> {
  // Compute elementStride lazily to support recursive types via r.lazy
  let _elementStride: number | null = null;
  const getElementStride = () => {
    if (_elementStride === null) {
      _elementStride = alignOffset(element.size, element.align);
    }
    return _elementStride;
  };

  return {
    size: 8, // relptr (4) + len (4)
    align: 4,

    // Zero-copy access: returns a Proxy that lazily decodes elements
    access(reader, offset) {
      const dataOffset = reader.readRelPtr32(offset);
      const length = reader.readU32(offset + 4);
      const cache = new Map<number, T>();
      const elementStride = getElementStride();

      return new Proxy([] as T[], {
        get(target, prop) {
          if (prop === 'length') return length;
          if (prop === Symbol.iterator) {
            return function* () {
              for (let i = 0; i < length; i++) {
                if (!cache.has(i)) {
                  const elemOffset = dataOffset + i * elementStride;
                  cache.set(i, element.access(reader, elemOffset));
                }
                yield cache.get(i)!;
              }
            };
          }
          if (typeof prop === 'string') {
            const index = parseInt(prop, 10);
            if (!isNaN(index) && index >= 0 && index < length) {
              if (!cache.has(index)) {
                const elemOffset = dataOffset + index * elementStride;
                cache.set(index, element.access(reader, elemOffset));
              }
              return cache.get(index);
            }
          }
          // Forward other array methods
          return Reflect.get(target, prop);
        },
        has(target, prop) {
          if (typeof prop === 'string') {
            const index = parseInt(prop, 10);
            if (!isNaN(index)) return index >= 0 && index < length;
          }
          return Reflect.has(target, prop);
        },
        ownKeys() {
          return [...Array(length).keys()].map(String);
        },
        getOwnPropertyDescriptor(target, prop) {
          if (typeof prop === 'string') {
            const index = parseInt(prop, 10);
            if (!isNaN(index) && index >= 0 && index < length) {
              return { enumerable: true, configurable: true, writable: false };
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
    },

    decode(reader, offset) {
      const dataOffset = reader.readRelPtr32(offset);
      const length = reader.readU32(offset + 4);
      const result: T[] = new Array(length);
      let currentOffset = dataOffset;

      for (let i = 0; i < length; i++) {
        currentOffset = alignOffset(currentOffset, element.align);
        result[i] = element.decode(reader, currentOffset);
        currentOffset += element.size;
      }
      return result;
    },

    _archive(writer, value) {
      if (value.length === 0) {
        return { pos: writer.pos, len: 0, elementResolvers: [] };
      }

      const elementResolvers: Resolver[] = [];
      for (const item of value) {
        elementResolvers.push(element._archive(writer, item));
      }

      writer.align(element.align);
      const elementsStartPos = writer.pos;

      for (let i = 0; i < value.length; i++) {
        writer.align(element.align);
        element._resolve(writer, value[i], elementResolvers[i]);
      }

      return { pos: elementsStartPos, len: value.length, elementResolvers };
    },

    _resolve(writer, _value, resolver) {
      writer.align(4);
      const structPos = writer.pos;
      const ptrPos = writer.reserveRelPtr32();
      const r = resolver as { pos: number; len: number };
      writer.writeU32(r.len);

      if (r.len > 0) {
        writer.writeRelPtr32At(ptrPos, r.pos);
      } else {
        writer.writeRelPtr32At(ptrPos, 0);
      }
      return structPos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

/**
 * Option<T> - Optional value
 */
export function option<T>(inner: RkyvCodec<T>): RkyvCodec<T | null> {
  const tagSize = 1;
  const paddingToInner = alignOffset(tagSize, inner.align) - tagSize;
  const totalSize = tagSize + paddingToInner + inner.size;

  return {
    size: totalSize,
    align: Math.max(1, inner.align),

    access(reader, offset) {
      const tag = reader.readU8(offset);
      if (tag === 0) return null;
      return inner.access(reader, offset + tagSize + paddingToInner);
    },

    decode(reader, offset) {
      const tag = reader.readU8(offset);
      if (tag === 0) return null;
      return inner.decode(reader, offset + tagSize + paddingToInner);
    },

    _archive(writer, value) {
      if (value === null) return { pos: writer.pos, inner: null };
      return { pos: writer.pos, inner: inner._archive(writer, value) };
    },

    _resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;

      if (value === null) {
        writer.writeU8(0);
        for (let i = 0; i < paddingToInner + inner.size; i++) writer.writeU8(0);
      } else {
        writer.writeU8(1);
        for (let i = 0; i < paddingToInner; i++) writer.writeU8(0);
        inner._resolve(writer, value, (resolver as unknown as { inner: Resolver }).inner);
      }
      return pos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

/**
 * Box<T> - Heap-allocated pointer
 */
export function box<T>(inner: RkyvCodec<T>): RkyvCodec<T> {
  return {
    size: 4,
    align: 4,

    access(reader, offset) {
      const dataOffset = reader.readRelPtr32(offset);
      return inner.access(reader, dataOffset);
    },

    decode(reader, offset) {
      const dataOffset = reader.readRelPtr32(offset);
      return inner.decode(reader, dataOffset);
    },

    _archive(writer, value) {
      const resolver = inner._archive(writer, value);
      writer.align(inner.align);
      inner._resolve(writer, value, resolver);
      return { pos: writer.pos - inner.size };
    },

    _resolve(writer, _value, resolver) {
      writer.align(4);
      const pos = writer.pos;
      const ptrPos = writer.reserveRelPtr32();
      writer.writeRelPtr32At(ptrPos, (resolver as { pos: number }).pos);
      return pos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

/**
 * [T; N] - Fixed-size array
 */
export function array<T>(element: RkyvCodec<T>, length: number): RkyvCodec<T[]> {
  const elementStride = alignOffset(element.size, element.align);
  const totalSize = elementStride * length;

  return {
    size: totalSize,
    align: element.align,

    // Zero-copy access with lazy element decoding
    access(reader, offset) {
      const cache = new Map<number, T>();

      return new Proxy([] as T[], {
        get(target, prop) {
          if (prop === 'length') return length;
          if (prop === Symbol.iterator) {
            return function* () {
              for (let i = 0; i < length; i++) {
                if (!cache.has(i)) {
                  cache.set(i, element.access(reader, offset + i * elementStride));
                }
                yield cache.get(i)!;
              }
            };
          }
          if (typeof prop === 'string') {
            const index = parseInt(prop, 10);
            if (!isNaN(index) && index >= 0 && index < length) {
              if (!cache.has(index)) {
                cache.set(index, element.access(reader, offset + index * elementStride));
              }
              return cache.get(index);
            }
          }
          return Reflect.get(target, prop);
        },
        has(target, prop) {
          if (typeof prop === 'string') {
            const index = parseInt(prop, 10);
            if (!isNaN(index)) return index >= 0 && index < length;
          }
          return Reflect.has(target, prop);
        },
        ownKeys() {
          return [...Array(length).keys()].map(String);
        },
        getOwnPropertyDescriptor(target, prop) {
          if (typeof prop === 'string') {
            const index = parseInt(prop, 10);
            if (!isNaN(index) && index >= 0 && index < length) {
              return { enumerable: true, configurable: true, writable: false };
            }
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
    },

    decode(reader, offset) {
      const result: T[] = new Array(length);
      for (let i = 0; i < length; i++) {
        result[i] = element.decode(reader, offset + i * elementStride);
      }
      return result;
    },

    _archive(writer, value) {
      if (value.length !== length) {
        throw new Error(`Array length mismatch: expected ${length}, got ${value.length}`);
      }
      const resolvers: Resolver[] = [];
      for (const item of value) {
        resolvers.push(element._archive(writer, item));
      }
      return { pos: writer.pos, resolvers };
    },

    _resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;
      const resolvers = (resolver as unknown as { resolvers: Resolver[] }).resolvers;

      for (let i = 0; i < length; i++) {
        writer.align(element.align);
        element._resolve(writer, value[i], resolvers[i]);
      }
      return pos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

/**
 * Tuple - heterogeneous fixed-size collection
 */
export function tuple<T extends unknown[]>(
  ...codecs: { [K in keyof T]: RkyvCodec<T[K]> }
): RkyvCodec<T> {
  let currentSize = 0;
  let maxAlign = 1;
  const offsets: number[] = [];

  for (const codec of codecs) {
    currentSize = alignOffset(currentSize, codec.align);
    offsets.push(currentSize);
    currentSize += codec.size;
    maxAlign = Math.max(maxAlign, codec.align);
  }
  const totalSize = alignOffset(currentSize, maxAlign);

  return {
    size: totalSize,
    align: maxAlign,

    // Tuple access with lazy element decoding
    access(reader, offset) {
      const cache = new Map<number, unknown>();
      const length = codecs.length;

      return new Proxy([] as unknown as T, {
        get(target, prop) {
          if (prop === 'length') return length;
          if (typeof prop === 'string') {
            const index = parseInt(prop, 10);
            if (!isNaN(index) && index >= 0 && index < length) {
              if (!cache.has(index)) {
                cache.set(index, codecs[index].access(reader, offset + offsets[index]));
              }
              return cache.get(index);
            }
          }
          return Reflect.get(target, prop);
        },
      });
    },

    decode(reader, offset) {
      const result: unknown[] = new Array(codecs.length);
      for (let i = 0; i < codecs.length; i++) {
        result[i] = codecs[i].decode(reader, offset + offsets[i]);
      }
      return result as T;
    },

    _archive(writer, value) {
      const resolvers: Resolver[] = [];
      for (let i = 0; i < codecs.length; i++) {
        resolvers.push(codecs[i]._archive(writer, value[i]));
      }
      return { pos: writer.pos, resolvers };
    },

    _resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;
      const resolvers = (resolver as unknown as { resolvers: Resolver[] }).resolvers;

      for (let i = 0; i < codecs.length; i++) {
        writer.align(codecs[i].align);
        codecs[i]._resolve(writer, value[i], resolvers[i]);
      }
      writer.padTo(pos + totalSize);
      return pos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

// ============================================================================
// Struct & Enum Codecs
// ============================================================================

/**
 * Struct - C-style struct with named fields
 *
 * @example
 * ```typescript
 * const Point = r.struct({
 *   x: r.f64,
 *   y: r.f64,
 * });
 * ```
 */
export function struct<T extends Record<string, unknown>>(
  fields: { [K in keyof T]: RkyvCodec<T[K]> }
): RkyvCodec<T> {
  const fieldNames = Object.keys(fields) as (keyof T)[];
  const fieldCodecs = fieldNames.map((name) => ({ name, codec: fields[name] }));

  // Calculate C-style layout
  let currentOffset = 0;
  let maxAlign = 1;
  const fieldOffsets = new Map<keyof T, number>();

  for (const { name, codec } of fieldCodecs) {
    currentOffset = alignOffset(currentOffset, codec.align);
    fieldOffsets.set(name, currentOffset);
    currentOffset += codec.size;
    maxAlign = Math.max(maxAlign, codec.align);
  }
  const totalSize = alignOffset(currentOffset, maxAlign);

  return {
    size: totalSize,
    align: maxAlign,

    /**
     * Zero-copy access: Returns a Proxy that lazily decodes fields on demand.
     * Fields are cached after first access for repeated reads.
     */
    access(reader, offset) {
      const cache = new Map<keyof T, T[keyof T]>();
      const fieldMap = new Map(fieldCodecs.map(f => [f.name as string, f]));

      return new Proxy({} as T, {
        get(target, prop) {
          const name = prop as keyof T;
          if (fieldMap.has(prop as string)) {
            if (!cache.has(name)) {
              const { codec } = fieldMap.get(prop as string)!;
              const fieldOffset = fieldOffsets.get(name)!;
              cache.set(name, codec.access(reader, offset + fieldOffset) as T[keyof T]);
            }
            return cache.get(name);
          }
          return Reflect.get(target, prop);
        },
        has(target, prop) {
          if (fieldMap.has(prop as string)) return true;
          return Reflect.has(target, prop);
        },
        ownKeys() {
          return fieldNames as string[];
        },
        getOwnPropertyDescriptor(target, prop) {
          if (fieldMap.has(prop as string)) {
            return { enumerable: true, configurable: true, writable: false };
          }
          return Reflect.getOwnPropertyDescriptor(target, prop);
        },
      });
    },

    decode(reader, offset) {
      const result = {} as T;
      for (const { name, codec } of fieldCodecs) {
        result[name] = codec.decode(reader, offset + fieldOffsets.get(name)!) as T[keyof T];
      }
      return result;
    },

    _archive(writer, value) {
      const fieldResolvers = new Map<keyof T, Resolver>();
      for (const { name, codec } of fieldCodecs) {
        fieldResolvers.set(name, codec._archive(writer, value[name]));
      }
      return { pos: writer.pos, fieldResolvers };
    },

    _resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;
      const fieldResolvers = (resolver as unknown as { fieldResolvers: Map<keyof T, Resolver> }).fieldResolvers;

      for (const { name, codec } of fieldCodecs) {
        writer.padTo(pos + fieldOffsets.get(name)!);
        codec._resolve(writer, value[name], fieldResolvers.get(name)!);
      }
      writer.padTo(pos + totalSize);
      return pos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

/**
 * Tagged enum value type
 */
export type EnumValue<V extends Record<string, unknown>> = {
  [K in keyof V]: { tag: K; value: V[K] };
}[keyof V];

/**
 * Enum - Rust-style tagged union
 *
 * @example
 * ```typescript
 * const Message = r.taggedEnum({
 *   Quit: r.unit,
 *   Move: r.struct({ x: r.i32, y: r.i32 }),
 *   Write: r.struct({ text: r.string }),
 * });
 * ```
 */
export function taggedEnum<V extends Record<string, unknown>>(
  variants: { [K in keyof V]: V[K] extends null ? RkyvCodec<null> : RkyvCodec<V[K]> }
): RkyvCodec<EnumValue<V>> {
  const variantNames = Object.keys(variants) as (keyof V)[];
  const variantCount = variantNames.length;

  // Discriminant size
  let discriminantSize: 1 | 2 | 4;
  if (variantCount <= 256) discriminantSize = 1;
  else if (variantCount <= 65536) discriminantSize = 2;
  else discriminantSize = 4;

  // Build variant info (unit variants have size === 0)
  const variantInfo = new Map<keyof V, { index: number; codec: RkyvCodec<unknown>; isUnit: boolean }>();
  let maxVariantAlign = discriminantSize;
  let maxVariantSize = 0;

  variantNames.forEach((name, index) => {
    const codec = variants[name] as RkyvCodec<unknown>;
    const isUnit = codec.size === 0;
    variantInfo.set(name, { index, codec, isUnit });
    if (!isUnit) {
      maxVariantAlign = Math.max(maxVariantAlign, codec.align) as 1 | 2 | 4;
      maxVariantSize = Math.max(maxVariantSize, codec.size);
    }
  });

  const maxDiscriminantPadding = alignOffset(discriminantSize, maxVariantAlign) - discriminantSize;
  const totalSize = discriminantSize + maxDiscriminantPadding + maxVariantSize;

  return {
    size: totalSize,
    align: maxVariantAlign,

    access(reader, offset) {
      let discriminant: number;
      if (discriminantSize === 1) discriminant = reader.readU8(offset);
      else if (discriminantSize === 2) discriminant = reader.readU16(offset);
      else discriminant = reader.readU32(offset);

      const tag = variantNames[discriminant];
      const info = variantInfo.get(tag)!;

      if (info.isUnit) {
        return { tag, value: null } as EnumValue<V>;
      }

      const variantPadding = alignOffset(discriminantSize, info.codec.align) - discriminantSize;
      const valueOffset = offset + discriminantSize + variantPadding;
      const value = info.codec.access(reader, valueOffset);
      return { tag, value } as EnumValue<V>;
    },

    decode(reader, offset) {
      let discriminant: number;
      if (discriminantSize === 1) discriminant = reader.readU8(offset);
      else if (discriminantSize === 2) discriminant = reader.readU16(offset);
      else discriminant = reader.readU32(offset);

      const tag = variantNames[discriminant];
      const info = variantInfo.get(tag)!;

      if (info.isUnit) {
        return { tag, value: null } as EnumValue<V>;
      }

      const variantPadding = alignOffset(discriminantSize, info.codec.align) - discriminantSize;
      const valueOffset = offset + discriminantSize + variantPadding;
      const value = info.codec.decode(reader, valueOffset);
      return { tag, value } as EnumValue<V>;
    },

    _archive(writer, value) {
      const enumValue = value as EnumValue<V>;
      const info = variantInfo.get(enumValue.tag)!;

      if (info.isUnit) {
        return { pos: writer.pos, variantResolver: null };
      }
      return { pos: writer.pos, variantResolver: info.codec._archive(writer, enumValue.value) };
    },

    _resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;
      const enumValue = value as EnumValue<V>;
      const info = variantInfo.get(enumValue.tag)!;

      // Write discriminant
      if (discriminantSize === 1) writer.writeU8(info.index);
      else if (discriminantSize === 2) writer.writeU16(info.index);
      else writer.writeU32(info.index);

      // Write variant padding + value
      if (!info.isUnit) {
        const variantPadding = alignOffset(discriminantSize, info.codec.align) - discriminantSize;
        for (let i = 0; i < variantPadding; i++) writer.writeU8(0);

        const variantResolver = (resolver as unknown as { variantResolver: Resolver | null }).variantResolver;
        info.codec._resolve(writer, enumValue.value, variantResolver!);
      }

      // Trailing padding
      writer.padTo(pos + totalSize);
      return pos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

/**
 * Union value with discriminator function result
 */
export type UnionValue<V extends Record<string, unknown>> = {
  [K in keyof V]: { type: K; value: V[K] };
}[keyof V];

/**
 * Untagged union - discriminated by a function
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
  variants: { [K in keyof V]: RkyvCodec<V[K]> }
): RkyvCodec<UnionValue<V>> {
  const variantNames = Object.keys(variants) as (keyof V)[];

  // Calculate max size/align
  let maxSize = 0;
  let maxAlign = 1;
  for (const name of variantNames) {
    const codec = variants[name];
    maxSize = Math.max(maxSize, codec.size);
    maxAlign = Math.max(maxAlign, codec.align);
  }
  const totalSize = alignOffset(maxSize, maxAlign);

  return {
    size: totalSize,
    align: maxAlign,

    access(reader, offset) {
      const type = discriminate(reader, offset);
      const value = variants[type].access(reader, offset);
      return { type, value } as UnionValue<V>;
    },

    decode(reader, offset) {
      const type = discriminate(reader, offset);
      const value = variants[type].decode(reader, offset);
      return { type, value } as UnionValue<V>;
    },

    _archive(writer, value) {
      const codec = variants[value.type];
      return { pos: writer.pos, type: value.type, inner: codec._archive(writer, value.value) };
    },

    _resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;
      const codec = variants[value.type];
      codec._resolve(writer, value.value, (resolver as unknown as { inner: Resolver }).inner);
      writer.padTo(pos + totalSize);
      return pos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

// ============================================================================
// Utility Codecs
// ============================================================================

/**
 * Transform a codec's output/input with mapping functions
 */
export function transform<T, U>(
  codec: RkyvCodec<T>,
  decode: (value: T) => U,
  encode: (value: U) => T
): RkyvCodec<U> {
  return {
    size: codec.size,
    align: codec.align,
    access: (reader, offset) => decode(codec.access(reader, offset)),
    decode: (reader, offset) => decode(codec.decode(reader, offset)),
    _archive: (writer, value) => codec._archive(writer, encode(value)),
    _resolve: (writer, value, resolver) => codec._resolve(writer, encode(value), resolver),
    encode: (writer, value) => codec.encode(writer, encode(value)),
  };
}

/**
 * Newtype wrapper - same binary representation, different TS type
 */
export function newtype<T, Brand extends string>(
  inner: RkyvCodec<T>,
  _brand: Brand
): RkyvCodec<T & { readonly __brand: Brand }> {
  return inner as RkyvCodec<T & { readonly __brand: Brand }>;
}

/**
 * Lazy codec for recursive types
 */
export function lazy<T>(getCodec: () => RkyvCodec<T>): RkyvCodec<T> {
  let cached: RkyvCodec<T> | null = null;
  const get = () => {
    if (!cached) cached = getCodec();
    return cached;
  };

  return {
    get size() { return get().size; },
    get align() { return get().align; },
    access: (reader, offset) => get().access(reader, offset),
    decode: (reader, offset) => get().decode(reader, offset),
    _archive: (writer, value) => get()._archive(writer, value),
    _resolve: (writer, value, resolver) => get()._resolve(writer, value, resolver),
    encode: (writer, value) => get().encode(writer, value),
  };
}

// ============================================================================
// Shared Pointer Codecs
// ============================================================================

/**
 * Rc<T> / Arc<T> - Reference-counted pointers
 *
 * In rkyv, Rc<T> and Arc<T> archive to the same format as Box<T> - a relative
 * pointer to the inner data. The only difference is a "flavor" marker used
 * during validation in Rust, but the binary format is identical.
 *
 * In JavaScript, we don't have reference counting semantics, so these are
 * just aliases for box().
 *
 * @alias box
 */
export const rc = box;

/**
 * Arc<T> - Atomically reference-counted pointer
 *
 * Same archive format as Rc<T> and Box<T>.
 *
 * @alias box
 */
export const arc = box;

/**
 * Weak<T> - Weak reference (rc::Weak or sync::Weak)
 *
 * In rkyv, Weak pointers serialize as nullable relative pointers:
 * - If the weak pointer can be upgraded, it points to the data
 * - If it can't (data was dropped), it serializes as a null pointer (offset = 0)
 *
 * In JavaScript, we represent this as T | null.
 */
export function weak<T>(inner: RkyvCodec<T>): RkyvCodec<T | null> {
  return {
    size: 4,
    align: 4,

    access(reader, offset) {
      // Check if the relative pointer is null (offset = 0)
      const relOffset = reader.readI32(offset);
      if (relOffset === 0) {
        return null;
      }
      const dataOffset = offset + relOffset;
      return inner.access(reader, dataOffset);
    },

    decode(reader, offset) {
      const relOffset = reader.readI32(offset);
      if (relOffset === 0) {
        return null;
      }
      const dataOffset = offset + relOffset;
      return inner.decode(reader, dataOffset);
    },

    _archive(writer, value) {
      if (value === null) {
        return { pos: 0, isNull: true };
      }
      const resolver = inner._archive(writer, value);
      writer.align(inner.align);
      inner._resolve(writer, value, resolver);
      return { pos: writer.pos - inner.size, isNull: false };
    },

    _resolve(writer, value, resolver) {
      writer.align(4);
      const pos = writer.pos;
      const r = resolver as { pos: number; isNull: boolean };

      if (r.isNull) {
        // Write a null relative pointer (0)
        writer.writeI32(0);
      } else {
        const ptrPos = writer.reserveRelPtr32();
        writer.writeRelPtr32At(ptrPos, r.pos);
      }
      return pos;
    },

    encode(writer, value) {
      const resolver = this._archive(writer, value);
      return this._resolve(writer, value, resolver);
    },
  };
}

/**
 * rc::Weak<T> - Weak reference to Rc data
 * @alias weak
 */
export const rcWeak = weak;

/**
 * sync::Weak<T> - Weak reference to Arc data
 * @alias weak
 */
export const arcWeak = weak;
