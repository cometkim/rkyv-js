/**
 * Encoder types for serializing data to rkyv format.
 *
 * rkyv uses a two-phase serialization process:
 * 1. Archive phase: Write dependencies (strings, vec contents, etc.) and get resolvers
 * 2. Resolve phase: Write the containing structure using resolvers for relative pointers
 *
 * This matches how rkyv works in Rust with the Archive and Resolve traits.
 */

import { RkyvWriter, Resolver, StringResolver, VecResolver } from './writer.js';
import { alignOffset } from './types.js';

/**
 * Base interface for all rkyv encoders.
 * Each encoder knows how to serialize a specific type to the binary format.
 */
export interface RkyvEncoder<T, R extends Resolver = Resolver> {
  /**
   * The size in bytes of the archived representation.
   */
  readonly size: number;

  /**
   * The alignment requirement for this type.
   */
  readonly align: number;

  /**
   * Archive the value's dependencies and return a resolver.
   * This writes any data that needs to be written before the main structure.
   */
  archive(writer: RkyvWriter, value: T): R;

  /**
   * Resolve the value using the resolver, writing the final archived form.
   * Returns the position where the value was written.
   */
  resolve(writer: RkyvWriter, value: T, resolver: R): number;

  /**
   * Convenience method to archive and resolve in one call.
   */
  encode(writer: RkyvWriter, value: T): number;
}

// === Primitive Encoders ===

function createPrimitiveEncoder<T>(
  size: number,
  align: number,
  write: (writer: RkyvWriter, value: T) => number
): RkyvEncoder<T> {
  return {
    size,
    align,
    archive: () => ({ pos: 0 }),
    resolve: (writer, value) => write(writer, value),
    encode: (writer, value) => write(writer, value),
  };
}

export const u8Encoder: RkyvEncoder<number> = createPrimitiveEncoder(1, 1, (w, v) => w.writeU8(v));
export const i8Encoder: RkyvEncoder<number> = createPrimitiveEncoder(1, 1, (w, v) => w.writeI8(v));
export const u16Encoder: RkyvEncoder<number> = createPrimitiveEncoder(2, 2, (w, v) => w.writeU16(v));
export const i16Encoder: RkyvEncoder<number> = createPrimitiveEncoder(2, 2, (w, v) => w.writeI16(v));
export const u32Encoder: RkyvEncoder<number> = createPrimitiveEncoder(4, 4, (w, v) => w.writeU32(v));
export const i32Encoder: RkyvEncoder<number> = createPrimitiveEncoder(4, 4, (w, v) => w.writeI32(v));
export const u64Encoder: RkyvEncoder<bigint> = createPrimitiveEncoder(8, 8, (w, v) => w.writeU64(v));
export const i64Encoder: RkyvEncoder<bigint> = createPrimitiveEncoder(8, 8, (w, v) => w.writeI64(v));
export const f32Encoder: RkyvEncoder<number> = createPrimitiveEncoder(4, 4, (w, v) => w.writeF32(v));
export const f64Encoder: RkyvEncoder<number> = createPrimitiveEncoder(8, 8, (w, v) => w.writeF64(v));
export const boolEncoder: RkyvEncoder<boolean> = createPrimitiveEncoder(1, 1, (w, v) => w.writeBool(v));

export const unitEncoder: RkyvEncoder<null> = {
  size: 0,
  align: 1,
  archive: () => ({ pos: 0 }),
  resolve: (writer) => writer.pos,
  encode: (writer) => writer.pos,
};

export const charEncoder: RkyvEncoder<string> = {
  size: 4,
  align: 4,
  archive: () => ({ pos: 0 }),
  resolve: (writer, value) => {
    const codePoint = value.codePointAt(0) ?? 0;
    return writer.writeU32(codePoint);
  },
  encode(writer, value) {
    return this.resolve(writer, value, this.archive(writer, value));
  },
};

// === String Encoder ===

/**
 * ArchivedString encoder for rkyv 0.8.
 *
 * rkyv 0.8 uses a compact representation with inline/out-of-line detection
 * based on the top 2 bits of the first byte:
 *
 * **Inline detection:** `(bytes[0] & 0xC0) != 0x80`
 * - If top 2 bits are `10` (0x80-0xBF) → out-of-line
 * - Otherwise → inline (includes 0x00-0x7F and 0xC0-0xFF)
 *
 * **Inline format** (for strings <= 8 bytes):
 * - Bytes 0-7: string data, padded with 0xff
 *
 * **Out-of-line format** (for strings > 8 bytes):
 * - Bytes 0-3 (u32): length with bits 6-7 set to `10` as marker
 *   - Encoded length = (len & 0x3F) | 0x80 | ((len & ~0x3F) << 2)
 * - Bytes 4-7 (i32): relative pointer to string data
 */
