# rkyv-js

A TypeScript decoder library for [rkyv](https://rkyv.org/) (Rust zero-copy deserialization framework), with Rust codegen support.

## Overview

rkyv is a zero-copy deserialization framework for Rust that achieves extremely fast serialization and deserialization by using a binary format that matches the in-memory representation of Rust types.

**rkyv-js** allows you to decode rkyv-serialized binary data directly in TypeScript/JavaScript, enabling interoperability between Rust backends and JavaScript frontends without the overhead of JSON or other text-based formats.

## Components

This project consists of two parts:

1. **`rkyv-js`** (npm package) - TypeScript library for decoding rkyv archives
2. **`rkyv-js-codegen`** (Rust crate) - Code generator that creates TypeScript bindings from Rust types

## Features

- **Type-safe**: Full TypeScript support with automatic type inference
- **Zero dependencies**: Pure TypeScript implementation using native `DataView`
- **Comprehensive**: Supports primitives, strings, vectors, options, boxes, tuples, structs, and enums
- **Code generation**: Automatically generate TypeScript decoders from Rust types
- **Configurable**: Matches rkyv's default format (little-endian, aligned, 32-bit pointers)

## Installation

### JavaScript/TypeScript

```bash
npm install rkyv-js
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

### Option 1: Manual Schema Definition

```typescript
import { access, struct, string, u32, vec } from 'rkyv-js';

// Define a decoder matching your Rust struct:
// #[derive(Archive)]
// struct Person {
//     name: String,
//     age: u32,
//     scores: Vec<u32>,
// }

const PersonDecoder = struct({
  name: { decoder: string },
  age: { decoder: u32 },
  scores: { decoder: vec(u32) },
});

// Decode from rkyv bytes (e.g., from a Rust server or WASM)
const person = access(bytes, PersonDecoder);

console.log(person.name);   // "Alice"
console.log(person.age);    // 30
console.log(person.scores); // [95, 87, 92]
```

### Option 2: Code Generation (Recommended)

#### Rust side (`build.rs`)

```rust
use rkyv_js_codegen::{CodeGenerator, TypeDef};

fn main() {
    let mut gen = CodeGenerator::new();

    gen.add_struct("Person", &[
        ("name", TypeDef::String),
        ("age", TypeDef::U32),
        ("scores", TypeDef::Vec(Box::new(TypeDef::U32))),
    ]);

    gen.write_to_file("generated/bindings.ts").unwrap();
}
```

#### Generated TypeScript (`bindings.ts`)

```typescript
import {
  struct,
  u32,
  string,
  vec,
  type RkyvDecoder,
} from 'rkyv-js';

export interface Person {
  name: string;
  age: number;
  scores: number[];
}

export const PersonDecoder: RkyvDecoder<Person> = struct({
  name: { decoder: string },
  age: { decoder: u32 },
  scores: { decoder: vec(u32) },
});
```

#### Using generated bindings

```typescript
import { access } from 'rkyv-js';
import { PersonDecoder, Person } from './generated/bindings';

const person: Person = access(bytes, PersonDecoder);
```

## Rust Code Generation

### Using `CodeGenerator` directly

```rust
use rkyv_js_codegen::{CodeGenerator, TypeDef, EnumVariant};

let mut gen = CodeGenerator::new();

// Set a custom header
gen.set_header("Generated bindings for my-app");

// Add structs
gen.add_struct("Point", &[
    ("x", TypeDef::F64),
    ("y", TypeDef::F64),
]);

// Add enums (tagged unions)
gen.add_enum("Message", &[
    EnumVariant::Unit("Quit".to_string()),
    EnumVariant::Struct("Move".to_string(), vec![
        ("x".to_string(), TypeDef::I32),
        ("y".to_string(), TypeDef::I32),
    ]),
    EnumVariant::Tuple("Write".to_string(), vec![TypeDef::String]),
]);

// Add unions (untagged)
gen.add_union("NumberUnion", &[
    UnionVariant::new("asU32", TypeDef::U32),
    UnionVariant::new("asF32", TypeDef::F32),
    UnionVariant::new("asBytes", TypeDef::Array(Box::new(TypeDef::U8), 4)),
]);

// Generate to file
gen.write_to_file("bindings.ts")?;
```

### Using `#[derive(TypeScript)]` macro

```rust
use rkyv::Archive;
use rkyv_js_codegen::TypeScript;

#[derive(Archive, TypeScript)]
struct Person {
    name: String,
    age: u32,
    email: Option<String>,
}

#[derive(Archive, TypeScript)]
enum Status {
    Pending,
    Active,
    Error { message: String },
}

// In build.rs, register types:
fn main() {
    let mut gen = CodeGenerator::new();
    
    // Use generated registration functions
    __register_typescript_person(&mut gen);
    __register_typescript_status(&mut gen);
    
    gen.write_to_file("bindings.ts").unwrap();
}
```

### Supported Type Mappings

| Rust Type | TypeDef | TypeScript Type |
|-----------|---------|-----------------|
| `u8`, `i8`, `u16`, `i16`, `u32`, `i32` | `TypeDef::U32`, etc. | `number` |
| `u64`, `i64` | `TypeDef::U64`, `TypeDef::I64` | `bigint` |
| `f32`, `f64` | `TypeDef::F32`, `TypeDef::F64` | `number` |
| `bool` | `TypeDef::Bool` | `boolean` |
| `char` | `TypeDef::Char` | `string` |
| `String` | `TypeDef::String` | `string` |
| `Vec<T>` | `TypeDef::Vec(Box::new(T))` | `T[]` |
| `Option<T>` | `TypeDef::Option(Box::new(T))` | `T \| null` |
| `Box<T>` | `TypeDef::Box(Box::new(T))` | `T` |
| `[T; N]` | `TypeDef::Array(Box::new(T), N)` | `T[]` |
| `(T1, T2, ...)` | `TypeDef::Tuple(vec![...])` | `[T1, T2, ...]` |
| `HashMap<K, V>` | `TypeDef::HashMap(...)` | `Map<K, V>` |
| Custom struct | `TypeDef::Named("Name")` | Interface |

## TypeScript API Reference

### Primitive Decoders

```typescript
import { u8, i8, u16, i16, u32, i32, u64, i64, f32, f64, bool, char } from 'rkyv-js';
```

### Container Decoders

```typescript
import { string, vec, option, box_, array, tuple } from 'rkyv-js';

const numbersDecoder = vec(u32);
const maybeNameDecoder = option(string);
const boxedDecoder = box_(u32);
const coords = array(f64, 3);
const pair = tuple(u32, string);
```

### Struct & Enum Decoders

```typescript
import { struct, enumType } from 'rkyv-js';

const PointDecoder = struct({
  x: { decoder: u32 },
  y: { decoder: u32 },
});

// Enums are tagged unions
const MessageDecoder = enumType<{
  Quit: undefined;
  Move: { x: number; y: number };
}>({
  Quit: {},
  Move: { fields: { x: { decoder: u32 }, y: { decoder: u32 } } },
});
```

### Union Decoders

```typescript
import { union, taggedUnion } from 'rkyv-js';

// Untagged union - all variants occupy same memory
const NumberUnion = union({
  asU32: { decoder: u32 },
  asF32: { decoder: f32 },
  asBytes: { decoder: array(u8, 4) },
});

// Decode all variants at once
const all = NumberUnion.decode(reader, offset);
// { asU32: 1065353216, asF32: 1.0, asBytes: [0, 0, 128, 63] }

// Or decode a specific variant
const value = NumberUnion.as('asF32').decode(reader, offset); // 1.0

// Tagged union with external discriminant
const TaggedNumber = taggedUnion(u8, {
  0: { name: 'int', decoder: i32 },
  1: { name: 'float', decoder: f32 },
});
// { tag: 'int', value: 42 } or { tag: 'float', value: 3.14 }
```

### Access Functions

```typescript
import { access, accessAt, createArchive } from 'rkyv-js';

// Decode root object (rkyv stores root at end of buffer)
const data = access(bytes, MyDecoder);

// Decode at specific offset
const item = accessAt(bytes, MyDecoder, offset);

// Create reusable archive for multiple reads
const archive = createArchive(bytes);
const root = archive.root(MyDecoder);
```

### Type Inference

```typescript
import { Infer } from 'rkyv-js';

type Person = Infer<typeof PersonDecoder>;
// { name: string; age: number }
```

## rkyv Format Notes

rkyv-js assumes the default rkyv format:

- **Endianness**: Little-endian
- **Alignment**: Aligned primitives
- **Pointer width**: 32-bit relative pointers
- **Object order**: Depth-first, root at end of buffer

If your Rust code uses different `rkyv` features (`big_endian`, `unaligned`, `pointer_width_64`, etc.), decoding may fail or produce incorrect results.

## Limitations

- **Read-only**: This library only decodes data; it cannot serialize TypeScript objects to rkyv format
- **No validation**: Unlike rkyv's `bytecheck`, this library does not validate data integrity
- **HashMap/BTreeMap**: Simplified implementation that may not work with all rkyv hash map layouts
- **Trait objects**: Not supported (rkyv_dyn)

## Use Cases

- **Rust → JavaScript interop**: Decode data from Rust servers or WASM modules
- **High-performance data loading**: When JSON parsing is too slow
- **Binary file formats**: Read rkyv-serialized files in the browser or Node.js

## Project Structure

```
rkyv-js/
├── src/                      # TypeScript library source
│   ├── index.ts              # Main exports
│   ├── reader.ts             # Binary buffer reader
│   ├── types.ts              # Primitive & container decoders
│   └── schema.ts             # Struct & enum schema builders
├── crates/
│   ├── rkyv-js-codegen/      # Rust code generator library
│   ├── rkyv-js-derive/       # Proc-macro for #[derive(TypeScript)]
│   └── example/              # Example Rust project
├── tests/                    # TypeScript tests
└── examples/                 # TypeScript usage examples
```

## License

MIT
