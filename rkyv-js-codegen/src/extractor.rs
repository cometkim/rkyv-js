//! Source file parser that extracts types annotated with `#[derive(Archive)]`.
//!
//! This module provides functionality to scan Rust source files and automatically
//! extract type definitions for TypeScript binding generation.
//!
//! Type resolution for external crates is handled by the [`TypeRegistry`](crate::registry::TypeRegistry)
//! on the [`CodeGenerator`], so adding support for new external types requires no changes here.
//!
//! ## Use-item analysis
//!
//! The extractor automatically processes `use` statements in each source file to
//! build a mapping from local names to fully-qualified module paths:
//!
//! - `use std::collections::BTreeMap` maps `"BTreeMap"` to `"std::collections::BTreeMap"`
//! - `use std::collections::BTreeMap as MyMap` maps `"MyMap"` to `"std::collections::BTreeMap"`
//! - `use rkyv::Archive as Rkyv` maps `"Rkyv"` to `"rkyv::Archive"`, which is then
//!   recognized as a valid derive marker.

use crate::CodeGenerator;
use crate::types::{EnumVariant, TypeDef};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use syn::{
    Attribute, Data, DeriveInput, Fields, GenericArgument, PathArguments, Type, TypeArray,
    TypePath, TypeTuple, UseTree,
};
use walkdir::WalkDir;

/// Per-file context built from `use` items.
///
/// This holds the import map for a single source file, so that type resolution
/// and derive detection work with fully-qualified paths.
struct SourceContext {
    /// Maps local name -> fully-qualified path.
    ///
    /// Populated for both plain imports (`use foo::Bar` -> `"Bar" => "foo::Bar"`)
    /// and renames (`use foo::Bar as Baz` -> `"Baz" => "foo::Bar"`).
    /// Glob imports are not tracked since they can't be resolved statically.
    imports: HashMap<String, String>,
}

/// Recursively flatten a `UseTree` into import entries.
///
/// Each entry maps the local name to its fully-qualified path built from `prefix`.
fn collect_imports(
    tree: &UseTree,
    prefix: &[String],
    imports: &mut HashMap<String, String>,
) {
    match tree {
        UseTree::Path(p) => {
            let mut new_prefix = prefix.to_vec();
            new_prefix.push(p.ident.to_string());
            collect_imports(&p.tree, &new_prefix, imports);
        }
        UseTree::Name(n) => {
            let name = n.ident.to_string();
            let full_path = make_full_path(prefix, &name);
            imports.insert(name, full_path);
        }
        UseTree::Rename(r) => {
            let canonical = r.ident.to_string();
            let alias = r.rename.to_string();
            let full_path = make_full_path(prefix, &canonical);
            imports.insert(alias, full_path);
        }
        UseTree::Glob(_) => {
            // Glob imports can't be resolved statically
        }
        UseTree::Group(g) => {
            for item in &g.items {
                collect_imports(item, prefix, imports);
            }
        }
    }
}

/// Join prefix segments with the final name using `::`.
fn make_full_path(prefix: &[String], name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{}::{}", prefix.join("::"), name)
    }
}

/// Build a `SourceContext` from all `use` items and type aliases in a parsed file.
fn build_source_context(file: &syn::File) -> SourceContext {
    let mut imports = HashMap::new();

    for item in &file.items {
        match item {
            syn::Item::Use(item_use) => {
                collect_imports(&item_use.tree, &[], &mut imports);
            }
            // `type Foo<..> = some::path::Bar<..>` → maps "Foo" to "some::path::Bar"
            syn::Item::Type(item_type) => {
                if let Type::Path(TypePath { path, .. }) = &*item_type.ty
                    && path.segments.len() > 1
                {
                    let full_path = path
                        .segments
                        .iter()
                        .map(|s| s.ident.to_string())
                        .collect::<Vec<_>>()
                        .join("::");
                    imports.insert(item_type.ident.to_string(), full_path);
                }
            }
            _ => {}
        }
    }

    SourceContext { imports }
}

