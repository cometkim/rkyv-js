/**
 * JIT conformance: every case's codec, compiled with `compileCodec`, must
 * decode every golden byte-identically in meaning (canonical deep-equal)
 * and re-encode to EXACTLY the bytes the interpreter produces. This pins
 * emitted-source semantics against the interpreter for the whole matrix.
 *
 * The unidirectional matrix repeats the same contract for `compileDecoder`
 * over the decoder-only bindings and `compileEncoder` over the encoder-only
 * bindings.
 */

import * as assert from 'node:assert';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import type { AnyCodec } from '#src/core/codec.ts';
import type { AnyDecoder } from '#src/core/decoder.ts';
import type { AnyEncoder } from '#src/core/encoder.ts';
import { compileCodec } from '#src/jit.ts';
import { compileDecoder } from '#src/jit.decode.ts';
import { compileEncoder } from '#src/jit.encode.ts';
import * as bindings from '#conformance/cases/bindings.ts';
import * as decodeOnly from '#conformance/cases/bindings.decode.ts';
import * as encodeOnly from '#conformance/cases/bindings.encode.ts';
import { conformanceEqual, inspect, revive } from './_canonical.ts';

const CASES_DIR = path.join(import.meta.dirname, '..', 'conformance', 'cases');

interface Meta {
  case: string;
  codec: string;
  ordered: boolean;
}

const entries = await readdir(CASES_DIR, { withFileTypes: true });
const caseDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

describe('conformance (compiled)', async () => {
  for (const name of caseDirs) {
    it(name, async () => {
      const dir = path.join(CASES_DIR, name);
      const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf-8')) as Meta;
      const interpreter = (bindings as Record<string, unknown>)[meta.codec] as AnyCodec | undefined;
      assert.ok(interpreter, `bindings.ts is missing export ${meta.codec}`);
      const compiled = compileCodec(interpreter);

      const data = new Uint8Array(await readFile(path.join(dir, 'data.bin')));
      const expected = revive(JSON.parse(await readFile(path.join(dir, 'data.json'), 'utf-8')));

      // Compiled decode agrees with the canonical value.
      const decoded: unknown = compiled.decode(data);
      assert.ok(
        conformanceEqual(decoded, expected, meta.ordered),
        `compiled decode differs from canonical\ndecoded: ${inspect(decoded)}\nexpected: ${inspect(expected)}`,
      );

      // Compiled encode is byte-identical to the interpreter's encode of the
      // same value (the interpreter is the wire oracle; conformance verify
      // separately proves the interpreter against Rust).
      const viaInterpreter = interpreter.encode(decoded);
      const viaCompiled = compiled.encode(decoded);
      assert.deepStrictEqual(
        viaCompiled,
        viaInterpreter,
        'compiled encode diverged from interpreter encode',
      );
    });
  }
});

describe('conformance (compiled, unidirectional)', async () => {
  for (const name of caseDirs) {
    it(name, async () => {
      const dir = path.join(CASES_DIR, name);
      const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf-8')) as Meta;
      const interpreter = (bindings as Record<string, unknown>)[meta.codec] as AnyCodec | undefined;
      const decoder = (decodeOnly as Record<string, unknown>)[meta.codec] as AnyDecoder | undefined;
      const encoder = (encodeOnly as Record<string, unknown>)[meta.codec] as AnyEncoder | undefined;
      assert.ok(interpreter, `bindings.ts is missing export ${meta.codec}`);
      assert.ok(decoder, `bindings.decode.ts is missing export ${meta.codec}`);
      assert.ok(encoder, `bindings.encode.ts is missing export ${meta.codec}`);

      const data = new Uint8Array(await readFile(path.join(dir, 'data.bin')));
      const expected = revive(JSON.parse(await readFile(path.join(dir, 'data.json'), 'utf-8')));

      // Compiled decoder-only bindings agree with the canonical value.
      const decoded: unknown = compileDecoder(decoder).decode(data);
      assert.ok(
        conformanceEqual(decoded, expected, meta.ordered),
        `compiled decoder-only decode differs from canonical\ndecoded: ${inspect(decoded)}\nexpected: ${inspect(expected)}`,
      );

      // Compiled encoder-only bindings are byte-identical to the full
      // interpreter's encode of the same value.
      assert.deepStrictEqual(
        compileEncoder(encoder).encode(decoded),
        interpreter.encode(decoded),
        'compiled encoder-only encode diverged from interpreter encode',
      );
    });
  }
});
