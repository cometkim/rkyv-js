# rkyv-js

An unofficial JavaScript library for [rkyv](https://rkyv.org/) (Rust's zero-copy deserialization framework) with codegen support.

## Components

This project consists of two parts:

1. `rkyv-js` (NPM package) - JavaScript runtime library for encoding/decoding rkyv archives
2. `rkyv-js-codegen` (Rust crate) - Code generator that creates TypeScript bindings from Rust types

## Installation

### JavaScript/TypeScript

```bash
yarn add rkyv-js
```

### Rust (for code generation)

```toml
# Cargo.toml
[dependencies]
rkyv-js-codegen = "0.1"

[build-dependencies]
rkyv-js-codegen = "0.1"
```

## Quick Start

### Option 1: Code Generation (Recommended)

You can annotate your rkyv types with `rkyv-js-codegen::TypeScript` macro to generate TypeScript bindings:

```rs
use rkyv_js_codegen::TypeScript;

#[derive(Archive, Serialize, Deserialize, TypeScript)]
struct Person {
    name: String,
    age: u32,
    email: Option<String>,
    scores: Vec<u32>,
}
```

Then configure the output in your `build.rs`:

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

    // Automatically extract all types annotated with #[derive(TypeScript)]
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
// struct Person {
//     name: String,
//     age: u32,
//     email: Option<String>,
//     scores: Vec<u32>,
// }
const PersonCodec = r.object({
  name: r.string,
  age: r.u32,
  email: r.optional(r.string),
  scores: r.vec(r.u32),
});

// Infer TypeScript type from the codec
type Person = r.infer<typeof PersonCodec>;

// Encode to rkyv bytes
const data = r.encode(PersonCodec, { 
  name: "Bob",
  age: 25,
  email: null,
  scores: [100],
});

// Decode from rkyv data
const person = r.decode(PersonCodec, data);
console.log(person.name);   // "Alice"
console.log(person.age);    // 30
console.log(person.scores); // [95, 87, 92]

// Lazy access (decodes fields on demand)
const lazy = r.access(PersonCodec, data);
console.log(lazy.name); // Only 'name' field is decoded
```

### Option 3: Low-level CodeGenerator API

You can generate TypeScript codes without macros if you want programmatic control:

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

- **No validation**: Unlike rkyv's `bytecheck`, this library does not validate data integrity
- **HashMap layout**: Simplified sequential storage (not hashbrown's actual layout)
- **Trait objects (`rkyv_dyn`)**: Not supported

## License

MIT
