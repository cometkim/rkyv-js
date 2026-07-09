/**
 * Unidirectional bindings conformance: the decoder-only bindings must decode
 * every golden to the canonical value, and the encoder-only bindings must
 * encode the canonical value to exactly the bytes the full bindings produce
 * (which conformance verify separately proves against Rust).
 */

import * as assert from 'node:assert';
import { readdir, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { describe, it } from 'node:test';

import type { AnyCodec } from '#src/core/codec.ts';
import type { AnyDecoder } from '#src/core/decoder.ts';
import * as full from '#conformance/cases/bindings.ts';
import * as decodeOnly from '#conformance/cases/bindings.decode.ts';
import * as encodeOnly from '#conformance/cases/bindings.encode.ts';
import { conformanceEqual, inspect, revive } from './_canonical.ts';

interface EncoderSurface {
  encode(value: unknown): Uint8Array;
}

const CASES_DIR = path.join(import.meta.dirname, '..', 'conformance', 'cases');

interface Meta {
  case: string;
  codec: string;
  ordered: boolean;
}

const entries = await readdir(CASES_DIR, { withFileTypes: true });
const caseDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

describe('conformance (unidirectional bindings)', async () => {
  for (const name of caseDirs) {
    it(name, async () => {
      const dir = path.join(CASES_DIR, name);
      const meta = JSON.parse(await readFile(path.join(dir, 'meta.json'), 'utf-8')) as Meta;

      const fullCodec = (full as Record<string, unknown>)[meta.codec] as AnyCodec | undefined;
      const decoder = (decodeOnly as Record<string, unknown>)[meta.codec] as AnyDecoder | undefined;
      const encoder = (encodeOnly as Record<string, unknown>)[meta.codec] as
        | EncoderSurface
        | undefined;
      assert.ok(fullCodec, `bindings.ts is missing export ${meta.codec}`);
      assert.ok(decoder, `bindings.decode.ts is missing export ${meta.codec}`);
      assert.ok(encoder, `bindings.encode.ts is missing export ${meta.codec}`);

      const data = new Uint8Array(await readFile(path.join(dir, 'data.bin')));
      const expected = revive(JSON.parse(await readFile(path.join(dir, 'data.json'), 'utf-8')));

      // Decoder-only bindings: Rust bytes → canonical value.
      const decoded: unknown = decoder.decode(data);
      assert.ok(
        conformanceEqual(decoded, expected, meta.ordered),
        `decoder-only decode differs from canonical\ndecoded: ${inspect(decoded)}\nexpected: ${inspect(expected)}`,
      );

      // Encoder-only bindings: canonical value → the full bindings' bytes.
      const viaFull = fullCodec.encode(decoded);
      const viaEncoder = encoder.encode(decoded);
      assert.deepStrictEqual(
        viaEncoder,
        viaFull,
        'encoder-only bindings encoded different bytes than the full bindings',
      );
    });
  }
});
