import * as assert from 'node:assert';
import { describe, it } from 'node:test';

import * as r from '#src/index.ts';
import {
  DEFAULT_FORMAT,
  RkyvReader,
  RkyvWriter,
  type RkyvTextDecoder,
  type RkyvTextEncoder,
} from '#src/core.ts';
import { hashMap } from '#src/lib/hashmap.ts';

/**
 * The reader/writer-configured text codecs must be used by every codec path
 * that touches text — including string hashing for map keys — never a
 * module-scoped instance. The contracts are rkyv-js-owned minimal interfaces
 * (`encodeInto` / `decode` only), so plain objects qualify.
 */

function countingEncoder(): RkyvTextEncoder & { calls: number } {
  const inner = new TextEncoder();
  return {
    calls: 0,
    encodeInto(src: string, dest: Uint8Array): { written: number } {
      this.calls++;
      return inner.encodeInto(src, dest);
    },
  };
}

function countingDecoder(): RkyvTextDecoder & { calls: number } {
  const inner = new TextDecoder();
  return {
    calls: 0,
    decode(bytes: Uint8Array): string {
      this.calls++;
      return inner.decode(bytes);
    },
  };
}

const ArchivedNote = r.struct({
  // ≤ 8 chars and non-ASCII: the inline-string path (`writer.encodeText`).
  title: r.string,
  // long and non-ASCII: the out-of-line path (`writer.writeText`).
  body: r.string,
});

const note = {
  title: '한글제목',
  body: '동네 이웃과 함께하는 중고거래 당근마켓입니다, 반가워요!',
};

const ArchivedTags = hashMap(r.string, r.u32);
// Non-ASCII keys force the hash path through the configured encoder.
const tags = new Map([
  ['당근', 1],
  ['마켓', 2],
  ['이웃', 3],
]);

describe('configured text codecs are used end-to-end', () => {
  it('encode paths (inline, out-of-line, and key hashing) use the writer encoder', () => {
    const encoder = countingEncoder();
    const writer = new RkyvWriter({ textEncoder: encoder });
    const bytes = ArchivedNote.encodeInto(writer, note);

    // title (inline repr) + body (out-of-line) both encode through it.
    assert.ok(encoder.calls >= 2, `struct strings should use the encoder (calls=${encoder.calls})`);
    assert.deepStrictEqual(bytes, ArchivedNote.encode(note), 'bytes match default encoder');

    const before = encoder.calls;
    const mapWriter = new RkyvWriter({ textEncoder: encoder });
    const mapBytes = ArchivedTags.encodeInto(mapWriter, tags);
    // 3 keys hashed + 3 inline key reprs encoded.
    assert.ok(
      encoder.calls >= before + 6,
      `hashing and encoding non-ASCII map keys should use the encoder (calls=${encoder.calls - before})`,
    );
    assert.deepStrictEqual(mapBytes, ArchivedTags.encode(tags), 'map bytes match default encoder');
  });

  it('decode paths use the reader decoder', () => {
    const bytes = ArchivedNote.encode(note);
    const decoder = countingDecoder();
    const reader = new RkyvReader(bytes, { textDecoder: decoder });
    const offset = reader.getRootPosition(ArchivedNote.layout(DEFAULT_FORMAT).size);

    const decoded = ArchivedNote.read(reader, offset);
    assert.deepStrictEqual(decoded, note);
    assert.ok(decoder.calls >= 2, `non-ASCII strings should decode through the decoder (calls=${decoder.calls})`);
  });
});
