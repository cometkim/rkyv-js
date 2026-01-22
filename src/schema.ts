import { RkyvDecoder, alignOffset } from './types.js';

/**
 * Schema definition for a struct field.
 */
export interface FieldDef<T = unknown> {
  name: string;
  decoder: RkyvDecoder<T>;
}

/**
 * Schema definition for an enum variant.
 */
export interface VariantDef<T = unknown> {
  name: string;
  /** Fields for struct-like variants, undefined for unit variants */
  fields?: FieldDef<T>[];
}

/**
 * Create a struct decoder from a field definition.
 *
 * In rkyv, archived structs use #[repr(C)] layout, meaning:
 * - Fields are laid out in declaration order
 * - Each field is aligned to its natural alignment
 * - The struct's alignment is the maximum alignment of its fields
 * - The struct's size is padded to a multiple of its alignment
 *
 * @example
 * ```typescript
 * const PersonDecoder = struct({
 *   name: { decoder: string },
 *   age: { decoder: u32 },
 * });
 *
 * const person = PersonDecoder.decode(reader, offset);
 * // { name: "Alice", age: 30 }
 * ```
 */
export function struct<T extends Record<string, unknown>>(
  fields: { [K in keyof T]: { decoder: RkyvDecoder<T[K]> } }
): RkyvDecoder<T> {
  const fieldNames = Object.keys(fields) as (keyof T)[];
  const fieldDecoders = fieldNames.map((name) => ({
    name,
    decoder: fields[name].decoder,
  }));

  // Calculate C-style struct layout
  let currentOffset = 0;
  let maxAlign = 1;
  const fieldOffsets: Map<keyof T, number> = new Map();

  for (const { name, decoder } of fieldDecoders) {
    // Align for this field
    currentOffset = alignOffset(currentOffset, decoder.align);
    fieldOffsets.set(name, currentOffset);
    currentOffset += decoder.size;
    maxAlign = Math.max(maxAlign, decoder.align);
  }

  // Add trailing padding
  const totalSize = alignOffset(currentOffset, maxAlign);

  return {
    size: totalSize,
    align: maxAlign,
    decode: (reader, offset) => {
      const result = {} as T;

      for (const { name, decoder } of fieldDecoders) {
        const fieldOffset = fieldOffsets.get(name)!;
        result[name] = decoder.decode(reader, offset + fieldOffset) as T[keyof T];
      }

      return result;
    },
  };
}

/**
 * Tagged union representation for decoded enums.
 */
export type EnumValue<V extends Record<string, unknown | undefined>> = {
  [K in keyof V]: { tag: K; value: V[K] };
}[keyof V];

/**
 * Create an enum decoder.
 *
 * In rkyv, enums are represented as:
 * - A discriminant tag (u8, u16, u32, u64, or u128 - using smallest that fits)
 * - Padding to align the largest variant
 * - The variant data (if any)
 *
 * The discriminant values are assigned in order starting from 0.
 *
 * @example
 * ```typescript
 * const ResultDecoder = enumType<{
 *   Ok: { value: string };
 *   Err: { message: string };
 * }>({
 *   Ok: { fields: { value: { decoder: string } } },
 *   Err: { fields: { message: { decoder: string } } },
 * });
 *
 * const result = ResultDecoder.decode(reader, offset);
 * // { tag: "Ok", value: { value: "success" } }
 * // or
 * // { tag: "Err", value: { message: "failed" } }
 * ```
 */
export function enumType<V extends Record<string, unknown | undefined>>(
  variants: {
    [K in keyof V]: V[K] extends undefined
      ? { fields?: undefined }
      : { fields: { [F in keyof V[K]]: { decoder: RkyvDecoder<V[K][F]> } } };
  }
): RkyvDecoder<EnumValue<V>> {
  const variantNames = Object.keys(variants) as (keyof V)[];
  const variantCount = variantNames.length;

  // Determine discriminant size (smallest integer type that fits)
  let discriminantSize: 1 | 2 | 4;
  if (variantCount <= 256) {
    discriminantSize = 1;
  } else if (variantCount <= 65536) {
    discriminantSize = 2;
  } else {
    discriminantSize = 4;
  }

  // Create decoders for each variant's fields
  // Store both the decoder and its alignment for per-variant padding calculation
  const variantDecoders: Map<
    keyof V,
    { index: number; decoder: RkyvDecoder<unknown> | null; align: number }
  > = new Map();

  let maxVariantAlign: number = discriminantSize;
  let maxVariantSize = 0;

  variantNames.forEach((name, index) => {
    const variant = variants[name];

    if (!variant.fields) {
      // Unit variant - align is 1 (no padding needed)
      variantDecoders.set(name, { index, decoder: null, align: 1 });
    } else {
      // Struct variant
      const fieldDecoder = struct(variant.fields as Record<string, { decoder: RkyvDecoder<unknown> }>);
      variantDecoders.set(name, { index, decoder: fieldDecoder, align: fieldDecoder.align });
      maxVariantAlign = Math.max(maxVariantAlign, fieldDecoder.align);
      maxVariantSize = Math.max(maxVariantSize, fieldDecoder.size);
    }
  });

  // Calculate total size: discriminant + padding (for max align) + max variant size
  const maxDiscriminantPadding =
    alignOffset(discriminantSize, maxVariantAlign) - discriminantSize;
  const totalSize = discriminantSize + maxDiscriminantPadding + maxVariantSize;

  return {
    size: totalSize,
    align: maxVariantAlign,
    decode: (reader, offset) => {
      // Read discriminant
      let discriminant: number;
      switch (discriminantSize) {
        case 1:
          discriminant = reader.readU8(offset);
          break;
        case 2:
          discriminant = reader.readU16(offset);
          break;
        case 4:
          discriminant = reader.readU32(offset);
          break;
      }

      // Find matching variant
      const variantName = variantNames[discriminant];
      if (variantName === undefined) {
        throw new Error(`Invalid enum discriminant: ${discriminant}`);
      }

      const { decoder, align } = variantDecoders.get(variantName)!;

      if (decoder === null) {
        // Unit variant
        return { tag: variantName, value: undefined } as EnumValue<V>;
      } else {
        // Struct variant - calculate padding based on THIS variant's alignment
        const variantPadding = alignOffset(discriminantSize, align) - discriminantSize;
        const valueOffset = offset + discriminantSize + variantPadding;
        const value = decoder.decode(reader, valueOffset);
        return { tag: variantName, value } as EnumValue<V>;
      }
    },
  };
}

