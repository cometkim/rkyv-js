import * as assert from 'node:assert';
import { describe, it } from 'node:test';

import * as r from '#src/index.ts';
import { format } from '#src/core/format.ts';
import { btreeMap, btreeSet } from '#src/lib/btreemap.ts';
import { bytes } from '#src/lib/bytes.ts';
import { hashMap, hashSet } from '#src/lib/hashmap.ts';
import { indexMap, indexSet } from '#src/lib/indexmap.ts';
import { uuid } from '#src/lib/uuid.ts';

function hex(data: Uint8Array): string {
  return [...data].map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

describe('Codec API', () => {
  describe('primitives', () => {
    it('roundtrips u32', () => {
      const data = r.u32.encode(0xdeadbeef);
      assert.strictEqual(r.u32.decode(data), 0xdeadbeef);
    });

    it('roundtrips f64', () => {
      const data = r.f64.encode(3.14159);
      assert.strictEqual(r.f64.decode(data), 3.14159);
    });

    it('roundtrips u64 as bigint', () => {
      const data = r.u64.encode(0x1122_3344_5566_7788n);
      assert.strictEqual(r.u64.decode(data), 0x1122_3344_5566_7788n);
    });

    it('roundtrips bool', () => {
      assert.strictEqual(r.bool.decode(r.bool.encode(true)), true);
      assert.strictEqual(r.bool.decode(r.bool.encode(false)), false);
    });

    it('roundtrips char (BMP and astral)', () => {
      assert.strictEqual(r.char.decode(r.char.encode('A')), 'A');
      assert.strictEqual(r.char.decode(r.char.encode('한')), '한');
      assert.strictEqual(r.char.decode(r.char.encode('🚀')), '🚀');
    });

    it('rejects multi-character char values', () => {
      assert.throws(() => r.char.encode('ab'));
      assert.throws(() => r.char.encode(''));
    });

    it('roundtrips inline string (<= 8 bytes)', () => {
      const data = r.string.encode('hi');
      assert.strictEqual(data.length, 8);
      assert.strictEqual(r.string.decode(data), 'hi');
    });

    it('roundtrips out-of-line string (> 8 bytes)', () => {
      const value = 'the quick brown fox jumps over the lazy dog';
      assert.strictEqual(r.string.decode(r.string.encode(value)), value);
    });

    it('roundtrips multibyte strings across the inline boundary', () => {
      for (const value of ['', 'a', '12345678', '123456789', '한국어', '🚀🚀🚀']) {
        assert.strictEqual(r.string.decode(r.string.encode(value)), value, JSON.stringify(value));
      }
    });
  });

  describe('r.vec', () => {
    it('roundtrips vec of u32', () => {
      const codec = r.vec(r.u32);
      assert.deepStrictEqual(codec.decode(codec.encode([1, 2, 3, 4, 5])), [1, 2, 3, 4, 5]);
    });

    it('encodes an empty root vec exactly like rkyv', () => {
      // Verified against rkyv 0.8.14: ptr offset 0, len 0.
      assert.strictEqual(hex(r.vec(r.u32).encode([])), '00 00 00 00 00 00 00 00');
    });

    it('roundtrips empty vec', () => {
      const codec = r.vec(r.u32);
      assert.deepStrictEqual(codec.decode(codec.encode([])), []);
    });

    it('roundtrips vec of strings', () => {
      const codec = r.vec(r.string);
      const value = ['short', 'a much longer string that goes out of line', ''];
      assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
    });

    it('roundtrips nested vecs', () => {
      const codec = r.vec(r.vec(r.u16));
      const value = [[1], [], [2, 3, 4]];
      assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
    });
  });

  describe('r.option', () => {
    it('roundtrips Some value', () => {
      const codec = r.option(r.u32);
      assert.strictEqual(codec.decode(codec.encode(42)), 42);
    });

    it('roundtrips None', () => {
      const codec = r.option(r.u32);
      assert.strictEqual(codec.decode(codec.encode(null)), null);
    });

    it('roundtrips Option<String>', () => {
      const codec = r.option(r.string);
      assert.strictEqual(codec.decode(codec.encode('maybe not inline, quite long')), 'maybe not inline, quite long');
      assert.strictEqual(codec.decode(codec.encode(null)), null);
    });

    it('roundtrips nested options', () => {
      const codec = r.option(r.option(r.u8));
      assert.strictEqual(codec.decode(codec.encode(7)), 7);
      assert.strictEqual(codec.decode(codec.encode(null)), null);
    });
  });

  describe('r.struct', () => {
    it('roundtrips simple struct', () => {
      const Point = r.struct({ x: r.f64, y: r.f64 });
      const value = { x: 1.5, y: -2.5 };
      assert.deepStrictEqual(Point.decode(Point.encode(value)), value);
    });

    it('roundtrips struct with mixed field alignments', () => {
      const codec = r.struct({ a: r.u8, b: r.u32, c: r.u8, d: r.u64 });
      const value = { a: 1, b: 2, c: 3, d: 4n };
      assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
    });

    it('roundtrips complex nested struct', () => {
      const Person = r.struct({
        name: r.string,
        age: r.u32,
        email: r.option(r.string),
        scores: r.vec(r.u32),
        active: r.bool,
      });
      const value = {
        name: 'Alice',
        age: 30,
        email: 'alice@example.com',
        scores: [95, 87, 92],
        active: true,
      };
      assert.deepStrictEqual(Person.decode(Person.encode(value)), value);
    });

    it('exposes fields metadata', () => {
      const Point = r.struct({ x: r.f64, y: r.f64 });
      assert.deepStrictEqual(
        Point.fields.map((f) => f.name),
        ['x', 'y'],
      );
    });
  });

  describe('r.taggedEnum', () => {
    const Message = r.taggedEnum({
      Quit: null,
      Move: { x: r.i32, y: r.i32 },
      Write: r.string,
      ChangeColor: { _0: r.u8, _1: r.u8, _2: r.u8 },
    });

    it('roundtrips unit variant', () => {
      const data = Message.encode({ tag: 'Quit', value: null });
      assert.deepStrictEqual(Message.decode(data), { tag: 'Quit', value: null });
    });

    it('roundtrips record variant', () => {
      const data = Message.encode({ tag: 'Move', value: { x: -3, y: 14 } });
      assert.deepStrictEqual(Message.decode(data), { tag: 'Move', value: { x: -3, y: 14 } });
    });

    it('roundtrips newtype variant', () => {
      const data = Message.encode({ tag: 'Write', value: 'hello out-of-line string!' });
      assert.deepStrictEqual(Message.decode(data), { tag: 'Write', value: 'hello out-of-line string!' });
    });

    it('roundtrips tuple-style record variant', () => {
      const data = Message.encode({ tag: 'ChangeColor', value: { _0: 255, _1: 128, _2: 0 } });
      assert.deepStrictEqual(Message.decode(data), {
        tag: 'ChangeColor',
        value: { _0: 255, _1: 128, _2: 0 },
      });
    });

    it('accepts struct codecs as variants (flattened layout, same value shape)', () => {
      const Legacy = r.taggedEnum({
        Quit: r.unit,
        Move: r.struct({ x: r.i32, y: r.i32 }),
      });
      const data = Legacy.encode({ tag: 'Move', value: { x: 1, y: 2 } });
      assert.deepStrictEqual(Legacy.decode(data), { tag: 'Move', value: { x: 1, y: 2 } });
      assert.deepStrictEqual(Legacy.decode(Legacy.encode({ tag: 'Quit', value: null })), {
        tag: 'Quit',
        value: null,
      });
    });

    it('lays out mixed-alignment variants exactly like rkyv (repr(u8) flattening)', () => {
      // enum MixedEnum { V { a: u8, b: u32 }, W(u64) }
      // Verified against rkyv 0.8.14: tag@0, a@1, b@4 — NOT a@4, b@8.
      const MixedEnum = r.taggedEnum({
        V: { a: r.u8, b: r.u32 },
        W: r.u64,
      });
      const v = MixedEnum.encode({ tag: 'V', value: { a: 0xaa, b: 0xdeadbeef } });
      assert.strictEqual(hex(v), '00 aa 00 00 ef be ad de 00 00 00 00 00 00 00 00');
      const w = MixedEnum.encode({ tag: 'W', value: 0x1122_3344_5566_7788n });
      assert.strictEqual(hex(w), '01 00 00 00 00 00 00 00 88 77 66 55 44 33 22 11');
      assert.deepStrictEqual(MixedEnum.decode(v), { tag: 'V', value: { a: 0xaa, b: 0xdeadbeef } });
      assert.deepStrictEqual(MixedEnum.decode(w), { tag: 'W', value: 0x1122_3344_5566_7788n });
    });

    it('supports exactly 256 variants and rejects more (rkyv derive limit)', () => {
      const max: Record<string, null> = {};
      for (let i = 0; i < 256; i++) max[`V${i}`] = null;
      const Max = r.taggedEnum(max);
      const data = Max.encode({ tag: 'V255', value: null });
      assert.strictEqual(data.length, 1);
      assert.deepStrictEqual(Max.decode(data), { tag: 'V255', value: null });

      const over: Record<string, null> = { ...max, V256: null };
      assert.throws(() => r.taggedEnum(over), /256/);
    });

    it('rejects unknown variants', () => {
      assert.throws(() => Message.encode({ tag: 'Nope', value: null } as never));
    });
  });

  describe('r.tuple', () => {
    it('roundtrips tuples', () => {
      const codec = r.tuple(r.u8, r.string, r.f64);
      const value: [number, string, number] = [7, 'seven', 7.7];
      assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
    });
  });

  describe('r.array', () => {
    it('roundtrips fixed-size arrays', () => {
      const codec = r.array(r.u16, 4);
      assert.deepStrictEqual(codec.decode(codec.encode([1, 2, 3, 4])), [1, 2, 3, 4]);
    });

    it('rejects length mismatches', () => {
      assert.throws(() => r.array(r.u16, 4).encode([1, 2]));
    });
  });

  describe('type inference', () => {
    it('infers value types from codecs', () => {
      const Person = r.struct({ name: r.string, age: r.u32 });
      type Person = r.Infer<typeof Person>;
      const p: Person = { name: 'x', age: 1 };
      assert.deepStrictEqual(Person.decode(Person.encode(p)), p);
    });
  });

  describe('r.transform', () => {
    it('maps values on encode/decode', () => {
      const date = r.transform(
        r.i64,
        (ms) => new Date(Number(ms)),
        (d) => BigInt(d.getTime()),
      );
      const value = new Date(1720000000000);
      assert.deepStrictEqual(date.decode(date.encode(value)), value);
    });
  });

  describe('r.lazy (recursive types)', () => {
    it('roundtrips recursive trees', () => {
      interface Tree {
        value: number;
        children: Tree[];
      }
      const Tree: r.Codec<Tree> = r.lazy(() =>
        r.struct({ value: r.u32, children: r.vec(Tree) }),
      ) as r.Codec<Tree>;
      const value: Tree = {
        value: 1,
        children: [
          { value: 2, children: [] },
          { value: 3, children: [{ value: 4, children: [] }] },
        ],
      };
      assert.deepStrictEqual(Tree.decode(Tree.encode(value)), value);
    });
  });

  describe('shared pointers', () => {
    it('r.rc is an alias for r.box', () => {
      assert.strictEqual(r.rc, r.box);
    });

    it('roundtrips box/rc', () => {
      const codec = r.box(r.string);
      assert.strictEqual(codec.decode(codec.encode('boxed value beyond inline')), 'boxed value beyond inline');
    });

    it('roundtrips rc in struct', () => {
      const codec = r.struct({ shared: r.rc(r.vec(r.u32)) });
      const value = { shared: [1, 2, 3] };
      assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
    });
  });

  describe('r.weak', () => {
    it('roundtrips live weak pointers', () => {
      const codec = r.weak(r.u32);
      assert.strictEqual(codec.decode(codec.encode(42)), 42);
    });

    it('encodes a dead weak pointer as the invalid sentinel (raw offset 1)', () => {
      // Verified against rkyv 0.8.14 (RelPtr::emplace_invalid).
      const codec = r.weak(r.u32);
      const data = codec.encode(null);
      assert.strictEqual(hex(data), '01 00 00 00');
      assert.strictEqual(codec.decode(data), null);
    });

    it('roundtrips weak in struct', () => {
      const codec = r.struct({ parent: r.weak(r.string), name: r.string });
      const some = { parent: 'a long enough string to leave inline range', name: 'n' };
      assert.deepStrictEqual(codec.decode(codec.encode(some)), some);
      const none = { parent: null, name: 'n' };
      assert.deepStrictEqual(codec.decode(codec.encode(none)), none);
    });
  });

  describe('access (lazy views)', () => {
    const Person = r.struct({
      name: r.string,
      age: r.u32,
      scores: r.vec(r.u32),
      address: r.struct({ city: r.string, zip: r.u32 }),
    });
    const value = {
      name: 'Alice',
      age: 30,
      scores: [10, 20, 30],
      address: { city: 'Seoul', zip: 12345 },
    };

    it('reads struct fields lazily', () => {
      const lazy = Person.access(Person.encode(value));
      assert.strictEqual(lazy.name, 'Alice');
      assert.strictEqual(lazy.age, 30);
    });

    it('memoizes accessed fields as own properties', () => {
      const lazy = Person.access(Person.encode(value));
      assert.deepStrictEqual(Object.keys(lazy), []);
      void lazy.name;
      assert.deepStrictEqual(Object.keys(lazy), ['name']);
      // Repeated access returns the same value.
      assert.strictEqual(lazy.name, 'Alice');
    });

    it('exposes vec fields as LazyList views', () => {
      const lazy = Person.access(Person.encode(value));
      const scores = lazy.scores;
      assert.strictEqual(scores.length, 3);
      assert.strictEqual(scores.at(1), 20);
      assert.strictEqual(scores.at(99), undefined);
      assert.deepStrictEqual([...scores], [10, 20, 30]);
      assert.deepStrictEqual(scores.toArray(), [10, 20, 30]);
    });

    it('nests lazily', () => {
      const lazy = Person.access(Person.encode(value));
      assert.strictEqual(lazy.address.city, 'Seoul');
    });

    it('serializes views through JSON.stringify via toJSON', () => {
      const lazy = Person.access(Person.encode(value));
      assert.deepStrictEqual(JSON.parse(JSON.stringify(lazy)), JSON.parse(JSON.stringify(value)));
    });

    it('supports lazy access through enums', () => {
      const E = r.taggedEnum({ A: { items: r.vec(r.u32) }, B: null });
      const lazy = E.access(E.encode({ tag: 'A', value: { items: [1, 2] } }));
      assert.strictEqual(lazy.tag, 'A');
      if (lazy.tag === 'A') {
        assert.strictEqual(lazy.value.items.at(0), 1);
      }
    });

    it('access on fixed arrays returns a LazyList', () => {
      const codec = r.array(r.u16, 3);
      const lazy = codec.access(codec.encode([5, 6, 7]));
      assert.strictEqual(lazy.length, 3);
      assert.strictEqual(lazy.at(2), 7);
    });
  });

  describe('built-in crates', () => {
    describe('std::collections::BTreeMap', () => {
      it('roundtrips string keys', () => {
        const codec = btreeMap(r.string, r.u32);
        const value = new Map([
          ['apple', 1],
          ['banana', 2],
          ['cherry', 3],
        ]);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
      });

      it('roundtrips empty map', () => {
        const codec = btreeMap(r.string, r.u32);
        assert.deepStrictEqual(codec.decode(codec.encode(new Map())), new Map());
      });

      it('sorts unsorted input by key', () => {
        const codec = btreeMap(r.u32, r.string);
        const value = new Map([
          [3, 'c'],
          [1, 'a'],
          [2, 'b'],
        ]);
        const decoded = codec.decode(codec.encode(value));
        assert.deepStrictEqual([...decoded.keys()], [1, 2, 3]);
        assert.strictEqual(decoded.get(1), 'a');
      });

      it('handles maps larger than the branching factor', () => {
        const codec = btreeMap(r.u32, r.u32);
        const value = new Map<number, number>();
        for (let i = 0; i < 23; i++) value.set(i, i * 100);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
      });

      it('roundtrips btreeSet', () => {
        const codec = btreeSet(r.string);
        const value = new Set(['x', 'y', 'z']);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
      });
    });

    describe('uuid', () => {
      it('roundtrips UUIDs', () => {
        const value = '550e8400-e29b-41d4-a716-446655440000';
        assert.strictEqual(uuid.decode(uuid.encode(value)), value);
      });

      it('encodes to 16 bytes', () => {
        assert.strictEqual(uuid.encode('550e8400-e29b-41d4-a716-446655440000').length, 16);
      });

      it('is hashable (usable as a map key)', () => {
        const codec = hashMap(uuid, r.u32);
        const value = new Map([
          ['550e8400-e29b-41d4-a716-446655440000', 1],
          ['6ba7b810-9dad-11d1-80b4-00c04fd430c8', 2],
        ]);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
      });
    });

    describe('bytes', () => {
      it('roundtrips byte payloads', () => {
        const value = new Uint8Array([1, 2, 3, 250, 251, 252]);
        assert.deepStrictEqual(new Uint8Array(bytes.decode(bytes.encode(value))), value);
      });

      it('roundtrips empty payloads', () => {
        assert.strictEqual(bytes.decode(bytes.encode(new Uint8Array())).length, 0);
      });

      it('works in struct', () => {
        const codec = r.struct({ payload: bytes, name: r.string });
        const value = { payload: new Uint8Array([9, 8, 7]), name: 'msg' };
        const decoded = codec.decode(codec.encode(value));
        assert.deepStrictEqual(new Uint8Array(decoded.payload), value.payload);
        assert.strictEqual(decoded.name, 'msg');
      });
    });

    describe('indexMap / indexSet', () => {
      it('roundtrips and preserves insertion order', () => {
        const codec = indexMap(r.string, r.u32);
        const value = new Map([
          ['zebra', 1],
          ['apple', 2],
          ['mango', 3],
        ]);
        const decoded = codec.decode(codec.encode(value));
        assert.deepStrictEqual([...decoded.entries()], [...value.entries()]);
      });

      it('roundtrips empty maps', () => {
        const codec = indexMap(r.string, r.u32);
        assert.deepStrictEqual(codec.decode(codec.encode(new Map())), new Map());
      });

      it('supports integer keys', () => {
        const codec = indexMap(r.u32, r.string);
        const value = new Map([
          [42, 'a'],
          [7, 'b'],
        ]);
        assert.deepStrictEqual([...codec.decode(codec.encode(value)).entries()], [...value.entries()]);
      });

      it('roundtrips indexSet preserving order', () => {
        const codec = indexSet(r.string);
        const value = new Set(['c', 'a', 'b']);
        assert.deepStrictEqual([...codec.decode(codec.encode(value))], ['c', 'a', 'b']);
      });
    });

    describe('hashMap / hashSet', () => {
      it('roundtrips string keys', () => {
        const codec = hashMap(r.string, r.u32);
        const value = new Map<string, number>();
        for (let i = 0; i < 50; i++) value.set(`key_${i}`, i * 10);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
      });

      it('roundtrips integer keys', () => {
        const codec = hashMap(r.u32, r.u32);
        const value = new Map<number, number>();
        for (let i = 0; i < 100; i++) value.set(i * 7 + 1, i);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
      });

      it('roundtrips u64 keys', () => {
        const codec = hashMap(r.u64, r.string);
        const value = new Map([
          [1n, 'one'],
          [0xffff_ffff_ffff_ffffn, 'max'],
        ]);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
      });

      it('roundtrips composite (tuple) keys', () => {
        const codec = hashMap(r.tuple(r.string, r.u32), r.bool);
        const value = new Map<[string, number], boolean>([
          [['a', 1], true],
          [['b', 2], false],
        ]);
        const decoded = codec.decode(codec.encode(value));
        assert.deepStrictEqual([...decoded.entries()].sort(), [...value.entries()].sort());
      });

      it('roundtrips empty maps', () => {
        const codec = hashMap(r.string, r.u32);
        assert.deepStrictEqual(codec.decode(codec.encode(new Map())), new Map());
      });

      it('roundtrips hashSet', () => {
        const codec = hashSet(r.string);
        const value = new Set(['alpha', 'beta', 'gamma']);
        assert.deepStrictEqual(codec.decode(codec.encode(value)), value);
      });

      it('rejects unhashable key codecs at construction', () => {
        assert.throws(() => hashMap(r.f32, r.u32), /hashable/);
        assert.throws(() => hashSet(r.vec(r.u8)), /hashable/);
      });
    });
  });

  describe('formats', () => {
    it('roundtrips under big-endian', () => {
      const be = format({ endian: 'big' });
      const codec = r.struct({ a: r.u32, s: r.string, xs: r.vec(r.u16) });
      const value = { a: 0x12345678, s: 'endian test string, long enough', xs: [1, 2, 3] };
      assert.deepStrictEqual(codec.decode(codec.encode(value, be), be), value);
    });

    it('roundtrips under pointerWidth 64', () => {
      const pw64 = format({ pointerWidth: 64 });
      const codec = r.struct({ s: r.string, xs: r.vec(r.u32) });
      const value = { s: 'a string exceeding even the 16-byte inline capacity', xs: [7, 8] };
      assert.deepStrictEqual(codec.decode(codec.encode(value, pw64), pw64), value);
    });

    it('roundtrips under pointerWidth 16', () => {
      const pw16 = format({ pointerWidth: 16 });
      const codec = r.vec(r.string);
      const value = ['aa', 'a longer string beyond four bytes'];
      assert.deepStrictEqual(codec.decode(codec.encode(value, pw16), pw16), value);
    });

    it('roundtrips under unaligned', () => {
      const packed = format({ aligned: false });
      const codec = r.struct({ a: r.u8, b: r.u32, c: r.u64 });
      const value = { a: 1, b: 2, c: 3n };
      assert.deepStrictEqual(codec.decode(codec.encode(value, packed), packed), value);
      // Packed: 1 + 4 + 8 bytes with no padding.
      assert.strictEqual(codec.encode(value, packed).length, 13);
    });

    it('withFormat pins the default format', () => {
      const be = format({ endian: 'big' });
      const codec = r.withFormat(r.u32, be);
      const data = codec.encode(0x12345678);
      assert.strictEqual(hex(data), '12 34 56 78');
      assert.strictEqual(codec.decode(data), 0x12345678);
    });
  });

  describe('encodeInto (writer reuse)', () => {
    it('supports pooled writers via reset()', () => {
      const writer = new r.RkyvWriter();
      const codec = r.struct({ n: r.u32 });
      const a = codec.encodeInto(writer, { n: 1 }).slice();
      writer.reset();
      const b = codec.encodeInto(writer, { n: 2 }).slice();
      assert.deepStrictEqual(codec.decode(a), { n: 1 });
      assert.deepStrictEqual(codec.decode(b), { n: 2 });
    });
  });
});
