//! # rkyv-js-codegen
//!
//! JavaScript/TypeScript code generator for rkyv types. This crate generates unified codec bindings
//! that work with the `rkyv-js` package API.
//!
//! ## Features
//!
//! - Generates JavaScript/TypeScript codecs for structs, enums, and unions
//! - Full support for rkyv's type system (primitives, containers, nested types)
//! - Automatic dependency ordering for type definitions
//! - Source file parsing to extract types annotated with `#[derive(Archive)]`
//!
//! ## Quick Start
//!
//! ### Using `CodeGenerator` directly
//!
//! ```rust
//! use rkyv_js_codegen::{CodeGenerator, TypeDef, EnumVariant};
//!
//! let mut generator = CodeGenerator::new();
//!
//! // Add a struct
//! generator.add_struct("Person", &[
//!     ("name", TypeDef::String),
//!     ("age", TypeDef::U32),
//!     ("email", TypeDef::Option(Box::new(TypeDef::String))),
//! ]);
//!
//! // Add an enum
//! generator.add_enum("Status", &[
//!     EnumVariant::Unit("Pending".to_string()),
//!     EnumVariant::Unit("Active".to_string()),
//!     EnumVariant::Struct("Error".to_string(), vec![
//!         ("message".to_string(), TypeDef::String),
//!     ]),
//! ]);
//!
//! // Generate code
//! let code = generator.generate();
//! // Or write to file:
//! // generator.write_to_file("bindings.ts").unwrap();
//! ```
//!
//! ### Generated Output
//!
//! The above generates:
//!
//! ```typescript
//! import * as r from 'rkyv-js';
//!
//! export const ArchivedPerson = r.object({
//!   name: r.string,
//!   age: r.u32,
//!   email: r.option(r.string),
//! });
//! export type Person = r.Infer<typeof ArchivedPerson>;
//!
//! export const ArchivedStatus = r.taggedEnum({
//!   Pending: r.unit,
//!   Active: r.unit,
//!   Error: r.object({ message: r.string }),
//! });
//! export type Status = r.Infer<typeof ArchivedStatus>;
//! ```
//!
//! ### Using `#[derive(Archive)]` macro
//!
//! ```rust,ignore
//! use rkyv::Archive;
//!
//! #[derive(Archive)]
//! struct Person {
//!     name: String,
//!     age: u32,
//! }
//! ```
//!
//! Then in `build.rs`:
//!
//! ```rust,ignore
//! use rkyv_js_codegen::CodeGenerator;
//!
//! fn main() {
//!     CodeGenerator::new()
//!         .add_source_file("src/lib.rs").unwrap()
//!         .write_to_file("generated/bindings.ts").unwrap();
//!
//!     println!("cargo:rerun-if-changed=src/lib.rs");
//! }
//! ```
//!
//! ## Type Mappings
//!
//! | Rust Type | TypeDef | TypeScript Codec | TypeScript Type |
//! |-----------|---------|------------------|-----------------|
//! | `u8`-`u32`, `i8`-`i32`, `f32`, `f64` | `TypeDef::U32`, etc. | `r.u32`, etc. | `number` |
//! | `u64`, `i64` | `TypeDef::U64`, `TypeDef::I64` | `r.u64`, `r.i64` | `bigint` |
//! | `bool` | `TypeDef::Bool` | `r.bool` | `boolean` |
//! | `char` | `TypeDef::Char` | `r.char` | `string` |
//! | `()` | `TypeDef::Unit` | `r.unit` | `null` |
//! | `String` | `TypeDef::String` | `r.string` | `string` |
//! | `Vec<T>` | `TypeDef::Vec(Box::new(T))` | `r.vec(T)` | `T[]` |
//! | `Option<T>` | `TypeDef::Option(Box::new(T))` | `r.option(T)` | `T \| null` |
//! | `Box<T>` | `TypeDef::Box(Box::new(T))` | `r.box(T)` | `T` |
//! | `[T; N]` | `TypeDef::Array(Box::new(T), N)` | `r.array(T, N)` | `T[]` |
//! | `(T1, T2)` | `TypeDef::Tuple(vec![...])` | `r.tuple(T1, T2)` | `[T1, T2]` |
//! | `HashMap<K, V>` | `TypeDef::HashMap(...)` | `r.hashMap(K, V)` | `Map<K, V>` |

mod extractor;
mod generator;
mod types;

pub use generator::CodeGenerator;
pub use types::{EnumVariant, LibTypeDef, TypeDef, UnionVariant};
