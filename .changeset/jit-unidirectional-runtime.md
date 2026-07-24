---
"rkyv-js": minor
---

JIT for unidirectional codecs.

New `rkyv-js/jit/decode` and `rkyv-js/jit/encode` entries export `compileDecoder` / `compileEncoder`,
the direction-split twins of `compileCodec`: each value-imports only its half of the emitter,
so a decode-only bundle that opts into JIT still never pulls in the writer (and vice versa).

Both are also re-exported from `rkyv-js/jit`, and emitted sources are unchanged
(the emitters moved to internal modules shared with `compileCodec`).

All compile functions now fail fast with a `TypeError` when handed a codec missing the required direction surface (e.g. an encoder-only codec passed to `compileCodec`),
instead of compiling successfully and failing on real use.
