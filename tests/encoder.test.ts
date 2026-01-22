import { describe, it, expect } from 'vitest';
import {
  RkyvWriter,
  RkyvReader,
  toBytes,
  access,
  // Encoders
  u8Encoder,
  u32Encoder,
  i32Encoder,
  f32Encoder,
  boolEncoder,
  stringEncoder,
  vecEncoder,
  optionEncoder,
  arrayEncoder,
  tupleEncoder,
  // Decoders for verification
  u8,
  u32,
  i32,
  f32,
  bool,
  string,
  vec,
  option,
  array,
  tuple,
} from '../src/index.js';

describe('RkyvWriter', () => {
  it('should write primitives in little-endian', () => {
    const writer = new RkyvWriter();

    writer.writeU32(0x12345678);
    const bytes = writer.finish();

    expect(bytes).toEqual(new Uint8Array([0x78, 0x56, 0x34, 0x12]));
  });

  it('should handle alignment', () => {
    const writer = new RkyvWriter();

    writer.writeU8(1); // 1 byte
    writer.writeU32(2); // needs 4-byte alignment, so 3 bytes padding + 4 bytes

    const bytes = writer.finish();
    expect(bytes.length).toBe(8); // 1 + 3 padding + 4
    expect(bytes[0]).toBe(1);
    expect(bytes[4]).toBe(2); // u32 at offset 4
  });

  it('should grow buffer as needed', () => {
    const writer = new RkyvWriter(4); // small initial capacity

    for (let i = 0; i < 100; i++) {
      writer.writeU32(i);
    }

    const bytes = writer.finish();
    expect(bytes.length).toBe(400);
  });
});

describe('primitive encoders', () => {
  it('should encode u8', () => {
    const bytes = toBytes(42, u8Encoder);
    expect(access(bytes, u8)).toBe(42);
  });

  it('should encode u32', () => {
    const bytes = toBytes(0x12345678, u32Encoder);
    expect(access(bytes, u32)).toBe(0x12345678);
  });

  it('should encode i32 negative', () => {
    const bytes = toBytes(-42, i32Encoder);
    expect(access(bytes, i32)).toBe(-42);
  });

  it('should encode f32', () => {
    const bytes = toBytes(3.14, f32Encoder);
    expect(access(bytes, f32)).toBeCloseTo(3.14, 5);
  });

  it('should encode bool', () => {
    expect(access(toBytes(true, boolEncoder), bool)).toBe(true);
    expect(access(toBytes(false, boolEncoder), bool)).toBe(false);
  });
});

describe('string encoder', () => {
  it('should encode and decode string', () => {
    const original = 'hello world';
    const bytes = toBytes(original, stringEncoder);
    const decoded = access(bytes, string);
    expect(decoded).toBe(original);
  });

  it('should encode UTF-8 string', () => {
    const original = 'こんにちは';
    const bytes = toBytes(original, stringEncoder);
    const decoded = access(bytes, string);
    expect(decoded).toBe(original);
  });

  it('should encode empty string', () => {
    const original = '';
    const bytes = toBytes(original, stringEncoder);
    const decoded = access(bytes, string);
    expect(decoded).toBe(original);
  });
});

describe('vec encoder', () => {
  it('should encode Vec<u32>', () => {
    const original = [1, 2, 3, 4, 5];
    const encoder = vecEncoder(u32Encoder);
    const decoder = vec(u32);

    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });

  it('should encode empty Vec', () => {
    const original: number[] = [];
    const encoder = vecEncoder(u32Encoder);
    const decoder = vec(u32);

    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });

  it('should encode Vec<String>', () => {
    const original = ['hello', 'world', 'test'];
    const encoder = vecEncoder(stringEncoder);
    const decoder = vec(string);

    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });
});

describe('option encoder', () => {
  it('should encode Some', () => {
    const original = 42;
    const encoder = optionEncoder(u32Encoder);
    const decoder = option(u32);

    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toBe(original);
  });

  it('should encode None', () => {
    const original = null;
    const encoder = optionEncoder(u32Encoder);
    const decoder = option(u32);

    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toBe(null);
  });
});

describe('array encoder', () => {
  it('should encode [u32; 3]', () => {
    const original = [1, 2, 3];
    const encoder = arrayEncoder(u32Encoder, 3);
    const decoder = array(u32, 3);

    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });

  it('should throw on wrong length', () => {
    const encoder = arrayEncoder(u32Encoder, 3);

    expect(() => toBytes([1, 2], encoder)).toThrow('Array length mismatch');
  });
});

describe('tuple encoder', () => {
  it('should encode (u8, u32, bool)', () => {
    const original: [number, number, boolean] = [1, 42, true];
    const encoder = tupleEncoder(u8Encoder, u32Encoder, boolEncoder);
    const decoder = tuple(u8, u32, bool);

    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });
});