/**
 * Create a newtype wrapper decoder (single-field struct).
 *
 * @example
 * ```typescript
 * const UserId = newtype<number>(u32);
 * ```
 */
export function newtype<T>(inner: RkyvDecoder<T>): RkyvDecoder<T> {
  return inner;
}

/**
 * Create a HashMap/BTreeMap decoder.
 *
 * Note: rkyv's ArchivedHashMap uses a Swiss Table implementation.
 * For simplicity, we decode to a Map or plain object.
 * This is a simplified implementation that works for many cases.
 */
export function hashMap<K, V>(
  keyDecoder: RkyvDecoder<K>,
  valueDecoder: RkyvDecoder<V>
): RkyvDecoder<Map<K, V>> {
  // ArchivedHashMap layout is complex (Swiss Table)
  // This is a simplified version that treats it as a Vec of (K, V) pairs
  // For full compatibility, we'd need to implement the Swiss Table layout

  const entryDecoder = struct<{ key: K; value: V }>({
    key: { decoder: keyDecoder },
    value: { decoder: valueDecoder },
  });

  return {
    // ArchivedHashMap has a more complex layout, but for basic use:
    // ptr (4) + len (4) + hash state (varies)
    size: 8,
    align: 4,
    decode: (reader, offset) => {
      const dataOffset = reader.readRelPtr32(offset);
      const length = reader.readU32(offset + 4);

      const result = new Map<K, V>();
      let currentOffset = dataOffset;

      for (let i = 0; i < length; i++) {
        currentOffset = alignOffset(currentOffset, entryDecoder.align);
        const entry = entryDecoder.decode(reader, currentOffset);
        result.set(entry.key, entry.value);
        currentOffset += entryDecoder.size;
      }

      return result;
    },
  };
}

/**
 * Create a decoder that applies a transformation to the decoded value.
 */
export function map<T, U>(
  decoder: RkyvDecoder<T>,
  transform: (value: T) => U
): RkyvDecoder<U> {
  return {
    size: decoder.size,
    align: decoder.align,
    decode: (reader, offset) => transform(decoder.decode(reader, offset)),
  };
}

/**
 * Create a lazy decoder for recursive types.
 * The decoder function is called lazily when decoding.
 */
export function lazy<T>(getDecoder: () => RkyvDecoder<T>): RkyvDecoder<T> {
  let cached: RkyvDecoder<T> | undefined;

  const ensureDecoder = () => {
    if (!cached) {
      cached = getDecoder();
    }
    return cached;
  };

  return {
    get size() {
      return ensureDecoder().size;
    },
    get align() {
      return ensureDecoder().align;
    },
    decode: (reader, offset) => ensureDecoder().decode(reader, offset),
  };
}

/**
 * Union value type - represents a value that could be one of several types.
 * Unlike enums, unions don't have a tag - you need external knowledge of which
 * variant is active.
 */
export type UnionValue<V extends Record<string, unknown>> = V[keyof V];

/**
 * Create an untagged union decoder.
 *
 * Unlike enums (tagged unions), untagged unions don't store a discriminant.
 * The caller must know which variant to decode, typically through external
 * context or a separate tag field.
 *
 * In Rust, this corresponds to `#[repr(C)]` unions:
 * ```rust
 * #[repr(C)]
 * union MyUnion {
 *     as_u32: u32,
 *     as_f32: f32,
 *     as_bytes: [u8; 4],
 * }
 * ```
 *
 * The union's size is the maximum size of all variants, and alignment is
 * the maximum alignment of all variants.
 *
 * @example
 * ```typescript
 * const NumberUnion = union({
 *   asU32: { decoder: u32 },
 *   asF32: { decoder: f32 },
 *   asBytes: { decoder: array(u8, 4) },
 * });
 *
 * // Decode as a specific variant
 * const value = NumberUnion.as('asU32').decode(reader, offset); // number
 * const floatValue = NumberUnion.as('asF32').decode(reader, offset); // number
 *
 * // Or decode all variants at once (they all read from the same memory)
 * const all = NumberUnion.decode(reader, offset);
 * // { asU32: 1065353216, asF32: 1.0, asBytes: [0, 0, 128, 63] }
 * ```
 */
