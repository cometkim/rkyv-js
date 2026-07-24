---
"rkyv-js": minor
---

`RkyvWriter` can now wrap caller-provided memory: `new RkyvWriter({ buffer })`
makes the writer fixed-capacity (overflow throws `RangeError` instead of
growing) and archives are written directly in place — the zero-copy path for
encoding into a `WebAssembly.Memory` region. `writeText` on a fixed buffer
detects true overflow from the encoder's progress instead of the pessimistic
3x estimate, and `RkyvTextEncoder.encodeInto` may now report `read` to make
that detection exact. Owned writers are unchanged.
