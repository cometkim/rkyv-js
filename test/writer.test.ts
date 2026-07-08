import * as assert from 'node:assert';
import { describe, it } from 'node:test';
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
