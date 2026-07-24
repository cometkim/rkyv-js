import * as assert from 'node:assert';
import { describe, it } from 'node:test';

import type { AnyDecoder } from '#src/core/decoder.ts';
import type { AnyEncoder } from '#src/core/encoder.ts';
import * as r from '#src/index.ts';
import * as d from '#src/decode.ts';
import * as e from '#src/encode.ts';
import * as jit from '#src/jit.ts';
import { compileDecoder, emitDecoderSource } from '#src/jit.decode.ts';
import { compileEncoder, emitEncoderSource } from '#src/jit.encode.ts';

// The same schema in all three directions; shapes chosen to exercise the
// string helper, vec loops (primitive and mixed), inline struct batching,
// and an opaque (option) child.
const Full = r.struct({
  id: r.u32,
  name: r.string,
  pos: r.struct({ x: r.f64, y: r.f64 }),
  scores: r.vec(r.u32),
  friends: r.vec(r.struct({ name: r.string, close: r.u32 })),
  email: r.option(r.string),
  pair: r.tuple(r.u32, r.f64),
});
const DecodeOnly = d.struct({
  id: d.u32,
  name: d.string,
  pos: d.struct({ x: d.f64, y: d.f64 }),
  scores: d.vec(d.u32),
  friends: d.vec(d.struct({ name: d.string, close: d.u32 })),
  email: d.option(d.string),
  pair: d.tuple(d.u32, d.f64),
});
const EncodeOnly = e.struct({
  id: e.u32,
  name: e.string,
  pos: e.struct({ x: e.f64, y: e.f64 }),
  scores: e.vec(e.u32),
  friends: e.vec(e.struct({ name: e.string, close: e.u32 })),
  email: e.option(e.string),
  pair: e.tuple(e.u32, e.f64),
});

type Value = r.Infer<typeof Full>;

const values: Value[] = [
  {
    id: 1,
    name: 'inline',
    pos: { x: 1.5, y: -2.25 },
    scores: [1, 2, 3, 4],
    friends: [
      { name: 'a much longer out-of-line name', close: 1 },
      { name: '', close: 0 },
    ],
    email: 'hey@example.com',
    pair: [7, 0.5],
  },
  {
    id: 0xffffffff,
    name: 'non-ASCII: 서울',
    pos: { x: 0, y: 0 },
    scores: [],
    friends: [],
    email: null,
    pair: [0, -0],
  },
];

describe('compileDecoder', () => {
  it('decodes byte streams identically to the interpreter', () => {
    const compiled = compileDecoder(DecodeOnly);
    for (const value of values) {
      const bytes = Full.encode(value);
      assert.deepStrictEqual(compiled.decode(bytes), DecodeOnly.decode(bytes));
      assert.deepStrictEqual(compiled.decode(bytes), value);
    }
  });

  it('lazy access delegates to the interpreter views', () => {
    const bytes = Full.encode(values[0]);
    const lazy = compileDecoder(DecodeOnly).access(bytes);
    assert.strictEqual(lazy.id, values[0].id);
    assert.strictEqual(lazy.name, values[0].name);
    assert.deepStrictEqual(lazy.friends.toArray(), values[0].friends);
  });

  it('format-bound decoders compile for the bound format', () => {
    const be = r.format({ endian: 'big' });
    const bytes = Full.encode(values[0], be);
    const compiled = compileDecoder(d.withFormat(DecodeOnly, be));
    assert.deepStrictEqual(compiled.decode(bytes), values[0]);
  });

  it('opaque roots fall back to interpreter dep calls', () => {
    const Root = d.vec(d.u32);
    const bytes = r.vec(r.u32).encode([1, 2, 3]);
    assert.deepStrictEqual(compileDecoder(Root).decode(bytes), [1, 2, 3]);
  });

  it('emits the same source as the full-surface emitter for the same shape', () => {
    assert.strictEqual(emitDecoderSource(DecodeOnly), jit.emitDecoderSource(Full));
  });
});

describe('compileEncoder', () => {
  it('encodes byte-identically to the interpreter', () => {
    const compiled = compileEncoder(EncodeOnly);
    for (const value of values) {
      assert.deepStrictEqual(compiled.encode(value), Full.encode(value));
      assert.deepStrictEqual(compiled.encode(value), EncodeOnly.encode(value));
    }
  });

  it('format-bound encoders compile for the bound format', () => {
    const be = r.format({ endian: 'big' });
    const compiled = compileEncoder(e.withFormat(EncodeOnly, be));
    assert.deepStrictEqual(compiled.encode(values[0]), Full.encode(values[0], be));
  });

  it('opaque roots fall back to interpreter resolve', () => {
    const compiled = compileEncoder(e.vec(e.u32));
    assert.deepStrictEqual(compiled.encode([1, 2, 3]), r.vec(r.u32).encode([1, 2, 3]));
  });

  it('emits the same source as the full-surface emitter for the same shape', () => {
    assert.strictEqual(emitEncoderSource(EncodeOnly), jit.emitEncoderSource(Full));
  });
});

describe('rkyv-js/jit re-exports', () => {
  it('exposes the unidirectional wrappers for full-surface consumers', () => {
    assert.strictEqual(jit.compileDecoder, compileDecoder);
    assert.strictEqual(jit.compileEncoder, compileEncoder);
  });
});

describe('wrong-direction codecs fail fast', () => {
  // Misuse only type-checks through a cast; at runtime it must throw at the
  // compile call, not deep inside generated source on first use.
  it('compileCodec rejects an encoder-only codec', () => {
    assert.throws(
      () => jit.compileCodec(EncodeOnly as unknown as jit.CompilableCodec<unknown>),
      { name: 'TypeError', message: /missing read.*compileEncoder/ },
    );
  });

  it('compileCodec rejects a decoder-only codec', () => {
    assert.throws(
      () => jit.compileCodec(DecodeOnly as unknown as jit.CompilableCodec<unknown>),
      { name: 'TypeError', message: /missing resolve.*compileDecoder/ },
    );
  });

  it('compileDecoder rejects an encoder-only codec', () => {
    assert.throws(
      () => compileDecoder(EncodeOnly as unknown as AnyDecoder),
      { name: 'TypeError', message: /missing read.*compileEncoder/ },
    );
  });

  it('compileEncoder rejects a decoder-only codec', () => {
    assert.throws(
      () => compileEncoder(DecodeOnly as unknown as AnyEncoder),
      { name: 'TypeError', message: /missing resolve.*compileDecoder/ },
    );
  });

  it('full codecs satisfy every entry point', () => {
    const bytes = Full.encode(values[0]);
    assert.deepStrictEqual(compileDecoder(Full).decode(bytes), values[0]);
    assert.deepStrictEqual(compileEncoder(Full).encode(values[0]), bytes);
  });
});
