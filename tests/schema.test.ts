import { describe, it, expect } from 'vitest';
import { RkyvReader } from '../src/reader.js';
import { u8, u32, string } from '../src/types.js';
import { struct, enumType, lazy } from '../src/schema.js';

describe('struct decoder', () => {
  it('should decode simple struct', () => {
    // struct Point { x: u32, y: u32 }
    // Layout: x (4) + y (4) = 8 bytes
    const buffer = new Uint8Array([
      0x0a, 0x00, 0x00, 0x00, // x = 10
      0x14, 0x00, 0x00, 0x00, // y = 20
    ]);
    const reader = new RkyvReader(buffer);

    const Point = struct<{ x: number; y: number }>({
      x: { decoder: u32 },
      y: { decoder: u32 },
    });

    expect(Point.decode(reader, 0)).toEqual({ x: 10, y: 20 });
    expect(Point.size).toBe(8);
    expect(Point.align).toBe(4);
  });

  it('should decode struct with padding', () => {
    // struct Mixed { a: u8, b: u32, c: u8 }
    // Layout: a (1) + padding (3) + b (4) + c (1) + padding (3) = 12 bytes
    const buffer = new Uint8Array([
      0x01, // a = 1
      0x00, 0x00, 0x00, // padding
      0x02, 0x00, 0x00, 0x00, // b = 2
      0x03, // c = 3
      0x00, 0x00, 0x00, // trailing padding
    ]);
    const reader = new RkyvReader(buffer);

    const Mixed = struct<{ a: number; b: number; c: number }>({
      a: { decoder: u8 },
      b: { decoder: u32 },
      c: { decoder: u8 },
    });

    expect(Mixed.decode(reader, 0)).toEqual({ a: 1, b: 2, c: 3 });
    expect(Mixed.size).toBe(12);
    expect(Mixed.align).toBe(4);
  });

  it('should decode nested structs', () => {
    // struct Inner { value: u32 }
    // struct Outer { inner: Inner, extra: u32 }
    const buffer = new Uint8Array([
      0x2a, 0x00, 0x00, 0x00, // inner.value = 42
      0x63, 0x00, 0x00, 0x00, // extra = 99
    ]);
    const reader = new RkyvReader(buffer);

    const Inner = struct<{ value: number }>({
      value: { decoder: u32 },
    });

    const Outer = struct<{ inner: { value: number }; extra: number }>({
      inner: { decoder: Inner },
      extra: { decoder: u32 },
    });

    expect(Outer.decode(reader, 0)).toEqual({
      inner: { value: 42 },
      extra: 99,
    });
  });
});

describe('enum decoder', () => {
  it('should decode unit variants', () => {
    // enum Status { Pending, Active, Done }
    // Layout: tag (1)
    const StatusDecoder = enumType<{
      Pending: undefined;
      Active: undefined;
      Done: undefined;
    }>({
      Pending: {},
      Active: {},
      Done: {},
    });

    const bufferPending = new Uint8Array([0x00]); // Pending
    const bufferActive = new Uint8Array([0x01]); // Active
    const bufferDone = new Uint8Array([0x02]); // Done

    expect(StatusDecoder.decode(new RkyvReader(bufferPending), 0)).toEqual({
      tag: 'Pending',
      value: undefined,
    });
    expect(StatusDecoder.decode(new RkyvReader(bufferActive), 0)).toEqual({
      tag: 'Active',
      value: undefined,
    });
    expect(StatusDecoder.decode(new RkyvReader(bufferDone), 0)).toEqual({
      tag: 'Done',
      value: undefined,
    });
  });

  it('should decode struct variants', () => {
    // enum Message { Quit, Move { x: u32, y: u32 } }
    // Layout for Move: tag (1) + padding (3) + x (4) + y (4) = 12 bytes
    const MessageDecoder = enumType<{
      Quit: undefined;
      Move: { x: number; y: number };
    }>({
      Quit: {},
      Move: { fields: { x: { decoder: u32 }, y: { decoder: u32 } } },
    });

    // Quit variant
    const bufferQuit = new Uint8Array([
      0x00, // tag = 0 (Quit)
      0x00, 0x00, 0x00, // padding
      0x00, 0x00, 0x00, 0x00, // unused
      0x00, 0x00, 0x00, 0x00, // unused
    ]);
    expect(MessageDecoder.decode(new RkyvReader(bufferQuit), 0)).toEqual({
      tag: 'Quit',
      value: undefined,
    });

    // Move variant
    const bufferMove = new Uint8Array([
      0x01, // tag = 1 (Move)
      0x00, 0x00, 0x00, // padding
      0x0a, 0x00, 0x00, 0x00, // x = 10
      0x14, 0x00, 0x00, 0x00, // y = 20
    ]);
    expect(MessageDecoder.decode(new RkyvReader(bufferMove), 0)).toEqual({
      tag: 'Move',
      value: { x: 10, y: 20 },
    });
  });

  it('should throw on invalid discriminant', () => {
    const StatusDecoder = enumType<{
      A: undefined;
      B: undefined;
    }>({
      A: {},
      B: {},
    });

    const buffer = new Uint8Array([0x05]); // Invalid discriminant
    expect(() =>
      StatusDecoder.decode(new RkyvReader(buffer), 0)
    ).toThrow('Invalid enum discriminant: 5');
  });
});

describe('lazy decoder', () => {
  it('should support recursive types', () => {
    // A simple linked list node
    // struct Node { value: u32, next: Option<Box<Node>> }
    // For simplicity, we'll test the lazy mechanism

    interface Node {
      value: number;
    }

    // Use lazy to break the circular reference
    const NodeDecoder = struct<Node>({
      value: { decoder: u32 },
    });

    // Create a lazy decoder that returns the same decoder
    const LazyNodeDecoder = lazy(() => NodeDecoder);

    const buffer = new Uint8Array([0x2a, 0x00, 0x00, 0x00]); // value = 42
    const reader = new RkyvReader(buffer);

    expect(LazyNodeDecoder.decode(reader, 0)).toEqual({ value: 42 });
    expect(LazyNodeDecoder.size).toBe(4);
    expect(LazyNodeDecoder.align).toBe(4);
  });
});
