# rkyv-js-codegen

## 0.2.1

### Patch Changes

- b4c3920: Add casing options so generated bindings can follow JavaScript naming conventions.

  `set_field_casing(Casing::Camel)` emits Rust's `snake_case` fields as `camelCase` (`created_at` becomes `createdAt`), covering struct fields and enum struct-variant fields; `set_variant_casing` does the same for enum variant tags. `Casing::Pascal` and `Casing::Snake` are also available, and both options default to `Casing::Preserve`, so existing output is unchanged.

  rkyv structs are laid out positionally, so the keys of an emitted `r.struct({ ... })` are labels only.
  Casing changes the shape of the decoded object and its inferred `r.Infer` type without moving a wire byte.
  Names that would collide after conversion (`foo_bar` and `fooBar` both becoming `fooBar`) are reported as a `NameCollision` diagnostic instead of being emitted as a duplicate object key.

  Raw identifiers now drop their escape: a `r#type` field is emitted as the key `type`, which previously produced invalid TypeScript.

## 0.2.0

### Minor Changes

- 08f3303: Add option `set_jit(true)`: every generated export is wrapped in the direction-matched compile function,
  while cross-references between generated types keep the raw interpreter codecs (`const {Name}$ = ...`) so the JIT can inline across type boundaries.

## 0.1.0

### Minor Changes

- ff6d9da: Complete v0.1 redesign. New APIs are documented in [docs.rs/rkyv-js-codegen](https://docs.rs/rkyv-js-codegen/0.1.0/rkyv_js_codegen).
