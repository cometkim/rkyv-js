/**
 * Configuration for the rkyv format.
 * These should match the Rust compilation features used.
 */
export interface RkyvConfig {
  /**
   * Endianness of the serialized data.
   * Default in rkyv is 'little'.
   */
  endianness: 'little' | 'big';

  /**
   * Pointer width for relative pointers (isize/usize serialization).
   * Default in rkyv is 32.
   */
  pointerWidth: 16 | 32 | 64;

  /**
   * Whether primitives are aligned.
   * Default in rkyv is true (aligned).
   */
  aligned: boolean;
}

export const DEFAULT_CONFIG: RkyvConfig = {
  endianness: 'little',
  pointerWidth: 32,
  aligned: true,
};
