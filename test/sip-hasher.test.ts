import * as assert from 'node:assert';
import { describe, it } from 'node:test';

import { SipHasher13 } from '#conformance/cases/sip-hasher.ts';

/**
 * Differential oracle: an independent BigInt SipHash-1-3 written literally
 * from the SipHash specification (whole-message, non-streaming). The u32-pair
 * streaming implementation must agree with it exactly. Both use k0 = k1 = 0,
 * matching `siphasher::sip::SipHasher13::default()`.
 */
const MASK64 = 0xffff_ffff_ffff_ffffn;

function rotl(x: bigint, b: bigint): bigint {
  return ((x << b) | (x >> (64n - b))) & MASK64;
}

function oracleSip13(data: Uint8Array): bigint {
  let v0 = 0x736f6d6570736575n;
  let v1 = 0x646f72616e646f6dn;
  let v2 = 0x6c7967656e657261n;
  let v3 = 0x7465646279746573n;

  const round = () => {
    v0 = (v0 + v1) & MASK64;
    v1 = rotl(v1, 13n);
    v1 ^= v0;
    v0 = rotl(v0, 32n);
    v2 = (v2 + v3) & MASK64;
    v3 = rotl(v3, 16n);
    v3 ^= v2;
    v0 = (v0 + v3) & MASK64;
    v3 = rotl(v3, 21n);
    v3 ^= v0;
    v2 = (v2 + v1) & MASK64;
    v1 = rotl(v1, 17n);
    v1 ^= v2;
    v2 = rotl(v2, 32n);
  };

  const compress = (m: bigint) => {
    v3 ^= m;
    round();
    v0 ^= m;
  };

  const words = data.length >>> 3;
  for (let i = 0; i < words; i++) {
    let m = 0n;
    for (let j = 0; j < 8; j++) m |= BigInt(data[i * 8 + j]) << BigInt(j * 8);
    compress(m);
  }
  let b = BigInt(data.length & 0xff) << 56n;
  for (let j = 0; j < (data.length & 7); j++) {
    b |= BigInt(data[words * 8 + j]) << BigInt(j * 8);
  }
  compress(b);

  v2 ^= 0xffn;
  round();
  round();
  round();
  return (v0 ^ v1 ^ v2 ^ v3) & MASK64;
}

function pairToBigint(h: SipHasher13): bigint {
  return (BigInt(h.hi) << 32n) | BigInt(h.lo);
}

// Deterministic pseudo-random bytes.
let seed = 0x9e3779b9;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed / 0x7fffffff;
}
function randomBytes(len: number): Uint8Array {
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = Math.floor(rnd() * 256);
  return bytes;
}

describe('SipHasher13 (conformance custom hasher)', () => {
  it('matches the BigInt oracle across lengths 0..64', () => {
    for (let len = 0; len <= 64; len++) {
      const bytes = randomBytes(len);
      const h = new SipHasher13();
      h.writeBytes(bytes);
      h.finish();
      assert.strictEqual(pairToBigint(h), oracleSip13(bytes), `len=${len}`);
    }
  });

  it('matches the oracle under split streaming writes', () => {
    for (let i = 0; i < 100; i++) {
      const bytes = randomBytes(1 + Math.floor(rnd() * 40));
      const split1 = Math.floor(rnd() * bytes.length);
      const split2 = split1 + Math.floor(rnd() * (bytes.length - split1));
      const h = new SipHasher13();
      h.writeBytes(bytes, 0, split1);
      h.writeBytes(bytes, split1, split2);
      h.writeBytes(bytes, split2, bytes.length);
      h.finish();
      assert.strictEqual(pairToBigint(h), oracleSip13(bytes), `i=${i}`);
    }
  });

  it('integer writes append little-endian bytes to the stream', () => {
    const h = new SipHasher13();
    h.writeU8(0xab);
    h.writeU16(0x1234);
    h.writeU32(0xdeadbeef);
    h.writeU64(0x0123_4567_89ab_cdefn);
    h.writeU64Parts(0x01234567, 0x89abcdef);
    h.writeUsize(0x1_2345_6789);
    h.finish();

    const expected = new Uint8Array([
      0xab,
      0x34, 0x12,
      0xef, 0xbe, 0xad, 0xde,
      0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01,
      0xef, 0xcd, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01,
      0x89, 0x67, 0x45, 0x23, 0x01, 0x00, 0x00, 0x00,
    ]);
    assert.strictEqual(pairToBigint(h), oracleSip13(expected));
  });

  it('reset() restores the zero-key initial state', () => {
    const bytes = randomBytes(24);
    const h = new SipHasher13();
    h.writeBytes(randomBytes(17));
    h.finish();
    h.reset();
    h.writeBytes(bytes);
    h.finish();
    assert.strictEqual(pairToBigint(h), oracleSip13(bytes));
  });

  it('matches the Rust `Hash for str` write pattern', () => {
    // str hashes as bytes + a trailing 0xff (what string keys feed through).
    const text = new TextEncoder().encode('sip_3');
    const h = new SipHasher13();
    h.writeBytes(text);
    h.writeU8(0xff);
    h.finish();
    const expected = new Uint8Array(text.length + 1);
    expected.set(text);
    expected[text.length] = 0xff;
    assert.strictEqual(pairToBigint(h), oracleSip13(expected));
  });
});
