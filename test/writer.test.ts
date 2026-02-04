import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { RkyvWriter } from 'rkyv-js/writer';

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
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
      );
    });

    it('should write i64 (little-endian)', () => {
      const writer = new RkyvWriter();
      writer.writeI64(-1n);
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff])
      );
    });

    it('should write f32 (little-endian)', () => {
      const writer = new RkyvWriter();
      writer.writeF32(1.0);
      // IEEE 754 single precision for 1.0
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x00, 0x00, 0x80, 0x3f]));
    });

    it('should write f64 (little-endian)', () => {
      const writer = new RkyvWriter();
      writer.writeF64(1.0);
      // IEEE 754 double precision for 1.0
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f])
      );
    });

    it('should write bool', () => {
      const writer = new RkyvWriter();
      writer.writeBool(false);
      writer.writeBool(true);
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0x00, 0x01]));
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
        new Uint8Array([0x01, 0x02, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00])
      );
    });

    it('should not add padding when already aligned', () => {
      const writer = new RkyvWriter();
      writer.writeU32(0x12345678);
      const pos = writer.align(4);
      assert.strictEqual(pos, 4);
      assert.strictEqual(writer.pos, 4);
    });

    it('should auto-align u16 writes', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0xff);
      writer.writeU16(0x1234);
      // u16 should align to 2, so there's 1 padding byte
      assert.deepStrictEqual(writer.finish(), new Uint8Array([0xff, 0x00, 0x34, 0x12]));
    });

    it('should auto-align u32 writes', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0xff);
      writer.writeU32(0x12345678);
      // u32 should align to 4, so there are 3 padding bytes
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([0xff, 0x00, 0x00, 0x00, 0x78, 0x56, 0x34, 0x12])
      );
    });

    it('should auto-align u64 writes', () => {
      const writer = new RkyvWriter();
      writer.writeU8(0xff);
      writer.writeU64(1n);
      // u64 should align to 8, so there are 7 padding bytes
      assert.deepStrictEqual(
        writer.finish(),
        new Uint8Array([
          0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
          0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
        ])
      );
    });
  });

  describe('padTo', () => {
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
      writer.padTo(2); // target is before current position
      assert.strictEqual(writer.pos, 4); // position unchanged
    });
  });

  describe('writeBytes', () => {
    it('should write raw bytes', () => {
      const writer = new RkyvWriter();
      const bytes = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
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
  });

  describe('relative pointers', () => {
    it('should reserve space for relative pointer', () => {
      const writer = new RkyvWriter();
      const pos = writer.reserveRelPtr32();
      assert.strictEqual(pos, 0);
      assert.strictEqual(writer.pos, 4);
    });

    it('should write relative pointer at position', () => {
      const writer = new RkyvWriter();
      const ptrPos = writer.reserveRelPtr32();
      const targetPos = writer.writeU32(0x12345678);
      writer.writeRelPtr32At(ptrPos, targetPos);

      const result = writer.finish();
      // At offset 0, relative pointer should be 4 (pointing to offset 4)
      assert.strictEqual(result[0], 0x04);
      assert.strictEqual(result[1], 0x00);
      assert.strictEqual(result[2], 0x00);
      assert.strictEqual(result[3], 0x00);
    });

    it('should handle negative relative pointers', () => {
      const writer = new RkyvWriter();
      // Write data first
      const dataPos = writer.writeU32(0x12345678);
      // Then write a pointer that points back to the data
      const ptrPos = writer.reserveRelPtr32();
      writer.writeRelPtr32At(ptrPos, dataPos);

      const result = writer.finish();
      // At offset 4, relative pointer should be -4 (pointing back to offset 0)
      // -4 in little-endian i32: 0xfc 0xff 0xff 0xff
      assert.strictEqual(result[4], 0xfc);
      assert.strictEqual(result[5], 0xff);
      assert.strictEqual(result[6], 0xff);
      assert.strictEqual(result[7], 0xff);
    });
  });

  describe('buffer capacity', () => {
    it('should auto-expand buffer when needed', () => {
      const writer = new RkyvWriter({ initialCapacity: 4 });
      // Write more than 4 bytes
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
    it('should encode ASCII string to UTF-8', () => {
      const writer = new RkyvWriter();
      const bytes = writer.encodeText('Hello');
      assert.deepStrictEqual(bytes, new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    });

    it('should encode Unicode string to UTF-8', () => {
      const writer = new RkyvWriter();
      const bytes = writer.encodeText('你好');
      // "你好" in UTF-8: E4 BD A0 E5 A5 BD
      assert.deepStrictEqual(
        bytes,
        new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd])
      );
    });

    it('should encode emoji to UTF-8', () => {
      const writer = new RkyvWriter();
      const bytes = writer.encodeText('👋');
      // "👋" in UTF-8: F0 9F 91 8B
      assert.deepStrictEqual(bytes, new Uint8Array([0xf0, 0x9f, 0x91, 0x8b]));
    });
  });

  describe('custom TextEncoder', () => {
    it('should use custom TextEncoder', () => {
      const customEncoder = new TextEncoder();
      const writer = new RkyvWriter({ textEncoder: customEncoder });
      assert.strictEqual(writer.textEncoder, customEncoder);
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
