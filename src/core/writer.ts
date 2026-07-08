import { DEFAULT_FORMAT, pointerBytes, type RkyvFormat } from './format.ts';

/**
 * The subset of the platform `TextEncoder` contract the writer needs — a
 * single UTF-8 `encodeInto`. The platform encoder satisfies it structurally;
 * hosts may inject a more efficient or hand-rolled implementation.
 */
export interface RkyvTextEncoder {
  /** UTF-8 encode `src` into `dest`, reporting the bytes written. */
  encodeInto(src: string, dest: Uint8Array): { written: number };
}

export interface RkyvWriterOptions {
  /** Wire format to emit. Defaults to rkyv's default format. */
  format?: RkyvFormat;
  initialCapacity?: number;
  /** UTF-8 encoder used for all text. Defaults to the platform TextEncoder. */
  textEncoder?: RkyvTextEncoder;
}

/**
 * RkyvWriter provides binary buffer writing operations for encoding data in
 * rkyv's serialization format.
 *
 * rkyv serializes depth-first from leaves to root:
 * 1. Dependencies (strings, vec contents, etc.) are written first
 * 2. The containing structure is written after, with relative pointers
 *    pointing back to the dependencies
 * 3. The root object ends up at the end of the buffer
 *
 * The writer owns the wire-format configuration: byte order is applied on
 * every multi-byte write, and `writeUsize`/relative-pointer operations use
 * the configured pointer width.
 *
 * Primitive writes do NOT self-align. Alignment is the caller's
 * responsibility (codecs align according to their format-resolved layout),
 * which is what makes the `unaligned` format work at all.
 */
export class RkyvWriter {
  buffer: Uint8Array;
  view: DataView;
  position: number;
  capacity: number;
  readonly format: RkyvFormat;
  readonly textEncoder: RkyvTextEncoder;
  /** True when the format is little-endian. */
  #le: boolean;
  /** Size in bytes of relative pointers and archived usize. */
  readonly pointerBytes: 2 | 4 | 8;

