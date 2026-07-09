/**
 * Layout contracts: the per-format geometry of archived representations.
 *
 * These are pure type declarations — the shape of what `codec.layout(fmt)`
 * returns (and what {@link CodecMeta} arms expose through their typed
 * layout accessors). The direction-neutral layout *math* that computes them
 * lives in `src/internal/layout.ts`; only the contracts are core API.
 */

/**
 * Size and alignment of a codec's archived representation under a specific
 * wire format.
 */
export interface Layout {
  readonly size: number;
  readonly align: number;
}

// ============================================================================
// String (rkyv 0.8 inline/out-of-line hybrid repr)
// ============================================================================

export interface StringLayout extends Layout {
  /** Bytes of an ArchivedUsize / relative pointer. */
  pb: 2 | 4 | 8;
  /** INLINE_CAPACITY = size_of::<OutOfLineRepr>() = 2 * pb. */
  inlineCapacity: number;
  /** OUT_OF_LINE_CAPACITY = (1 << (BITS - 2)) - 1. */
  maxLength: number;
}

// ============================================================================
// Vec<T> header (relative pointer + length)
// ============================================================================

export interface VecLayout extends Layout {
  pb: 2 | 4 | 8;
}

// ============================================================================
// Option<T> (tag byte + padded value)
// ============================================================================

export interface OptionLayout extends Layout {
  valueOffset: number;
}

// ============================================================================
// [T; N] — fixed-size array
// ============================================================================

export interface ArrayLayout extends Layout {
  stride: number;
}

// ============================================================================
// Struct / tuple (C-style sequential field layout)
// ============================================================================

export interface StructLayout extends Layout {
  offsets: number[];
}

// ============================================================================
// Tagged enum (rkyv's repr(u8)/repr(u16) layout)
// ============================================================================

export interface VariantLayout {
  fieldOffsets: number[];
}

export interface EnumLayout extends Layout {
  discSize: 1 | 2;
  variants: VariantLayout[];
}
