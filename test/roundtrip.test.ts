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

import * as r from 'rkyv-js';

const FIXTURES_DIR = path.join(import.meta.dirname, 'fixtures');

async function discoverFixtures(): Promise<string[]> {
  const entries = await readdir(FIXTURES_DIR, { withFileTypes: true });
  return entries.filter((e) => e.isDirectory()).map((e) => e.name);
}

async function loadFixture<T = unknown>(name: string): Promise<{
  codec: r.RkyvCodec<T>;
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

/**
 * Normalize values for comparison.
 * - Converts Uint8Array to regular arrays for comparison with JSON arrays
 * - Converts Map to array of [key, value] tuples for comparison with JSON
 * - Converts Set to array for comparison with JSON
 * - Recursively processes nested objects
 */
function normalizeForComparison(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (value instanceof Map) {
    return Array.from(value.entries()).map(([k, v]) => [
      normalizeForComparison(k),
      normalizeForComparison(v),
    ]);
  }
  if (value instanceof Set) {
    return Array.from(value).map(normalizeForComparison);
  }
  if (Array.isArray(value)) {
    return value.map(normalizeForComparison);
  }
  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = normalizeForComparison(val);
    }
    return result;
  }
  return value;
}

describe('Round-trip tests with Rust rkyv', async () => {
  const fixtures = await discoverFixtures();

  for (const fixtureName of fixtures) {
    it(`should decode and re-encode ${fixtureName}`, async () => {
      const { codec, bytes, json: expected } = await loadFixture(fixtureName);

      // Decode and validate against JSON
      const decoded = r.decode(codec, bytes);
      const normalizedDecoded = normalizeForComparison(decoded);
      assert.deepStrictEqual(normalizedDecoded, expected);

      // Re-encode and verify bytes match original
      const reencoded = r.encode(codec, decoded);
      assert.deepStrictEqual(reencoded, bytes);

      // Verify roundtrip
      const decoded2 = r.decode(codec, reencoded);
      const normalizedDecoded2 = normalizeForComparison(decoded2);
      assert.deepStrictEqual(normalizedDecoded2, expected);
    });
  }
});
