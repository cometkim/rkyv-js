/**
 * Snapshot tests for the JIT emitters (node:test built-in snapshots).
 *
 * `emitDecoderSource`/`emitEncoderSource` return exactly the source that
 * `compileCodec` evaluates, so any change to emitted code shows up here as
 * a reviewable diff. Regenerate deliberately with:
 *
 *     node --test --test-update-snapshots test/jit-snapshot.test.ts
 */

import { describe, it, snapshot } from 'node:test';

// Emitted sources are JavaScript — snapshot them verbatim, not JSON-escaped.
snapshot.setDefaultSnapshotSerializers([(value) => String(value)]);

import * as r from '#src/index.ts';
import { format } from '#src/core.ts';
import { hashMap } from '#src/lib/hashmap.ts';
import { emitDecoderSource, emitEncoderSource } from '#src/jit.ts';

const Address = r.struct({ city: r.string, zip: r.u32 });

const Person = r.struct({
  name: r.string,
  age: r.u32,
  email: r.option(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
  address: Address,
});

const Point = r.struct({ x: r.f64, y: r.f64 });

const Status = r.taggedEnum({
  Active: null,
  Renamed: r.string,
  Banned: { until: r.f64, reason: r.string },
});

const Shapes = r.struct({
  pair: r.tuple(r.u8, r.f64),
  short: r.array(r.u8, 4),
  long: r.array(r.i16, 12),
  friends: r.vec(Address),
  id: r.u64,
});

interface Tree {
  value: number;
  children: Tree[];
}
const TreeCodec: r.Codec<Tree> = r.struct({
  value: r.u32,
  children: r.vec(r.lazy(() => TreeCodec)),
}) as r.Codec<Tree>;

const WithMap = r.struct({
  tags: hashMap(r.string, r.u32),
  n: r.u32,
});

const be64 = format({ endian: 'big', pointerWidth: 64 });

describe('jit emitted source', () => {
  it('decoder: person struct (string helper, option, vec-of-primitive dep, nested struct)', (t) => {
    t.assert.snapshot(emitDecoderSource(Person));
  });

  it('decoder: inline all-primitive struct', (t) => {
    t.assert.snapshot(emitDecoderSource(Point));
  });

  it('decoder: tagged enum switch (unit / newtype / record variants)', (t) => {
    t.assert.snapshot(emitDecoderSource(Status));
  });

  it('decoder: tuple, unrolled array, loop array, vec-of-struct, u64', (t) => {
    t.assert.snapshot(emitDecoderSource(Shapes));
  });

  it('decoder: recursion terminates at lazy() with a dep call', (t) => {
    t.assert.snapshot(emitDecoderSource(TreeCodec));
  });

  it('decoder: map fields stay interpreter dep calls', (t) => {
    t.assert.snapshot(emitDecoderSource(WithMap));
  });

  it('decoder: format specialization (big-endian, 64-bit pointers)', (t) => {
    t.assert.snapshot(emitDecoderSource(Person, be64));
  });

  it('encoder: person struct (archive + resolve pair)', (t) => {
    t.assert.snapshot(emitEncoderSource(Person));
  });

  it('encoder: inline all-primitive struct (single-pass, null archive)', (t) => {
    t.assert.snapshot(emitEncoderSource(Point));
  });

  it('encoder: mixed shapes struct', (t) => {
    t.assert.snapshot(emitEncoderSource(Shapes));
  });

  it('encoder: format specialization (big-endian, 64-bit pointers)', (t) => {
    t.assert.snapshot(emitEncoderSource(Person, be64));
  });

  it('encoder: unrecognized root shapes are not compiled', (t) => {
    t.assert.snapshot(String(emitEncoderSource(Status)));
  });
});