  constructor(options: RkyvWriterOptions = {}) {
    this.format = options.format ?? DEFAULT_FORMAT;
    this.#le = this.format.endian === 'little';
    this.pointerBytes = pointerBytes(this.format);
    this.capacity = options.initialCapacity ?? 1024;
    this.textEncoder = options.textEncoder ?? (sharedTextEncoder ??= new TextEncoder());
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
  #ensureCapacity(additionalBytes: number): void {
    const required = this.position + additionalBytes;
    if (required > this.capacity) {
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
   * Align the current position to the given alignment (a power of two),
   * zero-filling the padding.
   */
  align(alignment: number): number {
    const target = (this.position + alignment - 1) & -alignment;
    if (target !== this.position) {
      this.padTo(target);
    }
    return this.position;
  }

  /**
   * Zero-fill up to a specific position.
   */
  padTo(targetPosition: number): void {
    if (targetPosition > this.position) {
      this.#ensureCapacity(targetPosition - this.position);
      this.buffer.fill(0, this.position, targetPosition);
      this.position = targetPosition;
    }
  }

  /**
   * Write `count` zero bytes.
   */
  writeZeros(count: number): void {
    this.#ensureCapacity(count);
    this.buffer.fill(0, this.position, this.position + count);
    this.position += count;
  }

  // === Primitive Writers (no implicit alignment) ===

  writeU8(value: number): number {
    const pos = this.position;
    this.#ensureCapacity(1);
    this.view.setUint8(this.position++, value);
    return pos;
  }

  writeI8(value: number): number {
    const pos = this.position;
    this.#ensureCapacity(1);
    this.view.setInt8(this.position++, value);
    return pos;
  }

  writeU16(value: number): number {
    const pos = this.position;
    this.#ensureCapacity(2);
    this.view.setUint16(pos, value, this.#le);
    this.position += 2;
    return pos;
  }

  writeI16(value: number): number {
    const pos = this.position;
    this.#ensureCapacity(2);
    this.view.setInt16(pos, value, this.#le);
    this.position += 2;
    return pos;
  }

  writeU32(value: number): number {
    const pos = this.position;
    this.#ensureCapacity(4);
    this.view.setUint32(pos, value, this.#le);
    this.position += 4;
    return pos;
  }

  writeI32(value: number): number {
    const pos = this.position;
    this.#ensureCapacity(4);
    this.view.setInt32(pos, value, this.#le);
    this.position += 4;
    return pos;
  }

  writeU64(value: bigint): number {
    const pos = this.position;
    this.#ensureCapacity(8);
    this.view.setBigUint64(pos, value, this.#le);
    this.position += 8;
    return pos;
  }

  writeI64(value: bigint): number {
    const pos = this.position;
    this.#ensureCapacity(8);
    this.view.setBigInt64(pos, value, this.#le);
    this.position += 8;
    return pos;
  }

  writeF32(value: number): number {
    const pos = this.position;
    this.#ensureCapacity(4);
    this.view.setFloat32(pos, value, this.#le);
    this.position += 4;
    return pos;
  }

  writeF64(value: number): number {
    const pos = this.position;
    this.#ensureCapacity(8);
    this.view.setFloat64(pos, value, this.#le);
    this.position += 8;
    return pos;
  }

  writeBool(value: boolean): number {
    return this.writeU8(value ? 1 : 0);
  }

  /**
   * Write an archived `usize` (rkyv `FixedUsize` — the configured pointer
   * width).
   */
  writeUsize(value: number): number {
    switch (this.pointerBytes) {
      case 2:
        return this.writeU16(value);
      case 4:
        return this.writeU32(value);
      case 8:
        return this.writeU64(BigInt(value));
    }
  }

  /**
   * Write raw bytes to the buffer.
   */
  writeBytes(bytes: Uint8Array): number {
    const pos = this.position;
    this.#ensureCapacity(bytes.length);
    this.buffer.set(bytes, this.position);
    this.position += bytes.length;
    return pos;
  }

  /**
   * UTF-8 encode `text` directly into the buffer at the current position
   * (no intermediate allocation). Returns the number of bytes written.
   */
  writeText(text: string): number {
    // Worst case: 3 bytes per UTF-16 code unit.
    this.#ensureCapacity(text.length * 3);
    const { written } = this.textEncoder.encodeInto(
      text,
      this.buffer.subarray(this.position),
    );
    this.position += written;
    return written;
  }

  /**
   * Encode a string to UTF-8 bytes (allocates; prefer `writeText` when the
   * destination is the buffer itself).
   */
  encodeText(text: string): Uint8Array {
    // Worst case: 3 bytes per UTF-16 code unit.
    const buf = new Uint8Array(text.length * 3);
    const { written } = this.textEncoder.encodeInto(text, buf);
    return buf.subarray(0, written);
  }

  // === Relative pointers (format pointer width) ===

  /**
   * Reserve space for a relative pointer at the current (already aligned)
   * position and return that position. Fill it later with `writeRelPtrAt`
   * or `writeInvalidPtrAt`.
   */
  reserveRelPtr(): number {
    const pos = this.position;
    this.#ensureCapacity(this.pointerBytes);
    this.position += this.pointerBytes;
    return pos;
  }

  /**
   * Store a raw signed offset into the relative pointer at `fromPos`.
   */
  writeRelPtrOffsetAt(fromPos: number, rawOffset: number): void {
    switch (this.pointerBytes) {
      case 2:
        this.view.setInt16(fromPos, rawOffset, this.#le);
        break;
      case 4:
        this.view.setInt32(fromPos, rawOffset, this.#le);
        break;
      case 8:
        this.view.setBigInt64(fromPos, BigInt(rawOffset), this.#le);
        break;
    }
  }

  /**
   * Write a relative pointer at `fromPos` pointing to `toPos`.
   */
  writeRelPtrAt(fromPos: number, toPos: number): void {
    this.writeRelPtrOffsetAt(fromPos, toPos - fromPos);
  }

  /**
   * Write rkyv's invalid-pointer sentinel (raw offset `1`, as emitted by
   * `RelPtr::emplace_invalid`) at `fromPos`. Used for dead `Weak` pointers
   * and empty hash tables.
   */
  writeInvalidPtrAt(fromPos: number): void {
    this.writeRelPtrOffsetAt(fromPos, 1);
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

// Lazily constructed so hosts without a global TextEncoder can still import
// this module and inject their own implementation per writer.
let sharedTextEncoder: RkyvTextEncoder | undefined;
