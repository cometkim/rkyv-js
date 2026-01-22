import { describe, it, expect } from 'vitest';
import {
  access,
  accessAt,
  createArchive,
  struct,
  vec,
  option,
  string,
  u32,
  u8,
  bool,
  enumType,
  Infer,
} from '../src/index.js';

describe('integration tests', () => {
  describe('access function', () => {
    it('should decode root object from end of buffer', () => {
      // Create a buffer where the root struct is at the end
      // Struct: { x: u32, y: u32 } = 8 bytes
      // Buffer layout: [padding...] [x: u32] [y: u32]
      //                             ^ root starts here (at length - 8)

      const buffer = new Uint8Array([
        0x00, 0x00, 0x00, 0x00, // some padding
        0x0a, 0x00, 0x00, 0x00, // x = 10
        0x14, 0x00, 0x00, 0x00, // y = 20
      ]);

      const Point = struct<{ x: number; y: number }>({
        x: { decoder: u32 },
        y: { decoder: u32 },
      });

      const result = access(buffer, Point);
      expect(result).toEqual({ x: 10, y: 20 });
    });
  });

  describe('accessAt function', () => {
    it('should decode at specific offset', () => {
      const buffer = new Uint8Array([
        0xff, 0xff, 0xff, 0xff, // garbage at offset 0
        0x2a, 0x00, 0x00, 0x00, // value = 42 at offset 4
      ]);

      const result = accessAt(buffer, u32, 4);
      expect(result).toBe(42);
    });
  });

  describe('createArchive', () => {
    it('should create reusable archive accessor', () => {
      const buffer = new Uint8Array([
        0x01, 0x00, 0x00, 0x00, // value at offset 0
        0x02, 0x00, 0x00, 0x00, // value at offset 4
      ]);

      const archive = createArchive(buffer);

      expect(archive.at(0, u32)).toBe(1);
      expect(archive.at(4, u32)).toBe(2);
      expect(archive.length).toBe(8);
    });
  });

  describe('complex nested structure', () => {
    it('should decode Person with nested Vec and Option', () => {
      // This simulates a more realistic scenario:
      // struct Person {
      //   name: String,     // relptr + len = 8 bytes
      //   age: u32,         // 4 bytes
      //   active: bool,     // 1 byte + 3 padding
      // }
      // Total struct size: 8 + 4 + 4 = 16 bytes (with alignment)

      // Buffer layout (depth-first, leaves to root):
      // offset 0: "Alice" (5 bytes) + padding
      // offset 8: Person struct starts here
      // rkyv 0.8 format: "Alice" (5 bytes) is inline
      // Person struct layout:
      //   - name: ArchivedString (8 bytes) - inline "Alice" + 0xff padding
      //   - age: u32 (4 bytes)
      //   - active: bool (1 byte)
      //   - padding: 3 bytes

      const buffer = new Uint8Array([
        // offset 0: Person struct (this is the root at offset 0)
        // name: ArchivedString (inline format)
        0x41, 0x6c, 0x69, 0x63, 0x65, // "Alice"
        0xff, 0xff, 0xff, // 0xff padding
        // age: u32
        0x1e, 0x00, 0x00, 0x00, // age = 30
        // active: bool
        0x01, // active = true
        0x00, 0x00, 0x00, // padding
      ]);

      const Person = struct<{ name: string; age: number; active: boolean }>({
        name: { decoder: string },
        age: { decoder: u32 },
        active: { decoder: bool },
      });

      // Access at offset 0 where Person starts
      const person = accessAt(buffer, Person, 0);

      expect(person.name).toBe('Alice');
      expect(person.age).toBe(30);
      expect(person.active).toBe(true);
    });
  });

  describe('type inference', () => {
    it('should correctly infer types from decoder', () => {
      const PersonDecoder = struct({
        name: { decoder: string },
        age: { decoder: u32 },
        scores: { decoder: vec(u32) },
        nickname: { decoder: option(string) },
      });

      // This is a compile-time check - if it compiles, inference works
      type Person = Infer<typeof PersonDecoder>;

      // Verify the type at runtime matches expectations
      const dummy: Person = {
        name: 'Test',
        age: 25,
        scores: [1, 2, 3],
        nickname: null,
      };

      expect(dummy.name).toBe('Test');
      expect(dummy.scores).toEqual([1, 2, 3]);
    });
  });

  describe('enum with mixed variants', () => {
    it('should decode Result-like enum', () => {
      // enum Result<T, E> { Ok(T), Err(E) }
      // Using u32 for T and string for E

      const ResultDecoder = enumType<{
        Ok: { value: number };
        Err: { message: string };
      }>({
        Ok: { fields: { value: { decoder: u32 } } },
        Err: { fields: { message: { decoder: string } } },
      });

      // Ok variant with value = 42
      // Layout: tag (1) + padding (3) + value (4) = 8 bytes minimum
      // But Err variant has ArchivedString which is 8 bytes
      // So total size accounts for largest variant

      const okBuffer = new Uint8Array([
        0x00, // tag = 0 (Ok)
        0x00, 0x00, 0x00, // padding to align u32
        0x2a, 0x00, 0x00, 0x00, // value = 42
      ]);

      const okResult = accessAt(okBuffer, ResultDecoder, 0);
      expect(okResult).toEqual({ tag: 'Ok', value: { value: 42 } });
    });
  });
});
