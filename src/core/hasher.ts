/**
 * Hasher contracts for archived hash collections.
 *
 * This module defines only the interfaces; the default implementation
 * (rkyv's `FxHasher64`) lives in `src/lib/internal/fx-hasher.ts` next to the
 * map codecs that use it, so pulling in the core never pulls in a hasher.
 */

import type { RkyvFormat } from './format.ts';

/**
 * The hasher contract map codecs hash keys through — the digest half of
 * Rust's `Hash`/`Hasher` split. Codec `hash()` implementations decide WHAT
 * gets written (exactly matching the Rust `Hash` impl of the key type,
 * hasher-independent); an `RkyvHasher` decides how those writes digest into
 * the 64 bits that place swiss-table entries.
 *
 * Protocol (mirrors how rkyv drives `Hasher`, kept allocation-free):
 * `reset()` → codec writes → `finish()` → read the digest from `hi`/`lo`.
 * One instance is reused for every key of a table build.
 */
export interface RkyvHasher {
  /** High 32 bits of the digest — valid after `finish()`. */
  hi: number;
  /** Low 32 bits of the digest — valid after `finish()`. */
  lo: number;
  /** Restore the initial state so the instance can hash the next key. */
  reset(): this;
  /** Finalize the digest into `hi`/`lo` (`Hasher::finish`). */
  finish(): void;
  /** `Hasher::write(&[u8])` over `bytes[start..end]`. */
  writeBytes(bytes: Uint8Array, start?: number, end?: number): void;
  writeU8(value: number): void;
  writeU16(value: number): void;
  writeU32(value: number): void;
  /** `Hasher::write_u64` from explicit u32 halves. */
  writeU64Parts(hi: number, lo: number): void;
  writeU64(value: bigint): void;
  writeUsize(value: number): void;
}

/**
 * Creates the hasher for an archived-table build (Rust's `BuildHasher`).
 * The wire format is provided because a hasher may depend on it — rkyv's
 * `FxHasher64` truncates `usize` writes to the archived pointer width.
 *
 * This must match the ARCHIVED hasher `H` in `ArchivedHashMap<K, V, H>` on
 * the Rust side — not the source map's `S` parameter, which never affects
 * the wire. rkyv 0.8's derive/std impls always archive with `FxHasher64`
 * (the map codecs' default); only manual `serialize_from_iter` impls that
 * pick a custom `H` need a different builder.
 */
export interface RkyvBuildHasher {
  create(format: RkyvFormat): RkyvHasher;
}
