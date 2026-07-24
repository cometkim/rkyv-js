---
"rkyv-js": patch
---

Encode fast paths: primitive `vec`/`array` batches of 16+ elements now write
through a single typed-array `set` (measured 4-9x on 1024-element vecs), and
inline ASCII strings archive with no intermediate allocation (~1.2x). Wire
bytes are unchanged — element conversions match the per-element `DataView`
writes bit for bit, and foreign-endian or unaligned targets keep the existing
monomorphic loops.
