# rkyv-js

An unofficial library to use [rkyv](https://rkyv.org/) (Zero-copy deserialization framework for Rust) in JavaScript/TypeScript projects.

## Motivation

This library allows JavaScript programs to efficiently exchange data with a Rust backend using rkyv types.

- Archived Rust types can be read directly from JS programs without an additional serialization layer.
- Bytes written in JS programs can be deserialized in Rust programs in a zero-copy manner.

Unlike Protobuf or Cap'n Proto, the schema derived directly from your Rust codebase without having to manage additional schema files.

## Components

This project consists of two parts:

1. `rkyv-js` (NPM package) - JavaScript runtime library for encoding/decoding rkyv archives
2. `rkyv-js-codegen` (Rust crate) - Code generator that creates JavaScript/TypeScript bindings from Rust source

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

To `rkyv-js-codegen` extract archived types from your Rust codebase.

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
use rkyv_js_codegen::{CodeGenerator, TypeDef};

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

    // Write to OUT_DIR (standard cargo location)
    codegen.write_to_file(out_dir.join("bindings.ts"))
        .expect("Failed to write bindings");

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=build.rs");
}
```

### Option 2: Manual Schema Definition

You can also use `rkyv-js` as a standalone library without Rust code generation:

```typescript
import { r } from 'rkyv-js';

// Define a codec matching your Rust struct:
//
// #[derive(rkyv::Archive)]
// struct Person {
//   name: String,
//   age: u32,
//   email: Option<String>,
//   scores: Vec<u32>,
// }
const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.optional(r.string),
  scores: r.vec(r.u32),
});

// Infer TypeScript type from the codec
type Person = r.infer<typeof ArchivedPerson>;

// Encode to rkyv bytes
const data = r.encode(ArchivedPerson, { 
  name: "Bob",
  age: 25,
  email: null,
  scores: [100],
});

// Decode from rkyv data
const person = r.decode(ArchivedPerson, data);
console.log(person.name);   // "Alice"
console.log(person.age);    // 30
console.log(person.scores); // [95, 87, 92]

// Lazy access (decodes fields on demand)
const lazy = r.access(ArchivedPerson, data);
console.log(lazy.name); // Only 'name' field is decoded
```

### Option 3: Low-level CodeGenerator API

You can generate bindings without rkyv macros if you want programmatic control:

```rust
use rkyv_js_codegen::{CodeGenerator, TypeDef};

fn main() {
    let mut generator = CodeGenerator::new();

    generator.add_struct("Person", &[
        ("name", TypeDef::String),
        ("age", TypeDef::U32),
        ("email", TypeDef::Option(Box::new(TypeDef::String))),
        ("scores", TypeDef::Vec(Box::new(TypeDef::U32))),
    ]);

    generator.write_to_file("generated/bindings.ts").unwrap();
}
```

## Type Mappings

| Rust Type | TypeDef | TypeScript Type |
|-----------|---------|-----------------|
| `u8`, `i8`, `u16`, `i16`, `u32`, `i32` | `TypeDef::U32`, etc. | `number` |
| `u64`, `i64` | `TypeDef::U64`, `TypeDef::I64` | `bigint` |
| `f32`, `f64` | `TypeDef::F32`, `TypeDef::F64` | `number` |
| `bool` | `TypeDef::Bool` | `boolean` |
| `char` | `TypeDef::Char` | `string` |
| `()` | `TypeDef::Unit` | `null` |
| `String` | `TypeDef::String` | `string` |
| `Vec<T>` | `TypeDef::Vec(Box::new(T))` | `T[]` |
| `Option<T>` | `TypeDef::Option(Box::new(T))` | `T \| null` |
| `Box<T>` | `TypeDef::Box(Box::new(T))` | `T` |
| `[T; N]` | `TypeDef::Array(Box::new(T), N)` | `T[]` |
| `(T1, T2, ...)` | `TypeDef::Tuple(vec![...])` | `[T1, T2, ...]` |
| `HashMap<K, V>` | `TypeDef::HashMap(...)` | `Map<K, V>` |


## rkyv Format Notes

rkyv-js assumes the default rkyv v0.8 format:

- **Endianness**: Little-endian
- **Alignment**: Aligned primitives
- **Pointer width**: 32-bit relative pointers
- **Object order**: Depth-first, root at end of buffer
- **String encoding**: rkyv v0.8 inline/outlined hybrid format

If your Rust code uses different `rkyv` features (`big_endian`, `unaligned`, `pointer_width_64`, etc.), encoding/decoding may fail or produce incorrect results.

## Limitations

- **No validation**: Unlike rkyv's `bytecheck`, `rkyv-js` does not validate data integrity
- **HashMap layout**: Simplified sequential storage (not hashbrown's actual layout)
- **Trait objects (`rkyv_dyn`)**: Not supported

Also advanced features like wrapper types and remote types are not yet supported.

## License

MIT
