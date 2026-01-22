import { RkyvReader } from './reader.js';

/**
 * Base interface for all rkyv type decoders.
 * Each decoder knows how to decode a specific archived type from the binary buffer.
 */
export interface RkyvDecoder<T> {
  /**
   * The size in bytes of the archived representation.
   * For fixed-size types, this is constant.
   * For variable-size types (like ArchivedString), this is the size of the "fat pointer" structure.
   */
  readonly size: number;

  /**
   * The alignment requirement for this type.
   */
  readonly align: number;

  /**
   * Decode the value at the given offset.
   */
  decode(reader: RkyvReader, offset: number): T;
}

// === Primitive Type Decoders ===

export const u8: RkyvDecoder<number> = {
  size: 1,
  align: 1,
  decode: (reader, offset) => reader.readU8(offset),
};

export const i8: RkyvDecoder<number> = {
  size: 1,
  align: 1,
  decode: (reader, offset) => reader.readI8(offset),
};

export const u16: RkyvDecoder<number> = {
  size: 2,
  align: 2,
  decode: (reader, offset) => reader.readU16(offset),
};

export const i16: RkyvDecoder<number> = {
  size: 2,
  align: 2,
  decode: (reader, offset) => reader.readI16(offset),
};

export const u32: RkyvDecoder<number> = {
  size: 4,
  align: 4,
  decode: (reader, offset) => reader.readU32(offset),
};

export const i32: RkyvDecoder<number> = {
  size: 4,
  align: 4,
  decode: (reader, offset) => reader.readI32(offset),
};

export const u64: RkyvDecoder<bigint> = {
  size: 8,
  align: 8,
  decode: (reader, offset) => reader.readU64(offset),
};

export const i64: RkyvDecoder<bigint> = {
  size: 8,
  align: 8,
  decode: (reader, offset) => reader.readI64(offset),
};

export const f32: RkyvDecoder<number> = {
  size: 4,
  align: 4,
  decode: (reader, offset) => reader.readF32(offset),
};

export const f64: RkyvDecoder<number> = {
  size: 8,
  align: 8,
  decode: (reader, offset) => reader.readF64(offset),
};

export const bool: RkyvDecoder<boolean> = {
  size: 1,
  align: 1,
  decode: (reader, offset) => reader.readBool(offset),
};

// === Unit type (empty tuple) ===
export const unit: RkyvDecoder<null> = {
  size: 0,
  align: 1,
  decode: () => null,
};

// === Char (UTF-32 code point, 4 bytes in rkyv) ===
export const char: RkyvDecoder<string> = {
  size: 4,
  align: 4,
  decode: (reader, offset) => {
    const codePoint = reader.readU32(offset);
    return String.fromCodePoint(codePoint);
  },
};

/**
 * ArchivedString decoder for rkyv 0.8.
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
 * - Length: position of first 0xff byte (or 8 if no 0xff)
 *
 * **Out-of-line format** (for strings > 8 bytes):
 * - Bytes 0-3 (u32): length with bits 6-7 set to `10` as marker
 *   - Actual length = (len & 0x3F) | ((len >> 2) & ~0x3F)
 * - Bytes 4-7 (i32): relative pointer to string data
 */
export const string: RkyvDecoder<string> = {
  size: 8,
  align: 4,
  decode: (reader, offset) => {
    const firstByte = reader.readU8(offset);

    // Check if inline: (firstByte & 0xC0) != 0x80
    // This means top 2 bits are NOT '10'
    const isInline = (firstByte & 0xc0) !== 0x80;

    if (isInline) {
      // Inline format: string data stored directly
      // Length is position of first 0xff byte
      let length = 0;
      while (length < 8) {
        const byte = reader.readU8(offset + length);
        if (byte === 0xff) break;
        length++;
      }

      const bytes = reader.readBytes(offset, length);
      return new TextDecoder().decode(bytes);
    } else {
      // Out-of-line format
      // Read the u32 length field with marker bits
      const lenWithMarker = reader.readU32(offset);
      // Extract actual length: remove the marker bits (6-7)
      // length = (lenWithMarker & 0x3F) | ((lenWithMarker & ~0xFF) >> 2)
      const length = (lenWithMarker & 0x3f) | ((lenWithMarker >>> 8) << 6);

      // Relative pointer is at offset + 4
      const relPtr = reader.readI32(offset + 4);
      const dataOffset = offset + relPtr;

      const bytes = reader.readBytes(dataOffset, length);
      return new TextDecoder().decode(bytes);
    }
  },
};

