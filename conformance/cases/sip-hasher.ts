/**
 * SipHash-1-3 with zero keys, implementing the rkyv-js `RkyvHasher`
 * interface — the JS counterpart of `siphasher::sip::SipHasher13::default()`
 * used by the `SipKeyedMap` conformance type's archived table.
 *
 * The four u64 state words are kept as u32 halves and all rounds use integer
 * `number` math (add-with-carry, pair rotates), like the production
 * `FxHasher`. Writes buffer into an 8-byte tail exactly like the streaming
 * Rust implementation: full little-endian words compress immediately, the
 * final partial word is combined with the length byte in `finish()`.
 *
 * Integer writes append their little-endian bytes to the stream, matching
 * `Hasher::write_uNN` on the little-endian 64-bit hosts the goldens are
 * generated on (`writeUsize` assumes a 64-bit Rust `usize`).
 */

import type { RkyvHasher } from 'rkyv-js/core';

// Initial state for k0 = k1 = 0: the SipHash constants verbatim.
const V0H = 0x736f6d65;
const V0L = 0x70736575;
const V1H = 0x646f7261;
const V1L = 0x6e646f6d;
const V2H = 0x6c796765;
const V2L = 0x6e657261;
const V3H = 0x74656462;
const V3L = 0x79746573;

// Scratch for integer writes (LE-encode, then feed through writeBytes).
const INT_SCRATCH = new Uint8Array(8);

export class SipHasher13 implements RkyvHasher {
  hi = 0;
  lo = 0;

  #v0h = V0H;
  #v0l = V0L;
  #v1h = V1H;
  #v1l = V1L;
  #v2h = V2H;
  #v2l = V2L;
  #v3h = V3H;
  #v3l = V3L;
  #tail = new Uint8Array(8);
  #ntail = 0;
  /** Total bytes written; only the low 8 bits reach the final block. */
  #length = 0;

  reset(): this {
    this.#v0h = V0H;
    this.#v0l = V0L;
    this.#v1h = V1H;
    this.#v1l = V1L;
    this.#v2h = V2H;
    this.#v2l = V2L;
    this.#v3h = V3H;
    this.#v3l = V3L;
    this.#ntail = 0;
    this.#length = 0;
    this.hi = 0;
    this.lo = 0;
    return this;
  }

  /** One SIPROUND over the u32-pair state. */
  #round(): void {
    let v0h = this.#v0h;
    let v0l = this.#v0l;
    let v1h = this.#v1h;
    let v1l = this.#v1l;
    let v2h = this.#v2h;
    let v2l = this.#v2l;
    let v3h = this.#v3h;
    let v3l = this.#v3l;
    let lo;
    let h;
    let l;

    // v0 += v1; v1 = rotl(v1, 13); v1 ^= v0; v0 = rotl(v0, 32)
    lo = (v0l + v1l) >>> 0;
    v0h = (v0h + v1h + (lo < v0l ? 1 : 0)) >>> 0;
    v0l = lo;
    h = ((v1h << 13) | (v1l >>> 19)) >>> 0;
    l = ((v1l << 13) | (v1h >>> 19)) >>> 0;
    v1h = (h ^ v0h) >>> 0;
    v1l = (l ^ v0l) >>> 0;
    h = v0h;
    v0h = v0l;
    v0l = h;

    // v2 += v3; v3 = rotl(v3, 16); v3 ^= v2
    lo = (v2l + v3l) >>> 0;
    v2h = (v2h + v3h + (lo < v2l ? 1 : 0)) >>> 0;
    v2l = lo;
    h = ((v3h << 16) | (v3l >>> 16)) >>> 0;
    l = ((v3l << 16) | (v3h >>> 16)) >>> 0;
    v3h = (h ^ v2h) >>> 0;
    v3l = (l ^ v2l) >>> 0;

    // v0 += v3; v3 = rotl(v3, 21); v3 ^= v0
    lo = (v0l + v3l) >>> 0;
    v0h = (v0h + v3h + (lo < v0l ? 1 : 0)) >>> 0;
    v0l = lo;
    h = ((v3h << 21) | (v3l >>> 11)) >>> 0;
    l = ((v3l << 21) | (v3h >>> 11)) >>> 0;
    v3h = (h ^ v0h) >>> 0;
    v3l = (l ^ v0l) >>> 0;

    // v2 += v1; v1 = rotl(v1, 17); v1 ^= v2; v2 = rotl(v2, 32)
    lo = (v2l + v1l) >>> 0;
    v2h = (v2h + v1h + (lo < v2l ? 1 : 0)) >>> 0;
    v2l = lo;
    h = ((v1h << 17) | (v1l >>> 15)) >>> 0;
    l = ((v1l << 17) | (v1h >>> 15)) >>> 0;
    v1h = (h ^ v2h) >>> 0;
    v1l = (l ^ v2l) >>> 0;
    h = v2h;
    v2h = v2l;
    v2l = h;

