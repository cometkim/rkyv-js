import * as assert from 'node:assert';
import { describe, it } from 'node:test';

import * as r from '#src/index.ts';
import * as rd from '#src/decode.ts';
import * as re from '#src/encode.ts';
import { DEFAULT_FORMAT, Kind, OPAQUE_META, defineCodec } from '#src/core.ts';
import { compileCodec, emitDecoderSource, emitEncoderSource } from '#src/jit.ts';

// The meta descriptors are a behavioral promise: consumers (the JIT) bypass
// codec methods based on them. These tests pin that trust from three sides:
// descriptors match what was constructed (children by identity, layouts by
// memo identity), everything undeclared stays opaque, and the emitted JIT
// source derived from each direction's descriptors is byte-identical — so
// the conformance-verified full-codec compilation transitively covers the
// decode-only and encode-only chains.

describe('decoder meta descriptors', () => {
  it('describes primitives, string, and containers by construction', () => {
    // A primitive's meta kind IS its element-kind tag.
    assert.strictEqual(rd.u32.meta.kind, Kind.u32);
    assert.strictEqual(rd.bool.meta.kind, Kind.bool);
    assert.strictEqual(rd.char.meta.kind, Kind.other);

    const string = rd.string.meta;
    assert.ok(string.kind === Kind.string);
    assert.strictEqual(string.layout(DEFAULT_FORMAT), rd.string.layout(DEFAULT_FORMAT));

    const vec = rd.vec(rd.string);
    const vecMeta = vec.meta;
    assert.ok(vecMeta.kind === Kind.vec);
    assert.strictEqual(vecMeta.element, rd.string);
    assert.strictEqual(vecMeta.layout(DEFAULT_FORMAT), vec.layout(DEFAULT_FORMAT));

    const option = rd.option(rd.f64);
    const optionMeta = option.meta;
    assert.ok(optionMeta.kind === Kind.option);
    assert.strictEqual(optionMeta.inner, rd.f64);

    const array = rd.array(rd.i16, 12);
    const arrayMeta = array.meta;
    assert.ok(arrayMeta.kind === Kind.array);
    assert.strictEqual(arrayMeta.element, rd.i16);
    assert.strictEqual(arrayMeta.length, 12);

    const tuple = rd.tuple(rd.u8, rd.f64);
    const tupleMeta = tuple.meta;
    assert.ok(tupleMeta.kind === Kind.tuple);
    assert.deepStrictEqual(tupleMeta.elements, [rd.u8, rd.f64]);
  });

  it('describes structs and enums with the normalized introspection lists', () => {
    const struct = rd.struct({ x: rd.u32, y: rd.string });
    const structMeta = struct.meta;
    assert.ok(structMeta.kind === Kind.struct);
    assert.deepStrictEqual(
      structMeta.fields.map((f) => f.name),
      ['x', 'y'],
    );
    assert.strictEqual(structMeta.fields[0].codec, rd.u32);
    assert.strictEqual(structMeta.fields[1].codec, rd.string);
    assert.strictEqual(structMeta.layout(DEFAULT_FORMAT), struct.layout(DEFAULT_FORMAT));

    const en = rd.taggedEnum({
      Active: null,
      Banned: { until: rd.f64 },
      Renamed: rd.string,
    });
    const enumMeta = en.meta;
    assert.ok(enumMeta.kind === Kind.enum);
    assert.deepStrictEqual(
      enumMeta.variants.map((v) => v.name),
      ['Active', 'Banned', 'Renamed'],
    );
    assert.strictEqual(enumMeta.variants[0].fields.length, 0);
    assert.strictEqual(enumMeta.variants[1].fields[0].name, 'until');
    assert.strictEqual(enumMeta.variants[1].fields[0].codec, rd.f64);
    assert.strictEqual(enumMeta.variants[2].fields[0].name, null);
    assert.strictEqual(enumMeta.variants[2].fields[0].codec, rd.string);
  });
});

describe('encoder meta descriptors', () => {
  it('exposes the encode-only chains that used to be private', () => {
    assert.strictEqual(re.u32.meta.kind, Kind.u32);

    const vec = re.vec(re.string);
    const vecMeta = vec.meta;
    assert.ok(vecMeta.kind === Kind.vec);
    assert.strictEqual(vecMeta.element, re.string);

    const option = re.option(re.f64);
    const optionMeta = option.meta;
    assert.ok(optionMeta.kind === Kind.option);
    assert.strictEqual(optionMeta.inner, re.f64);

    const array = re.array(re.i16, 12);
    const arrayMeta = array.meta;
    assert.ok(arrayMeta.kind === Kind.array);
    assert.strictEqual(arrayMeta.element, re.i16);
    assert.strictEqual(arrayMeta.length, 12);

    const tuple = re.tuple(re.u8, re.f64);
    const tupleMeta = tuple.meta;
    assert.ok(tupleMeta.kind === Kind.tuple);
    assert.deepStrictEqual(tupleMeta.elements, [re.u8, re.f64]);

    const struct = re.struct({ x: re.u32, y: re.string });
    const structMeta = struct.meta;
    assert.ok(structMeta.kind === Kind.struct);
    assert.strictEqual(structMeta.fields[1].codec, re.string);
    assert.strictEqual(structMeta.layout(DEFAULT_FORMAT), struct.layout(DEFAULT_FORMAT));

    const en = re.taggedEnum({
      Active: null,
      Banned: { until: re.f64 },
      Renamed: re.string,
    });
    const enumMeta = en.meta;
    assert.ok(enumMeta.kind === Kind.enum);
    assert.strictEqual(enumMeta.variants[1].fields[0].codec, re.f64);
    assert.strictEqual(enumMeta.variants[2].fields[0].name, null);
  });
});

