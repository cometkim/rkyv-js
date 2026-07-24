# rkyv-js-codegen

## 0.2.0

### Minor Changes

- 08f3303: Add option `set_jit(true)`: every generated export is wrapped in the direction-matched compile function,
  while cross-references between generated types keep the raw interpreter codecs (`const {Name}$ = ...`) so the JIT can inline across type boundaries.

## 0.1.0

### Minor Changes

- ff6d9da: Complete v0.1 redesign. New APIs are documented in [docs.rs/rkyv-js-codegen](https://docs.rs/rkyv-js-codegen/0.1.0/rkyv_js_codegen).
