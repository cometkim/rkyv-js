import { describe, it, expect } from 'vitest';
import { RkyvReader } from '../src/reader.js';

describe('RkyvReader', () => {
  describe('primitive reads', () => {
    it('should read u8', () => {
      const buffer = new Uint8Array([0xff, 0x00, 0x7f]);
      const reader = new RkyvReader(buffer);

      expect(reader.readU8(0)).toBe(255);
      expect(reader.readU8(1)).toBe(0);
      expect(reader.readU8(2)).toBe(127);
    });

    it('should read i8', () => {
      const buffer = new Uint8Array([0xff, 0x00, 0x7f, 0x80]);
      const reader = new RkyvReader(buffer);

      expect(reader.readI8(0)).toBe(-1);
      expect(reader.readI8(1)).toBe(0);
      expect(reader.readI8(2)).toBe(127);
      expect(reader.readI8(3)).toBe(-128);
    });

    it('should read u16 (little-endian)', () => {
      const buffer = new Uint8Array([0x01, 0x00, 0xff, 0xff, 0x34, 0x12]);
      const reader = new RkyvReader(buffer);

      expect(reader.readU16(0)).toBe(1);
      expect(reader.readU16(2)).toBe(65535);
      expect(reader.readU16(4)).toBe(0x1234);
    });

    it('should read i16 (little-endian)', () => {
      const buffer = new Uint8Array([0xff, 0xff, 0x00, 0x80]);
      const reader = new RkyvReader(buffer);

      expect(reader.readI16(0)).toBe(-1);
      expect(reader.readI16(2)).toBe(-32768);
    });

    it('should read u32 (little-endian)', () => {
      const buffer = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
      const reader = new RkyvReader(buffer);

      expect(reader.readU32(0)).toBe(0x12345678);
    });

    it('should read i32 (little-endian)', () => {
      const buffer = new Uint8Array([0xff, 0xff, 0xff, 0xff]);
      const reader = new RkyvReader(buffer);

      expect(reader.readI32(0)).toBe(-1);
    });

    it('should read u64 (little-endian)', () => {
      const buffer = new Uint8Array([0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      const reader = new RkyvReader(buffer);

      expect(reader.readU64(0)).toBe(1n);
    });

    it('should read f32 (little-endian)', () => {
      // IEEE 754 single precision for 1.0
      const buffer = new Uint8Array([0x00, 0x00, 0x80, 0x3f]);
      const reader = new RkyvReader(buffer);

      expect(reader.readF32(0)).toBeCloseTo(1.0);
    });

    it('should read f64 (little-endian)', () => {
      // IEEE 754 double precision for 1.0
      const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0, 0x3f]);
      const reader = new RkyvReader(buffer);

      expect(reader.readF64(0)).toBeCloseTo(1.0);
    });

    it('should read bool', () => {
      const buffer = new Uint8Array([0x00, 0x01, 0xff]);
      const reader = new RkyvReader(buffer);

      expect(reader.readBool(0)).toBe(false);
      expect(reader.readBool(1)).toBe(true);
      expect(reader.readBool(2)).toBe(true); // non-zero is true
    });
  });

  describe('relative pointers', () => {
    it('should read 32-bit relative pointer', () => {
      // At offset 0, relative pointer value is 8 (pointing to offset 8)
      const buffer = new Uint8Array([
        0x08, 0x00, 0x00, 0x00, // relptr at offset 0 -> points to offset 8
        0x00, 0x00, 0x00, 0x00, // padding
        0x48, 0x65, 0x6c, 0x6c, // "Hell" at offset 8
      ]);
      const reader = new RkyvReader(buffer);

      expect(reader.readRelPtr32(0)).toBe(8);
    });

    it('should handle negative relative pointers', () => {
      // At offset 8, relative pointer points back 4 bytes (to offset 4)
      const buffer = new Uint8Array([
        0x00, 0x00, 0x00, 0x00, // offset 0
        0x12, 0x34, 0x56, 0x78, // data at offset 4
        0xfc, 0xff, 0xff, 0xff, // relptr at offset 8 = -4 -> points to offset 4
      ]);
      const reader = new RkyvReader(buffer);

      expect(reader.readRelPtr32(8)).toBe(4);
    });
  });

  describe('readBytes', () => {
    it('should read byte slice', () => {
      const buffer = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]);
      const reader = new RkyvReader(buffer);

      const bytes = reader.readBytes(0, 5);
      expect(bytes).toEqual(new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]));
    });
  });

  describe('getRootPosition', () => {
    it('should calculate root position at end of buffer', () => {
      const buffer = new Uint8Array(100);
      const reader = new RkyvReader(buffer);

      // For a root object of size 8, root position is 100 - 8 = 92
      expect(reader.getRootPosition(8)).toBe(92);
    });
  });
});
