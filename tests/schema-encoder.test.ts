import { describe, it, expect } from 'vitest';
import {
  toBytes,
  access,
  // Encoders
  u32Encoder,
  i32Encoder,
  stringEncoder,
  vecEncoder,
  optionEncoder,
  structEncoder,
  enumEncoder,
  unionEncoder,
  // Decoders
  u32,
  i32,
  string,
  vec,
  option,
  struct,
  enumType,
  union,
} from '../src/index.js';

describe('struct encoder', () => {
  it('should encode simple struct', () => {
    interface Point {
      x: number;
      y: number;
    }

    const encoder = structEncoder<Point>({
      x: { encoder: u32Encoder },
      y: { encoder: u32Encoder },
    });

    const decoder = struct<Point>({
      x: { decoder: u32 },
      y: { decoder: u32 },
    });

    const original: Point = { x: 10, y: 20 };
    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });

  it('should encode struct with strings', () => {
    interface Person {
      name: string;
      age: number;
    }

    const encoder = structEncoder<Person>({
      name: { encoder: stringEncoder },
      age: { encoder: u32Encoder },
    });

    const decoder = struct<Person>({
      name: { decoder: string },
      age: { decoder: u32 },
    });

    const original: Person = { name: 'Alice', age: 30 };
    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });

  it('should encode nested structs', () => {
    interface Inner {
      value: number;
    }

    interface Outer {
      inner: Inner;
      extra: number;
    }

    const innerEncoder = structEncoder<Inner>({
      value: { encoder: u32Encoder },
    });

    const outerEncoder = structEncoder<Outer>({
      inner: { encoder: innerEncoder },
      extra: { encoder: u32Encoder },
    });

    const innerDecoder = struct<Inner>({
      value: { decoder: u32 },
    });

    const outerDecoder = struct<Outer>({
      inner: { decoder: innerDecoder },
      extra: { decoder: u32 },
    });

    const original: Outer = { inner: { value: 42 }, extra: 99 };
    const bytes = toBytes(original, outerEncoder);
    const decoded = access(bytes, outerDecoder);

    expect(decoded).toEqual(original);
  });

  it('should encode struct with Vec and Option', () => {
    interface Data {
      items: number[];
      label: string | null;
    }

    const encoder = structEncoder<Data>({
      items: { encoder: vecEncoder(u32Encoder) },
      label: { encoder: optionEncoder(stringEncoder) },
    });

    const decoder = struct<Data>({
      items: { decoder: vec(u32) },
      label: { decoder: option(string) },
    });

    const original: Data = { items: [1, 2, 3], label: 'test' };
    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });
});

describe('enum encoder', () => {
  it('should encode unit variants', () => {
    type Status = { tag: 'Pending'; value: undefined } | { tag: 'Active'; value: undefined };

    const encoder = enumEncoder<{
      Pending: undefined;
      Active: undefined;
    }>({
      Pending: {},
      Active: {},
    });

    const decoder = enumType<{
      Pending: undefined;
      Active: undefined;
    }>({
      Pending: {},
      Active: {},
    });

    const original: Status = { tag: 'Active', value: undefined };
    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });

  it('should encode struct variants', () => {
    type Message =
      | { tag: 'Quit'; value: undefined }
      | { tag: 'Move'; value: { x: number; y: number } };

    const encoder = enumEncoder<{
      Quit: undefined;
      Move: { x: number; y: number };
    }>({
      Quit: {},
      Move: { fields: { x: { encoder: i32Encoder }, y: { encoder: i32Encoder } } },
    });

    const decoder = enumType<{
      Quit: undefined;
      Move: { x: number; y: number };
    }>({
      Quit: {},
      Move: { fields: { x: { decoder: i32 }, y: { decoder: i32 } } },
    });

    const original: Message = { tag: 'Move', value: { x: 10, y: 20 } };
    const bytes = toBytes(original, encoder);
    const decoded = access(bytes, decoder);

    expect(decoded).toEqual(original);
  });
});

describe('union encoder', () => {
  it('should encode specific variant', () => {
    interface NumberUnion {
      asU32: number;
      asI32: number;
    }

    const encoder = unionEncoder<NumberUnion>({
      asU32: { encoder: u32Encoder },
      asI32: { encoder: i32Encoder },
    });

    const decoder = union<NumberUnion>({
      asU32: { decoder: u32 },
      asI32: { decoder: i32 },
    });

    // Encode as u32
    const bytes = toBytes(42, encoder.as('asU32'));

    // Decode - both interpretations should work
    const decoded = access(bytes, decoder);
    expect(decoded.asU32).toBe(42);
    expect(decoded.asI32).toBe(42);
  });
});
