/**
 * RkyvWriter provides binary buffer writing operations for encoding
 * data in rkyv's serialization format.
 *
 * rkyv serializes depth-first from leaves to root, meaning:
 * 1. Dependencies (strings, vec contents, etc.) are written first
 * 2. The containing structure is written after, with relative pointers
 *    pointing back to the dependencies
 * 3. The root object ends up at the end of the buffer
 */
export class RkyvWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private position: number;
  private capacity: number;

  constructor(initialCapacity: number = 1024) {
    this.capacity = initialCapacity;
    this.buffer = new Uint8Array(this.capacity);
    this.view = new DataView(this.buffer.buffer);
    this.position = 0;
  }

  /**
   * Current write position in the buffer.
   */
  get pos(): number {
    return this.position;
  }

  /**
   * Ensure the buffer has enough capacity for additional bytes.
   */
  private ensureCapacity(additionalBytes: number): void {
    const required = this.position + additionalBytes;
    if (required > this.capacity) {
      // Double capacity until it's enough
      while (this.capacity < required) {
        this.capacity *= 2;
      }
      const newBuffer = new Uint8Array(this.capacity);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
      this.view = new DataView(this.buffer.buffer);
    }
  }

  /**
   * Align the current position to the given alignment.
   * Writes zero padding bytes as needed.
   */
  align(alignment: number): number {
    const remainder = this.position % alignment;
    if (remainder !== 0) {
      const padding = alignment - remainder;
      this.ensureCapacity(padding);
      // Zero-fill padding
      for (let i = 0; i < padding; i++) {
        this.buffer[this.position++] = 0;
      }
    }
    return this.position;
  }

  /**
   * Write padding bytes to reach a specific position.
   */
  padTo(targetPosition: number): void {
    if (targetPosition > this.position) {
      const padding = targetPosition - this.position;
      this.ensureCapacity(padding);
      for (let i = 0; i < padding; i++) {
        this.buffer[this.position++] = 0;
      }
    }
  }

  // === Primitive Writers (Little Endian) ===

  writeU8(value: number): number {
    const pos = this.position;
    this.ensureCapacity(1);
    this.view.setUint8(this.position++, value);
    return pos;
  }

  writeI8(value: number): number {
    const pos = this.position;
    this.ensureCapacity(1);
    this.view.setInt8(this.position++, value);
    return pos;
  }

  writeU16(value: number): number {
    this.align(2);
    const pos = this.position;
    this.ensureCapacity(2);
    this.view.setUint16(this.position, value, true);
    this.position += 2;
    return pos;
  }

  writeI16(value: number): number {
    this.align(2);
    const pos = this.position;
    this.ensureCapacity(2);
    this.view.setInt16(this.position, value, true);
    this.position += 2;
    return pos;
  }

  writeU32(value: number): number {
    this.align(4);
    const pos = this.position;
    this.ensureCapacity(4);
    this.view.setUint32(this.position, value, true);
    this.position += 4;
    return pos;
  }

  writeI32(value: number): number {
    this.align(4);
    const pos = this.position;
    this.ensureCapacity(4);
    this.view.setInt32(this.position, value, true);
    this.position += 4;
    return pos;
  }

  writeU64(value: bigint): number {
    this.align(8);
    const pos = this.position;
    this.ensureCapacity(8);
    this.view.setBigUint64(this.position, value, true);
    this.position += 8;
    return pos;
  }

  writeI64(value: bigint): number {
    this.align(8);
    const pos = this.position;
    this.ensureCapacity(8);
    this.view.setBigInt64(this.position, value, true);
    this.position += 8;
    return pos;
  }

  writeF32(value: number): number {
    this.align(4);
    const pos = this.position;
    this.ensureCapacity(4);
    this.view.setFloat32(this.position, value, true);
    this.position += 4;
    return pos;
  }

  writeF64(value: number): number {
    this.align(8);
    const pos = this.position;
    this.ensureCapacity(8);
    this.view.setFloat64(this.position, value, true);
    this.position += 8;
    return pos;
  }

  writeBool(value: boolean): number {
    return this.writeU8(value ? 1 : 0);
  }

  /**
   * Write raw bytes to the buffer.
   */
  writeBytes(bytes: Uint8Array): number {
    const pos = this.position;
    this.ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.position);
    this.position += bytes.length;
    return pos;
  }

  /**
   * Write a relative pointer at a specific position.
   * The pointer points from `fromPos` to `toPos`.
   */
  writeRelPtr32At(fromPos: number, toPos: number): void {
    const offset = toPos - fromPos;
    this.view.setInt32(fromPos, offset, true);
  }

  /**
   * Reserve space for a relative pointer and return its position.
   * The actual pointer value should be written later with writeRelPtr32At.
   */
  reserveRelPtr32(): number {
    this.align(4);
    const pos = this.position;
    this.ensureCapacity(4);
    this.position += 4;
    return pos;
  }

  /**
   * Get the final buffer containing the serialized data.
   */
  finish(): Uint8Array {
    return this.buffer.subarray(0, this.position);
  }

  /**
   * Reset the writer to reuse the buffer.
   */
  reset(): void {
    this.position = 0;
  }
}

/**
 * Resolver holds the position of archived data written during serialization.
 * This is used to compute relative pointers when the containing struct is written.
 */
export interface Resolver {
  /**
   * The position where the archived data was written.
   */
  pos: number;
}

/**
 * String resolver containing the position of string bytes.
 */
export interface StringResolver extends Resolver {
  len: number;
}

/**
 * Vec resolver containing the position of array elements.
 */
export interface VecResolver extends Resolver {
  len: number;
}
