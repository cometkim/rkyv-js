import { DEFAULT_FORMAT, pointerBytes, type RkyvFormat } from './format.ts';

/**
 * The subset of the platform `TextEncoder` contract the writer needs a single UTF-8 `encodeInto`. 
 * The platform encoder satisfies it structurally; hosts may inject a more efficient or hand-rolled implementation.
 */
export interface RkyvTextEncoder {
  /**
   * UTF-8 encode `src` into `dest`, reporting the bytes written and,
   * optionally, the UTF-16 code units read (the platform encoder reports both).
   *
   * `read` lets a fixed-buffer writer distinguish "everything fit" from "output truncated";
   * without it, an output that exactly fills `dest` is conservatively treated as truncated.
   */
  encodeInto(src: string, dest: Uint8Array): { read?: number; written: number };
}

export interface RkyvWriterOptions {
  /** Wire format to emit. Defaults to rkyv's default format. */
  format?: RkyvFormat;

  initialCapacity?: number;

  /** UTF-8 encoder used for all text. Defaults to the platform TextEncoder. */
  textEncoder?: RkyvTextEncoder;

  /**
   * Write into caller-provided memory instead of an owned, growable buffer.
   *
   * The writer is then **fixed-capacity**: running past `buffer.length`
   * throws a `RangeError` instead of growing (`initialCapacity` is ignored).
   *
   * This is the zero-copy path for producing an archive directly in its final destination,
   * e.g. a `WebAssembly.Memory` region:
   * 
   * @example
   * ```ts
   * const region = new Uint8Array(memory.buffer, ptr, size);
   * const writer = new RkyvWriter({ buffer: region });
   * codec.encodeInto(writer, value); // archive written in place
   * const byteLength = writer.pos;
   * ```
   *
   * @note Two caller responsibilities:
   * - **Alignment**: rkyv archives are aligned relative to the buffer start,
   *   so the region itself must start at an address satisfying the archived type's alignment
   *   (allocate with ≥ 8-byte alignment to cover every kind).
   * - **Staleness**: growing a `WebAssembly.Memory` detaches the buffer the region views.
   *   Construct a fresh writer after any operation that may grow the memory.
   */
  buffer?: Uint8Array;
}

/**
 * RkyvWriter provides binary buffer writing operations for encoding data in
 * rkyv's serialization format.
 *
 * rkyv serializes depth-first from leaves to root:
 * 1. Dependencies (strings, vec contents, etc.) are written first
 * 2. The containing structure is written after, with relative pointers pointing back to the dependencies
 * 3. The root object ends up at the end of the buffer
 *
 * The writer owns the wire-format configuration: byte order is applied on every multi-byte write,
 * and `writeUsize`/relative-pointer operations use the configured pointer width.
 *
 * Primitive writes do NOT self-align. Alignment is the caller's responsibility
 * (codecs align according to their format-resolved layout), which is what makes the `unaligned` format work at all.
 */
export class RkyvWriter {
  buffer: Uint8Array;
  view: DataView;
  position: number;
  capacity: number;
  readonly format: RkyvFormat;
  readonly textEncoder: RkyvTextEncoder;
  /** True for a caller-provided buffer: capacity is fixed, overflow throws. */
  readonly fixed: boolean;
  /** True when the format is little-endian. */
  #le: boolean;
  /** Size in bytes of relative pointers and archived usize. */
  readonly pointerBytes: 2 | 4 | 8;

  constructor(options: RkyvWriterOptions = {}) {
    this.format = options.format ?? DEFAULT_FORMAT;
    this.#le = this.format.endian === 'little';
    this.pointerBytes = pointerBytes(this.format);
    this.textEncoder = options.textEncoder ?? (sharedTextEncoder ??= new TextEncoder());
    const external = options.buffer;
    if (external !== undefined) {
      this.fixed = true;
      this.capacity = external.length;
      this.buffer = external;
    } else {
      this.fixed = false;
      this.capacity = options.initialCapacity ?? 1024;
      this.buffer = new Uint8Array(this.capacity);
    }
    // Anchored at the Uint8Array's own offset so `position` addresses the
    // view and the underlying memory identically (external buffers are
    // typically subarrays with a non-zero byteOffset).
    this.view = new DataView(this.buffer.buffer, this.buffer.byteOffset, this.buffer.byteLength);
    this.position = 0;
  }

  /**
   * Current write position in the buffer.
   */
  get pos(): number {
    return this.position;
  }

  /**
   * True when the wire endianness matches the platform's byte order —
   * the precondition for bulk typed-array writes into the buffer.
   */
  get nativeEndian(): boolean {
    return this.#le === PLATFORM_LE;
  }

  /**
   * Advance `count` bytes without initializing the contents, returning the
   * start position. For bulk writers that overwrite the whole range through
   * a typed-array view — construct the view *after* calling this: growing
   * may replace the underlying buffer.
   */
  reserve(count: number): number {
    const pos = this.position;
    this.#ensureCapacity(count);
    this.position += count;
    return pos;
  }

  /**
   * Ensure the buffer has enough capacity for additional bytes: grow an
   * owned buffer, throw for a fixed (caller-provided) one.
   */
  #ensureCapacity(additionalBytes: number): void {
    const required = this.position + additionalBytes;
    if (required > this.capacity) {
      if (this.fixed) {
        this.#overflow(additionalBytes);
      }
      while (this.capacity < required) {
        this.capacity *= 2;
      }
      const newBuffer = new Uint8Array(this.capacity);
      newBuffer.set(this.buffer);
      this.buffer = newBuffer;
      this.view = new DataView(newBuffer.buffer, 0, newBuffer.byteLength);
    }
  }

  #overflow(additionalBytes: number): never {
    throw new RangeError(
      `rkyv-js: fixed writer buffer overflow: ${additionalBytes} more bytes at position ${this.position} exceed the capacity of ${this.capacity}`,
    );
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
    if (text.length === 0) return 0;
    if (!this.fixed) {
      // Worst case: 3 bytes per UTF-16 code unit.
      this.#ensureCapacity(text.length * 3);
      const { written } = this.textEncoder.encodeInto(
        text,
        this.buffer.subarray(this.position),
      );
      this.position += written;
      return written;
    }
    // Fixed buffer: the worst-case estimate may overshoot what's left even
    // when the encoded text fits, so encode into the remaining space and
    // detect a true overflow from the encoder's progress. Encoders that
    // don't report `read` are judged by whether the output filled `dest`
    // (an exact fill is then conservatively treated as truncation).
    const dest = this.buffer.subarray(this.position);
    const result = this.textEncoder.encodeInto(text, dest);
    const read = result.read ?? (result.written < dest.length ? text.length : -1);
    if (read < text.length) {
      this.#overflow(text.length * 3);
    }
    this.position += result.written;
    return result.written;
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

// Platform byte order (JS typed arrays are always platform-endian).
const PLATFORM_LE = new Uint8Array(Uint16Array.of(1).buffer)[0] === 1;
