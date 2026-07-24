import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import * as r from '#src/index.ts';
import { format } from '#src/core/format.ts';
import { RkyvWriter } from '#src/core/writer.ts';

describe('RkyvWriter', () => {
  describe('primitive writes', () => {
    it('should write u8', () => {
      const writer = new RkyvWriter();
      const pos = writer.writeU8(255);
      assert.strictEqual(pos, 0);
      assert.strictEqual(writer.pos, 1);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff]));
    });

    it('should write i8', () => {
      const writer = new RkyvWriter();
      writer.writeI8(-1);
      writer.writeI8(127);
      writer.writeI8(-128);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff, 0x7f, 0x80]));
    });

    it('should write u16 (little-endian)', () => {
      const writer = new RkyvWriter();
      const pos = writer.writeU16(0x1234);
      assert.strictEqual(pos, 0);
      assert.strictEqual(writer.pos, 2);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x34, 0x12]));
    });

    it('should write i16 (little-endian)', () => {
      const writer = new RkyvWriter();
      writer.writeI16(-1);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff, 0xff]));
    });

    it('should write u32 (little-endian)', () => {
      const writer = new RkyvWriter();
      const pos = writer.writeU32(0x12345678);
      assert.strictEqual(pos, 0);
      assert.strictEqual(writer.pos, 4);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x78, 0x56, 0x34, 0x12]));
    });

    it('should write i32 (little-endian)', () => {
      const writer = new RkyvWriter();
      writer.writeI32(-1);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff, 0xff, 0xff, 0xff]));
    });

    it('should write u64 (little-endian)', () => {
      const writer = new RkyvWriter();
      const pos = writer.writeU64(1n);
      assert.strictEqual(pos, 0);
      assert.strictEqual(writer.pos, 8);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([1, 0, 0, 0, 0, 0, 0, 0]));
    });

    it('should write i64 (little-endian)', () => {
      const writer = new RkyvWriter();
      writer.writeI64(-1n);
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]),
      );
    });

    it('should write f32 (little-endian)', () => {
      const writer = new RkyvWriter();
      writer.writeF32(1.0);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x00, 0x00, 0x80, 0x3f]));
    });

    it('should write f64 (little-endian)', () => {
      const writer = new RkyvWriter();
      writer.writeF64(1.0);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0, 0, 0, 0, 0, 0, 0xf0, 0x3f]));
    });

    it('should write bool', () => {
      const writer = new RkyvWriter();
      writer.writeBool(false);
      writer.writeBool(true);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x00, 0x01]));
    });

    it('does NOT self-align multi-byte writes (alignment is the caller\'s job)', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0xff);
      writer.writeU32(0x12345678);
      // No implicit padding: u32 lands at offset 1.
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([0xff, 0x78, 0x56, 0x34, 0x12]),
      );
    });
  });

  describe('endianness', () => {
    it('should write big-endian values when configured', () => {
      const writer = new RkyvWriter({ format: format({ endian: 'big' }) });
      writer.writeU32(0x12345678);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x12, 0x34, 0x56, 0x78]));
    });
  });

  describe('usize (pointer-width)', () => {
    it('should write 32-bit usize by default', () => {
      const writer = new RkyvWriter();
      writer.writeUsize(0x12345678);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x78, 0x56, 0x34, 0x12]));
    });

    it('should write 16-bit usize', () => {
      const writer = new RkyvWriter({ format: format({ pointerWidth: 16 }) });
      writer.writeUsize(0x1234);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x34, 0x12]));
    });

    it('should write 64-bit usize', () => {
      const writer = new RkyvWriter({ format: format({ pointerWidth: 64 }) });
      writer.writeUsize(0x1_0000_0001);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0]));
    });
  });

  describe('alignment', () => {
    it('should align to 2 bytes', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0xff);
      const pos = writer.align(2);
      assert.strictEqual(pos, 2);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff, 0x00]));
    });

    it('should align to 4 bytes', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0x01);
      const pos = writer.align(4);
      assert.strictEqual(pos, 4);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x01, 0x00, 0x00, 0x00]));
    });

    it('should align to 8 bytes', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0x01);
      writer.writeU8(0x02);
      writer.writeU8(0x03);
      const pos = writer.align(8);
      assert.strictEqual(pos, 8);
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([0x01, 0x02, 0x03, 0, 0, 0, 0, 0]),
      );
    });

    it('should not add padding when already aligned', () => {
      const writer = new RkyvWriter();
      writer.writeU32(0x12345678);
      const pos = writer.align(4);
      assert.strictEqual(pos, 4);
      assert.strictEqual(writer.pos, 4);
    });
  });

  describe('padTo / writeZeros', () => {
    it('should pad to target position', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0xff);
      writer.padTo(4);
      assert.strictEqual(writer.pos, 4);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff, 0x00, 0x00, 0x00]));
    });

    it('should not move position backward', () => {
      const writer = new RkyvWriter();
      writer.writeU32(0x12345678);
      writer.padTo(2);
      assert.strictEqual(writer.pos, 4);
    });

    it('should write a run of zeros', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0xff);
      writer.writeZeros(3);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff, 0, 0, 0]));
    });
  });

  describe('writeBytes / writeText', () => {
    it('should write raw bytes', () => {
      const writer = new RkyvWriter();
      const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      const pos = writer.writeBytes(bytes);
      assert.strictEqual(pos, 0);
      assert.deepStrictEqual(writer.finish(), bytes);
    });

    it('should write bytes at current position', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0xff);
      writer.writeBytes(new Uint8Array([0x01, 0x02, 0x03]));
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff, 0x01, 0x02, 0x03]));
    });

    it('should encode text directly into the buffer', () => {
      const writer = new RkyvWriter();
      const written = writer.writeText('Hello');
      assert.strictEqual(written, 5);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    });

    it('should encode multibyte text directly into the buffer', () => {
      const writer = new RkyvWriter({ initialCapacity: 2 });
      const written = writer.writeText('你好👋');
      // "你好" = 6 bytes, "👋" = 4 bytes
      assert.strictEqual(written, 10);
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd, 0xf0, 0x9f, 0x91, 0x8b]),
      );
    });

    it('short-ASCII fast path matches TextEncoder byte for byte', () => {
      const te = new TextEncoder();
      // Around the 32-char threshold, including a growth-forcing capacity.
      for (const text of ['abc', 'x'.repeat(31), 'y'.repeat(32), 'z'.repeat(33)]) {
        const writer = new RkyvWriter({ initialCapacity: 4 });
        assert.strictEqual(writer.writeText(text), text.length);
        assert.deepStrictEqual(writer.finish(), te.encode(text), JSON.stringify(text));
      }
    });

    it('short text with non-ASCII bails to the encoder, same bytes', () => {
      // ASCII prefix is overwritten by the encoder fallback re-encoding
      // from the same position.
      const text = 'price: 10€ total';
      const writer = new RkyvWriter();
      const written = writer.writeText(text);
      const expected = new TextEncoder().encode(text);
      assert.strictEqual(written, expected.length);
      assert.deepStrictEqual(writer.finish(), expected);
    });

    it('short-ASCII fast path respects fixed-buffer capacity', () => {
      const exact = new RkyvWriter({ buffer: new Uint8Array(12) });
      assert.strictEqual(exact.writeText('exactly12chr'), 12);
      const tight = new RkyvWriter({ buffer: new Uint8Array(8) });
      assert.throws(() => tight.writeText('nine char'), RangeError);
    });
  });

  describe('relative pointers', () => {
    it('should reserve pointer-width space', () => {
      const writer = new RkyvWriter();
      const pos = writer.reserveRelPtr();
      assert.strictEqual(pos, 0);
      assert.strictEqual(writer.pos, 4);
    });

    it('should reserve 2 bytes under pointerWidth 16', () => {
      const writer = new RkyvWriter({ format: format({ pointerWidth: 16 }) });
      writer.reserveRelPtr();
      assert.strictEqual(writer.pos, 2);
    });

    it('should write relative pointer at position', () => {
      const writer = new RkyvWriter();
      const ptrPos = writer.reserveRelPtr();
      const targetPos = writer.writeU32(0x12345678);
      writer.writeRelPtrAt(ptrPos, targetPos);
      assert.deepStrictEqual(
        writer.finish().subarray(0, 4),
        new Uint8Array([0x04, 0x00, 0x00, 0x00]),
      );
    });

    it('should handle negative relative pointers', () => {
      const writer = new RkyvWriter();
      const dataPos = writer.writeU32(0x12345678);
      const ptrPos = writer.reserveRelPtr();
      writer.writeRelPtrAt(ptrPos, dataPos);
      // -4 in little-endian i32
      assert.deepStrictEqual(
        writer.finish().subarray(4, 8),
        new Uint8Array([0xfc, 0xff, 0xff, 0xff]),
      );
    });

    it('should write the invalid-pointer sentinel (raw offset 1)', () => {
      const writer = new RkyvWriter();
      const ptrPos = writer.reserveRelPtr();
      writer.writeInvalidPtrAt(ptrPos);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x01, 0x00, 0x00, 0x00]));
    });
  });

  describe('buffer capacity', () => {
    it('should auto-expand buffer when needed', () => {
      const writer = new RkyvWriter({ initialCapacity: 4 });
      writer.writeU64(0x123456789abcdef0n);
      assert.strictEqual(writer.pos, 8);
      assert.ok(writer.capacity >= 8);
    });

    it('should handle large writes', () => {
      const writer = new RkyvWriter({ initialCapacity: 16 });
      const largeData = new Uint8Array(1000);
      for (let i = 0; i < 1000; i++) {
        largeData[i] = i % 256;
      }
      writer.writeBytes(largeData);
      assert.strictEqual(writer.pos, 1000);
      assert.deepStrictEqual(writer.finish(), largeData);
    });
  });

  describe('reset', () => {
    it('should reset position to start', () => {
      const writer = new RkyvWriter();
      writer.writeU32(0x12345678);
      writer.writeU32(0xabcdef00);
      assert.strictEqual(writer.pos, 8);
      writer.reset();
      assert.strictEqual(writer.pos, 0);
    });

    it('should allow reuse after reset', () => {
      const writer = new RkyvWriter();
      writer.writeU32(0x12345678);
      writer.reset();
      writer.writeU16(0xabcd);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xcd, 0xab]));
    });
  });

  describe('encodeText', () => {
    it('should encode strings to UTF-8 byte arrays', () => {
      const writer = new RkyvWriter();
      assert.deepStrictEqual(writer.encodeText('Hello'), new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
      assert.deepStrictEqual(writer.encodeText('你好'), new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]));
      assert.deepStrictEqual(writer.encodeText('👋'), new Uint8Array([0xf0, 0x9f, 0x91, 0x8b]));
    });
  });

  describe('finish', () => {
    it('should return subarray of written data only', () => {
      const writer = new RkyvWriter({ initialCapacity: 1024 });
      writer.writeU8(0x01);
      writer.writeU8(0x02);
      writer.writeU8(0x03);
      const result = writer.finish();
      assert.strictEqual(result.length, 3);
      assert.deepStrictEqual(result, new Uint8Array([0x01, 0x02, 0x03]));
    });
  });
});

