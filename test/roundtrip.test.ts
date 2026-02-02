/**
 * Round-trip tests that validate interoperability with Rust's rkyv.
 *
 * These tests dynamically discover fixture directories and:
 * 1. Load the codec from binding (from Rust)
 * 2. Read binary data from data.bin (from Rust)
 * 3. Read expected JSON from data.json (from Rust)
 * 4. Decode binary and validate against JSON
 * 5. Re-encode and verify bytes match original
 * 6. Decode re-encoded bytes and verify roundtrip
 */

import * as assert from 'node:assert';
import { describe, it } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import * as path from 'node:path';

import { r, type RkyvCodec } from 'rkyv-js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');

async function discoverFixtures(): Promise<string[]> {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function loadFixture<T = unknown>(name: string): Promise<{
  codec: RkyvCodec<T>;
  bytes: Uint8Array;
  json: T;
}> {
  const fixtureDir = path.join(FIXTURES_DIR, name);

  const [codecModule, binData, jsonData] = await Promise.all([
    import(path.join(fixtureDir, 'codec.ts')),
    readFile(path.join(fixtureDir, 'data.bin')),
    readFile(path.join(fixtureDir, 'data.json'), 'utf-8'),
  ]);

  return {
    codec: codecModule.default,
    bytes: new Uint8Array(binData),
    json: JSON.parse(jsonData),
  };
}

describe('Round-trip tests with Rust rkyv', async () => {
  const fixtures = await discoverFixtures();

  for (const fixtureName of fixtures) {
    it(`should decode and re-encode ${fixtureName}`, async () => {
      const { codec, bytes, json: expected } = await loadFixture(fixtureName);

      // Decode and validate against JSON
      const decoded = r.decode(codec, bytes);
      assert.deepStrictEqual(decoded, expected);

      // Re-encode and verify bytes match original
      const reencoded = r.encode(codec, decoded);
      assert.deepStrictEqual(reencoded, bytes);

      // Verify roundtrip
      const decoded2 = r.decode(codec, reencoded);
      assert.deepStrictEqual(decoded2, expected);
    });
  }
});
