import { describe, it, expect } from 'vitest';
import { RkyvReader } from '../src/reader.js';
import {
  u8,
  i8,
  u16,
  u32,
  i32,
  f32,
  bool,
  char,
  string,
  vec,
  option,
  box,
  array,
  tuple,
  alignOffset,
} from '../src/types.js';

describe('primitive decoders', () => {
  it('should decode u8', () => {
    const buffer = new Uint8Array([42]);
    const reader = new RkyvReader(buffer);
    expect(u8.decode(reader, 0)).toBe(42);
  });

  it('should decode i8', () => {
    const buffer = new Uint8Array([0xfe]);
    const reader = new RkyvReader(buffer);
    expect(i8.decode(reader, 0)).toBe(-2);
  });

  it('should decode u32', () => {
    const buffer = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
    const reader = new RkyvReader(buffer);
    expect(u32.decode(reader, 0)).toBe(0x12345678);
  });

  it('should decode bool', () => {
    const buffer = new Uint8Array([0, 1]);
    const reader = new RkyvReader(buffer);
    expect(bool.decode(reader, 0)).toBe(false);
    expect(bool.decode(reader, 1)).toBe(true);
  });

  it('should decode char (UTF-32)', () => {
    // Unicode code point for 'A' is 0x41
    const buffer = new Uint8Array([0x41, 0x00, 0x00, 0x00]);
    const reader = new RkyvReader(buffer);
    expect(char.decode(reader, 0)).toBe('A');
  });

  it('should decode char with emoji', () => {
    // Unicode code point for 😀 is 0x1F600
    const buffer = new Uint8Array([0x00, 0xf6, 0x01, 0x00]);
    const reader = new RkyvReader(buffer);
    expect(char.decode(reader, 0)).toBe('😀');
  });
});

describe('string decoder', () => {
  it('should decode inline ArchivedString (rkyv 0.8 format)', () => {
    // rkyv 0.8 inline format for strings < 8 bytes:
    // - Bytes 0-6: string data
    // - Remaining bytes: 0xff padding
    // "hello" = 5 bytes, so inline
    const buffer = new Uint8Array([
      0x68, 0x65, 0x6c, 0x6c, 0x6f, // "hello"
      0xff, 0xff, 0xff, // padding
    ]);
    const reader = new RkyvReader(buffer);
    expect(string.decode(reader, 0)).toBe('hello');
  });

  it('should decode out-of-line ArchivedString (rkyv 0.8 format)', () => {
    // rkyv 0.8 out-of-line format for strings >= 8 bytes:
    // - Byte 0: length | 0x80
    // - Bytes 1-3: extended length (0 for short strings)
    // - Bytes 4-7: relative pointer to string data
    // "hello world!" = 12 bytes, so out-of-line
    const str = 'hello world!';
    const utf8Bytes = new TextEncoder().encode(str);
    // String data at offset 0, ArchivedString struct at offset 12
    const buffer = new Uint8Array(utf8Bytes.length + 8);
    buffer.set(utf8Bytes, 0);
    const view = new DataView(buffer.buffer);

    // ArchivedString at offset 12
    const structOffset = utf8Bytes.length;
    view.setUint8(structOffset, utf8Bytes.length | 0x80); // length | 0x80
    view.setUint8(structOffset + 1, 0);
    view.setUint8(structOffset + 2, 0);
    view.setUint8(structOffset + 3, 0);
    view.setInt32(structOffset + 4, -structOffset, true); // relative pointer back to offset 0

    const reader = new RkyvReader(buffer);
    expect(string.decode(reader, structOffset)).toBe('hello world!');
  });

  it('should decode UTF-8 string (inline)', () => {
    // "日本" = 6 bytes in UTF-8, fits inline
    const utf8Bytes = new TextEncoder().encode('日本');
    const buffer = new Uint8Array(8);
    buffer.set(utf8Bytes, 0);
    // Pad with 0xff
    for (let i = utf8Bytes.length; i < 8; i++) {
      buffer[i] = 0xff;
    }

    const reader = new RkyvReader(buffer);
    expect(string.decode(reader, 0)).toBe('日本');
  });

  it('should decode UTF-8 string (out-of-line)', () => {
    // "こんにちは" = 15 bytes in UTF-8, out-of-line
    const utf8Bytes = new TextEncoder().encode('こんにちは');
    const buffer = new Uint8Array(utf8Bytes.length + 8);
    buffer.set(utf8Bytes, 0);

    const structOffset = utf8Bytes.length;
    const view = new DataView(buffer.buffer);
    view.setUint8(structOffset, utf8Bytes.length | 0x80);
    view.setUint8(structOffset + 1, 0);
    view.setUint8(structOffset + 2, 0);
    view.setUint8(structOffset + 3, 0);
    view.setInt32(structOffset + 4, -structOffset, true);

    const reader = new RkyvReader(buffer);
    expect(string.decode(reader, structOffset)).toBe('こんにちは');
  });
});