describe('RkyvWriter with an external buffer', () => {
  const Person = r.struct({
    name: r.string,
    age: r.u32,
    email: r.option(r.string),
    scores: r.vec(r.u32),
  });
  const person = {
    name: 'a name long enough to go out of line',
    age: 25,
    email: 'someone@example.com',
    scores: [95, 87, 92],
  };

  it('writes the archive in place, byte-identical to encode()', () => {
    const region = new Uint8Array(4096);
    const writer = new RkyvWriter({ buffer: region });
    const out = Person.encodeInto(writer, person);
    const expected = Person.encode(person);
    assert.strictEqual(writer.fixed, true);
    assert.strictEqual(writer.pos, expected.length);
    assert.deepStrictEqual([...out], [...expected]);
    // In place: the written bytes live in the caller's region.
    assert.deepStrictEqual([...region.subarray(0, writer.pos)], [...expected]);
  });

  it('addresses a subarray region correctly (non-zero byteOffset)', () => {
    const backing = new Uint8Array(4096 + 16);
    backing.fill(0xaa);
    const region = backing.subarray(16);
    const out = Person.encodeInto(new RkyvWriter({ buffer: region }), person);
    assert.deepStrictEqual([...out], [...Person.encode(person)]);
    // The bytes before the region are untouched.
    assert.ok([...backing.subarray(0, 16)].every((b) => b === 0xaa));
  });

  it('takes the bulk write path over an aligned subarray', () => {
    const codec = r.vec(r.u32);
    const values = Array.from({ length: 256 }, (_, i) => (i * 2654435761) >>> 0);
    const region = new Uint8Array(8192).subarray(8); // aligned offset: bulk-eligible
    const out = codec.encodeInto(new RkyvWriter({ buffer: region }), values);
    assert.deepStrictEqual([...out], [...codec.encode(values)]);
  });

  it('falls back to loops on an unaligned subarray, still byte-identical', () => {
    const codec = r.vec(r.u32);
    const values = Array.from({ length: 64 }, (_, i) => i * 7);
    const region = new Uint8Array(8192).subarray(2); // bulk view ineligible
    const out = codec.encodeInto(new RkyvWriter({ buffer: region }), values);
    assert.deepStrictEqual([...out], [...codec.encode(values)]);
  });

  it('is reusable across encodes via reset()', () => {
    const writer = new RkyvWriter({ buffer: new Uint8Array(4096) });
    const first = [...Person.encodeInto(writer, person)];
    writer.reset();
    assert.deepStrictEqual([...Person.encodeInto(writer, person)], first);
  });

  it('round-trips what it wrote', () => {
    const writer = new RkyvWriter({ buffer: new Uint8Array(4096) });
    const out = Person.encodeInto(writer, person);
    assert.deepStrictEqual(Person.decode(out.slice()), person);
  });

  describe('overflow', () => {
    it('throws RangeError instead of growing', () => {
      const codec = r.vec(r.u32);
      const values = Array.from({ length: 64 }, (_, i) => i);
      const writer = new RkyvWriter({ buffer: new Uint8Array(32) });
      assert.throws(() => codec.encodeInto(writer, values), RangeError);
    });

    it('accepts text that fits despite the pessimistic worst-case estimate', () => {
      // 30 ASCII chars encode to 30 bytes; the 3x estimate (90) exceeds the
      // region, the actual bytes do not.
      const writer = new RkyvWriter({ buffer: new Uint8Array(48) });
      assert.strictEqual(writer.writeText('x'.repeat(30)), 30);
    });

    it('throws when text truly does not fit', () => {
      const writer = new RkyvWriter({ buffer: new Uint8Array(16) });
      assert.throws(() => writer.writeText('y'.repeat(64)), RangeError);
      // Multibyte content overflowing mid-way throws too.
      const writer2 = new RkyvWriter({ buffer: new Uint8Array(8) });
      assert.throws(() => writer2.writeText('한국어 텍스트'), RangeError);
    });

    it('reports overflow for a string codec near the boundary', () => {
      const long = 'z'.repeat(64);
      const exact = r.string.encode(long).length;
      const tight = new RkyvWriter({ buffer: new Uint8Array(exact) });
      assert.deepStrictEqual([...r.string.encodeInto(tight, long)], [...r.string.encode(long)]);
      const short = new RkyvWriter({ buffer: new Uint8Array(exact - 1) });
      assert.throws(() => r.string.encodeInto(short, long), RangeError);
    });
  });

  it('owned writers still grow (fixed is opt-in)', () => {
    const writer = new RkyvWriter({ initialCapacity: 8 });
    const codec = r.vec(r.u32);
    const values = Array.from({ length: 256 }, (_, i) => i);
    assert.strictEqual(writer.fixed, false);
    assert.deepStrictEqual([...codec.encodeInto(writer, values)], [...codec.encode(values)]);
  });
});
