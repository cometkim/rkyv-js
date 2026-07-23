# rkyv-js-codegen

[![crates.io](https://img.shields.io/crates/v/rkyv-js-codegen.svg)](https://crates.io/crates/rkyv-js-codegen)
[![docs.rs](https://img.shields.io/docsrs/rkyv-js-codegen)](https://docs.rs/rkyv-js-codegen)

Generates TypeScript codec bindings from [rkyv](https://rkyv.org/) types, targeting the [`rkyv-js`](https://www.npmjs.com/package/rkyv-js) runtime.

The generator parses Rust sources with `syn`, extracts every type marked `#[derive(Archive)]`, and emits one `export const Archived{Name}` codec per type.

TypeScript types are derived from the codecs via `r.Infer<typeof ...>`, so your Rust source stays the single source of truth. No schema files, no second type declaration to drift.

```toml
[build-dependencies]
rkyv-js-codegen = "0.1"
```

```rust
use rkyv_js_codegen::CodeGenerator;

fn main() -> Result<(), rkyv_js_codegen::Error> {
    CodeGenerator::new()
        .add_source_file("src/lib.rs")?
        .write_to_file("generated/bindings.ts")?;

    println!("cargo:rerun-if-changed=src/lib.rs");
    Ok(())
}
```

A `#[derive(Archive)]` struct becomes a self-contained codec:

```typescript
import * as r from 'rkyv-js';

export const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.option(r.string),
  scores: r.vec(r.u32),
});

export type Person = r.Infer<typeof ArchivedPerson>;
```

## Documentation

- [docs.rs](https://docs.rs/rkyv-js-codegen)
- [rkyv-js](https://github.com/cometkim/rkyv-js#readme)
- [rkyv-example](https://github.com/cometkim/rkyv-js/tree/main/rkyv-example)

## Compatibility

Emitted bindings import from the `rkyv-js` npm package.

Both halves are developed in the same repository and verified together by a bidirectional conformance suite against a pinned rkyv version (currently **0.8.14**), but they are versioned independently - rkyv patch releases can legitimately change wire bytes, so check the project README before mixing versions.

## License

MIT