/**
 * Create an ArchivedVec decoder for a given element type.
 *
 * In rkyv, ArchivedVec is represented as:
 * - RelPtr (4 bytes): relative pointer to the array data
 * - len (4 bytes): number of elements
 *
 * The elements are stored contiguously at the pointer location.
 */
export function vec<T>(elementDecoder: RkyvDecoder<T>): RkyvDecoder<T[]> {
  return {
    size: 8, // RelPtr (4) + len (4)
    align: 4,
    decode: (reader, offset) => {
      const dataOffset = reader.readRelPtr32(offset);
      const length = reader.readU32(offset + 4);

      const result: T[] = new Array(length);
      let currentOffset = dataOffset;

      for (let i = 0; i < length; i++) {
        // Align the current offset if needed
        currentOffset = alignOffset(currentOffset, elementDecoder.align);
        result[i] = elementDecoder.decode(reader, currentOffset);
        currentOffset += elementDecoder.size;
      }

      return result;
    },
  };
}

/**
 * Create an ArchivedOption decoder.
 *
 * In rkyv, ArchivedOption<T> uses a niche optimization when possible,
 * but for the general case it's represented as:
 * - tag (1 byte): 0 = None, 1 = Some
 * - padding to align T
 * - T (if Some)
 *
 * The total size depends on T's size and alignment.
 */
export function option<T>(innerDecoder: RkyvDecoder<T>): RkyvDecoder<T | null> {
  // Calculate size: 1 byte tag + padding + inner size
  const tagSize = 1;
  const paddingToInner = alignOffset(tagSize, innerDecoder.align) - tagSize;
  const totalSize = tagSize + paddingToInner + innerDecoder.size;

  return {
    size: totalSize,
    align: Math.max(1, innerDecoder.align),
    decode: (reader, offset) => {
      const tag = reader.readU8(offset);

      if (tag === 0) {
        return null; // None
      } else {
        // Some - read the inner value after alignment padding
        const innerOffset = offset + tagSize + paddingToInner;
        return innerDecoder.decode(reader, innerOffset);
      }
    },
  };
}

/**
 * Create an ArchivedBox decoder.
 *
 * In rkyv, ArchivedBox<T> is essentially a relative pointer to T.
 * For sized types, it's just:
 * - RelPtr (4 bytes): relative pointer to the boxed data
 */
export function box<T>(innerDecoder: RkyvDecoder<T>): RkyvDecoder<T> {
  return {
    size: 4, // Just the RelPtr
    align: 4,
    decode: (reader, offset) => {
      const dataOffset = reader.readRelPtr32(offset);
      return innerDecoder.decode(reader, dataOffset);
    },
  };
}

/**
 * Create a fixed-size array decoder [T; N].
 */
export function array<T>(
  elementDecoder: RkyvDecoder<T>,
  length: number
): RkyvDecoder<T[]> {
  // Each element is aligned
  const elementStride = alignOffset(elementDecoder.size, elementDecoder.align);
  const totalSize = elementStride * length;

  return {
    size: totalSize,
    align: elementDecoder.align,
    decode: (reader, offset) => {
      const result: T[] = new Array(length);

      for (let i = 0; i < length; i++) {
        const elementOffset = offset + i * elementStride;
        result[i] = elementDecoder.decode(reader, elementOffset);
      }

      return result;
    },
  };
}

/**
 * Create a tuple decoder.
 *
 * rkyv serializes tuples as #[repr(C)] structs, so fields are laid out
 * in order with appropriate padding for alignment.
 */
export function tuple<T extends unknown[]>(
  ...decoders: { [K in keyof T]: RkyvDecoder<T[K]> }
): RkyvDecoder<T> {
  // Calculate layout
  let currentSize = 0;
  let maxAlign = 1;
  const offsets: number[] = [];

  for (const decoder of decoders) {
    // Align current position for this field
    currentSize = alignOffset(currentSize, decoder.align);
    offsets.push(currentSize);
    currentSize += decoder.size;
    maxAlign = Math.max(maxAlign, decoder.align);
  }

  // Final size with trailing padding
  const totalSize = alignOffset(currentSize, maxAlign);

  return {
    size: totalSize,
    align: maxAlign,
    decode: (reader, offset) => {
      const result: unknown[] = new Array(decoders.length);

      for (let i = 0; i < decoders.length; i++) {
        result[i] = decoders[i].decode(reader, offset + offsets[i]);
      }

      return result as T;
    },
  };
}

/**
 * Utility: align an offset to the given alignment.
 */
export function alignOffset(offset: number, align: number): number {
  const remainder = offset % align;
  return remainder === 0 ? offset : offset + (align - remainder);
}
