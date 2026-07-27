---
"rkyv-js-codegen": patch
---

Add casing options so generated bindings can follow JavaScript naming conventions.

`set_field_casing(Casing::Camel)` emits Rust's `snake_case` fields as `camelCase` (`created_at` becomes `createdAt`), covering struct fields and enum struct-variant fields; `set_variant_casing` does the same for enum variant tags. `Casing::Pascal` and `Casing::Snake` are also available, and both options default to `Casing::Preserve`, so existing output is unchanged.

rkyv structs are laid out positionally, so the keys of an emitted `r.struct({ ... })` are labels only.
Casing changes the shape of the decoded object and its inferred `r.Infer` type without moving a wire byte.
Names that would collide after conversion (`foo_bar` and `fooBar` both becoming `fooBar`) are reported as a `NameCollision` diagnostic instead of being emitted as a duplicate object key.

Raw identifiers now drop their escape: a `r#type` field is emitted as the key `type`, which previously produced invalid TypeScript.
