# rkyv-js

An unofficial library to use [rkyv](https://rkyv.org/) (Zero-copy deserialization framework for Rust) in JavaScript/TypeScript projects.

## Motivation

This library allows JavaScript programs to efficiently exchange data with a Rust backend using rkyv types.

- Archived Rust types can be read directly from JS programs without an additional serialization layer.
- Bytes written in JS programs can be deserialized in Rust programs in a zero-copy manner.
- Unlike Protobuf or Cap'n Proto, the schema is derived directly from your Rust codebase without having to manage additional schema files.

## Components

This project consists of two parts:

1. `rkyv-js` (NPM package) - JavaScript runtime library for encoding/decoding rkyv archives
2. `rkyv-js-codegen` (Rust crate) - Code generator that creates TypeScript bindings from Rust source

## Installation

### JavaScript

```bash
yarn add rkyv-js
```

### Rust (for code generation)

```toml
[build-dependencies]
rkyv-js-codegen = "0.1"
```

## Quick Start

### Option 1: Code Generation (Recommended)

Annotate your Rust types with `#[derive(Archive)]`:

```rs
use rkyv::{Archive, Deserialize, Serialize};

#[derive(Archive, Serialize, Deserialize)]
struct Person {
    name: String,
    age: u32,
    email: Option<String>,
    scores: Vec<u32>,
}
```

Configure the output in your `build.rs`:

```rs
use rkyv_js_codegen::CodeGenerator;
use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    let mut codegen = CodeGenerator::new();

    codegen.set_header(
        "Generated TypeScript bindings from rkyv-js-codegen\n\
         These types match the Rust structs in src/lib.rs",
    );

    // Automatically extract all types annotated with #[derive(rkyv::Archive)]
    codegen.add_source_file(manifest_dir.join("src/lib.rs"))
        .expect("Failed to parse source file");

    // Write generated bindings
    codegen.write_to_file(out_dir.join("bindings.ts"))
        .expect("Failed to write bindings");

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=build.rs");
}
```

This generates TypeScript like:

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

### Option 2: Manual Schema Definition

You can also use `rkyv-js` as a standalone library without Rust code generation:

```typescript
import * as r from 'rkyv-js';

// Define a codec matching your Rust struct
const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.option(r.string),
  scores: r.vec(r.u32),
});

// Infer TypeScript type from the codec
type Person = r.Infer<typeof ArchivedPerson>;

// Encode to rkyv bytes
const data = r.encode(ArchivedPerson, {
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
  scores: [95, 87, 92],
});

// Decode from rkyv bytes
const person = r.decode(ArchivedPerson, data);
console.log(person.name);   // "Alice"
console.log(person.age);    // 30
console.log(person.scores); // [95, 87, 92]

// Lazy access (decodes fields on demand)
const lazy = r.access(ArchivedPerson, data);
console.log(lazy.name); // Only 'name' field is decoded
```

## Codec API

### Primitives

| Codec | Rust Type | TypeScript Type |
|-------|-----------|-----------------|
| `r.u8`, `r.i8` | `u8`, `i8` | `number` |
| `r.u16`, `r.i16` | `u16`, `i16` | `number` |
| `r.u32`, `r.i32` | `u32`, `i32` | `number` |
| `r.u64`, `r.i64` | `u64`, `i64` | `bigint` |
| `r.f32`, `r.f64` | `f32`, `f64` | `number` |
| `r.bool` | `bool` | `boolean` |
| `r.char` | `char` | `string` |
| `r.unit` | `()` | `null` |
| `r.string` | `String` | `string` |

### Containers

| Codec | Rust Type | TypeScript Type |
|-------|-----------|-----------------|
| `r.vec(T)` | `Vec<T>` | `T[]` |
| `r.option(T)` | `Option<T>` | `T \| null` |
| `r.box(T)` | `Box<T>` | `T` |
| `r.array(T, N)` | `[T; N]` | `T[]` |
| `r.tuple(T1, T2, ...)` | `(T1, T2, ...)` | `[T1, T2, ...]` |

### Composite Types

| Codec | Rust Type | TypeScript Type |
|-------|-----------|-----------------|
| `r.struct({...})` | `struct { ... }` | `{ ... }` |
| `r.taggedEnum({...})` | `enum { ... }` | `{ tag: string, value: ... }` |

### Smart Pointers

| Codec | Rust Type | TypeScript Type |
|-------|-----------|-----------------|
| `r.rc(T)` | `Rc<T>` | `T` |
| `r.arc(T)` | `Arc<T>` | `T` |
| `r.rcWeak(T)` | `rc::Weak<T>` | `T \| null` |
| `r.arcWeak(T)` | `sync::Weak<T>` | `T \| null` |

### External Crate Types

The codegen recognizes types from [external crates that rkyv supports](https://docs.rs/rkyv/latest/rkyv/#crates). Many of these archive to the same format as built-in types:

| Rust Type | Import | TypeScript Type |
|-----------|--------|-----------------|
| `uuid::Uuid` | `rkyv-js/lib/uuid` | `string` |
| `bytes::Bytes` | `rkyv-js/lib/bytes` | `Uint8Array` |
| `std::collections::HashMap<K, V>` | `rkyv-js/lib/std-hash-map` | `Map<K, V>` |
| `std::collections::HashSet<T>` | `rkyv-js/lib/std-hash-set` | `Set<T>` |
| `std::collections::BTreeMap<K, V>` | `rkyv-js/lib/std-btree-map` | `Map<K, V>` |
| `std::collections::BTreeSet<T>` | `rkyv-js/lib/std-btree-set` | `Set<T>` |
| `indexmap::IndexMap<K, V>` | `rkyv-js/lib/indexmap` | `Map<K, V>` |
| `indexmap::IndexSet<T>` | `rkyv-js/lib/indexmap` | `Set<T>` |
| `smol_str::SmolStr` | (none, same as String) | `string` |
| `thin_vec::ThinVec<T>` | (none, same as Vec) | `T[]` |
| `arrayvec::ArrayVec<T, N>` | (none, same as Vec) | `T[]` |
| `smallvec::SmallVec<[T; N]>` | (none, same as Vec) | `T[]` |
| `tinyvec::TinyVec<[T; N]>` | (none, same as Vec) | `T[]` |
| `triomphe::Arc<T>` | (none, same as Box) | `T` |
| `hashbrown::HashMap<K, V>` | (same as HashMap) | `Map<K, V>` |
| `hashbrown::HashSet<T>` | (same as HashSet) | `Set<T>` |

Example usage:

```typescript
import * as r from 'rkyv-js';
import { btreeMap } from 'rkyv-js/lib/std-btree-map';
import { uuid } from 'rkyv-js/lib/uuid';
import { bytes } from 'rkyv-js/lib/bytes';
import { indexSet, indexMap } from 'rkyv-js/lib/indexmap';

const ArchivedRecord = r.struct({
  id: uuid,
  data: bytes,
  tags: indexSet(r.string),
  settings: indexMap(r.string, r.u32),
  orderedConfig: btreeMap(r.string, r.u32),
});
```

## Code Generation

### Source File Extraction

The codegen parses Rust source files and extracts types annotated with `#[derive(Archive)]`:

```rust
use rkyv_js_codegen::CodeGenerator;

fn main() {
    let mut codegen = CodeGenerator::new();

    // Single file
    codegen.add_source_file("src/lib.rs").unwrap();

    // Or scan an entire directory recursively
    codegen.add_source_dir("src/").unwrap();

    // Or pass source code directly
    codegen.add_source_str(r#"
        use rkyv::Archive;

        #[derive(Archive)]
        struct Point { x: f64, y: f64 }
    "#);

    codegen.write_to_file("bindings.ts").unwrap();
}
```

### Import Resolution

The codegen resolves all `use` imports to fully-qualified paths. This means types are matched by their canonical module path, not by their local name.

```rust
use rkyv::Archive;
use std::collections::BTreeMap as MyMap;

#[derive(Archive)]
struct Config {
    data: MyMap<String, u32>,  // Resolved as std::collections::BTreeMap
}
```

Marker aliases are also auto-detected:

```rust
use rkyv::Archive as Rkyv;

#[derive(Rkyv)]  // Recognized as rkyv::Archive
struct Point { x: f64, y: f64 }
```

Note that `#[derive(Archive)]` requires an explicit `use rkyv::Archive;` import (or a `use rkyv::Archive as ...` alias) — the codegen does not assume unresolved names. Wildcard imports (`use rkyv::*`) are not supported.

### Custom Type Registration

You can register custom type mappings for the codegen to use when encountering external types:

```rust
use rkyv_js_codegen::{CodeGenerator, TypeDef};

let mut codegen = CodeGenerator::new();

// Register a custom type with a fully-qualified Rust path.
// {0}, {1} are placeholders for type parameters.
codegen.register_type("my_crate::CustomMap",
    TypeDef::new("customMap({0}, {1})", "Map<{0}, {1}>")
        .with_import("my-package/codecs", "customMap"),
);

// Now `my_crate::CustomMap<K, V>` (or a `use my_crate::CustomMap` alias)
// in source files will generate:
//   import { customMap } from 'my-package/codecs';
//   field: customMap(r.string, r.u32)
```

### Remote Types

Types from external crates that don't support rkyv can be handled via `#[rkyv(remote = ...)]`. The codegen skips proxy types and uses the registered codec for the remote type:

```rust
use rkyv_js_codegen::{CodeGenerator, TypeDef};

let mut codegen = CodeGenerator::new();

// Register a codec for the external type (use the fully-qualified path)
codegen.register_type("external::Coord",
    TypeDef::new("Coord", "Coord")
        .with_import("./coord.ts", "Coord"),
);

codegen.add_source_str(r#"
    use rkyv::Archive;

    // This proxy type is skipped by codegen
    #[derive(Archive)]
    #[rkyv(remote = external::Coord)]
    struct CoordDef {
        x: f32,
        y: f32,
    }

    #[derive(Archive)]
    struct Event {
        name: String,
        location: Coord,  // Uses the registered codec for external::Coord
    }
"#);
```

The user-provided codec (`coord.ts`) has full control over the binary format. It implements the `RkyvCodec<T>` interface and can use any serialization strategy — it's not tied to rkyv's struct layout.

### Programmatic API

You can also build types programmatically without parsing source files:

```rust
use rkyv_js_codegen::{CodeGenerator, TypeDef, EnumVariant};

let mut codegen = CodeGenerator::new();

codegen.add_struct("Person", &[
    ("name", TypeDef::string()),
    ("age", TypeDef::u32()),
    ("email", TypeDef::option(TypeDef::string())),
    ("scores", TypeDef::vec(TypeDef::u32())),
]);

codegen.add_enum("Status", &[
    EnumVariant::Unit("Pending".to_string()),
    EnumVariant::Unit("Active".to_string()),
    EnumVariant::Struct("Error".to_string(), vec![
        ("message".to_string(), TypeDef::string()),
    ]),
]);

codegen.write_to_file("bindings.ts").unwrap();
```

## rkyv Format Notes

rkyv-js assumes the default rkyv v0.8 format:

- **Endianness**: Little-endian
- **Alignment**: Aligned primitives
- **Pointer width**: 32-bit relative pointers
- **Object order**: Depth-first, root at end of buffer
- **String encoding**: rkyv v0.8 inline/outlined hybrid format

If your Rust code uses different `rkyv` features (`big_endian`, `unaligned`, `pointer_width_64`, etc.), encoding/decoding may fail or produce incorrect results.

## Limitations

- Unlike rkyv's `bytecheck`, `rkyv-js` does not validate data integrity
- Trait objects (`rkyv_dyn`) are not supported
- Non-default rkyv formats (big-endian, unaligned, 16/64-bit pointers) are not supported

## License

MIT
