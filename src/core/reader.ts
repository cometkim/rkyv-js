import { DEFAULT_FORMAT, pointerBytes, type RkyvFormat } from './format.ts';

/**
 * The subset of the platform `TextDecoder` contract the reader needs — a
 * single UTF-8 `decode`. The platform decoder satisfies it structurally;
 * hosts may inject a more efficient or hand-rolled implementation.
 */
export interface RkyvTextDecoder {
  /** Decode UTF-8 `bytes` into a string. */
  decode(bytes: Uint8Array): string;
}

export interface RkyvReaderOptions {
  /** Wire format of the buffer. Defaults to rkyv's default format. */
  format?: RkyvFormat;
  /** UTF-8 decoder used for all text. Defaults to the platform TextDecoder. */
  textDecoder?: RkyvTextDecoder;
}

// Shared 8-byte scratch for float and 64-bit reads: constructed once per
// process instead of one DataView per decoded buffer. The scratch read takes
// the little-endian flag, so this stays endian- and platform-correct.
const SCRATCH = new Uint8Array(8);
const SCRATCH_VIEW = new DataView(SCRATCH.buffer);

/**
 * RkyvReader provides low-level binary buffer reading operations for decoding
 * rkyv-serialized data.
 *
 * The reader owns the wire-format configuration: byte order is applied on
 * every multi-byte read, and `readUsize`/`readRelPtr` dispatch on the
 * configured pointer width. Codecs never consult the format for byte order —
 * they simply call these methods.
 *
 * Integer reads use plain byte math on the `Uint8Array` and float/64-bit
 * reads go through a module-level scratch, so constructing a reader
 * allocates no `DataView` — the dominant fixed cost for small decodes.
 * Like rkyv's `access_unchecked`, reads are not bounds-checked: decoding
 * assumes trusted bytes (out-of-range offsets read as zeros).
 */
export class RkyvReader {
  readonly buffer: Uint8Array;
  readonly format: RkyvFormat;
  readonly textDecoder: RkyvTextDecoder;
  /** Size in bytes of relative pointers and archived usize. */
  readonly pointerBytes: 2 | 4 | 8;
  /** True when the format is little-endian. */
  readonly littleEndian: boolean;
  #view: DataView | null = null;

  constructor(buffer: ArrayBuffer | Uint8Array, options: RkyvReaderOptions = {}) {
    this.format = options.format ?? DEFAULT_FORMAT;
    this.littleEndian = this.format.endian === 'little';
    this.pointerBytes = pointerBytes(this.format);
    this.textDecoder = options.textDecoder ?? (sharedTextDecoder ??= new TextDecoder());
    this.buffer = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  /**
   * A DataView over the buffer, created on first access (none of the
   * built-in codecs need it).
   */
  get view(): DataView {
    if (this.#view === null) {
      const buffer = this.buffer;
      this.#view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
    }
    return this.#view;
  }

  get length(): number {
    return this.buffer.length;
  }

  /**
   * Get the root position for rkyv archives.
   * rkyv lays out objects depth-first from leaves to root,
   * meaning the root object is at the end of the buffer.
   */
  getRootPosition(rootSize: number): number {
    return this.length - rootSize;
  }

  // === Primitive Type Readers ===

  readU8(offset: number): number {
    return this.buffer[offset];
  }

  readI8(offset: number): number {
    return (this.buffer[offset] << 24) >> 24;
  }

  readU16(offset: number): number {
    const b = this.buffer;
    return this.littleEndian ? b[offset] | (b[offset + 1] << 8) : (b[offset] << 8) | b[offset + 1];
  }

  readI16(offset: number): number {
    return (this.readU16(offset) << 16) >> 16;
  }

  readU32(offset: number): number {
    const b = this.buffer;
    return this.littleEndian
      ? (b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16) | (b[offset + 3] << 24)) >>> 0
      : ((b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3]) >>> 0;
  }

  readI32(offset: number): number {
    const b = this.buffer;
    return this.littleEndian
      ? b[offset] | (b[offset + 1] << 8) | (b[offset + 2] << 16) | (b[offset + 3] << 24)
      : (b[offset] << 24) | (b[offset + 1] << 16) | (b[offset + 2] << 8) | b[offset + 3];
  }

