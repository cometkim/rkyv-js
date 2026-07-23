//! # rkyv-js-codegen
//!
//! TypeScript codec-binding generator for [rkyv](https://rkyv.org) types, targeting the `rkyv-js` runtime.
//!
//! The generator parses Rust sources with `syn`,
//! extracts every type marked with `#[derive(Archive)]` (or a custom marker),
//! and emits one `export const Archived{Name} = ...` codec per type.
//!
//! TypeScript types are always derived from the codecs via `r.Infer<typeof Archived{Name}>`.
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
//! ## Source extraction
//!
//! [`add_source_file`](CodeGenerator::add_source_file),
//! [`add_source_dir`](CodeGenerator::add_source_dir) (recursive), and
//! [`add_source_str`](CodeGenerator::add_source_str) all extract every type carrying the marker derive.
//! `use` imports are resolved to fully-qualified paths — aliases and globs included —
//! so registry lookups never depend on local names:
//!
//! ```
//! use rkyv_js_codegen::CodeGenerator;
//!
//! let mut generator = CodeGenerator::new();
//! generator.add_source_str(r#"
//!     use rkyv::Archive;
//!
//!     #[derive(Archive)]
//!     pub struct Point { pub x: f64, pub y: f64 }
//! "#)?;
//!
//! assert_eq!(generator.archived_name_of("Point").as_deref(), Some("ArchivedPoint"));
//! # Ok::<(), rkyv_js_codegen::Error>(())
//! ```
//!
//! `#[derive(Archive)]` must be resolvable — through `use rkyv::Archive`, an
//! alias, a `use rkyv::*` glob, or an extra marker registered with
//! [`add_marker_path`](CodeGenerator::add_marker_path).
//!
//! ## Output options
//!
//! | Method | Effect |
//! |--------|--------|
//! | [`set_header`](CodeGenerator::set_header) | Replace the generated file's header comment |
//! | [`set_archived_name`](CodeGenerator::set_archived_name) | Override an export name, matching `#[rkyv(archived = Name)]` |
//! | [`set_direction`](CodeGenerator::set_direction) | Emit full, decode-only, or encode-only bindings |
//! | [`set_format`](CodeGenerator::set_format) | Target a non-default rkyv wire format |
//! | [`allow_typescript_syntax`](CodeGenerator::allow_typescript_syntax) | Drop `export type` lines, emitting plain JavaScript |
//! | [`on_unknown_type`](CodeGenerator::on_unknown_type) | Fail, or warn and omit, on unmappable types |
//!
//! ```
//! use rkyv_js_codegen::{CodeGenerator, Direction};
//!
//! let mut generator = CodeGenerator::new();
//! generator
//!     .set_direction(Direction::Decode)   // imports become `rkyv-js/decode`
//!     .set_format("big", 64, true)        // mirrors rkyv's feature flags
//!     .allow_typescript_syntax(false);
//! ```
//!
//! [`Direction`] rewrites only the `rkyv-js` import specifiers.
//!
//! Factory names and type exports are unchanged, and modules registered through
//! [`register_external`](CodeGenerator::register_external) are left alone,
//! so one schema can produce direction-matched bundles for a browser client and a Rust-facing service.
//!
//! Emission is deterministic: dependency-ordered, alphabetical within ties, so generated files diff cleanly.
//!
//! ## Expressions instead of format strings
//!
//! Codec expressions are a typed tree ([`CodecExpr`]) with builders that mirror the runtime combinators ([`codec`]):
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
//! Parse failures surface immediately from `add_source_*`; everything else is validated in [`CodeGenerator::generate`],
//! which aggregates all [`Diagnostic`]s into a single [`Error::Codegen`].
//!
//! Set [`OnUnknown::SkipContainingType`] to emit `cargo:warning`s and omit affected types instead of failing.

mod error;
mod expr;
mod extractor;
mod generator;
mod registry;

pub use error::{Diagnostic, DiagnosticKind, Error, SourceLocation};
pub use expr::{CodecExpr, Import, codec, generate_import_block};
pub use generator::{CodeGenerator, Direction, EnumVariant, OnUnknown};
pub use registry::{ExternalType, WithWrapper};
