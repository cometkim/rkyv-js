/**
 * Schema-based encoders for structs, enums, and unions.
 */

import { Resolver } from './writer.js';
import { RkyvEncoder } from './encoder.js';
import { alignOffset } from './types.js';

/**
 * Create a struct encoder from field definitions.
 *
 * Fields are laid out in declaration order with C-style alignment.
 */
export function structEncoder<T extends Record<string, unknown>>(
  fields: { [K in keyof T]: { encoder: RkyvEncoder<T[K]> } }
): RkyvEncoder<T, Resolver & { fieldResolvers: Map<keyof T, Resolver> }> {
  const fieldNames = Object.keys(fields) as (keyof T)[];
  const fieldEncoders = fieldNames.map((name) => ({
    name,
    encoder: fields[name].encoder,
  }));

  // Calculate C-style struct layout
  let currentOffset = 0;
  let maxAlign = 1;
  const fieldOffsets: Map<keyof T, number> = new Map();

  for (const { name, encoder } of fieldEncoders) {
    currentOffset = alignOffset(currentOffset, encoder.align);
    fieldOffsets.set(name, currentOffset);
    currentOffset += encoder.size;
    maxAlign = Math.max(maxAlign, encoder.align);
  }

  const totalSize = alignOffset(currentOffset, maxAlign);

  return {
    size: totalSize,
    align: maxAlign,

    archive(writer, value) {
      const fieldResolvers = new Map<keyof T, Resolver>();

      // Archive all fields (dependencies first)
      for (const { name, encoder } of fieldEncoders) {
        const resolver = encoder.archive(writer, value[name]);
        fieldResolvers.set(name, resolver);
      }

      return { pos: writer.pos, fieldResolvers };
    },

    resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;

      // Resolve fields in order
      for (const { name, encoder } of fieldEncoders) {
        const fieldOffset = fieldOffsets.get(name)!;
        writer.padTo(pos + fieldOffset);
        encoder.resolve(writer, value[name], resolver.fieldResolvers.get(name)!);
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

/**
 * Enum (tagged union) encoder.
 *
 * Layout: discriminant + padding + variant data
 */
export function enumEncoder<V extends Record<string, unknown | undefined>>(
  variants: {
    [K in keyof V]: V[K] extends undefined
      ? { fields?: undefined }
      : { fields: { [F in keyof V[K]]: { encoder: RkyvEncoder<V[K][F]> } } };
  }
): RkyvEncoder<
  { [K in keyof V]: { tag: K; value: V[K] } }[keyof V],
  Resolver & { variantResolver: Resolver | null }
> {
  type EnumValue = { [K in keyof V]: { tag: K; value: V[K] } }[keyof V];

  const variantNames = Object.keys(variants) as (keyof V)[];
  const variantCount = variantNames.length;

  // Determine discriminant size
  let discriminantSize: 1 | 2 | 4;
  if (variantCount <= 256) {
    discriminantSize = 1;
  } else if (variantCount <= 65536) {
    discriminantSize = 2;
  } else {
    discriminantSize = 4;
  }

  // Create encoders for each variant
  // Store the encoder and its alignment for per-variant padding calculation
  const variantEncoders: Map<keyof V, { index: number; encoder: RkyvEncoder<unknown> | null; align: number }> =
    new Map();

  let maxVariantAlign: number = discriminantSize;
  let maxVariantSize = 0;

  variantNames.forEach((name, index) => {
    const variant = variants[name];

    if (!variant.fields) {
      variantEncoders.set(name, { index, encoder: null, align: 1 });
    } else {
      const fieldEncoder = structEncoder(
        variant.fields as Record<string, { encoder: RkyvEncoder<unknown> }>
      );
      variantEncoders.set(name, { index, encoder: fieldEncoder, align: fieldEncoder.align });
      maxVariantAlign = Math.max(maxVariantAlign, fieldEncoder.align);
      maxVariantSize = Math.max(maxVariantSize, fieldEncoder.size);
    }
  });

  const maxDiscriminantPadding = alignOffset(discriminantSize, maxVariantAlign) - discriminantSize;
  const totalSize = discriminantSize + maxDiscriminantPadding + maxVariantSize;

  return {
    size: totalSize,
    align: maxVariantAlign,

    archive(writer, value) {
      const enumValue = value as EnumValue;
      const { encoder } = variantEncoders.get(enumValue.tag)!;

      if (encoder === null) {
        return { pos: writer.pos, variantResolver: null };
      }

      const variantResolver = encoder.archive(writer, enumValue.value);
      return { pos: writer.pos, variantResolver };
    },

    resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;

      const enumValue = value as EnumValue;
      const { index, encoder, align } = variantEncoders.get(enumValue.tag)!;

      // Write discriminant
      switch (discriminantSize) {
        case 1:
          writer.writeU8(index);
          break;
        case 2:
          writer.writeU16(index);
          break;
        case 4:
          writer.writeU32(index);
          break;
      }

      // Per-variant padding based on that variant's alignment
      const variantPadding = alignOffset(discriminantSize, align) - discriminantSize;
      for (let i = 0; i < variantPadding; i++) {
        writer.writeU8(0);
      }

      // Variant data
      if (encoder !== null) {
        encoder.resolve(writer, enumValue.value, resolver.variantResolver!);
      }

      // Pad to full size
      writer.padTo(pos + totalSize);

      return pos;
    },

    encode(writer, value) {
      const resolver = this.archive(writer, value);
      return this.resolve(writer, value, resolver);
    },
  };
}

/**
 * Union (untagged) encoder.
 *
 * All variants occupy the same memory location.
 * Caller must specify which variant to encode.
 */
export function unionEncoder<V extends Record<string, unknown>>(
  variants: { [K in keyof V]: { encoder: RkyvEncoder<V[K]> } }
): UnionEncoderType<V> {
  const variantNames = Object.keys(variants) as (keyof V)[];
  const variantEncoders = variantNames.map((name) => ({
    name,
    encoder: variants[name].encoder,
  }));

  // Calculate union size and alignment (max of all variants)
  let maxSize = 0;
  let maxAlign = 1;

  for (const { encoder } of variantEncoders) {
    maxSize = Math.max(maxSize, encoder.size);
    maxAlign = Math.max(maxAlign, encoder.align);
  }

  const totalSize = alignOffset(maxSize, maxAlign);

  // Create individual variant encoders
  const variantEncoderMap = {} as { [K in keyof V]: RkyvEncoder<V[K]> };
  for (const { name, encoder } of variantEncoders) {
    variantEncoderMap[name] = {
      size: totalSize,
      align: maxAlign,
      archive: (writer, value) => encoder.archive(writer, value),
      resolve: (writer, value, resolver) => {
        writer.align(maxAlign);
        const pos = writer.pos;
        encoder.resolve(writer, value, resolver);
        writer.padTo(pos + totalSize);
        return pos;
      },
      encode(writer, value) {
        const resolver = this.archive(writer, value);
        return this.resolve(writer, value, resolver);
      },
    };
  }

  return {
    size: totalSize,
    align: maxAlign,
    variants: variantEncoderMap,

    as<K extends keyof V>(variant: K): RkyvEncoder<V[K]> {
      return variantEncoderMap[variant];
    },

    // Default encode uses first variant (mainly for type compatibility)
    archive(writer, value) {
      const firstVariant = variantNames[0];
      return variantEncoders[0].encoder.archive(writer, (value as V)[firstVariant]);
    },

    resolve(writer, value, resolver) {
      writer.align(maxAlign);
      const pos = writer.pos;
      const firstVariant = variantNames[0];
      variantEncoders[0].encoder.resolve(writer, (value as V)[firstVariant], resolver);
      writer.padTo(pos + totalSize);
      return pos;
    },

    encode(writer, value) {
      const resolver = this.archive(writer, value);
      return this.resolve(writer, value, resolver);
    },
  };
}

/**
 * Extended encoder for unions that provides variant-specific access.
 */
export interface UnionEncoderType<V extends Record<string, unknown>>
  extends RkyvEncoder<V, Resolver> {
  variants: { [K in keyof V]: RkyvEncoder<V[K]> };
  as<K extends keyof V>(variant: K): RkyvEncoder<V[K]>;
}

/**
 * Tagged union encoder with external discriminant.
 */
export function taggedUnionEncoder<
  TTag extends number,
  V extends Record<TTag, { name: string; encoder: RkyvEncoder<unknown> }>
>(
  tagEncoder: RkyvEncoder<TTag>,
  variants: V
): RkyvEncoder<
  { [K in keyof V]: { tag: V[K]['name']; value: Parameters<V[K]['encoder']['encode']>[1] } }[keyof V],
  Resolver
> {
  type ResultType = {
    [K in keyof V]: { tag: V[K]['name']; value: Parameters<V[K]['encoder']['encode']>[1] };
  }[keyof V];

  const tagValues = Object.keys(variants).map(Number) as TTag[];

  // Build name to tag mapping
  const nameToTag = new Map<string, TTag>();
  for (const tagValue of tagValues) {
    nameToTag.set(variants[tagValue].name, tagValue);
  }

  // Calculate max variant size
  let maxVariantSize = 0;
  let maxVariantAlign = 1;

  for (const tagValue of tagValues) {
    const variant = variants[tagValue];
    maxVariantSize = Math.max(maxVariantSize, variant.encoder.size);
    maxVariantAlign = Math.max(maxVariantAlign, variant.encoder.align);
  }

  const tagPadding = alignOffset(tagEncoder.size, maxVariantAlign) - tagEncoder.size;
  const totalSize = tagEncoder.size + tagPadding + alignOffset(maxVariantSize, maxVariantAlign);
  const totalAlign = Math.max(tagEncoder.align, maxVariantAlign);

  return {
    size: totalSize,
    align: totalAlign,

    archive(writer, value) {
      const enumValue = value as ResultType;
      const tag = nameToTag.get(enumValue.tag as string)!;
      const variant = variants[tag];
      return variant.encoder.archive(writer, enumValue.value);
    },

    resolve(writer, value, resolver) {
      writer.align(this.align);
      const pos = writer.pos;

      const enumValue = value as ResultType;
      const tag = nameToTag.get(enumValue.tag as string)!;
      const variant = variants[tag];

      // Write tag
      tagEncoder.encode(writer, tag);

      // Padding
      for (let i = 0; i < tagPadding; i++) {
        writer.writeU8(0);
      }

      // Variant data
      variant.encoder.resolve(writer, enumValue.value, resolver);

      // Pad to full size
      writer.padTo(pos + totalSize);

      return pos;
    },

    encode(writer, value) {
      const resolver = this.archive(writer, value);
      return this.resolve(writer, value, resolver);
    },
  };
}