export const stringEncoder: RkyvEncoder<string, StringResolver> = {
  size: 8,
  align: 4,

  archive(writer, value) {
    const bytes = new TextEncoder().encode(value);

    if (bytes.length <= 8) {
      // Inline: no need to write string data separately
      return { pos: 0, len: bytes.length };
    } else {
      // Out-of-line: write string bytes first
      const pos = writer.writeBytes(bytes);
      return { pos, len: bytes.length };
    }
  },

  resolve(writer, value, resolver) {
    writer.align(4);
    const structPos = writer.pos;
    const bytes = new TextEncoder().encode(value);

    if (bytes.length <= 8) {
      // Inline format: string data + 0xff padding
      for (let i = 0; i < bytes.length; i++) {
        writer.writeU8(bytes[i]);
      }
      // Pad remaining bytes with 0xff
      for (let i = bytes.length; i < 8; i++) {
        writer.writeU8(0xff);
      }
    } else {
      // Out-of-line format
      // Encode length with bits 6-7 set to `10` as marker
      // encodedLen = (len & 0x3F) | 0x80 | ((len & ~0x3F) << 2)
      const len = bytes.length;
      const encodedLen = (len & 0x3f) | 0x80 | ((len & ~0x3f) << 2);
      writer.writeU32(encodedLen);

      // Relative pointer: points to string data from start of struct
      const relPtr = resolver.pos - structPos;
      writer.writeI32(relPtr);
    }

    return structPos;
  },

  encode(writer, value) {
    const resolver = this.archive(writer, value);
    return this.resolve(writer, value, resolver);
  },
};

// === Vec Encoder ===

/**
 * Extended VecResolver that stores element resolvers.
 */
interface VecResolverWithElements<R extends Resolver> extends VecResolver {
  elementResolvers: R[];
}

/**
 * Create an ArchivedVec encoder.
 *
 * Layout in buffer (depth-first):
 * 1. All element dependencies are written first (string bytes, nested vecs, etc.)
 * 2. Then the element structs are written consecutively
 * 3. Finally the ArchivedVec struct: relptr (4) + len (4)
 */
export function vecEncoder<T, R extends Resolver>(
  elementEncoder: RkyvEncoder<T, R>
): RkyvEncoder<T[], VecResolverWithElements<R>> {
  return {
    size: 8, // relptr (4) + len (4)
    align: 4,

    archive(writer, value) {
      if (value.length === 0) {
        return { pos: writer.pos, len: 0, elementResolvers: [] };
      }

      // Phase 1: Archive all elements (write dependencies)
      const elementResolvers: R[] = [];
      for (const item of value) {
        elementResolvers.push(elementEncoder.archive(writer, item));
      }

      // Phase 2: Resolve all elements consecutively (write element structs)
      writer.align(elementEncoder.align);
      const elementsStartPos = writer.pos;

      for (let i = 0; i < value.length; i++) {
        writer.align(elementEncoder.align);
        elementEncoder.resolve(writer, value[i], elementResolvers[i]);
      }

      return { pos: elementsStartPos, len: value.length, elementResolvers };
    },

    resolve(writer, _value, resolver) {
      writer.align(4);
      const structPos = writer.pos;

      // Reserve space for relptr
      const ptrPos = writer.reserveRelPtr32();
      // Write length
      writer.writeU32(resolver.len);

      // Write the relative pointer
      if (resolver.len > 0) {
        writer.writeRelPtr32At(ptrPos, resolver.pos);
      } else {
        // For empty vecs, point to the start of the buffer (offset 0)
        // This matches rkyv's behavior for empty slices
        writer.writeRelPtr32At(ptrPos, 0);
      }

      return structPos;
    },

    encode(writer, value) {
      const resolver = this.archive(writer, value);
      return this.resolve(writer, value, resolver);
    },
  };
}

// === Option Encoder ===

interface OptionResolver<R extends Resolver> extends Resolver {
  inner: R | null;
}

/**
 * Create an ArchivedOption encoder.
 *
 * Layout: tag (1) + padding + inner value
 */
