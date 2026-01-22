//! Proc-macro providing the `#[derive(TypeScript)]` attribute.
//!
//! This macro is a **no-op annotation** - it doesn't generate any code.
//! It serves as documentation to indicate that a type should have
//! TypeScript bindings generated via `rkyv-js-codegen` in your build.rs.
//!
//! # Usage
//!
//! 1. Annotate your types with `#[derive(TypeScript)]`
//! 2. Use `CodeGenerator` in your build.rs to generate the actual bindings
//!
//! # Example
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
//! Then in your build.rs:
//!
//! ```rust,ignore
//! use rkyv_js_codegen::{CodeGenerator, TypeDef};
//!
//! fn main() {
//!     let mut gen = CodeGenerator::new();
//!     gen.add_struct("Person", &[
//!         ("name", TypeDef::String),
//!         ("age", TypeDef::U32),
//!     ]);
//!     gen.write_to_file("bindings.ts").unwrap();
//! }
//! ```

use proc_macro::TokenStream;

/// Marker derive macro for TypeScript binding generation.
///
/// This macro is a no-op - it doesn't generate any code at compile time.
/// It serves as documentation to indicate that a type should have
/// TypeScript bindings generated via `CodeGenerator` in your build.rs.
///
/// The actual binding generation happens in build.rs using `CodeGenerator`.
#[proc_macro_derive(TypeScript, attributes(typescript))]
pub fn derive_typescript(_input: TokenStream) -> TokenStream {
    // No-op: actual code generation happens in build.rs
    TokenStream::new()
}
