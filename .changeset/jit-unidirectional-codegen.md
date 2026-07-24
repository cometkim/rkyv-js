---
"rkyv-js-codegen": minor
---

Add option `set_jit(true)`: every generated export is wrapped in the direction-matched compile function,
while cross-references between generated types keep the raw interpreter codecs (`const {Name}$ = ...`) so the JIT can inline across type boundaries.
