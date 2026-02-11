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
//! - Full `use` import resolution — type paths are resolved to their fully-qualified forms
//! - Extensible type registry for external crate support
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
//!     ("name", TypeDef::string()),
//!     ("age", TypeDef::u32()),
//!     ("email", TypeDef::option(TypeDef::string())),
//! ]);
//!
//! // Add an enum
//! generator.add_enum("Status", &[
//!     EnumVariant::Unit("Pending".to_string()),
//!     EnumVariant::Unit("Active".to_string()),
//!     EnumVariant::Struct("Error".to_string(), vec![
//!         ("message".to_string(), TypeDef::string()),
//!     ]),
//! ]);
//!
//! // Generate code
//! let code = generator.generate();
//! // Or write to file:
//! // generator.write_to_file("bindings.ts").unwrap();
//! ```
//!
//! ### Extending with Custom Types
//!
//! ```
//! # fn main() {
//! use rkyv_js_codegen::{CodeGenerator, TypeDef};
//!
//! let mut generator = CodeGenerator::new();
//!
//! // Register a custom type mapping (use fully-qualified Rust path)
//! generator.register_type("my_crate::MyCustomVec",
//!     TypeDef::new("myVec({0})", "{0}[]")
//!         .with_import("my-package/codecs", "myVec"),
//! );
//!
//! // Now the generator will recognize `my_crate::MyCustomVec<T>` in source files
//! # }
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
//! ```no_run
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
//! | `u8`-`u32`, `i8`-`i32`, `f32`, `f64` | `TypeDef::u32()`, etc. | `r.u32`, etc. | `number` |
//! | `u64`, `i64` | `TypeDef::u64()`, `TypeDef::i64()` | `r.u64`, `r.i64` | `bigint` |
//! | `bool` | `TypeDef::bool()` | `r.bool` | `boolean` |
//! | `char` | `TypeDef::char()` | `r.char` | `string` |
//! | `()` | `TypeDef::unit()` | `r.unit` | `null` |
//! | `String` | `TypeDef::string()` | `r.string` | `string` |
//! | `Vec<T>` | `TypeDef::vec(T)` | `r.vec(T)` | `T[]` |
//! | `Option<T>` | `TypeDef::option(T)` | `r.option(T)` | `T \| null` |
//! | `Box<T>` | `TypeDef::boxed(T)` | `r.box(T)` | `T` |
//! | `[T; N]` | `TypeDef::array(T, N)` | `r.array(T, N)` | `T[]` |
//! | `(T1, T2)` | `TypeDef::tuple(vec![...])` | `r.tuple(T1, T2)` | `[T1, T2]` |
//! | External types | `TypeDef::new(...)` | via registry | via registry |

mod extractor;
mod generator;
pub mod registry;
mod types;

pub use generator::CodeGenerator;
pub use types::{EnumVariant, Import, TypeDef, UnionVariant, generate_imports};