  #loadScratch8(offset: number): void {
    const b = this.buffer;
    SCRATCH[0] = b[offset];
    SCRATCH[1] = b[offset + 1];
    SCRATCH[2] = b[offset + 2];
    SCRATCH[3] = b[offset + 3];
    SCRATCH[4] = b[offset + 4];
    SCRATCH[5] = b[offset + 5];
    SCRATCH[6] = b[offset + 6];
    SCRATCH[7] = b[offset + 7];
  }

  readU64(offset: number): bigint {
    this.#loadScratch8(offset);
    return SCRATCH_VIEW.getBigUint64(0, this.littleEndian);
  }

  readI64(offset: number): bigint {
    this.#loadScratch8(offset);
    return SCRATCH_VIEW.getBigInt64(0, this.littleEndian);
  }

  readF32(offset: number): number {
    const b = this.buffer;
    SCRATCH[0] = b[offset];
    SCRATCH[1] = b[offset + 1];
    SCRATCH[2] = b[offset + 2];
    SCRATCH[3] = b[offset + 3];
    return SCRATCH_VIEW.getFloat32(0, this.littleEndian);
  }

  readF64(offset: number): number {
    this.#loadScratch8(offset);
    return SCRATCH_VIEW.getFloat64(0, this.littleEndian);
  }

  readBool(offset: number): boolean {
    return this.buffer[offset] !== 0;
  }

  /**
   * Read an archived `usize` (rkyv `FixedUsize` — the configured pointer
   * width) as a number.
   */
  readUsize(offset: number): number {
    switch (this.pointerBytes) {
      case 2:
        return this.readU16(offset);
      case 4:
        return this.readU32(offset);
      case 8: {
        // usize values fit safe integers; compose without BigInt.
        const lo = this.littleEndian ? this.readU32(offset) : this.readU32(offset + 4);
        const hi = this.littleEndian ? this.readU32(offset + 4) : this.readU32(offset);
        return hi * 0x1_0000_0000 + lo;
      }
    }
  }

  /**
   * Read a raw byte slice from the buffer (a view, not a copy).
   */
  readBytes(offset: number, length: number): Uint8Array {
    return this.buffer.subarray(offset, offset + length);
  }

  /**
   * Decode UTF-8 text at `offset`. Short ASCII runs take an allocation-free
   * fast path; anything else falls back to TextDecoder.
   */
  readText(offset: number, length: number): string {
    if (length <= 16) {
      const buffer = this.buffer;
      let out = '';
      let i = offset;
      const end = offset + length;
      for (; i < end; i++) {
        const b = buffer[i];
        if (b > 0x7f) break;
        out += String.fromCharCode(b);
      }
      if (i === end) return out;
    }
    return this.textDecoder.decode(this.readBytes(offset, length));
  }

  /**
   * Read the raw signed offset stored in a relative pointer, without
   * resolving it. rkyv encodes "invalid" pointers (dead `Weak`, empty hash
   * tables) as the raw offset `1`.
   */
  readRelPtrOffset(offset: number): number {
    switch (this.pointerBytes) {
      case 2:
        return this.readI16(offset);
      case 4:
        return this.readI32(offset);
      case 8: {
        // Offsets are within the buffer, so they fit safe integers.
        const lo = this.littleEndian ? this.readU32(offset) : this.readU32(offset + 4);
        const hi = this.littleEndian ? this.readI32(offset + 4) : this.readI32(offset);
        return hi * 0x1_0000_0000 + lo;
      }
    }
  }

  /**
   * Read a relative pointer at the format's pointer width and resolve it to
   * an absolute buffer position.
   */
  readRelPtr(offset: number): number {
    return offset + this.readRelPtrOffset(offset);
  }

  /**
   * Whether the relative pointer at `offset` is rkyv's invalid sentinel
   * (raw offset `1`, written by `RelPtr::emplace_invalid`).
   */
  isInvalidPtr(offset: number): boolean {
    return this.readRelPtrOffset(offset) === 1;
  }
}

// Lazily constructed so hosts without a global TextDecoder can still import
// this module and inject their own implementation per reader.
let sharedTextDecoder: RkyvTextDecoder | undefined;
