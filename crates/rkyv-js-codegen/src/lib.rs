//! # rkyv-js-codegen
//!
//! TypeScript code generator for rkyv types. This crate generates decoder and encoder
//! bindings that work with the `rkyv-js` npm package.
//!
//! ## Usage
//!
//! ### 1. Annotate your types with `#[derive(TypeScript)]`
//!
//! ```rust,ignore
//! use rkyv::Archive;
//! use rkyv_js_codegen::TypeScript;
//!
//! #[derive(Archive, TypeScript)]
//! struct Person {
//!     name: String,
//!     age: u32,
//! }
//! ```
//!
//! ### 2. Generate bindings in build.rs
//!
//! ```rust,ignore
//! // build.rs
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
//! The generator will automatically find all types annotated with `#[derive(TypeScript)]`
//! and generate both decoder and encoder bindings.

mod extractor;
mod generator;
mod types;

pub use generator::CodeGenerator;
pub use types::{EnumVariant, TypeDef, UnionVariant};

#[cfg(feature = "derive")]
pub use rkyv_js_derive::TypeScript;
