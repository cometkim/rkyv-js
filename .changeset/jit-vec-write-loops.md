---
"rkyv-js": patch
---

JIT-compiled encoders now compile vec element write loops for struct/tuple
elements. Fully-primitive elements get a single reservation for the whole
payload and a strided constant-offset store loop (24x on a 256-element vec of
small structs); mixed elements keep the interpreter's two-phase order with
monomorphic per-element call sites and batched scalar runs (1.5x with string
fields; Order-style payloads 1.5x end to end). Primitive, recursive, opaque,
and map elements stay on the interpreter, and the vec header write is
unchanged — bytes are identical throughout.
