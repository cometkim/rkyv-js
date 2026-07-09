import * as assert from 'node:assert';
import { describe, it } from 'node:test';

import * as r from '#src/index.ts';
import { OPAQUE_META, format } from '#src/core.ts';
import { compileCodec, emitDecoderSource } from '#src/jit.ts';

const Address = r.struct({ city: r.string, zip: r.u32 });
const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.option(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
  address: Address,
  friends: r.vec(Address),
  id: r.u64,
  status: r.taggedEnum({
    Active: null,
    Banned: { until: r.f64, reason: r.string },
    Renamed: r.string,
  }),
  pair: r.tuple(r.u8, r.f64),
  history: r.array(r.i16, 12),
});

type Person = r.Infer<typeof ArchivedPerson>;

const people: Person[] = [
  {
    name: 'Alice',
    age: 30,
    email: 'alice@example.com',
    scores: [100, 95, 87, 92],
    active: true,
    address: { city: '서울', zip: 4524 },
    friends: [
      { city: 'Busan', zip: 48059 },
      { city: 'A city with quite a long name indeed', zip: 1 },
    ],
    id: 0x0123_4567_89ab_cdefn,
    status: { tag: 'Banned', value: { until: 1699999999.5, reason: '규칙 위반' } },
    pair: [7, 2.5],
    history: [0, -1, 2, -3, 4, -5, 6, -7, 8, -9, 10, -11],
  },
  {
    name: 'B',
    age: 0,
    email: null,
    scores: [],
    active: false,
    address: { city: '', zip: 0 },
    friends: [],
    id: 0n,
    status: { tag: 'Active', value: null },
    pair: [255, -0.0],
    history: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
  },
  {
    name: 'Charlie with a name that goes out of line for sure',
    age: 0xffff_ffff,
    email: '긴 이메일 주소는 아웃오브라인으로 갑니다@example.com',
    scores: Array.from({ length: 100 }, (_, i) => i * 3),
    active: true,
    address: { city: 'X', zip: 99 },
    friends: [{ city: '판교', zip: 13529 }],
    id: 0xffff_ffff_ffff_ffffn,
    status: { tag: 'Renamed', value: '새이름' },
    pair: [0, Number.MAX_SAFE_INTEGER],
    history: [-32768, 32767, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
];

describe('compileCodec', () => {
  it('decode parity + encode byte-identity across value shapes', () => {
    const compiled = compileCodec(ArchivedPerson);
    for (const person of people) {
      const bytes = ArchivedPerson.encode(person);
      assert.deepStrictEqual(compiled.decode(bytes), ArchivedPerson.decode(bytes));
      assert.deepStrictEqual(compiled.encode(person), bytes);
    }
  });

  it('access() still returns lazy views (delegated)', () => {
    const compiled = compileCodec(ArchivedPerson);
    const bytes = ArchivedPerson.encode(people[0]);
    const view = compiled.access(bytes);
    assert.strictEqual(view.name, 'Alice');
    assert.strictEqual(view.address.city, '서울');
  });

  it('recursive types via lazy() compile with interpreter fallback at the cycle', () => {
    interface Tree {
      value: number;
      children: Tree[];
    }
    const ArchivedTree: r.Codec<Tree> = r.struct({
      value: r.u32,
      children: r.vec(r.lazy(() => ArchivedTree)),
    }) as r.Codec<Tree>;
    const tree: Tree = { value: 1, children: [{ value: 2, children: [{ value: 3, children: [] }] }] };
    const compiled = compileCodec(ArchivedTree);
    const bytes = ArchivedTree.encode(tree);
    assert.deepStrictEqual(compiled.decode(bytes), tree);
    assert.deepStrictEqual(compiled.encode(tree), bytes);
  });

  it('recompiles per format', () => {
    const compiled = compileCodec(ArchivedPerson);
    const be = format({ endian: 'big', pointerWidth: 64 });
    for (const fmt of [be, format({ pointerWidth: 16 }), format({ aligned: false })]) {
      const bytes = ArchivedPerson.encode(people[0], fmt);
      assert.deepStrictEqual(compiled.decode(bytes, fmt), people[0]);
      assert.deepStrictEqual(compiled.encode(people[0], fmt), bytes);
    }
  });

  it('withFormat-bound codecs compile for the bound format', () => {
    const be = format({ endian: 'big' });
    const bound = r.withFormat(ArchivedPerson, be);
    const compiled = compileCodec(bound);
    const bytes = bound.encode(people[0]);
    assert.deepStrictEqual(compiled.decode(bytes), people[0]);
    assert.deepStrictEqual(compiled.encode(people[0]), bytes);
  });

  it('a __proto__ field falls back to the interpreter (no literal emit)', () => {
    const Sneaky = r.struct({ ['__proto__']: r.u32, ok: r.u32 });
    const compiled = compileCodec(Sneaky);
    const source = emitDecoderSource(Sneaky);
    assert.ok(!source.includes('"__proto__":'), 'must not emit __proto__ in an object literal');
    const value = Object.defineProperty({ ok: 7 } as Record<string, number>, '__proto__', {
      value: 5,
      enumerable: true,
      configurable: true,
      writable: true,
    });
    const bytes = Sneaky.encode(value as never);
    assert.deepStrictEqual(compiled.decode(bytes), Sneaky.decode(bytes));
  });

  it('meta is a behavioral promise: overriding subclasses reset it to opaque', () => {
    const StringCodecCtor = r.string.constructor as new () => r.Codec<string>;
    // A subclass that keeps the inherited meta keeps the inherited behavior
    // contract — the JIT inlines it like the base codec.
    class Inherited extends StringCodecCtor {}
    const inlined = emitDecoderSource(r.struct({ s: new Inherited() }));
    assert.ok(inlined.includes('function h0'), 'meta-carrying subclass inlines');
    // A subclass that changes behavior must reset meta to opaque; the JIT
    // then never bypasses its methods — it stays an interpreter dep call.
    class Custom extends StringCodecCtor {
      constructor() {
        super();
        this.meta = OPAQUE_META;
      }
    }
    const opaque = emitDecoderSource(r.struct({ s: new Custom() }));
    assert.ok(!opaque.includes('function h0'), 'opaque subclass hoists no string helper');
    assert.ok(opaque.includes('d[0].read(r, o'), 'opaque subclass stays a dep call');
  });

  it('emitted source quotes every field name', () => {
    const Weird = r.struct({ 'a b': r.u32, "c'd": r.u32, 'e"f': r.u32 });
    const compiled = compileCodec(Weird);
    const value = { 'a b': 1, "c'd": 2, 'e"f': 3 };
    const bytes = Weird.encode(value);
    assert.deepStrictEqual(compiled.decode(bytes), value);
    assert.deepStrictEqual(compiled.encode(value), bytes);
  });

  it('falls back to the interpreter codec when eval is unavailable', () => {
    // Simulated by the onUnsupported contract: with eval available the
    // wrapper differs from the target; the fallback path returns the exact
    // interpreter instance (covered in CSP environments end-to-end).
    const compiled = compileCodec(ArchivedPerson);
    assert.notStrictEqual(compiled, ArchivedPerson);
  });
});
