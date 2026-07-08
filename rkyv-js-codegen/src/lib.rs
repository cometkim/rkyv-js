//! # rkyv-js-codegen
//!
//! TypeScript codec-binding generator for [rkyv](https://rkyv.org) types,
//! targeting the `rkyv-js` runtime.
//!
//! The generator parses Rust sources with `syn`, extracts every type marked
//! with `#[derive(Archive)]` (or a custom marker), and emits one
//! `export const Archived{Name} = ...` codec per type. TypeScript types are
//! always derived from the codecs via `r.Infer<typeof Archived{Name}>`.
//!
//! ## build.rs
//!
//! ```no_run
//! use rkyv_js_codegen::CodeGenerator;
//!
//! fn main() -> Result<(), rkyv_js_codegen::Error> {
//!     CodeGenerator::new()
//!         .add_source_file("src/lib.rs")?
//!         .write_to_file("generated/bindings.ts")?;
//!
//!     println!("cargo:rerun-if-changed=src/lib.rs");
//!     Ok(())
//! }
//! ```
//!
//! ## Expressions instead of format strings
//!
//! Codec expressions are a typed tree ([`CodecExpr`]) with builders that
//! mirror the runtime combinators ([`codec`]):
//!
//! ```
//! use rkyv_js_codegen::{CodeGenerator, codec};
//!
//! let mut generator = CodeGenerator::new();
//! generator.add_struct("Person", [
//!     ("name", codec::string()),
//!     ("age", codec::u32()),
//!     ("email", codec::option(codec::string())),
//! ]);
//! let code = generator.generate()?;
//! assert!(code.contains("email: r.option(r.string),"));
//! # Ok::<(), rkyv_js_codegen::Error>(())
//! ```
//!
//! ## Extending the registry
//!
//! External crate types are registered by fully-qualified Rust path:
//!
//! ```
//! use rkyv_js_codegen::{CodeGenerator, CodecExpr, ExternalType, WithWrapper};
//!
//! let mut generator = CodeGenerator::new();
//!
//! // `my_crate::MyVec<T>` → `myVec(T)` from a custom module.
//! generator.register_external(
//!     "my_crate::MyVec",
//!     ExternalType::generic1(|t| {
//!         CodecExpr::call(CodecExpr::import_from("my-package/codecs", "myVec"), [t])
//!     }),
//! );
//!
//! // `#[rkyv(with = AsJson)]` fields → a hand-written codec.
//! generator.register_with(
//!     "AsJson",
//!     WithWrapper::replace(CodecExpr::import_from("./custom.ts", "asJson")),
//! );
//! ```
//!
//! ## Error handling
//!
//! Parse failures surface immediately from `add_source_*`; everything else
//! is validated in [`CodeGenerator::generate`], which aggregates all
//! [`Diagnostic`]s into a single [`Error::Codegen`]. Set
//! [`OnUnknown::SkipContainingType`] to emit `cargo:warning`s and omit
//! affected types instead of failing.

mod error;
mod expr;
mod extractor;
mod generator;
mod registry;

pub use error::{Diagnostic, DiagnosticKind, Error, SourceLocation};
pub use expr::{CodecExpr, Import, codec, generate_import_block};
pub use generator::{CodeGenerator, EnumVariant, OnUnknown};
pub use registry::{ExternalType, WithWrapper};