describe('vec decoder', () => {
  it('should decode Vec<u32>', () => {
    // Layout: relptr (4) + len (4) + array data
    // At offset 0: relptr = 8 (points to array data)
    // At offset 4: len = 3
    // At offset 8: [1, 2, 3] as u32s
    const buffer = new Uint8Array([
      0x08, 0x00, 0x00, 0x00, // relptr = 8
      0x03, 0x00, 0x00, 0x00, // len = 3
      0x01, 0x00, 0x00, 0x00, // 1
      0x02, 0x00, 0x00, 0x00, // 2
      0x03, 0x00, 0x00, 0x00, // 3
    ]);
    const reader = new RkyvReader(buffer);
    const decoder = vec(u32);
    expect(decoder.decode(reader, 0)).toEqual([1, 2, 3]);
  });

  it('should decode empty Vec', () => {
    // Empty vec: relptr can be anything, len = 0
    const buffer = new Uint8Array([
      0x00, 0x00, 0x00, 0x00, // relptr (doesn't matter)
      0x00, 0x00, 0x00, 0x00, // len = 0
    ]);
    const reader = new RkyvReader(buffer);
    const decoder = vec(u32);
    expect(decoder.decode(reader, 0)).toEqual([]);
  });
});

describe('option decoder', () => {
  it('should decode None', () => {
    // Option<u32>: tag (1) + padding (3) + value (4)
    const buffer = new Uint8Array([
      0x00, // tag = 0 (None)
      0x00, 0x00, 0x00, // padding
      0xff, 0xff, 0xff, 0xff, // unused value area
    ]);
    const reader = new RkyvReader(buffer);
    const decoder = option(u32);
    expect(decoder.decode(reader, 0)).toBe(null);
  });

  it('should decode Some(42)', () => {
    // Option<u32>: tag (1) + padding (3) + value (4)
    const buffer = new Uint8Array([
      0x01, // tag = 1 (Some)
      0x00, 0x00, 0x00, // padding
      0x2a, 0x00, 0x00, 0x00, // value = 42
    ]);
    const reader = new RkyvReader(buffer);
    const decoder = option(u32);
    expect(decoder.decode(reader, 0)).toBe(42);
  });

  it('should decode Option<u8> without extra padding', () => {
    // Option<u8>: tag (1) + value (1) = 2 bytes (no padding needed)
    const buffer = new Uint8Array([
      0x01, // tag = 1 (Some)
      0x2a, // value = 42
    ]);
    const reader = new RkyvReader(buffer);
    const decoder = option(u8);
    expect(decoder.decode(reader, 0)).toBe(42);
  });
});

describe('box decoder', () => {
  it('should decode Box<u32>', () => {
    // Box is just a relative pointer
    // At offset 0: relptr = 4 (points to u32 at offset 4)
    // At offset 4: value = 42
    const buffer = new Uint8Array([
      0x04, 0x00, 0x00, 0x00, // relptr = 4
      0x2a, 0x00, 0x00, 0x00, // value = 42
    ]);
    const reader = new RkyvReader(buffer);
    const decoder = box(u32);
    expect(decoder.decode(reader, 0)).toBe(42);
  });
});

describe('array decoder', () => {
  it('should decode [u32; 3]', () => {
    const buffer = new Uint8Array([
      0x01, 0x00, 0x00, 0x00, // 1
      0x02, 0x00, 0x00, 0x00, // 2
      0x03, 0x00, 0x00, 0x00, // 3
    ]);
    const reader = new RkyvReader(buffer);
    const decoder = array(u32, 3);
    expect(decoder.decode(reader, 0)).toEqual([1, 2, 3]);
  });
});

describe('tuple decoder', () => {
  it('should decode (u8, u32, u8)', () => {
    // C layout: u8 (1) + padding (3) + u32 (4) + u8 (1) + padding (3) = 12 bytes
    const buffer = new Uint8Array([
      0x01, // u8 = 1
      0x00, 0x00, 0x00, // padding
      0x02, 0x00, 0x00, 0x00, // u32 = 2
      0x03, // u8 = 3
      0x00, 0x00, 0x00, // trailing padding
    ]);
    const reader = new RkyvReader(buffer);
    const decoder = tuple(u8, u32, u8);
    expect(decoder.decode(reader, 0)).toEqual([1, 2, 3]);
  });
});

describe('alignOffset', () => {
  it('should align to 1', () => {
    expect(alignOffset(0, 1)).toBe(0);
    expect(alignOffset(1, 1)).toBe(1);
    expect(alignOffset(7, 1)).toBe(7);
  });

  it('should align to 4', () => {
    expect(alignOffset(0, 4)).toBe(0);
    expect(alignOffset(1, 4)).toBe(4);
    expect(alignOffset(4, 4)).toBe(4);
    expect(alignOffset(5, 4)).toBe(8);
  });

  it('should align to 8', () => {
    expect(alignOffset(0, 8)).toBe(0);
    expect(alignOffset(1, 8)).toBe(8);
    expect(alignOffset(7, 8)).toBe(8);
    expect(alignOffset(8, 8)).toBe(8);
    expect(alignOffset(9, 8)).toBe(16);
  });
});
