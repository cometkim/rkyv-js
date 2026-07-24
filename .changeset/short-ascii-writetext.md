---
"rkyv-js": patch
---

`writeText` takes an allocation-free char-loop fast path for ASCII strings up
to 32 chars (out-of-line strings; the inline path already had it): 4.9x at 12
chars, 1.5x at 31, tapering to TextEncoder's `encodeInto` beyond. Non-ASCII
text bails to the encoder from the same position, byte-identical.