    this.#v0h = v0h;
    this.#v0l = v0l;
    this.#v1h = v1h;
    this.#v1l = v1l;
    this.#v2h = v2h;
    this.#v2l = v2l;
    this.#v3h = v3h;
    this.#v3l = v3l;
  }

  /** Compress one message word: v3 ^= m; SIPROUND (c = 1); v0 ^= m. */
  #compress(mHi: number, mLo: number): void {
    this.#v3h = (this.#v3h ^ mHi) >>> 0;
    this.#v3l = (this.#v3l ^ mLo) >>> 0;
    this.#round();
    this.#v0h = (this.#v0h ^ mHi) >>> 0;
    this.#v0l = (this.#v0l ^ mLo) >>> 0;
  }

  writeBytes(bytes: Uint8Array, start: number = 0, end: number = bytes.length): void {
    this.#length = (this.#length + (end - start)) & 0xff;
    const tail = this.#tail;
    let i = start;

    if (this.#ntail > 0) {
      while (this.#ntail < 8 && i < end) {
        tail[this.#ntail++] = bytes[i++];
      }
      if (this.#ntail < 8) return;
      this.#compress(
        (tail[4] | (tail[5] << 8) | (tail[6] << 16) | (tail[7] << 24)) >>> 0,
        (tail[0] | (tail[1] << 8) | (tail[2] << 16) | (tail[3] << 24)) >>> 0,
      );
      this.#ntail = 0;
    }

    while (end - i >= 8) {
      this.#compress(
        (bytes[i + 4] | (bytes[i + 5] << 8) | (bytes[i + 6] << 16) | (bytes[i + 7] << 24)) >>> 0,
        (bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24)) >>> 0,
      );
      i += 8;
    }

    while (i < end) {
      tail[this.#ntail++] = bytes[i++];
    }
  }

  writeU8(value: number): void {
    INT_SCRATCH[0] = value & 0xff;
    this.writeBytes(INT_SCRATCH, 0, 1);
  }

  writeU16(value: number): void {
    INT_SCRATCH[0] = value & 0xff;
    INT_SCRATCH[1] = (value >>> 8) & 0xff;
    this.writeBytes(INT_SCRATCH, 0, 2);
  }

  writeU32(value: number): void {
    INT_SCRATCH[0] = value & 0xff;
    INT_SCRATCH[1] = (value >>> 8) & 0xff;
    INT_SCRATCH[2] = (value >>> 16) & 0xff;
    INT_SCRATCH[3] = (value >>> 24) & 0xff;
    this.writeBytes(INT_SCRATCH, 0, 4);
  }

  writeU64Parts(hi: number, lo: number): void {
    INT_SCRATCH[0] = lo & 0xff;
    INT_SCRATCH[1] = (lo >>> 8) & 0xff;
    INT_SCRATCH[2] = (lo >>> 16) & 0xff;
    INT_SCRATCH[3] = (lo >>> 24) & 0xff;
    INT_SCRATCH[4] = hi & 0xff;
    INT_SCRATCH[5] = (hi >>> 8) & 0xff;
    INT_SCRATCH[6] = (hi >>> 16) & 0xff;
    INT_SCRATCH[7] = (hi >>> 24) & 0xff;
    this.writeBytes(INT_SCRATCH, 0, 8);
  }

  writeU64(value: bigint): void {
    const v = BigInt.asUintN(64, value);
    this.writeU64Parts(Number(v >> 32n), Number(v & 0xffff_ffffn));
  }

  writeUsize(value: number): void {
    // Rust `usize` on the 64-bit hosts the goldens come from.
    this.writeU64Parts(Math.floor(value / 0x1_0000_0000), value >>> 0);
  }

  finish(): void {
    const tail = this.#tail;
    for (let i = this.#ntail; i < 7; i++) {
      tail[i] = 0;
    }
    // The final block's top byte is the total length mod 256.
    tail[7] = this.#length;
    this.#compress(
      (tail[4] | (tail[5] << 8) | (tail[6] << 16) | (tail[7] << 24)) >>> 0,
      (tail[0] | (tail[1] << 8) | (tail[2] << 16) | (tail[3] << 24)) >>> 0,
    );

    // Finalization: v2 ^= 0xff, then d = 3 rounds.
    this.#v2l = (this.#v2l ^ 0xff) >>> 0;
    this.#round();
    this.#round();
    this.#round();

    this.hi = (this.#v0h ^ this.#v1h ^ this.#v2h ^ this.#v3h) >>> 0;
    this.lo = (this.#v0l ^ this.#v1l ^ this.#v2l ^ this.#v3l) >>> 0;
  }
}
