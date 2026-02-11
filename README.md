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

| Rust Type | JavaScript Codec | TypeScript Type |
|-----------|-------|-----------------|
| `u8`, `i8` | `r.u8`, `r.i8` | `number` |
| `u16`, `i16` | `r.u16`, `r.i16` | `number` |
| `u32`, `i32` | `r.u32`, `r.i32` | `number` |
| `u64`, `i64` | `r.u64`, `r.i64` | `bigint` |
| `f32`, `f64` | `r.f32`, `r.f64` | `number` |
| `bool` | `r.bool` | `boolean` |
| `char` | `r.char` | `string` |
| `()` | `r.unit` | `null` |
| `String` | `r.string` | `string` |

### Containers

| Rust Type | JavaScript Codec | TypeScript Type |
|-----------|-------|-----------------|
| `Vec<T>` | `r.vec(T)` | `T[]` |
| `Option<T>` | `r.option(T)` | `T \| null` |
| `Box<T>` | `r.box(T)` | `T` |
| `[T; N]` | `r.array(T, N)` | `T[]` |
| `(T1, T2, ...)` | `r.tuple(T1, T2, ...)` | `[T1, T2, ...]` |

### Composite Types

| Rust Type | JavaScript Codec | TypeScript Type |
|-----------|-------|-----------------|
| `struct { ... }` | `r.struct({...})` | `{ ... }` |
| `enum { ... }` | `r.taggedEnum({...})` | `{ tag: string, value: ... }` |

### Smart Pointers

| Rust Type | JavaScript Codec | TypeScript Type |
|-----------|-------|-----------------|
| `std::rc::Rc<T>`, `std::sync::Arc<T>` | `r.rc(T)` | `T` |
| `std::rc::Weak<T>`, `std::sync::Weak<T>` | `r.weak(T)` | `T \| null` |

### External Crate Types

The codegen recognizes types from [external crates that rkyv supports](https://docs.rs/rkyv/latest/rkyv/#crates). Many of these archive to the same format as built-in types:

| Rust Type | JavaScript Codec | TypeScript Type |
|-----------|-------|-----------------|
| `uuid::Uuid` | `import { uuid } from 'rkyv-js/lib/uuid'` | `string` |
| `bytes::Bytes` | `import { bytes } from 'rkyv-js/lib/bytes'` | `Uint8Array` |
| `std::collections::BTreeMap<K, V>` | `import { btreeMap } from 'rkyv-js/lib/btreemap'` | `Map<K, V>` |
| `std::collections::BTreeSet<T>` | `import { btreeSet } from 'rkyv-js/lib/btreemap'` | `Set<T>` |
| `std::collections::HashMap<K, V>` | `import { hashMap } from 'rkyv-js/lib/hashmap'` | `Map<K, V>` |
| `std::collections::HashSet<T>` | `import { hashSet } from 'rkyv-js/lib/hashmap'` | `Set<T>` |
| `hashbrown::HashMap<K, V>` | `import { hashMap } from 'rkyv-js/lib/hashmap'` | `Map<K, V>` |
| `hashbrown::HashSet<T>` | `import { hashSet } from 'rkyv-js/lib/hashmap'` | `Set<T>` |
| `indexmap::IndexMap<K, V>` | `import { indexMap } from 'rkyv-js/lib/indexmap'` | `Map<K, V>` |
| `indexmap::IndexSet<T>` | `import { indexSet } from 'rkyv-js/lib/indexmap'` | `Set<T>` |
| `smol_str::SmolStr` | `r.string` | `string` |
| `thin_vec::ThinVec<T>` | `r.vec(T)` | `T[]` |
| `arrayvec::ArrayVec<T, N>` | `r.vec(T)` | `T[]` |
| `smallvec::SmallVec<[T; N]>` | `r.vec(T)` | `T[]` |
| `tinyvec::TinyVec<[T; N]>` | `r.vec(T)` | `T[]` |
| `triomphe::Arc<T>` | `r.rc(T)` | `T` |

Example usage:

```typescript
import * as r from 'rkyv-js';
import { btreeMap } from 'rkyv-js/lib/btreemap';
import { bytes } from 'rkyv-js/lib/bytes';
import { indexSet, indexMap } from 'rkyv-js/lib/indexmap';
import { uuid } from 'rkyv-js/lib/uuid';

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