export function union<V extends Record<string, unknown>>(
  variants: { [K in keyof V]: { decoder: RkyvDecoder<V[K]> } }
): UnionDecoder<V> {
  const variantNames = Object.keys(variants) as (keyof V)[];
  const variantDecoders = variantNames.map((name) => ({
    name,
    decoder: variants[name].decoder,
  }));

  // Calculate union size and alignment (max of all variants)
  let maxSize = 0;
  let maxAlign = 1;

  for (const { decoder } of variantDecoders) {
    maxSize = Math.max(maxSize, decoder.size);
    maxAlign = Math.max(maxAlign, decoder.align);
  }

  // Pad size to alignment
  const totalSize = alignOffset(maxSize, maxAlign);

  const baseDecoder: RkyvDecoder<V> = {
    size: totalSize,
    align: maxAlign,
    decode: (reader, offset) => {
      // Decode all variants from the same memory location
      const result = {} as V;
      for (const { name, decoder } of variantDecoders) {
        result[name] = decoder.decode(reader, offset) as V[keyof V];
      }
      return result;
    },
  };

  // Create variant-specific decoders
  const variantAccessors = {} as { [K in keyof V]: RkyvDecoder<V[K]> };
  for (const { name, decoder } of variantDecoders) {
    variantAccessors[name] = {
      size: totalSize,
      align: maxAlign,
      decode: (reader, offset) => decoder.decode(reader, offset),
    };
  }

  return {
    ...baseDecoder,
    variants: variantAccessors,
    as<K extends keyof V>(variant: K): RkyvDecoder<V[K]> {
      return variantAccessors[variant];
    },
  };
}

/**
 * Extended decoder for unions that provides variant-specific access.
 */
export interface UnionDecoder<V extends Record<string, unknown>> extends RkyvDecoder<V> {
  /**
   * Access individual variant decoders.
   */
  variants: { [K in keyof V]: RkyvDecoder<V[K]> };

  /**
   * Get a decoder for a specific variant.
   * This is useful when you know which variant is active.
   */
  as<K extends keyof V>(variant: K): RkyvDecoder<V[K]>;
}

/**
 * Create a tagged union decoder with an external tag.
 *
 * This is useful when the discriminant is stored separately from the union data,
 * which is common in C-style tagged unions:
 *
 * ```rust
 * #[repr(C)]
 * struct TaggedValue {
 *     tag: u8,
 *     value: MyUnion,
 * }
 * ```
 *
 * @example
 * ```typescript
 * const TaggedValue = taggedUnion(
 *   u8,  // tag decoder
 *   {
 *     0: { name: 'int', decoder: i32 },
 *     1: { name: 'float', decoder: f32 },
 *     2: { name: 'string', decoder: string },
 *   }
 * );
 *
 * const value = TaggedValue.decode(reader, offset);
 * // { tag: 'int', value: 42 } or { tag: 'float', value: 3.14 } etc.
 * ```
 */
export function taggedUnion<
  TTag extends number,
  V extends Record<TTag, { name: string; decoder: RkyvDecoder<unknown> }>
>(
  tagDecoder: RkyvDecoder<TTag>,
  variants: V
): RkyvDecoder<{ [K in keyof V]: { tag: V[K]['name']; value: ReturnType<V[K]['decoder']['decode']> } }[keyof V]> {
  const tagValues = Object.keys(variants).map(Number) as TTag[];

  // Calculate max variant size
  let maxVariantSize = 0;
  let maxVariantAlign = 1;

  for (const tagValue of tagValues) {
    const variant = variants[tagValue];
    maxVariantSize = Math.max(maxVariantSize, variant.decoder.size);
    maxVariantAlign = Math.max(maxVariantAlign, variant.decoder.align);
  }

  // Total size: tag + padding + max variant
  const tagPadding = alignOffset(tagDecoder.size, maxVariantAlign) - tagDecoder.size;
  const totalSize = tagDecoder.size + tagPadding + alignOffset(maxVariantSize, maxVariantAlign);
  const totalAlign = Math.max(tagDecoder.align, maxVariantAlign);

  type ResultType = { [K in keyof V]: { tag: V[K]['name']; value: ReturnType<V[K]['decoder']['decode']> } }[keyof V];

  return {
    size: totalSize,
    align: totalAlign,
    decode: (reader, offset) => {
      const tag = tagDecoder.decode(reader, offset);
      const variant = variants[tag as TTag];

      if (!variant) {
        throw new Error(`Invalid union tag: ${tag}`);
      }

      const valueOffset = offset + tagDecoder.size + tagPadding;
      const value = variant.decoder.decode(reader, valueOffset);

      return { tag: variant.name, value } as ResultType;
    },
  };
}