export function optionEncoder<T, R extends Resolver>(
  innerEncoder: RkyvEncoder<T, R>
): RkyvEncoder<T | null, OptionResolver<R>> {
  const tagSize = 1;
  const paddingToInner = alignOffset(tagSize, innerEncoder.align) - tagSize;
  const totalSize = tagSize + paddingToInner + innerEncoder.size;

  return {
    size: totalSize,
    align: Math.max(1, innerEncoder.align),

    archive(writer, value) {
      if (value === null) {
        return { pos: writer.pos, inner: null };
      }
      const inner = innerEncoder.archive(writer, value);
      return { pos: writer.pos, inner };
    },

    resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;

      if (value === null) {
        // None: tag = 0
        writer.writeU8(0);
        // Write padding + placeholder for inner
        for (let i = 0; i < paddingToInner + innerEncoder.size; i++) {
          writer.writeU8(0);
        }
      } else {
        // Some: tag = 1
        writer.writeU8(1);
        // Padding
        for (let i = 0; i < paddingToInner; i++) {
          writer.writeU8(0);
        }
        // Inner value
        innerEncoder.resolve(writer, value, resolver.inner!);
      }

      return pos;
    },

    encode(writer, value) {
      const resolver = this.archive(writer, value);
      return this.resolve(writer, value, resolver);
    },
  };
}

// === Box Encoder ===

/**
 * Create an ArchivedBox encoder.
 *
 * Layout: Just a relative pointer to the boxed data.
 */
export function boxEncoder<T, R extends Resolver>(
  innerEncoder: RkyvEncoder<T, R>
): RkyvEncoder<T, R> {
  return {
    size: 4, // Just the relptr
    align: 4,

    archive(writer, value) {
      // Write inner data first
      const resolver = innerEncoder.archive(writer, value);
      writer.align(innerEncoder.align);
      innerEncoder.resolve(writer, value, resolver);
      return { pos: writer.pos - innerEncoder.size } as R;
    },

    resolve(writer, _value, resolver) {
      writer.align(4);
      const pos = writer.pos;
      const ptrPos = writer.reserveRelPtr32();
      writer.writeRelPtr32At(ptrPos, resolver.pos);
      return pos;
    },

    encode(writer, value) {
      const resolver = this.archive(writer, value);
      return this.resolve(writer, value, resolver);
    },
  };
}

// === Array Encoder ===

/**
 * Create a fixed-size array encoder [T; N].
 */
export function arrayEncoder<T, R extends Resolver>(
  elementEncoder: RkyvEncoder<T, R>,
  length: number
): RkyvEncoder<T[], Resolver> {
  const elementStride = alignOffset(elementEncoder.size, elementEncoder.align);
  const totalSize = elementStride * length;

  return {
    size: totalSize,
    align: elementEncoder.align,

    archive(writer, value) {
      if (value.length !== length) {
        throw new Error(`Array length mismatch: expected ${length}, got ${value.length}`);
      }
      // Archive all elements
      const resolvers: R[] = [];
      for (const item of value) {
        resolvers.push(elementEncoder.archive(writer, item));
      }
      return { pos: writer.pos, resolvers } as Resolver & { resolvers: R[] };
    },

    resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;
      const resolvers = (resolver as Resolver & { resolvers: R[] }).resolvers;

      for (let i = 0; i < length; i++) {
        writer.align(elementEncoder.align);
        elementEncoder.resolve(writer, value[i], resolvers[i]);
      }

      return pos;
    },

    encode(writer, value) {
      const resolver = this.archive(writer, value);
      return this.resolve(writer, value, resolver);
    },
  };
}

// === Tuple Encoder ===

/**
 * Create a tuple encoder.
 */
export function tupleEncoder<T extends unknown[]>(
  ...encoders: { [K in keyof T]: RkyvEncoder<T[K]> }
): RkyvEncoder<T, Resolver & { resolvers: Resolver[] }> {
  // Calculate layout
  let currentSize = 0;
  let maxAlign = 1;
  const offsets: number[] = [];

  for (const encoder of encoders) {
    currentSize = alignOffset(currentSize, encoder.align);
    offsets.push(currentSize);
    currentSize += encoder.size;
    maxAlign = Math.max(maxAlign, encoder.align);
  }

  const totalSize = alignOffset(currentSize, maxAlign);

  return {
    size: totalSize,
    align: maxAlign,

    archive(writer, value) {
      const resolvers: Resolver[] = [];
      for (let i = 0; i < encoders.length; i++) {
        resolvers.push(encoders[i].archive(writer, value[i]));
      }
      return { pos: writer.pos, resolvers };
    },

    resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;

      for (let i = 0; i < encoders.length; i++) {
        writer.align(encoders[i].align);
        encoders[i].resolve(writer, value[i], resolver.resolvers[i]);
      }

      // Trailing padding
      writer.padTo(pos + totalSize);

      return pos;
    },

    encode(writer, value) {
      const resolver = this.archive(writer, value);
      return this.resolve(writer, value, resolver);
    },
  };
}