/// Extract the remote type path from `#[rkyv(remote = some::Type)]`, if present.
///
/// Returns the full qualified path (e.g., `"chrono::NaiveDate"` from `chrono::NaiveDate`).
fn extract_rkyv_remote(attrs: &[Attribute]) -> Option<String> {
    for attr in attrs {
        if !attr.path().is_ident("rkyv") {
            continue;
        }
        if let Ok(nested) = attr.parse_args_with(
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
        ) {
            for meta in &nested {
                if let syn::Meta::NameValue(nv) = meta
                    && nv.path.is_ident("remote")
                    && let syn::Expr::Path(expr_path) = &nv.value
                {
                    let path_str = expr_path
                        .path
                        .segments
                        .iter()
                        .map(|s| s.ident.to_string())
                        .collect::<Vec<_>>()
                        .join("::");
                    return Some(path_str);
                }
            }
        }
    }
    None
}

/// Extract the archived name from `#[rkyv(archived = Name)]`, if present.
///
/// Returns the identifier (e.g., `"ArchivedFoo"` from `#[rkyv(archived = ArchivedFoo)]`).
fn extract_rkyv_archived(attrs: &[Attribute]) -> Option<String> {
    for attr in attrs {
        if !attr.path().is_ident("rkyv") {
            continue;
        }
        if let Ok(nested) = attr.parse_args_with(
            syn::punctuated::Punctuated::<syn::Meta, syn::Token![,]>::parse_terminated,
        ) {
            for meta in &nested {
                if let syn::Meta::NameValue(nv) = meta
                    && nv.path.is_ident("archived")
                    && let syn::Expr::Path(expr_path) = &nv.value
                    && let Some(last) = expr_path.path.segments.last()
                {
                    return Some(last.ident.to_string());
                }
            }
        }
    }
    None
}

/// The fully-qualified derive marker path that triggers type extraction.
const MARKER: &str = "rkyv::Archive";

