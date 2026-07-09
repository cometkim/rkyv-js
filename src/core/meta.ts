/**
 * Self-describing shape descriptors (`meta`) for rkyv-js codecs.
 *
 * Every codec — decoder, encoder, or full — carries a `meta` describing its
 * archived shape as one arm of the discriminated union below. Consumers
 * dispatch on the numeric `meta.kind` tag instead of probing implementation
 * classes, so decode-only chains, encode-only chains, full codecs, and
 * user-defined codecs are all introspectable through one protocol (JIT
 * compilation, schema tooling, interop).
 *
 * A non-opaque `meta` is a behavioral promise, not a hint: it declares that
 * the codec's `read`/`resolve` implement rkyv's standard algorithm for that
 * shape over exactly the children it lists, with the layout its accessor
 * returns. Consumers may bypass the codec's own methods based on it — a
 * codec that customizes behavior (including a subclass of an intrinsic
 * codec) must carry {@link OPAQUE_META} instead. Wrappers and containers
 * whose wire form is not one of the listed shapes (box, maps, transforms,
 * …) stay opaque and are always driven through their own methods.
 *
 * The child type `C` is direction-typed: a `Decoder` carries
 * `CodecMeta<AnyDecoder>`, an `Encoder` carries `CodecMeta<AnyEncoder>`,
 * and a full codec's children are full codecs satisfying both.
 */

import type { RkyvFormat } from './format.ts';
import type {
  ArrayLayout,
  EnumLayout,
  OptionLayout,
  StringLayout,
  StructLayout,
  VecLayout,
} from './layout.ts';

// ============================================================================
// Kind tags
// ============================================================================

/**
 * The numeric kind tags, as one mapped object — the only public spelling.
 * 0–11 are the primitive element kinds: a primitive codec's `meta.kind` IS
 * its element kind, which is what the vec bulk paths and the JIT primitive
 * switches dispatch on (no separate per-primitive field). 12+ tag the
 * composite shapes.
 */
export const Kind: {
  /** A primitive the bulk paths cannot batch (char, unit). */
  readonly other: 0;
  readonly u8: 1;
  readonly i8: 2;
  readonly u16: 3;
  readonly i16: 4;
  readonly u32: 5;
  readonly i32: 6;
  readonly u64: 7;
  readonly i64: 8;
  readonly f32: 9;
  readonly f64: 10;
  readonly bool: 11;
  readonly opaque: 12;
  readonly string: 13;
  readonly struct: 14;
  readonly tuple: 15;
  readonly option: 16;
  readonly vec: 17;
  readonly array: 18;
  readonly enum: 19;
} = Object.freeze({
  other: 0,
  u8: 1,
  i8: 2,
  u16: 3,
  i16: 4,
  u32: 5,
  i32: 6,
  u64: 7,
  i64: 8,
  f32: 9,
  f64: 10,
  bool: 11,
  opaque: 12,
  string: 13,
  struct: 14,
  tuple: 15,
  option: 16,
  vec: 17,
  array: 18,
  enum: 19,
});

/** The kind tag of a primitive codec's meta (a fixed-size scalar). */
export type PrimitiveKindTag = (typeof Kind)[
  | 'other'
  | 'u8'
  | 'i8'
  | 'u16'
  | 'i16'
  | 'u32'
  | 'i32'
  | 'u64'
  | 'i64'
  | 'f32'
  | 'f64'
  | 'bool'];

/**
 * The batchable primitive kind a codec's meta declares, or `Kind.other`
 * for unbatchable primitives and every composite shape. This is the
 * element-kind derivation used by vec's monomorphic bulk paths.
 */
export function primitiveKindOf(meta: CodecMeta<unknown>): PrimitiveKindTag {
  switch (meta.kind) {
    case Kind.u8:
    case Kind.i8:
    case Kind.u16:
    case Kind.i16:
    case Kind.u32:
    case Kind.i32:
    case Kind.u64:
    case Kind.i64:
    case Kind.f32:
    case Kind.f64:
    case Kind.bool:
      return meta.kind;
    default:
      return Kind.other;
  }
}

// ============================================================================
// Shape descriptors
// ============================================================================

/** A codec with no declared shape — always driven through its own methods. */
export interface OpaqueMeta {
  readonly kind: (typeof Kind)['opaque'];
}

/**
 * A fixed-size scalar. The kind tag itself identifies the primitive
 * (`Kind.u8` … `Kind.bool`, or `Kind.other` for char/unit).
 */
export interface PrimitiveMeta {
  readonly kind: PrimitiveKindTag;
}

/** rkyv 0.8's inline/out-of-line hybrid string repr. */
export interface StringMeta {
  readonly kind: (typeof Kind)['string'];
  layout(fmt: RkyvFormat): StringLayout;
}

export interface CodecMetaField<C> {
  readonly name: string;
  readonly codec: C;
}

/** C-style struct with named fields at `layout(fmt).offsets`. */
export interface StructMeta<C> {
  readonly kind: (typeof Kind)['struct'];
  readonly fields: readonly CodecMetaField<C>[];
  layout(fmt: RkyvFormat): StructLayout;
}

/** Positional struct: elements at `layout(fmt).offsets`. */
export interface TupleMeta<C> {
  readonly kind: (typeof Kind)['tuple'];
  readonly elements: readonly C[];
  layout(fmt: RkyvFormat): StructLayout;
}

/** Tag byte, then the value at `layout(fmt).valueOffset`. */
export interface OptionMeta<C> {
  readonly kind: (typeof Kind)['option'];
  readonly inner: C;
  layout(fmt: RkyvFormat): OptionLayout;
}

/** Vec header (relative pointer + length); element geometry via `element`. */
export interface VecMeta<C> {
  readonly kind: (typeof Kind)['vec'];
  readonly element: C;
  layout(fmt: RkyvFormat): VecLayout;
}

/** `[T; N]`: `length` elements at stride `layout(fmt).stride`. */
export interface ArrayMeta<C> {
  readonly kind: (typeof Kind)['array'];
  readonly element: C;
  readonly length: number;
  layout(fmt: RkyvFormat): ArrayLayout;
}

/** One flattened field of a normalized enum variant (`name` null = newtype). */
export interface CodecMetaVariantField<C> {
  readonly name: string | null;
  readonly codec: C;
}

/** A normalized enum variant: tag name and flattened field list. */
export interface CodecMetaVariant<C> {
  readonly name: string;
  readonly fields: readonly CodecMetaVariantField<C>[];
}

/** rkyv's repr(u8)/repr(u16) tagged enum; variants in discriminant order. */
export interface EnumMeta<C> {
  readonly kind: (typeof Kind)['enum'];
  readonly variants: readonly CodecMetaVariant<C>[];
  layout(fmt: RkyvFormat): EnumLayout;
}

/**
 * The shape descriptor carried by every codec. Dispatch on `kind`; each
 * shape arm exposes its children and a typed layout accessor (delegating to
 * the codec's own memoized `layout`).
 */
export type CodecMeta<C> =
  | OpaqueMeta
  | PrimitiveMeta
  | StringMeta
  | StructMeta<C>
  | TupleMeta<C>
  | OptionMeta<C>
  | VecMeta<C>
  | ArrayMeta<C>
  | EnumMeta<C>;

/**
 * The shared default descriptor. Every codec starts opaque; intrinsic
 * codecs assign their shape in the constructor, and subclasses that
 * override behavior must reset `meta` back to this.
 */
export const OPAQUE_META: CodecMeta<never> = { kind: Kind.opaque };