describe('full codec meta descriptors', () => {
  it('inherits the decode-side descriptor with full-codec children', () => {
    const struct = r.struct({ n: r.u32, s: r.string });
    const meta = struct.meta;
    assert.ok(meta.kind === Kind.struct);
    // Children are the full codecs the constructor received — so the write
    // emitter can call archive/resolve on exactly these dep objects.
    assert.strictEqual(meta.fields[0].codec, r.u32);
    assert.strictEqual(meta.fields[1].codec, r.string);
    for (const field of meta.fields) {
      assert.strictEqual(typeof (field.codec as r.Codec<unknown>).resolve, 'function');
      assert.strictEqual(typeof (field.codec as r.Codec<unknown>).read, 'function');
    }

    const vec = r.vec(r.string);
    const vecMeta = vec.meta;
    assert.ok(vecMeta.kind === Kind.vec);
    assert.strictEqual(vecMeta.element, r.string);
  });
});

describe('opaque defaults', () => {
  it('wrappers and custom codecs carry no shape promise', () => {
    assert.strictEqual(r.box(r.u32).meta.kind, Kind.opaque);
    assert.strictEqual(r.weak(r.u32).meta.kind, Kind.opaque);
    assert.strictEqual(
      r.transform(
        r.u32,
        (n) => String(n),
        (s) => Number(s),
      ).meta.kind,
      Kind.opaque,
    );
    assert.strictEqual(r.lazy(() => r.u32).meta.kind, Kind.opaque);
    assert.strictEqual(rd.withFormat(rd.u32, DEFAULT_FORMAT).meta.kind, Kind.opaque);
    assert.strictEqual(re.withFormat(re.u32, DEFAULT_FORMAT).meta.kind, Kind.opaque);

    const custom = defineCodec<number>({
      layout: (fmt) => r.u32.layout(fmt),
      read: (reader, offset) => r.u32.read(reader, offset),
      resolve: (writer, value) => r.u32.resolve(writer, value, undefined),
    });
    assert.strictEqual(custom.meta, OPAQUE_META);
  });
});

describe('direction-split emission equality', () => {
  // The full-codec JIT output is conformance-verified byte-for-byte against
  // rkyv; proving each one-direction chain emits the *identical source*
  // (same shapes, same layouts, same dep indexes) extends that verification
  // to the split chains without re-running rkyv.
  const Full = r.struct({
    name: r.string,
    age: r.u32,
    tags: r.vec(r.string),
    score: r.option(r.f64),
    pair: r.tuple(r.u8, r.f64),
    history: r.array(r.i16, 12),
    status: r.taggedEnum({
      Active: null,
      Banned: { until: r.f64 },
      Renamed: r.string,
    }),
  });
  const DecodeOnly = rd.struct({
    name: rd.string,
    age: rd.u32,
    tags: rd.vec(rd.string),
    score: rd.option(rd.f64),
    pair: rd.tuple(rd.u8, rd.f64),
    history: rd.array(rd.i16, 12),
    status: rd.taggedEnum({
      Active: null,
      Banned: { until: rd.f64 },
      Renamed: rd.string,
    }),
  });
  const EncodeOnly = re.struct({
    name: re.string,
    age: re.u32,
    tags: re.vec(re.string),
    score: re.option(re.f64),
    pair: re.tuple(re.u8, re.f64),
    history: re.array(re.i16, 12),
    status: re.taggedEnum({
      Active: null,
      Banned: { until: re.f64 },
      Renamed: re.string,
    }),
  });

  it('decode-only chains emit the exact full-codec decoder source', () => {
    assert.strictEqual(emitDecoderSource(DecodeOnly), emitDecoderSource(Full));
  });

  it('encode-only chains emit the exact full-codec encoder source', () => {
    const encodeOnly = emitEncoderSource(EncodeOnly);
    assert.ok(encodeOnly !== null, 'struct root is write-compiled');
    assert.strictEqual(encodeOnly, emitEncoderSource(Full));
  });
});

describe('defineCodec meta', () => {
  it('opts a custom codec into meta-driven inlining', () => {
    const Real = r.struct({ x: r.u32, y: r.u32 });
    const custom = defineCodec<{ x: number; y: number }>({
      layout: (fmt) => Real.layout(fmt),
      read: (reader, offset) => Real.read(reader, offset),
      resolve: (writer, value) => Real.resolve(writer, value, undefined),
      meta: {
        kind: Kind.struct,
        fields: [
          { name: 'x', codec: r.u32 },
          { name: 'y', codec: r.u32 },
        ],
        layout: (fmt) => Real.layout(fmt),
      },
    });

    // Declaring the shape makes the custom codec emit exactly like the
    // intrinsic struct — and the compiled unit round-trips against it.
    assert.strictEqual(emitDecoderSource(custom), emitDecoderSource(Real));
    assert.strictEqual(emitEncoderSource(custom), emitEncoderSource(Real));

    const compiled = compileCodec(custom);
    const value = { x: 1, y: 2 };
    const bytes = Real.encode(value);
    assert.deepStrictEqual(compiled.decode(bytes), value);
    assert.deepStrictEqual(compiled.encode(value), bytes);
  });
});
