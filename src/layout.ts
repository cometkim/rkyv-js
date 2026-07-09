/**
 * Direction-neutral layout math shared by the decode-only and encode-only
 * codec chains (`src/decode.ts` / `src/encode.ts`).
 *
 * Both chains compute identical archived geometry — the wire format does not
 * depend on direction — so the pure layout helpers live here exactly once.
 * The layout *contracts* these functions produce live in `core/layout.ts`
 * (they are public API via `codec.layout()` and the `meta` descriptors);
 * this module holds only the math. It may import only `core/base`,
 * `core/format`, and `core/layout`: it must never drag the reader, the
 * writer, or a hasher into either unidirectional bundle.
 */

import { alignOffset } from './core/base.ts';
import { pointerBytes, type RkyvFormat } from './core/format.ts';
import type {
  ArrayLayout,
  EnumLayout,
  Layout,
  OptionLayout,
  StringLayout,
  StructLayout,
  VariantLayout,
  VecLayout,
} from './core/layout.ts';

export type {
  ArrayLayout,
  EnumLayout,
  Layout,
  OptionLayout,
  StringLayout,
  StructLayout,
  VariantLayout,
  VecLayout,
} from './core/layout.ts';

/**
 * The minimal contract layout helpers require of child codecs — satisfied by
 * read codecs, write codecs, and full codecs alike.
 */
export interface HasLayout {
  layout(fmt: RkyvFormat): Layout;
}

// ============================================================================
// String (rkyv 0.8 inline/out-of-line hybrid repr)
// ============================================================================

export function stringLayout(fmt: RkyvFormat): StringLayout {
  const pb = pointerBytes(fmt);
  return {
    size: pb * 2,
    align: fmt.aligned ? pb : 1,
    pb,
    inlineCapacity: pb * 2,
    maxLength: pb === 8 ? Number.MAX_SAFE_INTEGER : 2 ** (pb * 8 - 2) - 1,
  };
}

// ============================================================================
// Vec<T> header (relative pointer + length)
// ============================================================================

// The vec header's layout never depends on the element — that is what
// makes recursive types (`struct Tree { children: Vec<Tree> }`) legal.
// Element geometry is memoized separately and only computed at
// read/write time, when any recursion has already bottomed out.
export function vecLayout(fmt: RkyvFormat): VecLayout {
  const pb = pointerBytes(fmt);
  return { size: pb * 2, align: fmt.aligned ? pb : 1, pb };
}

/**
 * Distance between consecutive archived elements of a sequence.
 */
export function elementStride(fmt: RkyvFormat, element: HasLayout): number {
  const el = element.layout(fmt);
  return alignOffset(el.size, el.align);
}

// ============================================================================
// Box<T> / Rc<T> / Weak<T> (a bare relative pointer)
// ============================================================================

export function ptrLayout(fmt: RkyvFormat): Layout {
  const pb = pointerBytes(fmt);
  return { size: pb, align: fmt.aligned ? pb : 1 };
}

// ============================================================================
// Option<T> (tag byte + padded value)
// ============================================================================

export function optionLayout(fmt: RkyvFormat, inner: HasLayout): OptionLayout {
  const el = inner.layout(fmt);
  const valueOffset = alignOffset(1, el.align);
  return {
    size: valueOffset + el.size,
    align: Math.max(1, el.align),
    valueOffset,
  };
}

// ============================================================================
// [T; N] — fixed-size array
// ============================================================================

export function arrayLayout(fmt: RkyvFormat, element: HasLayout, length: number): ArrayLayout {
  const el = element.layout(fmt);
  const stride = alignOffset(el.size, el.align);
  return { size: stride * length, align: el.align, stride };
}

// ============================================================================
// Struct / tuple (C-style sequential field layout)
// ============================================================================

export function structLayout(fmt: RkyvFormat, codecs: readonly HasLayout[]): StructLayout {
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

// ============================================================================
// Tagged enum (rkyv's repr(u8)/repr(u16) layout)
// ============================================================================

export function enumLayout(
  fmt: RkyvFormat,
  variantFields: readonly (readonly HasLayout[])[],
): EnumLayout {
  const count = variantFields.length;
  const discSize: 1 | 2 = count <= 256 ? 1 : 2;
  const discAlign = fmt.aligned ? discSize : 1;
  let enumAlign: number = discAlign;
  let maxVariantSize: number = discSize;

  // Each variant is a repr(C) struct `{ tag, ...fields }` with fields laid
  // out directly after the tag (RFC 2195); the enum is their union.
  const variants: VariantLayout[] = variantFields.map((fields) => {
    let off: number = discSize;
    let variantAlign: number = discAlign;
    const fieldOffsets: number[] = new Array<number>(fields.length);
    for (let i = 0; i < fields.length; i++) {
      const el = fields[i].layout(fmt);
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

// ============================================================================
// Untagged union (max of the variants)
// ============================================================================

export function unionLayout(fmt: RkyvFormat, codecs: readonly HasLayout[]): Layout {
  let size = 0;
  let align = 1;
  for (let i = 0; i < codecs.length; i++) {
    const el = codecs[i].layout(fmt);
    size = Math.max(size, el.size);
    align = Math.max(align, el.align);
  }
  return { size: alignOffset(size, align), align };
}
