import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { format } from '#src/core/format.ts';
import { RkyvReader } from '#src/core/reader.ts';

describe('RkyvReader', () => {
  describe('primitive reads', () => {
    it('should read u8', () => {
      const reader = new RkyvReader(new Uint8Array([0xff, 0x00, 0x7f]));
      assert.strictEqual(reader.readU8(0), 255);
      assert.strictEqual(reader.readU8(1), 0);
      assert.strictEqual(reader.readU8(2), 127);
    });

    it('should read i8', () => {
      const reader = new RkyvReader(new Uint8Array([0xff, 0x00, 0x7f, 0x80]));
      assert.strictEqual(reader.readI8(0), -1);
      assert.strictEqual(reader.readI8(1), 0);
      assert.strictEqual(reader.readI8(2), 127);
      assert.strictEqual(reader.readI8(3), -128);
    });

    it('should read u16 (little-endian)', () => {
      const reader = new RkyvReader(new Uint8Array([0x01, 0x00, 0xff, 0xff, 0x34, 0x12]));
      assert.strictEqual(reader.readU16(0), 1);
      assert.strictEqual(reader.readU16(2), 65535);
      assert.strictEqual(reader.readU16(4), 0x1234);
    });

    it('should read i16 (little-endian)', () => {
      const reader = new RkyvReader(new Uint8Array([0xff, 0xff, 0x00, 0x80]));
      assert.strictEqual(reader.readI16(0), -1);
      assert.strictEqual(reader.readI16(2), -32768);
    });

    it('should read u32 (little-endian)', () => {
      const reader = new RkyvReader(new Uint8Array([0x78, 0x56, 0x34, 0x12]));
      assert.strictEqual(reader.readU32(0), 0x12345678);
    });

    it('should read i32 (little-endian)', () => {
      const reader = new RkyvReader(new Uint8Array([0xff, 0xff, 0xff, 0xff]));
      assert.strictEqual(reader.readI32(0), -1);
    });

    it('should read u64 (little-endian)', () => {
      const reader = new RkyvReader(new Uint8Array([0x01, 0, 0, 0, 0, 0, 0, 0]));
      assert.strictEqual(reader.readU64(0), 1n);
    });

    it('should read f32 (little-endian)', () => {
      // IEEE 754 single precision for 1.0
      const reader = new RkyvReader(new Uint8Array([0x00, 0x00, 0x80, 0x3f]));
      assert.strictEqual(reader.readF32(0), 1.0);
    });

    it('should read f64 (little-endian)', () => {
      // IEEE 754 double precision for 1.0
      const reader = new RkyvReader(new Uint8Array([0, 0, 0, 0, 0, 0, 0xf0, 0x3f]));
      assert.strictEqual(reader.readF64(0), 1.0);
    });

    it('should read bool', () => {
      const reader = new RkyvReader(new Uint8Array([0x00, 0x01, 0xff]));
      assert.strictEqual(reader.readBool(0), false);
      assert.strictEqual(reader.readBool(1), true);
      assert.strictEqual(reader.readBool(2), true); // non-zero is true
    });
  });

  describe('endianness', () => {
    it('should read big-endian values when configured', () => {
      const reader = new RkyvReader(new Uint8Array([0x12, 0x34, 0x56, 0x78]), {
        format: format({ endian: 'big' }),
      });
      assert.strictEqual(reader.readU32(0), 0x12345678);
      assert.strictEqual(reader.readU16(0), 0x1234);
    });
  });

  describe('usize (pointer-width)', () => {
    it('should read 32-bit usize by default', () => {
      const reader = new RkyvReader(new Uint8Array([0x78, 0x56, 0x34, 0x12]));
      assert.strictEqual(reader.readUsize(0), 0x12345678);
    });

    it('should read 16-bit usize', () => {
      const reader = new RkyvReader(new Uint8Array([0x34, 0x12]), {
        format: format({ pointerWidth: 16 }),
      });
      assert.strictEqual(reader.readUsize(0), 0x1234);
    });

    it('should read 64-bit usize', () => {
      const reader = new RkyvReader(new Uint8Array([1, 0, 0, 0, 1, 0, 0, 0]), {
        format: format({ pointerWidth: 64 }),
      });
      assert.strictEqual(reader.readUsize(0), 0x1_0000_0001);
    });
  });

  describe('relative pointers', () => {
    it('should resolve a forward relative pointer', () => {
      const buffer = new Uint8Array([
        0x08, 0x00, 0x00, 0x00, // relptr at offset 0 -> points to offset 8
        0x00, 0x00, 0x00, 0x00,
        0x48, 0x65, 0x6c, 0x6c,
      ]);
      const reader = new RkyvReader(buffer);
      assert.strictEqual(reader.readRelPtr(0), 8);
      assert.strictEqual(reader.readRelPtrOffset(0), 8);
    });

    it('should handle negative relative pointers', () => {
      const buffer = new Uint8Array([
        0x00, 0x00, 0x00, 0x00,
        0x12, 0x34, 0x56, 0x78,
        0xfc, 0xff, 0xff, 0xff, // relptr at offset 8 = -4 -> points to offset 4
      ]);
      const reader = new RkyvReader(buffer);
      assert.strictEqual(reader.readRelPtr(8), 4);
    });

    it('should read 16-bit relative pointers under pointerWidth 16', () => {
      const reader = new RkyvReader(new Uint8Array([0x04, 0x00, 0xff, 0xff]), {
        format: format({ pointerWidth: 16 }),
      });
      assert.strictEqual(reader.readRelPtr(0), 4);
      assert.strictEqual(reader.readRelPtr(2), 1); // 2 + (-1)
    });

    it('should detect the invalid-pointer sentinel (raw offset 1)', () => {
      const reader = new RkyvReader(new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00]));
      assert.strictEqual(reader.isInvalidPtr(0), true);
      assert.strictEqual(reader.isInvalidPtr(4), false);
    });
  });

  describe('readBytes / readText', () => {
    it('should read byte slice', () => {
      const reader = new RkyvReader(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
      assert.deepStrictEqual(reader.readBytes(0, 5), new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    });

    it('should decode short ASCII text (fast path)', () => {
      const reader = new RkyvReader(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
      assert.strictEqual(reader.readText(0, 5), 'Hello');
    });

    it('should decode multibyte UTF-8 text', () => {
      // "你好" = E4 BD A0 E5 A5 BD
      const reader = new RkyvReader(new Uint8Array([0xe4, 0xbd, 0xa0, 0xe5, 0xa5, 0xbd]));
      assert.strictEqual(reader.readText(0, 6), '你好');
    });

    it('should decode long text', () => {
      const text = 'a'.repeat(100);
      const reader = new RkyvReader(new TextEncoder().encode(text));
      assert.strictEqual(reader.readText(0, 100), text);
    });
  });

  describe('getRootPosition', () => {
    it('should calculate root position at end of buffer', () => {
      const reader = new RkyvReader(new Uint8Array(100));
      assert.strictEqual(reader.getRootPosition(8), 92);
    });
  });
});
