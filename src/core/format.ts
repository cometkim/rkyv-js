/**
 * rkyv wire-format configuration.
 *
 * These correspond to the rkyv crate's compile-time format features and must
 * match the Rust side exactly:
 *
 * | Option         | rkyv default | rkyv feature                          |
 * |----------------|--------------|---------------------------------------|
 * | `endian`       | `'little'`   | `big_endian`                          |
 * | `pointerWidth` | `32`         | `pointer_width_16`/`pointer_width_64` |
 * | `aligned`      | `true`       | `unaligned`                           |
 *
 * Formats are compared by object identity in per-codec layout caches, so
 * always create them through {@link format} (which canonicalizes the default)
 * and reuse the returned object.
 */
export interface RkyvFormat {
  /**
   * Byte order of all multi-byte values.
   */
  readonly endian: 'little' | 'big';

  /**
   * Width in bits of relative pointers and archived `usize`/`isize`
   * (`FixedUsize` in rkyv).
   */
  readonly pointerWidth: 16 | 32 | 64;

  /**
   * Whether archived primitives keep their natural alignment.
   * `false` corresponds to rkyv's `unaligned` feature (all alignments are 1).
   */
  readonly aligned: boolean;
}

/**
 * The default rkyv format: little-endian, 32-bit pointers, aligned.
 */
export const DEFAULT_FORMAT: RkyvFormat = Object.freeze({
  endian: 'little',
  pointerWidth: 32,
  aligned: true,
});

/**
 * Create a canonical {@link RkyvFormat}.
 *
 * Options equivalent to the default return the {@link DEFAULT_FORMAT}
 * singleton so identity-keyed layout caches stay warm.
 */
export function format(options: Partial<RkyvFormat> = {}): RkyvFormat {
  const endian = options.endian ?? 'little';
  const pointerWidth = options.pointerWidth ?? 32;
  const aligned = options.aligned ?? true;

  if (endian === 'little' && pointerWidth === 32 && aligned) {
    return DEFAULT_FORMAT;
  }
  return Object.freeze({ endian, pointerWidth, aligned });
}

/**
 * Size in bytes of relative pointers and archived `usize` under `fmt`.
 */
export function pointerBytes(fmt: RkyvFormat): 2 | 4 | 8 {
  return (fmt.pointerWidth / 8) as 2 | 4 | 8;
}