/// Check if a derive input has the `Archive` marker derive.
///
/// Recognizes:
/// - `#[derive(Archive)]` when `use rkyv::Archive` is in scope
/// - `#[derive(rkyv::Archive)]` or any qualified path ending in `::Archive`
/// - `#[derive(Rkyv)]` when `use rkyv::Archive as Rkyv` is in scope
fn has_marker_derive(attrs: &[Attribute], ctx: &SourceContext) -> bool {
    for attr in attrs {
        if attr.path().is_ident("derive")
            && let Ok(nested) = attr.parse_args_with(
                syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
            )
        {
            for path in nested {
                if path.segments.len() == 1 {
                    // Unqualified: resolve via imports
                    let ident = path.segments[0].ident.to_string();
                    if ctx.imports.get(&ident).is_some_and(|p| p == MARKER) {
                        return true;
                    }
                } else {
                    // Qualified path like `rkyv::Archive`: join segments
                    let qualified: String = path
                        .segments
                        .iter()
                        .map(|s| s.ident.to_string())
                        .collect::<Vec<_>>()
                        .join("::");
                    if qualified == MARKER || qualified.ends_with("::Archive") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Resolve a local type name to its fully-qualified path using the import map.
///
/// For names found in `ctx.imports`, returns the full path (e.g., `"std::collections::HashMap"`).
/// For names not in imports (local types, primitives), returns the name as-is.
fn resolve_type_path(raw_ident: &str, ctx: &SourceContext) -> String {
    ctx.imports
        .get(raw_ident)
        .cloned()
        .unwrap_or_else(|| raw_ident.to_string())
}

/// Convert a syn Type to our TypeDef, using the type registry and import map.
fn type_to_typedef(ty: &Type, codegen: &CodeGenerator, ctx: &SourceContext) -> Option<TypeDef> {
    match ty {
        Type::Path(TypePath { path, .. }) => {
            let segment = path.segments.last()?;
            let raw_ident = segment.ident.to_string();

            // For multi-segment paths (e.g., std::collections::BTreeMap),
            // join all segments to get the full path directly.
            // For single-segment paths, resolve via the import map.
            let full_path = if path.segments.len() > 1 {
                path.segments
                    .iter()
                    .map(|s| s.ident.to_string())
                    .collect::<Vec<_>>()
                    .join("::")
            } else {
                resolve_type_path(&raw_ident, ctx)
            };

            match full_path.as_str() {
                // Primitives (no module path needed)
                "u8" => Some(TypeDef::u8()),
                "i8" => Some(TypeDef::i8()),
                "u16" => Some(TypeDef::u16()),
                "i16" => Some(TypeDef::i16()),
                "u32" => Some(TypeDef::u32()),
                "i32" => Some(TypeDef::i32()),
                "u64" => Some(TypeDef::u64()),
                "i64" => Some(TypeDef::i64()),
                "f32" => Some(TypeDef::f32()),
                "f64" => Some(TypeDef::f64()),
                "bool" => Some(TypeDef::bool()),
                "char" => Some(TypeDef::char()),
                "String" | "std::string::String" => Some(TypeDef::string()),

                // Container types
                "Vec" | "std::vec::Vec" => {
                    let inner = get_single_generic_arg(segment)?;
                    Some(TypeDef::vec(type_to_typedef(inner, codegen, ctx)?))
                }
                "Option" | "std::option::Option" => {
                    let inner = get_single_generic_arg(segment)?;
                    Some(TypeDef::option(type_to_typedef(inner, codegen, ctx)?))
                }
                "Box" | "std::boxed::Box" => {
                    let inner = get_single_generic_arg(segment)?;
                    Some(TypeDef::boxed(type_to_typedef(inner, codegen, ctx)?))
                }

                // Check the type registry for external types, fallback to named
                _ => {
                    if let Some(template) = codegen.registry.get(&full_path) {
                        let arity = template.arity();
                        let type_params = if arity == 0 {
                            vec![]
                        } else {
                            let type_args = collect_type_args(segment);
                            let resolved: Option<Vec<_>> = type_args
                                .iter()
                                .take(arity)
                                .map(|ty| type_to_typedef(ty, codegen, ctx))
                                .collect();
                            resolved?
                        };
                        Some(template.resolve(type_params))
                    } else {
                        // For unresolved types, use the raw ident (local type name)
                        Some(TypeDef::named(raw_ident))
                    }
                }
            }
        }
        Type::Array(TypeArray { elem, len, .. }) => {
            let elem_def = type_to_typedef(elem, codegen, ctx)?;
            if let syn::Expr::Lit(syn::ExprLit {
                lit: syn::Lit::Int(lit_int),
                ..
            }) = len
            {
                let len_val: usize = lit_int.base10_parse().ok()?;
                Some(TypeDef::array(elem_def, len_val))
            } else {
                None
            }
        }
        Type::Tuple(TypeTuple { elems, .. }) => {
            if elems.is_empty() {
                Some(TypeDef::unit())
            } else {
                let elem_defs: Option<Vec<_>> = elems
                    .iter()
                    .map(|e| type_to_typedef(e, codegen, ctx))
                    .collect();
                Some(TypeDef::tuple(elem_defs?))
            }
        }
        Type::Reference(reference) => {
            if let Type::Path(TypePath { path, .. }) = &*reference.elem
                && path.is_ident("str")
            {
                return Some(TypeDef::string());
            }
            type_to_typedef(&reference.elem, codegen, ctx)
        }
        _ => None,
    }
}

fn get_single_generic_arg(segment: &syn::PathSegment) -> Option<&Type> {
    match &segment.arguments {
        PathArguments::AngleBracketed(args) => match args.args.first()? {
            GenericArgument::Type(ty) => Some(ty),
            _ => None,
        },
        _ => None,
    }
}

/// Collect all type arguments from a path segment's angle brackets.
///
/// - Unwraps `[T; N]` array types to just `T` (for SmallVec/TinyVec patterns)
/// - Skips non-type arguments (const generics, lifetimes)
fn collect_type_args(segment: &syn::PathSegment) -> Vec<&Type> {
    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        return vec![];
    };

    let mut type_args = Vec::new();
    for arg in &args.args {
        if let GenericArgument::Type(ty) = arg {
            // Unwrap array types: SmallVec<[T; N]> -> T
            if let Type::Array(TypeArray { elem, .. }) = ty {
                type_args.push(elem.as_ref());
            } else {
                type_args.push(ty);
            }
        }
        // Skip const/lifetime args
    }
    type_args
}

fn extract_struct(
    fields: &Fields,
    codegen: &CodeGenerator,
    ctx: &SourceContext,
) -> Option<Vec<(String, TypeDef)>> {
    match fields {
        Fields::Named(named) => named
            .named
            .iter()
            .map(|f| {
                let name = f.ident.as_ref()?.to_string();
                let td = type_to_typedef(&f.ty, codegen, ctx)?;
                Some((name, td))
            })
            .collect(),
        Fields::Unnamed(unnamed) => unnamed
            .unnamed
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let td = type_to_typedef(&f.ty, codegen, ctx)?;
                Some((format!("_{}", i), td))
            })
            .collect(),
        Fields::Unit => Some(vec![]),
    }
}

fn extract_enum(
    variants: &syn::punctuated::Punctuated<syn::Variant, syn::token::Comma>,
    codegen: &CodeGenerator,
    ctx: &SourceContext,
) -> Option<Vec<EnumVariant>> {
    variants
        .iter()
        .map(|v| {
            let name = v.ident.to_string();
            match &v.fields {
                Fields::Unit => Some(EnumVariant::Unit(name)),
                Fields::Unnamed(fields) => {
                    let types: Option<Vec<_>> = fields
                        .unnamed
                        .iter()
                        .map(|f| type_to_typedef(&f.ty, codegen, ctx))
                        .collect();
                    Some(EnumVariant::Tuple(name, types?))
                }
                Fields::Named(fields) => {
                    let field_defs: Option<Vec<_>> = fields
                        .named
                        .iter()
                        .map(|f| {
                            let fname = f.ident.as_ref()?.to_string();
                            let td = type_to_typedef(&f.ty, codegen, ctx)?;
                            Some((fname, td))
                        })
                        .collect();
                    Some(EnumVariant::Struct(name, field_defs?))
                }
            }
        })
        .collect()
}

fn process_derive_input(
    codegen: &mut CodeGenerator,
    input: &DeriveInput,
    ctx: &SourceContext,
) {
    if !has_marker_derive(&input.attrs, ctx) {
        return;
    }

    // Check for #[rkyv(remote = X)] — this type is a serialization proxy,
    // not a real type in the schema. Skip codegen but validate that the
    // remote type is registered.
    if let Some(remote_type) = extract_rkyv_remote(&input.attrs) {
        let local_name = input.ident.to_string();
        if !codegen.registry.contains(&remote_type) {
            eprintln!(
                "cargo:warning=rkyv-js-codegen: `{}` has #[rkyv(remote = ...)] targeting `{}`, \
                 but `{}` is not registered in the type registry. \
                 Use `register_type(\"{}\", ...)` to provide a TypeScript codec for it.",
                local_name, remote_type, remote_type, remote_type,
            );
        }
        // Skip generating bindings for the local proxy type
        return;
    }

    let name = input.ident.to_string();
    let archived_name = extract_rkyv_archived(&input.attrs);

    match &input.data {
        Data::Struct(data) => {
            if let Some(fields) = extract_struct(&data.fields, codegen, ctx) {
                let fields_ref: Vec<_> = fields
                    .iter()
                    .map(|(n, t)| (n.as_str(), t.clone()))
                    .collect();
                codegen.add_struct(&name, &fields_ref);
                if let Some(archived) = archived_name {
                    codegen.set_archived_name(&name, archived);
                }
            }
        }
        Data::Enum(data) => {
            if let Some(variants) = extract_enum(&data.variants, codegen, ctx) {
                codegen.add_enum(&name, &variants);
                if let Some(archived) = archived_name {
                    codegen.set_archived_name(&name, archived);
                }
            }
        }
        Data::Union(_) => {}
    }
}

fn parse_source_file(codegen: &mut CodeGenerator, source: &str) {
    let file = match syn::parse_file(source) {
        Ok(f) => f,
        Err(_) => return,
    };

    // Build per-file context from `use` items
    let ctx = build_source_context(&file);

    for item in file.items {
        if let syn::Item::Struct(s) = item {
            let input = DeriveInput {
                attrs: s.attrs,
                vis: s.vis,
                ident: s.ident,
                generics: s.generics,
                data: Data::Struct(syn::DataStruct {
                    struct_token: s.struct_token,
                    fields: s.fields,
                    semi_token: s.semi_token,
                }),
            };
            process_derive_input(codegen, &input, &ctx);
        } else if let syn::Item::Enum(e) = item {
            let input = DeriveInput {
                attrs: e.attrs,
                vis: e.vis,
                ident: e.ident,
                generics: e.generics,
                data: Data::Enum(syn::DataEnum {
                    enum_token: e.enum_token,
                    brace_token: e.brace_token,
                    variants: e.variants,
                }),
            };
            process_derive_input(codegen, &input, &ctx);
        }
    }
}

impl CodeGenerator {
    /// Parse a single Rust source file and extract types with marker derives.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # fn main() -> Result<(), std::io::Error> {
    /// use rkyv_js_codegen::CodeGenerator;
    ///
    /// let mut generator = CodeGenerator::new();
    /// generator.add_source_file("src/lib.rs")?;
    /// generator.write_to_file("bindings.ts")?;
    /// # Ok(())
    /// # }
    /// ```
    pub fn add_source_file(&mut self, path: impl AsRef<Path>) -> std::io::Result<&mut Self> {
        let source = fs::read_to_string(path)?;
        parse_source_file(self, &source);
        Ok(self)
    }

    /// Parse Rust source from a string and extract types with marker derives.
    pub fn add_source_str(&mut self, source: &str) -> &mut Self {
        parse_source_file(self, source);
        self
    }

    /// Recursively scan a directory for `.rs` files and extract annotated types.
    ///
    /// # Example
    ///
    /// ```no_run
    /// # fn main() -> Result<(), std::io::Error> {
    /// use rkyv_js_codegen::CodeGenerator;
    ///
    /// let mut generator = CodeGenerator::new();
    /// generator.add_source_dir("src/")?;
    /// generator.write_to_file("bindings.ts")?;
    /// # Ok(())
    /// # }
    /// ```
    pub fn add_source_dir(&mut self, path: impl AsRef<Path>) -> std::io::Result<&mut Self> {
        for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e == "rs").unwrap_or(false) {
                let source = fs::read_to_string(path)?;
                parse_source_file(self, &source);
            }
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_extract_simple_struct() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Point { x: f64, y: f64 }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("export const ArchivedPoint = r.struct({"));
        assert!(code.contains("x: r.f64"));
        assert!(code.contains("y: r.f64"));
        assert!(code.contains("export type Point = r.Infer<typeof ArchivedPoint>;"));
    }

    #[test]
    fn test_extract_struct_with_containers() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Person { name: String, age: u32, scores: Vec<u32>, email: Option<String> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("name: r.string"));
        assert!(code.contains("scores: r.vec(r.u32)"));
        assert!(code.contains("email: r.option(r.string)"));
    }

    #[test]
    fn test_extract_enum() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            enum Message { Quit, Move { x: i32, y: i32 }, Write(String) }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("export const ArchivedMessage = r.taggedEnum({"));
        assert!(code.contains("Quit: r.unit"));
        assert!(code.contains("Move: r.struct({"));
        assert!(code.contains("Write: r.struct({"));
    }

    #[test]
    fn test_ignores_non_typescript_types() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Debug)]
            struct NotExported { x: i32 }
            #[derive(Debug, Archive)]
            struct Exported { y: i32 }
        "#,
        );
        let code = codegen.generate();
        assert!(!code.contains("ArchivedNotExported"));
        assert!(code.contains("ArchivedExported"));
    }

    #[test]
    fn test_qualified_archive_derive() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            #[derive(rkyv::Archive)]
            struct QualifiedPath { value: u32 }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("export const ArchivedQualifiedPath = r.struct({"));
    }

    #[test]
    fn test_aliased_archive_derive() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            #[derive(some_alias::Archive)]
            struct AliasedPath { id: u64 }
            #[derive(deeply::nested::module::Archive)]
            struct DeeplyNested { data: String }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("id: r.u64"));
        assert!(code.contains("data: r.string"));
    }

    #[test]
    fn test_auto_detect_marker_alias() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive as Rkyv;
            #[derive(Rkyv)]
            struct AliasedMarker { value: i32 }
            #[derive(rkyv::Archive)]
            struct DefaultMarker { value: u32 }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("ArchivedAliasedMarker"));
        assert!(code.contains("ArchivedDefaultMarker"));
    }

    #[test]
    fn test_auto_detect_marker_alias_qualified() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive as Serialize;
            #[derive(Serialize)]
            struct WithAlias { a: i32 }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("ArchivedWithAlias"));
    }

    #[test]
    fn test_unimported_marker_not_detected() {
        // Without a `use rkyv::Archive`, neither bare `Archive` nor `Rkyv` should be detected
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            #[derive(Rkyv)]
            struct NotDetected1 { a: i32 }
            #[derive(Archive)]
            struct NotDetected2 { b: i32 }
        "#,
        );
        let code = codegen.generate();
        assert!(!code.contains("ArchivedNotDetected1"));
        assert!(!code.contains("ArchivedNotDetected2"));
    }

    #[test]
    fn test_extract_nested_types() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Inner { value: u32 }
            #[derive(Archive)]
            struct Outer { inner: Inner, items: Vec<Inner> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("inner: ArchivedInner"));
        assert!(code.contains("items: r.vec(ArchivedInner)"));
    }

    #[test]
    fn test_extract_lib_uuid() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use uuid::Uuid;
            #[derive(Archive)]
            struct Record { id: Uuid, name: String }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { uuid } from 'rkyv-js/lib/uuid';"));
        assert!(code.contains("id: uuid"));
    }

    #[test]
    fn test_extract_lib_bytes() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use bytes::Bytes;
            #[derive(Archive)]
            struct Message { payload: Bytes }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { bytes } from 'rkyv-js/lib/bytes';"));
        assert!(code.contains("payload: bytes"));
    }

    #[test]
    fn test_extract_lib_smol_str() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use smol_str::SmolStr;
            #[derive(Archive)]
            struct Config { key: SmolStr }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("key: r.string"));
    }

    #[test]
    fn test_extract_lib_thin_vec() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use thin_vec::ThinVec;
            #[derive(Archive)]
            struct Data { items: ThinVec<u32> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("items: r.vec(r.u32)"));
    }

    #[test]
    fn test_extract_lib_arrayvec() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use arrayvec::ArrayVec;
            #[derive(Archive)]
            struct Buffer { data: ArrayVec<u8, 64> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("data: r.vec(r.u8)"));
    }

    #[test]
    fn test_extract_lib_smallvec() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use smallvec::SmallVec;
            #[derive(Archive)]
            struct Items { values: SmallVec<[u32; 4]> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("values: r.vec(r.u32)"));
    }

    #[test]
    fn test_extract_lib_tinyvec() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use tinyvec::TinyVec;
            #[derive(Archive)]
            struct Stack { elements: TinyVec<[String; 8]> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("elements: r.vec(r.string)"));
    }

    #[test]
    fn test_extract_lib_indexmap() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use indexmap::IndexMap;
            #[derive(Archive)]
            struct Config { settings: IndexMap<String, u32> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { indexMap } from 'rkyv-js/lib/indexmap';"));
        assert!(!code.contains("indexSet"));
        assert!(code.contains("settings: indexMap(r.string, r.u32)"));
    }

    #[test]
    fn test_extract_lib_indexset() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use indexmap::IndexSet;
            #[derive(Archive)]
            struct Tags { items: IndexSet<String> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { indexSet } from 'rkyv-js/lib/indexmap';"));
        assert!(!code.contains("indexMap"));
        assert!(code.contains("items: indexSet(r.string)"));
    }

    #[test]
    fn test_extract_lib_vec_deque() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::collections::VecDeque;
            #[derive(Archive)]
            struct Queue { items: VecDeque<u32> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("items: r.vec(r.u32)"));
    }

    #[test]
    fn test_extract_lib_hash_set() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::collections::HashSet;
            #[derive(Archive)]
            struct UniqueItems { ids: HashSet<String> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { hashSet } from 'rkyv-js/lib/std-hash-set';"));
        assert!(code.contains("ids: hashSet(r.string)"));
    }

    #[test]
    fn test_extract_lib_btree_set() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::collections::BTreeSet;
            #[derive(Archive)]
            struct SortedItems { values: BTreeSet<i64> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { btreeSet } from 'rkyv-js/lib/std-btree-set';"));
        assert!(code.contains("values: btreeSet(r.i64)"));
    }

    #[test]
    fn test_extract_lib_arc() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use triomphe::Arc;
            #[derive(Archive)]
            struct Shared { config: Arc<String> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("config: r.arc(r.string)"));
    }

    #[test]
    fn test_extract_lib_rc() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::rc::Rc;
            #[derive(Archive)]
            struct Shared { data: Rc<String> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("data: r.rc(r.string)"));
    }

    #[test]
    fn test_extract_lib_weak() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::rc::Weak;
            #[derive(Archive)]
            struct MaybeShared { weak_ref: Weak<u32> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("weak_ref: r.rcWeak(r.u32)"));
    }

    #[test]
    fn test_custom_registered_type() {
        let mut codegen = CodeGenerator::new();
        codegen.register_type(
            "my_crate::CustomVec",
            TypeDef::new("customVec({0})", "{0}[]").with_import("my-package/codecs", "customVec"),
        );
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use my_crate::CustomVec;
            #[derive(Archive)]
            struct MyData { custom: CustomVec<u32> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { customVec } from 'my-package/codecs';"));
        assert!(code.contains("custom: customVec(r.u32)"));
    }

    // ── Aliased type import tests ────────────────────────────────────

    #[test]
    fn test_aliased_btreemap() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::collections::BTreeMap as MyMap;
            #[derive(Archive)]
            struct Config { data: MyMap<String, u32> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { btreeMap } from 'rkyv-js/lib/std-btree-map';"));
        assert!(code.contains("data: btreeMap(r.string, r.u32)"));
    }

    #[test]
    fn test_aliased_hashmap() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::collections::HashMap as Map;
            #[derive(Archive)]
            struct Data { entries: Map<String, u64> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { hashMap } from 'rkyv-js/lib/std-hash-map';"));
        assert!(code.contains("entries: hashMap(r.string, r.u64)"));
    }

    #[test]
    fn test_aliased_vec_as_list() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::vec::Vec as List;
            #[derive(Archive)]
            struct Data { items: List<u32> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("items: r.vec(r.u32)"));
    }

    #[test]
    fn test_aliased_option() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::option::Option as Maybe;
            #[derive(Archive)]
            struct Data { value: Maybe<String> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("value: r.option(r.string)"));
    }

    #[test]
    fn test_aliased_uuid() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use uuid::Uuid as Id;
            #[derive(Archive)]
            struct Record { id: Id }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("import { uuid } from 'rkyv-js/lib/uuid';"));
        assert!(code.contains("id: uuid"));
    }

    #[test]
    fn test_aliased_in_group_import() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::collections::{HashMap as Map, BTreeSet as SortedSet};
            #[derive(Archive)]
            struct Data { map: Map<String, u32>, set: SortedSet<String> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("map: hashMap(r.string, r.u32)"));
        assert!(code.contains("set: btreeSet(r.string)"));
    }

    #[test]
    fn test_mixed_aliased_and_non_aliased() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use std::collections::{HashMap as Map, BTreeMap};
            #[derive(Archive)]
            struct Data { map: Map<String, u32>, tree: BTreeMap<String, u64> }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("map: hashMap(r.string, r.u32)"));
        assert!(code.contains("tree: btreeMap(r.string, r.u64)"));
    }

    // ── Remote derive tests ──────────────────────────────────────────

    #[test]
    fn test_remote_derive_skips_proxy_type() {
        let mut codegen = CodeGenerator::new();
        codegen.register_type(
            "chrono::NaiveDate",
            TypeDef::new("naiveDate", "string").with_import("my-package/chrono", "naiveDate"),
        );
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(remote = chrono::NaiveDate)]
            struct NaiveDateDef {
                year: i32,
                ordinal: u32,
            }
        "#,
        );
        let code = codegen.generate();
        // The proxy type should NOT appear in the output
        assert!(!code.contains("NaiveDateDef"));
        assert!(!code.contains("ArchivedNaiveDateDef"));
    }

    #[test]
    fn test_remote_derive_referenced_by_other_type() {
        let mut codegen = CodeGenerator::new();
        codegen.register_type(
            "chrono::NaiveDate",
            TypeDef::new("naiveDate", "string").with_import("my-package/chrono", "naiveDate"),
        );
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use chrono::NaiveDate;
            #[derive(Archive)]
            #[rkyv(remote = chrono::NaiveDate)]
            struct NaiveDateDef {
                year: i32,
                ordinal: u32,
            }

            #[derive(Archive)]
            struct Event {
                name: String,
                date: NaiveDate,
            }
        "#,
        );
        let code = codegen.generate();
        // The proxy type should be skipped
        assert!(!code.contains("NaiveDateDef"));
        // The Event struct should reference NaiveDate via the registered codec
        assert!(code.contains("date: naiveDate"));
        assert!(code.contains("import { naiveDate } from 'my-package/chrono';"));
    }

    #[test]
    fn test_remote_derive_with_other_rkyv_attrs() {
        // Ensure #[rkyv(remote = X)] is detected even alongside other rkyv attrs
        let mut codegen = CodeGenerator::new();
        codegen.register_type(
            "external::Foo",
            TypeDef::new("foo", "string").with_import("my-package/foo", "foo"),
        );
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(compare(PartialEq), remote = external::Foo)]
            struct FooDef {
                value: u32,
            }
        "#,
        );
        let code = codegen.generate();
        assert!(!code.contains("FooDef"));
    }

    #[test]
    fn test_remote_derive_unregistered_warns() {
        // When remote type is NOT registered, the proxy is still skipped
        // (warning goes to stderr, we can't easily capture it in a test,
        // but we verify the proxy type is not generated)
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(remote = chrono::NaiveDate)]
            struct NaiveDateDef {
                year: i32,
                ordinal: u32,
            }
        "#,
        );
        let code = codegen.generate();
        assert!(!code.contains("NaiveDateDef"));
    }

    #[test]
    fn test_non_remote_type_still_generated() {
        // Types without #[rkyv(remote = ...)] should be generated normally
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(compare(PartialEq), derive(Debug))]
            struct Normal {
                value: u32,
            }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("ArchivedNormal"));
        assert!(code.contains("value: r.u32"));
    }

    // ── Archived name rename tests ───────────────────────────────────

    #[test]
    fn test_archived_rename_struct() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(archived = CustomPoint)]
            struct Point {
                x: f64,
                y: f64,
            }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("export const CustomPoint = r.struct({"));
        assert!(code.contains("export type Point = r.Infer<typeof CustomPoint>;"));
        assert!(!code.contains("ArchivedPoint"));
    }

    #[test]
    fn test_archived_rename_enum() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(archived = CustomMessage)]
            enum Message {
                Quit,
                Write(String),
            }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("export const CustomMessage = r.taggedEnum({"));
        assert!(code.contains("export type Message = r.Infer<typeof CustomMessage>;"));
        assert!(!code.contains("ArchivedMessage"));
    }

    #[test]
    fn test_archived_rename_cross_reference() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(archived = MyPoint)]
            struct Point {
                x: f64,
                y: f64,
            }

            #[derive(Archive)]
            struct Line {
                start: Point,
                end: Point,
            }
        "#,
        );
        let code = codegen.generate();
        // Point uses the custom archived name
        assert!(code.contains("export const MyPoint = r.struct({"));
        // Line references MyPoint instead of ArchivedPoint
        assert!(code.contains("start: MyPoint"));
        assert!(code.contains("end: MyPoint"));
        assert!(!code.contains("ArchivedPoint"));
    }

    #[test]
    fn test_archived_rename_with_other_rkyv_attrs() {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(compare(PartialEq), archived = APoint, derive(Debug))]
            struct Point {
                x: f64,
            }
        "#,
        );
        let code = codegen.generate();
        assert!(code.contains("export const APoint = r.struct({"));
        assert!(!code.contains("ArchivedPoint"));
    }

    #[test]
    fn test_archived_rename_on_remote_derive() {
        // When both remote and archived are present, the type is still skipped
        // (it's a proxy type for remote derive)
        let mut codegen = CodeGenerator::new();
        codegen.register_type("external::Coord", TypeDef::new("Coord", "Coord"));
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(remote = external::Coord)]
            #[rkyv(archived = ArchivedCoord)]
            struct CoordDef {
                x: f32,
                y: f32,
            }
        "#,
        );
        let code = codegen.generate();
        assert!(!code.contains("CoordDef"));
        assert!(!code.contains("ArchivedCoord"));
    }
}
