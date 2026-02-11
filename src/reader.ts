export interface RkyvReaderOptions {
  textDecoder?: TextDecoder,
};

/**
 * RkyvReader provides low-level binary buffer reading operations
 * for decoding rkyv-serialized data.
 *
 * rkyv uses little-endian byte ordering by default (configurable in Rust via features).
 * This reader assumes little-endian format.
 */
export class RkyvReader {
  readonly view: DataView;
  readonly textDecoder: TextDecoder;

  constructor(buffer: ArrayBuffer | Uint8Array, options: RkyvReaderOptions = {}) {
    this.textDecoder = options.textDecoder || new TextDecoder();

    if (buffer instanceof Uint8Array) {
      this.view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    } else {
      this.view = new DataView(buffer);
    }
  }

  /**
   * Get the root position for rkyv archives.
   * rkyv lays out objects depth-first from leaves to root,
   * meaning the root object is at the end of the buffer.
   */
  getRootPosition(rootSize: number): number {
    return this.view.byteLength - rootSize;
  }

  // === Primitive Type Readers (Little Endian) ===

  readU8(offset: number): number {
    return this.view.getUint8(offset);
  }

  readI8(offset: number): number {
    return this.view.getInt8(offset);
  }

  readU16(offset: number): number {
    return this.view.getUint16(offset, true); // little-endian
  }

  readI16(offset: number): number {
    return this.view.getInt16(offset, true);
  }

  readU32(offset: number): number {
    return this.view.getUint32(offset, true);
  }

  readI32(offset: number): number {
    return this.view.getInt32(offset, true);
  }

  readU64(offset: number): bigint {
    return this.view.getBigUint64(offset, true);
  }

  readI64(offset: number): bigint {
    return this.view.getBigInt64(offset, true);
  }

  readF32(offset: number): number {
    return this.view.getFloat32(offset, true);
  }

  readF64(offset: number): number {
    return this.view.getFloat64(offset, true);
  }

  readBool(offset: number): boolean {
    return this.view.getUint8(offset) !== 0;
  }

  /**
   * Read a raw byte slice from the buffer
   */
  readBytes(offset: number, length: number): Uint8Array {
    return new Uint8Array(this.view.buffer, this.view.byteOffset + offset, length);
  }

  /**
   */
  readText(offset: number, length: number): string {
    const bytes = this.readBytes(offset, length);
    return this.textDecoder.decode(bytes);
  }

  /**
   * Read a relative pointer (32-bit signed offset by default in rkyv).
   * Returns the absolute position the pointer points to.
   *
   * @param offset - The position of the relative pointer in the buffer
   * @returns The absolute position the pointer points to
   */
  readRelPtr32(offset: number): number {
    const relativeOffset = this.view.getInt32(offset, true);
    return offset + relativeOffset;
  }

  /**
   * Read a 16-bit relative pointer.
   */
  readRelPtr16(offset: number): number {
    const relativeOffset = this.view.getInt16(offset, true);
    return offset + relativeOffset;
  }

  /**
   * Read a 64-bit relative pointer.
   */
  readRelPtr64(offset: number): bigint {
    const relativeOffset = this.view.getBigInt64(offset, true);
    return BigInt(offset) + relativeOffset;
  }
}
