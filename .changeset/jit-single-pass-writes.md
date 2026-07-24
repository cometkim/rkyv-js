---
"rkyv-js": patch
---

JIT-compiled encoders now emit single-pass batched writes.

Inline struct/tuple subtrees are flattened into their parent (no more dep call per nested fixed-size field),
and runs of 2+ primitive fields fuse into one `reserve(span)` plus direct constant-offset `DataView` stores.

One capacity check and one position bump per run instead of one of each per field, with alignment gaps zero-filled to keep the bytes identical. 

Measured 1.9x over the previous compiled encoder on a 12-scalar struct (2.1x over the interpreter); string/vec/enum-dominated shapes gain 2-5%.
