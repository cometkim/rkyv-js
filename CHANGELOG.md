# rkyv-js

## 0.2.1

### Patch Changes

- 2043c15: Enabled the provenance for the rkyv-js NPM package.

## 0.2.0

### Minor Changes

- 805d6df: `RkyvWriter` can now wrap caller-provided memory: `new RkyvWriter({ buffer })` makes the writer fixed-capacity (overflow throws `RangeError` instead of growing)
  and archives are written directly in place, e.g. the zero-copy path for encoding into a `WebAssembly.Memory` region.

  `writeText` on a fixed buffer detects true overflow from the encoder's progress instead of the pessimistic 3x estimate,
  and `RkyvTextEncoder.encodeInto` may now report `read` to make that detection exact. Owned writers are unchanged.

- 08f3303: JIT for unidirectional codecs.

  New `rkyv-js/jit/decode` and `rkyv-js/jit/encode` entries export `compileDecoder` / `compileEncoder`,
  the direction-split twins of `compileCodec`: each value-imports only its half of the emitter,
  so a decode-only bundle that opts into JIT still never pulls in the writer (and vice versa).

  Both are also re-exported from `rkyv-js/jit`, and emitted sources are unchanged
  (the emitters moved to internal modules shared with `compileCodec`).

  All compile functions now fail fast with a `TypeError` when handed a codec missing the required direction surface (e.g. an encoder-only codec passed to `compileCodec`),
  instead of compiling successfully and failing on real use.

### Patch Changes

- 92efb56: Encode fast paths:

  - Primitive `vec`/`array` batches of 16+ elements now write through a single typed-array `set` (measured 4-9x on 1024-element vecs),
  - Inline ASCII strings archive with no intermediate allocation (~1.2x).

  Wire bytes are unchanged, element conversions match the per-element `DataView` writes bit for bit,
  and foreign-endian or unaligned targets keep the existing monomorphic loops.

- 55bcb5f: JIT-compiled encoders now emit single-pass batched writes.

  Inline struct/tuple subtrees are flattened into their parent (no more dep call per nested fixed-size field),
  and runs of 2+ primitive fields fuse into one `reserve(span)` plus direct constant-offset `DataView` stores.

  One capacity check and one position bump per run instead of one of each per field, with alignment gaps zero-filled to keep the bytes identical.

  Measured 1.9x over the previous compiled encoder on a 12-scalar struct (2.1x over the interpreter); string/vec/enum-dominated shapes gain 2-5%.

- 3b1ab89: JIT-compiled encoders now compile vec element write loops for struct/tuple elements.

  Fully-primitive elements get a single reservation for the whole payload and a strided constant-offset store loop
  (24x on a 256-element vec of small structs).

  Mixed elements keep the interpreter's two-phase order with monomorphic per-element call sites and batched scalar runs
  (1.5x with string fields; Order-style payloads 1.5x end to end).

- 9c1849b: `writeText` takes an allocation-free char-loop fast path for ASCII strings up to 32 chars (out-of-line strings; the inline path already had it):
  4.9x at 12 chars, 1.5x at 31, tapering to TextEncoder's `encodeInto` beyond.

## 0.1.1

### Patch Changes

- 50a95fc: Fix broken entry points in the published package. Publishing now goes through `yarn npm publish`, which applies the `publishConfig` overrides.

## 0.1.0

### Minor Changes

- 4149164: Complete v0.1 redesign:

  - Self-contained codec API.
  - Verified wire-format conformance against rkyv 0.8.14 (fixed e num layouts, swiss-table probing, Rust-compatible key hashing, invalid-pointer sentinels)
  - Format configuration (endianness / pointer width / alignment) is now customizable.
  - Lazy access via explicit `.get(index)` call on `LazyList`, instead of proxy traps.
  - The runtime performance is now comparable to protobufjs.
