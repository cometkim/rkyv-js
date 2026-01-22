import { describe, it, expect } from 'vitest';
import { r, type RkyvCodec } from 'rkyv-js';
import assert from 'node:assert';

describe('Unified Codec API', () => {
  describe('primitives', () => {
    it('should encode and decode u32', () => {
      const bytes = r.encode(r.u32, 42);
      const value = r.decode(r.u32, bytes);
      expect(value).toBe(42);
    });

    it('should encode and decode f64', () => {
      const bytes = r.encode(r.f64, 3.14159);
      const value = r.decode(r.f64, bytes);
      expect(value).toBeCloseTo(3.14159);
    });

    it('should encode and decode bool', () => {
      const bytes = r.encode(r.bool, true);
      const value = r.decode(r.bool, bytes);
      expect(value).toBe(true);
    });

    it('should encode and decode string', () => {
      const bytes = r.encode(r.string, 'hello');
      const value = r.decode(r.string, bytes);
      expect(value).toBe('hello');
    });

    it('should encode and decode long string (out-of-line)', () => {
      const longStr = 'This is a very long string that exceeds 8 bytes';
      const bytes = r.encode(r.string, longStr);
      const value = r.decode(r.string, bytes);
      expect(value).toBe(longStr);
    });
  });

  describe('r.vec', () => {
    it('should encode and decode vec of u32', () => {
      const arr = [1, 2, 3, 4, 5];
      const codec = r.vec(r.u32);
      const bytes = r.encode(codec, arr);
      const value = r.decode(codec, bytes);
      expect(value).toEqual(arr);
    });

    it('should encode and decode empty vec', () => {
      const codec = r.vec(r.u32);
      const bytes = r.encode(codec, []);
      const value = r.decode(codec, bytes);
      expect(value).toEqual([]);
    });

    it('should encode and decode vec of strings', () => {
      const arr = ['hello', 'world'];
      const codec = r.vec(r.string);
      const bytes = r.encode(codec, arr);
      const value = r.decode(codec, bytes);
      expect(value).toEqual(arr);
    });
  });

  describe('r.optional', () => {
    it('should encode and decode Some value', () => {
      const codec = r.optional(r.u32);
      const bytes = r.encode(codec, 42);
      const value = r.decode(codec, bytes);
      expect(value).toBe(42);
    });

    it('should encode and decode None', () => {
      const codec = r.optional(r.u32);
      const bytes = r.encode(codec, null);
      const value = r.decode(codec, bytes);
      expect(value).toBeNull();
    });
  });

  describe('r.object', () => {
    it('should encode and decode simple struct', () => {
      const Point = r.object({
        x: r.f64,
        y: r.f64,
      });

      const point = { x: 1.5, y: 2.5 };
      const bytes = r.encode(Point, point);
      const decoded = r.decode(Point, bytes);
      expect(decoded).toEqual(point);
    });

    it('should encode and decode struct with string', () => {
      const Person = r.object({
        name: r.string,
        age: r.u32,
      });

      const person = { name: 'Alice', age: 30 };
      const bytes = r.encode(Person, person);
      const decoded = r.decode(Person, bytes);
      expect(decoded).toEqual(person);
    });

    it('should encode and decode complex struct', () => {
      const Person = r.object({
        name: r.string,
        age: r.u32,
        email: r.optional(r.string),
        scores: r.vec(r.u32),
        active: r.bool,
      });

      const person = {
        name: 'Alice',
        age: 30,
        email: 'alice@example.com',
        scores: [100, 95, 87],
        active: true,
      };

      const bytes = r.encode(Person, person);
      const decoded = r.decode(Person, bytes);
      expect(decoded).toEqual(person);
    });
  });

  describe('r.taggedEnum', () => {
    it('should encode and decode unit variant', () => {
      const Message = r.taggedEnum<{
        Quit: undefined;
        Move: { x: number; y: number };
      }>({
        Quit: r.unit,
        Move: r.object({ x: r.i32, y: r.i32 }),
      });

      const value = { tag: 'Quit' as const, value: undefined };
      const bytes = r.encode(Message, value);
      const decoded = r.decode(Message, bytes);
      expect(decoded.tag).toBe('Quit');
    });

    it('should encode and decode struct variant', () => {
      const Message = r.taggedEnum<{
        Quit: undefined;
        Move: { x: number; y: number };
      }>({
        Quit: r.unit,
        Move: r.object({ x: r.i32, y: r.i32 }),
      });

      const value = { tag: 'Move' as const, value: { x: 10, y: 20 } };
      const bytes = r.encode(Message, value);
      const decoded = r.decode(Message, bytes);
      expect(decoded).toEqual(value);
    });
  });

  describe('r.tuple', () => {
    it('should encode and decode tuple', () => {
      const codec = r.tuple(r.u32, r.string, r.bool);
      const value: [number, string, boolean] = [42, 'hello', true];
      const bytes = r.encode(codec, value);
      const decoded = r.decode(codec, bytes);
      expect(decoded).toEqual(value);
    });
  });

  describe('r.array (fixed-size)', () => {
    it('should encode and decode fixed-size array', () => {
      const codec = r.array(r.u32, 3);
      const value = [1, 2, 3];
      const bytes = r.encode(codec, value);
      const decoded = r.decode(codec, bytes);
      expect(decoded).toEqual(value);
    });
  });

  describe('type inference', () => {
    it('should infer types correctly', () => {
      const Person = r.object({
        name: r.string,
        age: r.u32,
        scores: r.vec(r.u32),
      });

      type Person = r.infer<typeof Person>;

      // This is a compile-time check - if types are wrong, TS will error
      const person: Person = {
        name: 'Alice',
        age: 30,
        scores: [100, 95],
      };

      const bytes = r.encode(Person, person);
      const decoded: Person = r.decode(Person, bytes);
      expect(decoded.name).toBe('Alice');
      expect(decoded.age).toBe(30);
      expect(decoded.scores).toEqual([100, 95]);
    });
  });

  describe('r.transform', () => {
    it('should transform values on encode/decode', () => {
      // Transform a Date to/from a timestamp
      const DateCodec = r.transform(
        r.u64,
        (timestamp: bigint) => new Date(Number(timestamp)),
        (date: Date) => BigInt(date.getTime())
      );

      const date = new Date('2024-01-15T12:00:00Z');
      const bytes = r.encode(DateCodec, date);
      const decoded = r.decode(DateCodec, bytes);
      expect(decoded.getTime()).toBe(date.getTime());
    });
  });

  describe('r.lazy (recursive types)', () => {
    it('should handle recursive types', () => {
      interface TreeNode {
        value: number;
        children: TreeNode[];
      }

      const TreeNode: RkyvCodec<TreeNode> = r.lazy(() =>
        r.object({
          value: r.u32,
          children: r.vec(TreeNode),
        })
      );

      const tree: TreeNode = {
        value: 1,
        children: [
          { value: 2, children: [] },
          { value: 3, children: [{ value: 4, children: [] }] },
        ],
      };

      const bytes = r.encode(TreeNode, tree);
      const decoded = r.decode(TreeNode, bytes);
      expect(decoded).toEqual(tree);
    });
  });

  describe('r.access (zero-copy lazy access)', () => {
    it('should lazily access object fields', () => {
      const Person = r.object({
        name: r.string,
        age: r.u32,
        email: r.optional(r.string),
      });

      const person = { name: 'Alice', age: 30, email: 'alice@example.com' };
      const bytes = r.encode(Person, person);
      const proxy = r.access(Person, bytes);

      // Access individual fields
      expect(proxy.name).toBe('Alice');
      expect(proxy.age).toBe(30);
      expect(proxy.email).toBe('alice@example.com');
    });

    it('should lazily access vec elements', () => {
      const Numbers = r.vec(r.u32);
      const arr = [10, 20, 30, 40, 50];
      const bytes = r.encode(Numbers, arr);
      const proxy = r.access(Numbers, bytes);

      // Access individual elements
      expect(proxy.length).toBe(5);
      expect(proxy[0]).toBe(10);
      expect(proxy[2]).toBe(30);
      expect(proxy[4]).toBe(50);

      // Test 'in' operator
      expect(0 in proxy).toBe(true);
      expect(4 in proxy).toBe(true);
      expect(5 in proxy).toBe(false);
    });

    it('should lazily access nested objects', () => {
      const Inner = r.object({
        value: r.u32,
        text: r.string,
      });
      const Outer = r.object({
        id: r.u32,
        inner: Inner,
      });

      const data = { id: 1, inner: { value: 42, text: 'nested' } };
      const bytes = r.encode(Outer, data);
      const proxy = r.access(Outer, bytes);

      expect(proxy.id).toBe(1);
      expect(proxy.inner.value).toBe(42);
      expect(proxy.inner.text).toBe('nested');
    });

    it('should lazily access vec of objects', () => {
      const Point = r.object({ x: r.f64, y: r.f64 });
      const Points = r.vec(Point);

      const points = [
        { x: 1.0, y: 2.0 },
        { x: 3.0, y: 4.0 },
        { x: 5.0, y: 6.0 },
      ];
      const bytes = r.encode(Points, points);
      const proxy = r.access(Points, bytes);

      expect(proxy.length).toBe(3);
      expect(proxy[0].x).toBe(1.0);
      expect(proxy[1].y).toBe(4.0);
      expect(proxy[2].x).toBe(5.0);
    });

    it('should support iteration over vec proxy', () => {
      const Numbers = r.vec(r.u32);
      const arr = [1, 2, 3];
      const bytes = r.encode(Numbers, arr);
      const proxy = r.access(Numbers, bytes);

      // Test spread operator
      expect([...proxy]).toEqual([1, 2, 3]);

      // Test for...of
      const collected: number[] = [];
      for (const n of proxy) {
        collected.push(n);
      }
      expect(collected).toEqual([1, 2, 3]);
    });

    it('should support Object.keys on object proxy', () => {
      const Person = r.object({
        name: r.string,
        age: r.u32,
      });

      const person = { name: 'Bob', age: 25 };
      const bytes = r.encode(Person, person);
      const proxy = r.access(Person, bytes);

      expect(Object.keys(proxy)).toEqual(['name', 'age']);
    });

    it('should cache accessed fields (not re-decode)', () => {
      const Person = r.object({
        name: r.string,
        age: r.u32,
      });

      const person = { name: 'Cache', age: 99 };
      const bytes = r.encode(Person, person);
      const proxy = r.access(Person, bytes);

      // Access same field multiple times
      const name1 = proxy.name;
      const name2 = proxy.name;
      const name3 = proxy.name;

      // All should return the same cached value
      expect(name1).toBe('Cache');
      expect(name2).toBe('Cache');
      expect(name3).toBe('Cache');
      // Note: We can't easily test that it's cached without internal access,
      // but the API contract is that it should be cached
    });

    it('should handle access on fixed-size array', () => {
      const Coords = r.array(r.f64, 3);
      const coords = [1.5, 2.5, 3.5];
      const bytes = r.encode(Coords, coords);
      const proxy = r.access(Coords, bytes);

      expect(proxy.length).toBe(3);
      expect(proxy[0]).toBe(1.5);
      expect(proxy[1]).toBe(2.5);
      expect(proxy[2]).toBe(3.5);
    });

    it('should handle access on tuple', () => {
      const Pair = r.tuple(r.string, r.u32);
      const pair: [string, number] = ['hello', 42];
      const bytes = r.encode(Pair, pair);
      const proxy = r.access(Pair, bytes);

      expect(proxy.length).toBe(2);
      expect(proxy[0]).toBe('hello');
      expect(proxy[1]).toBe(42);
    });

    it('should handle access on taggedEnum', () => {
      const Message = r.taggedEnum<{
        Quit: undefined;
        Move: { x: number; y: number };
      }>({
        Quit: r.unit,
        Move: r.object({ x: r.i32, y: r.i32 }),
      });

      // Unit variant
      const quit = { tag: 'Quit' as const, value: undefined };
      const quitBytes = r.encode(Message, quit);
      const quitProxy = r.access(Message, quitBytes);
      expect(quitProxy.tag).toBe('Quit');
      expect(quitProxy.value).toBeUndefined();

      // Struct variant
      const move = { tag: 'Move' as const, value: { x: 10, y: 20 } };
      const moveBytes = r.encode(Message, move);
      const moveProxy = r.access(Message, moveBytes);

      assert(moveProxy.tag === 'Move');
      expect(moveProxy.value.x).toBe(10);
      expect(moveProxy.value.y).toBe(20);
    });

    it('should handle deeply nested access', () => {
      const Inner = r.object({
        data: r.vec(r.u32),
      });
      const Outer = r.object({
        items: r.vec(Inner),
      });

      const data = {
        items: [
          { data: [1, 2, 3] },
          { data: [4, 5, 6] },
          { data: [7, 8, 9] },
        ],
      };
      const bytes = r.encode(Outer, data);
      const proxy = r.access(Outer, bytes);

      // Deep access through proxies
      expect(proxy.items[0].data[0]).toBe(1);
      expect(proxy.items[1].data[2]).toBe(6);
      expect(proxy.items[2].data[1]).toBe(8);
    });
  });
});
