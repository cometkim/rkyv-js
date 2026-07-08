import * as assert from 'node:assert';
import { describe, it } from 'node:test';

import { FxHasher } from '#src/lib/internal/fx-hasher.ts';
import { digestH2, digestMod } from '#src/lib/internal/swiss-table.ts';

/**
 * Differential oracle: an independent BigInt implementation of rkyv's
 * FxHasher64 (rkyv 0.8 src/hash.rs), following the Rust source literally.
 * The u32-pair production implementation must agree with it exactly.
 */
const MASK64 = 0xffff_ffff_ffff_ffffn;
const SEED = 0x517c_c1b7_2722_0a95n;

class OracleFxHasher {
  hash = 0n;

  private word(word: bigint): void {
    const rotated = ((this.hash << 5n) | (this.hash >> 59n)) & MASK64;
    this.hash = ((rotated ^ word) * SEED) & MASK64;
  }

  writeBytes(bytes: Uint8Array): void {
    const len = bytes.length;
    for (let i = 0; i < len >>> 3; i++) {
      let w = 0n;
      for (let j = 0; j < 8; j++) w |= BigInt(bytes[i * 8 + j]) << BigInt(j * 8);
      this.word(w);
    }
    if (len & 4) {
      const o = len & ~7;
      let w = 0n;
      for (let j = 0; j < 4; j++) w |= BigInt(bytes[o + j]) << BigInt(j * 8);
      this.word(w);
    }
    if (len & 2) {
      const o = len & ~3;
      this.word(BigInt(bytes[o] | (bytes[o + 1] << 8)));
    }
    if (len & 1) {
      this.word(BigInt(bytes[len - 1]));
    }
  }

  writeU8(v: number): void {
    this.word(BigInt(v & 0xff));
  }
  writeU16(v: number): void {
    this.word(BigInt(v & 0xffff));
  }
  writeU32(v: number): void {
    this.word(BigInt(v >>> 0));
  }
  writeU64(v: bigint): void {
    this.word(BigInt.asUintN(64, v));
  }
  writeUsize(v: number, pw: 16 | 32 | 64): void {
    if (pw === 64) this.word(BigInt(v));
    else if (pw === 32) this.word(BigInt(v >>> 0));
    else this.word(BigInt(v & 0xffff));
  }
}

function pairToBigint(h: FxHasher): bigint {
  return (BigInt(h.hi) << 32n) | BigInt(h.lo);
}

// Deterministic PRNG for reproducible failures.
let seed = 0x2f6e2b1;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x80000000;
}
function randomBytes(len: number): Uint8Array {
  const b = new Uint8Array(len);
  for (let i = 0; i < len; i++) b[i] = Math.floor(rnd() * 256);
  return b;
}

describe('FxHasher (u32-pair) vs BigInt oracle', () => {
  it('agrees on writeBytes for every tail shape (len 0..40)', () => {
    for (let len = 0; len <= 40; len++) {
      for (let rep = 0; rep < 8; rep++) {
        const bytes = randomBytes(len);
        const h = new FxHasher();
        const o = new OracleFxHasher();
        h.writeBytes(bytes);
        o.writeBytes(bytes);
        assert.strictEqual(pairToBigint(h), o.hash, `len=${len} bytes=[${bytes}]`);
      }
    }
  });

  it('agrees on str hashing (bytes + 0xff terminator)', () => {
    const enc = new TextEncoder();
    for (const s of ['', 'a', 'timeout', 'key_0', 'hello rkyv interop', '한국어 텍스트', '🚀'.repeat(9)]) {
      const bytes = enc.encode(s);
      const h = new FxHasher();
      const o = new OracleFxHasher();
      h.writeBytes(bytes);
      h.writeU8(0xff);
      o.writeBytes(bytes);
      o.writeU8(0xff);
      assert.strictEqual(pairToBigint(h), o.hash, `str=${JSON.stringify(s)}`);
    }
  });

  it('agrees on integer writes', () => {
    const h = new FxHasher();
    const o = new OracleFxHasher();
    for (let i = 0; i < 500; i++) {
      const v = Math.floor(rnd() * 0x1_0000_0000);
      switch (i % 5) {
        case 0:
          h.writeU8(v);
          o.writeU8(v);
          break;
        case 1:
          h.writeU16(v);
          o.writeU16(v);
          break;
        case 2:
          h.writeU32(v);
          o.writeU32(v);
          break;
        case 3: {
          const big = (BigInt(v) << 32n) | BigInt(Math.floor(rnd() * 0x1_0000_0000));
          h.writeU64(big);
          o.writeU64(big);
          break;
        }
        case 4:
          h.writeU64Parts(v, v ^ 0xdeadbeef);
          o.writeU64((BigInt(v >>> 0) << 32n) | BigInt((v ^ 0xdeadbeef) >>> 0));
          break;
      }
      assert.strictEqual(pairToBigint(h), o.hash, `step=${i}`);
    }
  });

  it('agrees on signed two’s-complement forwarding', () => {
    for (const v of [-1, -128, -32768, -2147483648]) {
      const h = new FxHasher();
      const o = new OracleFxHasher();
      h.writeU32(v);
      o.writeU32(v);
      assert.strictEqual(pairToBigint(h), o.hash, `i32=${v}`);
    }
    const h = new FxHasher();
    const o = new OracleFxHasher();
    h.writeU64(-1n);
    o.writeU64(-1n);
    assert.strictEqual(pairToBigint(h), o.hash, 'i64=-1');
  });

  it('agrees on writeUsize across pointer widths', () => {
    for (const pw of [16, 32, 64] as const) {
      for (const v of [0, 1, 0xffff, 0x10000, 0xffff_ffff, 2 ** 40]) {
        const h = new FxHasher(pw);
        const o = new OracleFxHasher();
        h.writeUsize(v);
        o.writeUsize(v, pw);
        assert.strictEqual(pairToBigint(h), o.hash, `pw=${pw} v=${v}`);
      }
    }
  });

  it('digestH2 and digestMod match BigInt derivations', () => {
    for (let i = 0; i < 200; i++) {
      const bytes = randomBytes(1 + Math.floor(rnd() * 24));
      const h = new FxHasher();
      h.writeBytes(bytes);
      h.writeU8(0xff);
      h.finish();
      const big = pairToBigint(h);
      assert.strictEqual(digestH2(h.hi), Number((big >> 57n) & 0x7fn), 'h2');
      for (const cap of [1, 2, 3, 4, 57, 58, 5717, 0x7fffffff, 0xffffffff]) {
        assert.strictEqual(digestMod(h.hi, h.lo, cap), Number(big % BigInt(cap)), `mod cap=${cap}`);
      }
    }
  });

  it('reset() restores the default state', () => {
    const h = new FxHasher();
    h.writeBytes(randomBytes(16));
    h.reset();
    assert.strictEqual(h.hi, 0);
    assert.strictEqual(h.lo, 0);
  });
});
