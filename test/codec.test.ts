import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { r, type RkyvCodec } from 'rkyv-js';
import { uuid as uuidCodec } from 'rkyv-js/lib/uuid';
import { bytes as bytesCodec } from 'rkyv-js/lib/bytes';
import { indexMap, indexSet } from 'rkyv-js/lib/indexmap';

describe('Codec API', () => {
  describe('primitives', () => {
    it('should encode and decode u32', () => {
      const bytes = r.encode(r.u32, 42);
      const value = r.decode(r.u32, bytes);
      assert.strictEqual(value, 42);
    });

    it('should encode and decode f64', () => {
      const bytes = r.encode(r.f64, 3.14159);
      const value = r.decode(r.f64, bytes);
      assert.strictEqual(value, 3.14159);
    });

    it('should encode and decode bool', () => {
      const bytes = r.encode(r.bool, true);
      const value = r.decode(r.bool, bytes);
      assert.strictEqual(value ,true);
    });

    it('should encode and decode string', () => {
      const bytes = r.encode(r.string, 'hello');
      const value = r.decode(r.string, bytes);
      assert.strictEqual(value, 'hello');
    });

    it('should encode and decode long string (out-of-line)', () => {
      const longStr = 'This is a very long string that exceeds 8 bytes';
      const bytes = r.encode(r.string, longStr);
      const value = r.decode(r.string, bytes);
      assert.strictEqual(value, longStr);
    });
  });

  describe('r.vec', () => {
    it('should encode and decode vec of u32', () => {
      const arr = [1, 2, 3, 4, 5];
      const codec = r.vec(r.u32);
      const bytes = r.encode(codec, arr);
      const value = r.decode(codec, bytes);
      assert.deepStrictEqual(value, arr);
    });

    it('should encode and decode empty vec', () => {
      const codec = r.vec(r.u32);
      const bytes = r.encode(codec, []);
      const value = r.decode(codec, bytes);
      assert.deepStrictEqual(value, []);
    });

    it('should encode and decode vec of strings', () => {
      const arr = ['hello', 'world'];
      const codec = r.vec(r.string);
      const bytes = r.encode(codec, arr);
      const value = r.decode(codec, bytes);
      assert.deepStrictEqual(value, arr);
    });
  });

  describe('r.option', () => {
    it('should encode and decode Some value', () => {
      const codec = r.option(r.u32);
      const bytes = r.encode(codec, 42);
      const value = r.decode(codec, bytes);
      assert.strictEqual(value, 42);
    });

    it('should encode and decode None', () => {
      const codec = r.option(r.u32);
      const bytes = r.encode(codec, null);
      const value = r.decode(codec, bytes);
      assert.strictEqual(value, null);
    });
  });

  describe('r.struct', () => {
    it('should encode and decode simple struct', () => {
      const Point = r.struct({
        x: r.f64,
        y: r.f64,
      });

      const point = { x: 1.5, y: 2.5 };
      const bytes = r.encode(Point, point);
      const decoded = r.decode(Point, bytes);
      assert.deepStrictEqual(decoded, point);
    });

    it('should encode and decode struct with string', () => {
      const Person = r.struct({
        name: r.string,
        age: r.u32,
      });

      const person = { name: 'Alice', age: 30 };
      const bytes = r.encode(Person, person);
      const decoded = r.decode(Person, bytes);
      assert.deepStrictEqual(decoded, person);
    });

    it('should encode and decode complex struct', () => {
      const Person = r.struct({
        name: r.string,
        age: r.u32,
        email: r.option(r.string),
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
      assert.deepStrictEqual(decoded, person);
    });
  });

  describe('r.taggedEnum', () => {
    it('should encode and decode unit variant', () => {
      const Message = r.taggedEnum({
        Quit: r.unit,
        Move: r.struct({ x: r.i32, y: r.i32 }),
      });

      const value = { tag: 'Quit' as const, value: null };
      const bytes = r.encode(Message, value);
      const decoded = r.decode(Message, bytes);
      assert.strictEqual(decoded.tag, 'Quit');
    });

    it('should encode and decode struct variant', () => {
      const Message = r.taggedEnum({
        Quit: r.unit,
        Move: r.struct({ x: r.i32, y: r.i32 }),
      });

      const value = { tag: 'Move' as const, value: { x: 10, y: 20 } };
      const bytes = r.encode(Message, value);
      const decoded = r.decode(Message, bytes);
      assert.deepStrictEqual(decoded, value);
    });
  });

  describe('r.tuple', () => {
    it('should encode and decode tuple', () => {
      const codec = r.tuple(r.u32, r.string, r.bool);
      const value: r.infer<typeof codec> = [42, 'hello', true];
      const bytes = r.encode(codec, value);
      const decoded = r.decode(codec, bytes);
      assert.deepStrictEqual(decoded, value);
    });
  });

  describe('r.array (fixed-size)', () => {
    it('should encode and decode fixed-size array', () => {
      const codec = r.array(r.u32, 3);
      const value = [1, 2, 3];
      const bytes = r.encode(codec, value);
      const decoded = r.decode(codec, bytes);
      assert.deepStrictEqual(decoded, value);
    });
  });

  describe('type inference', () => {
    it('should infer types correctly', () => {
      const Person = r.struct({
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
      assert.deepStrictEqual(decoded.name, 'Alice');
      assert.deepStrictEqual(decoded.age, 30);
      assert.deepStrictEqual(decoded.scores, [100, 95]);
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
      assert.strictEqual(decoded.getTime(), date.getTime());
    });
  });

  describe('r.lazy (recursive types)', () => {
    it('should handle recursive types', () => {
      interface TreeNode {
        value: number;
        children: TreeNode[];
      }

      const TreeNode: RkyvCodec<TreeNode> = r.lazy(() =>
        r.struct({
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
      assert.deepStrictEqual(decoded, tree);
    });
  });

  describe('r.access (lazy access)', () => {
    it('should lazily access object fields', () => {
      const Person = r.struct({
        name: r.string,
        age: r.u32,
        email: r.option(r.string),
      });

      const person = { name: 'Alice', age: 30, email: 'alice@example.com' };
      const bytes = r.encode(Person, person);
      const proxy = r.access(Person, bytes);

      // Access individual fields
      assert.strictEqual(proxy.name, 'Alice');
      assert.strictEqual(proxy.age, 30);
      assert.strictEqual(proxy.email, 'alice@example.com');
    });

    it('should lazily access vec elements', () => {
      const Numbers = r.vec(r.u32);
      const arr = [10, 20, 30, 40, 50];
      const bytes = r.encode(Numbers, arr);
      const proxy = r.access(Numbers, bytes);

      // Access individual elements
      assert.strictEqual(proxy.length, 5);
      assert.strictEqual(proxy[0], 10);
      assert.strictEqual(proxy[2], 30);
      assert.strictEqual(proxy[4], 50);

      // Test 'in' operator
      assert.ok(0 in proxy);
      assert.ok(4 in proxy);
      assert.ok(!(5 in proxy));
    });

    it('should lazily access nested objects', () => {
      const Inner = r.struct({
        value: r.u32,
        text: r.string,
      });

      const Outer = r.struct({
        id: r.u32,
        inner: Inner,
      });

      const data = { id: 1, inner: { value: 42, text: 'nested' } };
      const bytes = r.encode(Outer, data);
      const proxy = r.access(Outer, bytes);

      assert.strictEqual(proxy.id, 1);
      assert.strictEqual(proxy.inner.value, 42);
      assert.strictEqual(proxy.inner.text, 'nested');
    });

    it('should lazily access vec of objects', () => {
      const Point = r.struct({ x: r.f64, y: r.f64 });
      const Points = r.vec(Point);

      const points = [
        { x: 1.0, y: 2.0 },
        { x: 3.0, y: 4.0 },
        { x: 5.0, y: 6.0 },
      ];
      const bytes = r.encode(Points, points);
      const proxy = r.access(Points, bytes);

      assert.strictEqual(proxy.length, 3);
      assert.strictEqual(proxy[0].x, 1.0);
      assert.strictEqual(proxy[1].y, 4.0);
      assert.strictEqual(proxy[2].x, 5.0);
    });

    it('should support iteration over vec proxy', () => {
      const Numbers = r.vec(r.u32);
      const arr = [1, 2, 3];
      const bytes = r.encode(Numbers, arr);
      const proxy = r.access(Numbers, bytes);

      // Test spread operator
      assert.deepStrictEqual([...proxy], [1, 2, 3]);

      // Test for...of
      const collected: number[] = [];
      for (const n of proxy) {
        collected.push(n);
      }
      assert.deepStrictEqual(collected, [1, 2, 3]);
    });

    it('should support Object.keys on object proxy', () => {
      const Person = r.struct({
        name: r.string,
        age: r.u32,
      });

      const person = { name: 'Bob', age: 25 };
      const bytes = r.encode(Person, person);
      const proxy = r.access(Person, bytes);

      assert.deepStrictEqual(Object.keys(proxy), ['name', 'age']);
    });

    it('should cache accessed fields (not re-decode)', () => {
      const Person = r.struct({
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
      assert.strictEqual(name1, 'Cache');
      assert.strictEqual(name2, 'Cache');
      assert.strictEqual(name3, 'Cache');
      // Note: We can't easily test that it's cached without internal access,
      // but the API contract is that it should be cached
    });

    it('should handle access on fixed-size array', () => {
      const Coords = r.array(r.f64, 3);
      const coords = [1.5, 2.5, 3.5];
      const bytes = r.encode(Coords, coords);
      const proxy = r.access(Coords, bytes);

      assert.strictEqual(proxy.length, 3);
      assert.strictEqual(proxy[0], 1.5);
      assert.strictEqual(proxy[1], 2.5);
      assert.strictEqual(proxy[2], 3.5);
    });

    it('should handle access on tuple', () => {
      const Pair = r.tuple(r.string, r.u32);
      const pair: r.infer<typeof Pair> = ['hello', 42];
      const bytes = r.encode(Pair, pair);
      const proxy = r.access(Pair, bytes);

      assert.strictEqual(proxy.length, 2);
      assert.strictEqual(proxy[0], 'hello');
      assert.strictEqual(proxy[1], 42);
    });

    it('should handle access on taggedEnum', () => {
      const Message = r.taggedEnum({
        Quit: r.unit,
        Move: r.struct({ x: r.i32, y: r.i32 }),
      });

      // Unit variant
      const quit = { tag: 'Quit' as const, value: null };
      const quitBytes = r.encode(Message, quit);
      const quitProxy = r.access(Message, quitBytes);
      assert.strictEqual(quitProxy.tag, 'Quit');
      assert.strictEqual(quitProxy.value, null);

      // Struct variant
      const move = { tag: 'Move' as const, value: { x: 10, y: 20 } };
      const moveBytes = r.encode(Message, move);
      const moveProxy = r.access(Message, moveBytes);

      assert.ok(moveProxy.tag === 'Move');
      assert.strictEqual(moveProxy.value.x, 10);
      assert.strictEqual(moveProxy.value.y, 20);
    });

    it('should handle deeply nested access', () => {
      const Inner = r.struct({
        data: r.vec(r.u32),
      });
      const Outer = r.struct({
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
      assert.strictEqual(proxy.items[0].data[0], 1);
      assert.strictEqual(proxy.items[1].data[2], 6);
      assert.strictEqual(proxy.items[2].data[1], 8);
    });
  });

  describe('shared pointers (r.rc, r.arc)', () => {
    it('r.rc and r.arc are aliases for r.box', () => {
      // They all have the same binary format
      assert.strictEqual(r.rc, r.box);
      assert.strictEqual(r.arc, r.box);
    });

    it('should work in struct with Arc', () => {
      const ArcShared = r.struct({
        shared_data: r.arc(r.string),
        local_data: r.u32,
      });
      const value = {
        shared_data: 'shared-value',
        local_data: 42,
      };
      const bytes = r.encode(ArcShared, value);
      const decoded = r.decode(ArcShared, bytes);
      assert.deepStrictEqual(decoded, value);
    });
  });

  describe('r.weak (weak reference)', () => {
    it('should encode and decode non-null Weak<T>', () => {
      const codec = r.weak(r.u32);
      const bytes = r.encode(codec, 42);
      const decoded = r.decode(codec, bytes);
      assert.strictEqual(decoded, 42);
    });

    it('should encode and decode null Weak<T>', () => {
      const codec = r.weak(r.u32);
      const bytes = r.encode(codec, null);
      const decoded = r.decode(codec, bytes);
      assert.strictEqual(decoded, null);
    });

    it('should encode and decode Weak<string>', () => {
      const codec = r.weak(r.string);
      const bytes = r.encode(codec, 'weak-ref');
      const decoded = r.decode(codec, bytes);
      assert.strictEqual(decoded, 'weak-ref');
    });

    it('should work in struct', () => {
      const WithWeak = r.struct({
        data: r.weak(r.u32),
        id: r.u32,
      });

      // Non-null case
      const value1 = { data: 100, id: 1 };
      const bytes1 = r.encode(WithWeak, value1);
      const decoded1 = r.decode(WithWeak, bytes1);
      assert.deepStrictEqual(decoded1, value1);

      // Null case
      const value2 = { data: null, id: 2 };
      const bytes2 = r.encode(WithWeak, value2);
      const decoded2 = r.decode(WithWeak, bytes2);
      assert.deepStrictEqual(decoded2, value2);
    });

    it('r.rcWeak and r.arcWeak are aliases for r.weak', () => {
      assert.strictEqual(r.rcWeak, r.weak);
      assert.strictEqual(r.arcWeak, r.weak);
    });
  });

  describe('r.btreeMap', () => {
    it('should encode and decode BTreeMap', () => {
      const codec = r.btreeMap(r.string, r.u32);
      const map = new Map([
        ['alpha', 1],
        ['beta', 2],
        ['gamma', 3],
      ]);
      const bytes = r.encode(codec, map);
      const decoded = r.decode(codec, bytes);
      assert.deepStrictEqual(decoded, map);
    });

    it('should handle empty BTreeMap', () => {
      const codec = r.btreeMap(r.string, r.u32);
      const map = new Map<string, number>();
      const bytes = r.encode(codec, map);
      const decoded = r.decode(codec, bytes);
      assert.strictEqual(decoded.size, 0);
    });

    it('should work with numeric keys', () => {
      const codec = r.btreeMap(r.u32, r.string);
      const map = new Map([
        [1, 'one'],
        [2, 'two'],
        [3, 'three'],
      ]);
      const bytes = r.encode(codec, map);
      const decoded = r.decode(codec, bytes);
      assert.deepStrictEqual(decoded, map);
    });

    it('should handle larger maps (more than E entries)', () => {
      const codec = r.btreeMap(r.u32, r.u32);
      const map = new Map<number, number>();
      for (let i = 0; i < 20; i++) {
        map.set(i, i * 10);
      }
      const bytes = r.encode(codec, map);
      const decoded = r.decode(codec, bytes);
      assert.strictEqual(decoded.size, 20);
      for (let i = 0; i < 20; i++) {
        assert.strictEqual(decoded.get(i), i * 10);
      }
    });

    it('should work in struct', () => {
      const Config = r.struct({
        settings: r.btreeMap(r.string, r.u32),
        version: r.u32,
      });
      const config = {
        settings: new Map([
          ['timeout', 30],
          ['retries', 3],
        ]),
        version: 1,
      };
      const bytes = r.encode(Config, config);
      const decoded = r.decode(Config, bytes);
      assert.deepStrictEqual(decoded.settings, config.settings);
      assert.strictEqual(decoded.version, config.version);
    });
  });

  describe('built-in crates', () => {
    describe('uuid', () => {
      it('should encode and decode UUID', () => {
        const uuid = '550e8400-e29b-41d4-a716-446655440000';
        const bytes = r.encode(uuidCodec, uuid);
        const decoded = r.decode(uuidCodec, bytes);
        assert.strictEqual(decoded, uuid);
      });

      it('should encode UUID to 16 bytes', () => {
        const uuid = '00000000-0000-0000-0000-000000000000';
        const bytes = r.encode(uuidCodec, uuid);
        assert.strictEqual(bytes.length, 16);
      });

      it('should work in struct', () => {
        const Record = r.struct({
          id: uuidCodec,
          name: r.string,
        });
        const record = {
          id: '123e4567-e89b-12d3-a456-426614174000',
          name: 'Test',
        };
        const bytes = r.encode(Record, record);
        const decoded = r.decode(Record, bytes);
        assert.deepStrictEqual(decoded, record);
      });
    });

    describe('bytes', () => {
      it('should encode and decode Uint8Array', () => {
        const data = new Uint8Array([1, 2, 3, 4, 5]);
        const bytes = r.encode(bytesCodec, data);
        const decoded = r.decode(bytesCodec, bytes);
        assert.deepStrictEqual(decoded, data);
      });

      it('should handle empty bytes', () => {
        const data = new Uint8Array([]);
        const bytes = r.encode(bytesCodec, data);
        const decoded = r.decode(bytesCodec, bytes);
        assert.deepStrictEqual(decoded, data);
      });

      it('should work in struct', () => {
        const Message = r.struct({
          payload: bytesCodec,
          checksum: r.u32,
        });
        const msg = {
          payload: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
          checksum: 12345,
        };
        const bytes = r.encode(Message, msg);
        const decoded = r.decode(Message, bytes);
        assert.deepStrictEqual(decoded.payload, msg.payload);
        assert.strictEqual(decoded.checksum, msg.checksum);
      });
    });

    describe('indexMap', () => {
      it('should encode and decode Map', () => {
        const codec = indexMap(r.string, r.u32);
        const map = new Map([
          ['a', 1],
          ['b', 2],
          ['c', 3],
        ]);
        const bytes = r.encode(codec, map);
        const decoded = r.decode(codec, bytes);
        assert.deepStrictEqual(decoded, map);
      });

      it('should preserve insertion order', () => {
        const codec = indexMap(r.string, r.u32);
        const map = new Map<string, number>();
        map.set('z', 1);
        map.set('a', 2);
        map.set('m', 3);
        const bytes = r.encode(codec, map);
        const decoded = r.decode(codec, bytes);

        // Check that keys are in same order
        const originalKeys = [...map.keys()];
        const decodedKeys = [...decoded.keys()];
        assert.deepStrictEqual(decodedKeys, originalKeys);
      });

      it('should handle empty Map', () => {
        const codec = indexMap(r.string, r.u32);
        const map = new Map<string, number>();
        const bytes = r.encode(codec, map);
        const decoded = r.decode(codec, bytes);
        assert.strictEqual(decoded.size, 0);
      });

      it('should work in struct', () => {
        const Config = r.struct({
          settings: indexMap(r.string, r.u32),
        });
        const config = {
          settings: new Map([
            ['timeout', 30],
            ['retries', 3],
          ]),
        };
        const bytes = r.encode(Config, config);
        const decoded = r.decode(Config, bytes);
        assert.deepStrictEqual(decoded.settings, config.settings);
      });
    });

    describe('indexSet', () => {
      it('should encode and decode Set', () => {
        const codec = indexSet(r.string);
        const set = new Set(['a', 'b', 'c']);
        const bytes = r.encode(codec, set);
        const decoded = r.decode(codec, bytes);
        assert.deepStrictEqual(decoded, set);
      });

      it('should preserve insertion order', () => {
        const codec = indexSet(r.string);
        const set = new Set<string>();
        set.add('z');
        set.add('a');
        set.add('m');
        const bytes = r.encode(codec, set);
        const decoded = r.decode(codec, bytes);

        // Check that values are in same order
        const originalValues = [...set];
        const decodedValues = [...decoded];
        assert.deepStrictEqual(decodedValues, originalValues);
      });

      it('should handle empty Set', () => {
        const codec = indexSet(r.u32);
        const set = new Set<number>();
        const bytes = r.encode(codec, set);
        const decoded = r.decode(codec, bytes);
        assert.strictEqual(decoded.size, 0);
      });

      it('should work with numeric values', () => {
        const codec = indexSet(r.u32);
        const set = new Set([1, 2, 3, 4, 5]);
        const bytes = r.encode(codec, set);
        const decoded = r.decode(codec, bytes);
        assert.deepStrictEqual(decoded, set);
      });
    });
  });
});
