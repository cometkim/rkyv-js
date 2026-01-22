import { describe, it, expect } from 'vitest';
import { RkyvReader } from '../src/reader.js';
import { u8, u32, f32, array } from '../src/types.js';
import { union, taggedUnion } from '../src/schema.js';

describe('union decoder', () => {
  it('should decode all variants from same memory location', () => {
    // Union of u32 / f32 / [u8; 4]
    // Value 0x3F800000 = 1.0 as f32, 1065353216 as u32
    const buffer = new Uint8Array([0x00, 0x00, 0x80, 0x3f]);
    const reader = new RkyvReader(buffer);

    const NumberUnion = union({
      asU32: { decoder: u32 },
      asF32: { decoder: f32 },
      asBytes: { decoder: array(u8, 4) },
    });

    // Decode all variants at once
    const result = NumberUnion.decode(reader, 0);

    expect(result.asU32).toBe(1065353216);
    expect(result.asF32).toBeCloseTo(1.0);
    expect(result.asBytes).toEqual([0x00, 0x00, 0x80, 0x3f]);
  });

  it('should decode specific variant using .as()', () => {
    const buffer = new Uint8Array([0x00, 0x00, 0x80, 0x3f]);
    const reader = new RkyvReader(buffer);

    const NumberUnion = union({
      asU32: { decoder: u32 },
      asF32: { decoder: f32 },
    });

    // Decode specific variant
    const u32Value = NumberUnion.as('asU32').decode(reader, 0);
    expect(u32Value).toBe(1065353216);

    const f32Value = NumberUnion.as('asF32').decode(reader, 0);
    expect(f32Value).toBeCloseTo(1.0);
  });

  it('should have correct size and alignment', () => {
    const NumberUnion = union({
      asU32: { decoder: u32 },
      asU8: { decoder: u8 },
    });

    // Size should be max of variants (4 bytes for u32)
    expect(NumberUnion.size).toBe(4);
    // Alignment should be max of variants (4 for u32)
    expect(NumberUnion.align).toBe(4);
  });

  it('should provide variant accessors', () => {
    const NumberUnion = union({
      asU32: { decoder: u32 },
      asF32: { decoder: f32 },
    });

    // Check that variants property exists
    expect(NumberUnion.variants.asU32).toBeDefined();
    expect(NumberUnion.variants.asF32).toBeDefined();
    expect(NumberUnion.variants.asU32.size).toBe(4);
  });
});

describe('taggedUnion decoder', () => {
  it('should decode with external tag', () => {
    // Layout: tag (1 byte) + padding (3 bytes) + value (4 bytes)
    // Tag 0 = u32, Tag 1 = f32

    const TaggedNumber = taggedUnion(u8, {
      0: { name: 'int', decoder: u32 },
      1: { name: 'float', decoder: f32 },
    });

    // Test int variant (tag = 0, value = 42)
    const intBuffer = new Uint8Array([
      0x00, // tag = 0
      0x00, 0x00, 0x00, // padding
      0x2a, 0x00, 0x00, 0x00, // value = 42
    ]);

    const intResult = TaggedNumber.decode(new RkyvReader(intBuffer), 0);
    expect(intResult.tag).toBe('int');
    expect(intResult.value).toBe(42);

    // Test float variant (tag = 1, value = 1.0)
    const floatBuffer = new Uint8Array([
      0x01, // tag = 1
      0x00, 0x00, 0x00, // padding
      0x00, 0x00, 0x80, 0x3f, // value = 1.0
    ]);

    const floatResult = TaggedNumber.decode(new RkyvReader(floatBuffer), 0);
    expect(floatResult.tag).toBe('float');
    expect(floatResult.value).toBeCloseTo(1.0);
  });

  it('should throw on invalid tag', () => {
    const TaggedNumber = taggedUnion(u8, {
      0: { name: 'int', decoder: u32 },
      1: { name: 'float', decoder: f32 },
    });

    const invalidBuffer = new Uint8Array([
      0x05, // invalid tag
      0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);

    expect(() => TaggedNumber.decode(new RkyvReader(invalidBuffer), 0)).toThrow(
      'Invalid union tag: 5'
    );
  });
});
