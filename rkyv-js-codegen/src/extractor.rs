//! Source file parser that extracts types annotated with `#[derive(Archive)]`.
//!
//! This module provides functionality to scan Rust source files and automatically
//! extract type definitions for TypeScript binding generation.
//!
//! Type resolution for external crates is handled by the [`TypeRegistry`](crate::registry::TypeRegistry)
//! on the [`CodeGenerator`], so adding support for new external types requires no changes here.

use crate::CodeGenerator;
use crate::registry::GenericShape;
use crate::types::{EnumVariant, TypeDef};
use std::fs;
use std::path::Path;
use syn::{
    Attribute, Data, DeriveInput, Fields, GenericArgument, PathArguments, Type, TypeArray,
    TypePath, TypeTuple,
};
use walkdir::WalkDir;

/// Check if a derive input has any of the specified marker derives.
///
/// Matches any path whose last segment matches one of the markers, which handles:
/// - `Archive` (direct import)
/// - `rkyv::Archive` (qualified path)
/// - `my_alias::Archive` (re-exports)
/// - Custom aliases via `add_marker("Rkyv")`
fn has_marker_derive(attrs: &[Attribute], markers: &[String]) -> bool {
    for attr in attrs {
        if attr.path().is_ident("derive")
            && let Ok(nested) = attr.parse_args_with(
                syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
            )
        {
            for path in nested {
                if let Some(last_segment) = path.segments.last() {
                    let ident = last_segment.ident.to_string();
                    if markers.iter().any(|m| m == &ident) {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Convert a syn Type to our TypeDef, using the type registry for external types.
fn type_to_typedef(ty: &Type, codegen: &CodeGenerator) -> Option<TypeDef> {
    match ty {
        Type::Path(TypePath { path, .. }) => {
            let segment = path.segments.last()?;
            let ident_str = segment.ident.to_string();

            match ident_str.as_str() {
                // Primitives
                "u8" => Some(TypeDef::U8),
                "i8" => Some(TypeDef::I8),
                "u16" => Some(TypeDef::U16),
                "i16" => Some(TypeDef::I16),
                "u32" => Some(TypeDef::U32),
                "i32" => Some(TypeDef::I32),
                "u64" => Some(TypeDef::U64),
                "i64" => Some(TypeDef::I64),
                "f32" => Some(TypeDef::F32),
                "f64" => Some(TypeDef::F64),
                "bool" => Some(TypeDef::Bool),
                "char" => Some(TypeDef::Char),
                "String" => Some(TypeDef::String),

                // Container types
                "Vec" => {
                    let inner = get_single_generic_arg(segment)?;
                    let inner_def = type_to_typedef(inner, codegen)?;
                    Some(TypeDef::Vec(Box::new(inner_def)))
                }
                "Option" => {
                    let inner = get_single_generic_arg(segment)?;
                    let inner_def = type_to_typedef(inner, codegen)?;
                    Some(TypeDef::Option(Box::new(inner_def)))
                }
                "Box" => {
                    let inner = get_single_generic_arg(segment)?;
                    let inner_def = type_to_typedef(inner, codegen)?;
                    Some(TypeDef::Box(Box::new(inner_def)))
                }

                // Check the type registry for external types
                _ => {
                    if let Some(mapping) = codegen.registry.get(&ident_str) {
                        // Resolve type parameters based on the generic shape
                        let type_params = match &mapping.generics {
                            GenericShape::None => vec![],
                            GenericShape::Single => {
                                let inner = get_single_generic_arg(segment)?;
                                let inner_def = type_to_typedef(inner, codegen)?;
                                vec![inner_def]
                            }
                            GenericShape::Pair => {
                                let (key, value) = get_two_generic_args(segment)?;
                                let key_def = type_to_typedef(key, codegen)?;
                                let value_def = type_to_typedef(value, codegen)?;
                                vec![key_def, value_def]
                            }
                            GenericShape::Array => {
                                // SmallVec<[T; N]> / TinyVec<[T; N]> style
                                let inner_array = get_single_generic_arg(segment)?;
                                if let Type::Array(TypeArray { elem, .. }) = inner_array {
                                    let inner_def = type_to_typedef(elem, codegen)?;
                                    vec![inner_def]
                                } else {
                                    return None;
                                }
                            }
                            GenericShape::TypeAndConst => {
                                // ArrayVec<T, CAP> style - only extract the type
                                let inner = get_first_type_generic_arg(segment)?;
                                let inner_def = type_to_typedef(inner, codegen)?;
                                vec![inner_def]
                            }
                        };
                        Some(mapping.to_type_def(type_params))
                    } else {
                        // Named type (custom struct/enum)
                        Some(TypeDef::Named(ident_str))
                    }
                }
            }
        }
        Type::Array(TypeArray { elem, len, .. }) => {
            let elem_def = type_to_typedef(elem, codegen)?;
            // Try to extract the array length
            if let syn::Expr::Lit(syn::ExprLit {
                lit: syn::Lit::Int(lit_int),
                ..
            }) = len
            {
                let len_val: usize = lit_int.base10_parse().ok()?;
                Some(TypeDef::Array(Box::new(elem_def), len_val))
            } else {
                None
            }
        }
        Type::Tuple(TypeTuple { elems, .. }) => {
            if elems.is_empty() {
                Some(TypeDef::Unit)
            } else {
                let elem_defs: Option<Vec<_>> =
                    elems.iter().map(|e| type_to_typedef(e, codegen)).collect();
                Some(TypeDef::Tuple(elem_defs?))
            }
        }
        Type::Reference(reference) => {
            // For &str, treat as String
            if let Type::Path(TypePath { path, .. }) = &*reference.elem
                && path.is_ident("str")
            {
                return Some(TypeDef::String);
            }
            // Otherwise, follow the reference
            type_to_typedef(&reference.elem, codegen)
        }
        _ => None,
    }
}

fn get_single_generic_arg(segment: &syn::PathSegment) -> Option<&Type> {
    match &segment.arguments {
        PathArguments::AngleBracketed(args) => {
            let arg = args.args.first()?;
            match arg {
                GenericArgument::Type(ty) => Some(ty),
                _ => None,
            }
        }
        _ => None,
    }
}

/// Get the first type argument from angle-bracketed generics (ignoring const args).
/// For `Foo<T, N>` where N is a const, this returns `T`.
fn get_first_type_generic_arg(segment: &syn::PathSegment) -> Option<&Type> {
    match &segment.arguments {
        PathArguments::AngleBracketed(args) => {
            for arg in &args.args {
                if let GenericArgument::Type(ty) = arg {
                    return Some(ty);
                }
            }
            None
        }
        _ => None,
    }
}

fn get_two_generic_args(segment: &syn::PathSegment) -> Option<(&Type, &Type)> {
    match &segment.arguments {
        PathArguments::AngleBracketed(args) => {
            let mut iter = args.args.iter();
            let first = iter.next()?;
            let second = iter.next()?;

            let key = match first {
                GenericArgument::Type(ty) => ty,
                _ => return None,
            };
            let value = match second {
                GenericArgument::Type(ty) => ty,
                _ => return None,
            };

            Some((key, value))
        }
        _ => None,
    }
}

/// Extract a struct definition from a DeriveInput.
fn extract_struct(fields: &Fields, codegen: &CodeGenerator) -> Option<Vec<(String, TypeDef)>> {
    match fields {
        Fields::Named(named) => {
            let field_defs: Option<Vec<_>> = named
                .named
                .iter()
                .map(|f| {
                    let field_name = f.ident.as_ref()?.to_string();
                    let type_def = type_to_typedef(&f.ty, codegen)?;
                    Some((field_name, type_def))
                })
                .collect();
            field_defs
        }
        Fields::Unnamed(unnamed) => {
            // Tuple struct - treat as struct with numbered fields
            let field_defs: Option<Vec<_>> = unnamed
                .unnamed
                .iter()
                .enumerate()
                .map(|(i, f)| {
                    let field_name = format!("_{}", i);
                    let type_def = type_to_typedef(&f.ty, codegen)?;
                    Some((field_name, type_def))
                })
                .collect();
            field_defs
        }
        Fields::Unit => Some(vec![]),
    }
}

/// Extract an enum definition from a DeriveInput.
fn extract_enum(
    variants: &syn::punctuated::Punctuated<syn::Variant, syn::token::Comma>,
    codegen: &CodeGenerator,
) -> Option<Vec<EnumVariant>> {
    variants
        .iter()
        .map(|v| {
            let variant_name = v.ident.to_string();
            match &v.fields {
                Fields::Unit => Some(EnumVariant::Unit(variant_name)),
                Fields::Unnamed(fields) => {
                    let types: Option<Vec<_>> = fields
                        .unnamed
                        .iter()
                        .map(|f| type_to_typedef(&f.ty, codegen))
                        .collect();
                    Some(EnumVariant::Tuple(variant_name, types?))
                }
                Fields::Named(fields) => {
                    let field_defs: Option<Vec<_>> = fields
                        .named
                        .iter()
                        .map(|f| {
                            let field_name = f.ident.as_ref()?.to_string();
                            let type_def = type_to_typedef(&f.ty, codegen)?;
                            Some((field_name, type_def))
                        })
                        .collect();
                    Some(EnumVariant::Struct(variant_name, field_defs?))
                }
            }
        })
        .collect()
}

/// Process a single DeriveInput and add it to the generator if it has a marker derive.
fn process_derive_input(codegen: &mut CodeGenerator, input: &DeriveInput, markers: &[String]) {
    if !has_marker_derive(&input.attrs, markers) {
        return;
    }

    let name = input.ident.to_string();

    match &input.data {
        Data::Struct(data) => {
            if let Some(fields) = extract_struct(&data.fields, codegen) {
                let fields_ref: Vec<_> = fields
                    .iter()
                    .map(|(n, t)| (n.as_str(), t.clone()))
                    .collect();
                codegen.add_struct(&name, &fields_ref);
            }
        }
        Data::Enum(data) => {
            if let Some(variants) = extract_enum(&data.variants, codegen) {
                codegen.add_enum(&name, &variants);
            }
        }
        Data::Union(_) => {
            // Unions are not supported via derive, use add_union manually
        }
    }
}

/// Parse a Rust source file and extract marker-annotated types.
fn parse_source_file(codegen: &mut CodeGenerator, source: &str, markers: &[String]) {
    let file = match syn::parse_file(source) {
        Ok(f) => f,
        Err(_) => return,
    };

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
            process_derive_input(codegen, &input, markers);
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
            process_derive_input(codegen, &input, markers);
        }
    }
}

impl CodeGenerator {
    /// Parse a single Rust source file and extract types with marker derives.
    ///
    /// By default, looks for `#[derive(Archive)]` or any path ending with `Archive`.
    /// Use `add_marker()` to recognize additional marker names.
    ///
    /// Type resolution for external crates uses the type registry. Built-in
    /// mappings are registered by default. Use [`register_type`](CodeGenerator::register_type)
    /// to add custom mappings.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let mut gen = CodeGenerator::new();
    /// gen.add_source_file("src/lib.rs")?;
    /// gen.write_to_file("bindings.ts")?;
    /// ```
    pub fn add_source_file(&mut self, path: impl AsRef<Path>) -> std::io::Result<&mut Self> {
        let source = fs::read_to_string(path)?;
        parse_source_file(self, &source, &self.markers.clone());
        Ok(self)
    }

    /// Parse Rust source from a string and extract types with marker derives.
    pub fn add_source_str(&mut self, source: &str) -> &mut Self {
        parse_source_file(self, source, &self.markers.clone());
        self
    }

    /// Recursively scan a directory for `.rs` files and extract annotated types.
    ///
    /// # Example
    ///
    /// ```rust,ignore
    /// let mut gen = CodeGenerator::new();
    /// gen.add_source_dir("src/")?;
    /// gen.write_to_file("bindings.ts")?;
    /// ```
    pub fn add_source_dir(&mut self, path: impl AsRef<Path>) -> std::io::Result<&mut Self> {
        let markers = self.markers.clone();
        for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e == "rs").unwrap_or(false) {
                let source = fs::read_to_string(path)?;
                parse_source_file(self, &source, &markers);
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
        let source = r#"
            use rkyv::Archive;

            #[derive(Archive)]
            struct Point {
                x: f64,
                y: f64,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedPoint = r.struct({"));
        assert!(code.contains("x: r.f64"));
        assert!(code.contains("y: r.f64"));
        assert!(code.contains("export type Point = r.Infer<typeof ArchivedPoint>;"));
    }

    #[test]
    fn test_extract_struct_with_containers() {
        let source = r#"
            #[derive(Archive)]
            struct Person {
                name: String,
                age: u32,
                scores: Vec<u32>,
                email: Option<String>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedPerson = r.struct({"));
        assert!(code.contains("name: r.string"));
        assert!(code.contains("scores: r.vec(r.u32)"));
        assert!(code.contains("email: r.option(r.string)"));
    }

    #[test]
    fn test_extract_enum() {
        let source = r#"
            #[derive(Archive)]
            enum Message {
                Quit,
                Move { x: i32, y: i32 },
                Write(String),
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedMessage = r.taggedEnum({"));
        assert!(code.contains("export type Message = r.Infer<typeof ArchivedMessage>;"));
        assert!(code.contains("Quit: r.unit"));
        assert!(code.contains("Move: r.struct({"));
        assert!(code.contains("Write: r.struct({"));
    }

    #[test]
    fn test_ignores_non_typescript_types() {
        let source = r#"
            #[derive(Debug)]
            struct NotExported {
                x: i32,
            }

            #[derive(Debug, Archive)]
            struct Exported {
                y: i32,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(!code.contains("ArchivedNotExported"));
        assert!(code.contains("ArchivedExported"));
    }

    #[test]
    fn test_qualified_archive_derive() {
        let source = r#"
            #[derive(rkyv::Archive)]
            struct QualifiedPath {
                value: u32,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedQualifiedPath = r.struct({"));
        assert!(code.contains("value: r.u32"));
    }

    #[test]
    fn test_aliased_archive_derive() {
        let source = r#"
            #[derive(some_alias::Archive)]
            struct AliasedPath {
                id: u64,
            }

            #[derive(deeply::nested::module::Archive)]
            struct DeeplyNested {
                data: String,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedAliasedPath = r.struct({"));
        assert!(code.contains("id: r.u64"));
        assert!(code.contains("export const ArchivedDeeplyNested = r.struct({"));
        assert!(code.contains("data: r.string"));
    }

    #[test]
    fn test_custom_marker_name() {
        // When using `use rkyv::Archive as Rkyv;`
        let source = r#"
            #[derive(Rkyv)]
            struct CustomMarker {
                value: i32,
            }

            #[derive(Archive)]
            struct DefaultMarker {
                value: u32,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_marker("Rkyv");
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedCustomMarker = r.struct({"));
        assert!(code.contains("export const ArchivedDefaultMarker = r.struct({"));
    }

    #[test]
    fn test_replace_markers() {
        let source = r#"
            #[derive(Rkyv)]
            struct WithRkyv {
                a: i32,
            }

            #[derive(Archive)]
            struct WithArchive {
                b: i32,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.set_markers(&["Rkyv"]);
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedWithRkyv = r.struct({"));
        assert!(!code.contains("WithArchive"));
    }

    #[test]
    fn test_extract_nested_types() {
        let source = r#"
            #[derive(Archive)]
            struct Inner {
                value: u32,
            }

            #[derive(Archive)]
            struct Outer {
                inner: Inner,
                items: Vec<Inner>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedInner = r.struct({"));
        assert!(code.contains("export const ArchivedOuter = r.struct({"));
        assert!(code.contains("inner: ArchivedInner"));
        assert!(code.contains("items: r.vec(ArchivedInner)"));
    }

    #[test]
    fn test_extract_lib_uuid() {
        let source = r#"
            use uuid::Uuid;

            #[derive(Archive)]
            struct Record {
                id: Uuid,
                name: String,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("import { uuid } from 'rkyv-js/lib/uuid';"));
        assert!(code.contains("export const ArchivedRecord = r.struct({"));
        assert!(code.contains("id: uuid"));
        assert!(code.contains("name: r.string"));
    }

    #[test]
    fn test_extract_lib_bytes() {
        let source = r#"
            use bytes::Bytes;

            #[derive(Archive)]
            struct Message {
                payload: Bytes,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("import { bytes } from 'rkyv-js/lib/bytes';"));
        assert!(code.contains("payload: bytes"));
    }

    #[test]
    fn test_extract_lib_smol_str() {
        let source = r#"
            use smol_str::SmolStr;

            #[derive(Archive)]
            struct Config {
                key: SmolStr,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        // SmolStr archives to the same format as String
        assert!(code.contains("key: r.string"));
    }

    #[test]
    fn test_extract_lib_thin_vec() {
        let source = r#"
            use thin_vec::ThinVec;

            #[derive(Archive)]
            struct Data {
                items: ThinVec<u32>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        // ThinVec archives to the same format as Vec
        assert!(code.contains("items: r.vec(r.u32)"));
    }

    #[test]
    fn test_extract_lib_arrayvec() {
        let source = r#"
            use arrayvec::ArrayVec;

            #[derive(Archive)]
            struct Buffer {
                data: ArrayVec<u8, 64>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        // ArrayVec archives to the same format as Vec
        assert!(code.contains("data: r.vec(r.u8)"));
    }

    #[test]
    fn test_extract_lib_smallvec() {
        let source = r#"
            use smallvec::SmallVec;

            #[derive(Archive)]
            struct Items {
                values: SmallVec<[u32; 4]>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        // SmallVec archives to the same format as Vec
        assert!(code.contains("values: r.vec(r.u32)"));
    }

    #[test]
    fn test_extract_lib_tinyvec() {
        let source = r#"
            use tinyvec::TinyVec;

            #[derive(Archive)]
            struct Stack {
                elements: TinyVec<[String; 8]>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        // TinyVec archives to the same format as Vec
        assert!(code.contains("elements: r.vec(r.string)"));
    }

    #[test]
    fn test_extract_lib_indexmap() {
        let source = r#"
            use indexmap::IndexMap;

            #[derive(Archive)]
            struct Config {
                settings: IndexMap<String, u32>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("import { indexMap } from 'rkyv-js/lib/indexmap';"));
        assert!(!code.contains("indexSet"));
        assert!(code.contains("settings: indexMap(r.string, r.u32)"));
    }

    #[test]
    fn test_extract_lib_indexset() {
        let source = r#"
            use indexmap::IndexSet;

            #[derive(Archive)]
            struct Tags {
                items: IndexSet<String>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("import { indexSet } from 'rkyv-js/lib/indexmap';"));
        assert!(!code.contains("indexMap"));
        assert!(code.contains("items: indexSet(r.string)"));
    }

    #[test]
    fn test_extract_lib_vec_deque() {
        let source = r#"
            use std::collections::VecDeque;

            #[derive(Archive)]
            struct Queue {
                items: VecDeque<u32>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("items: r.vec(r.u32)"));
    }

    #[test]
    fn test_extract_lib_hash_set() {
        let source = r#"
            use std::collections::HashSet;

            #[derive(Archive)]
            struct UniqueItems {
                ids: HashSet<String>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("import { hashSet } from 'rkyv-js/lib/std-hash-set';"));
        assert!(code.contains("ids: hashSet(r.string)"));
    }

    #[test]
    fn test_extract_lib_btree_set() {
        let source = r#"
            use std::collections::BTreeSet;

            #[derive(Archive)]
            struct SortedItems {
                values: BTreeSet<i64>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("import { btreeSet } from 'rkyv-js/lib/std-btree-set';"));
        assert!(code.contains("values: btreeSet(r.i64)"));
    }

    #[test]
    fn test_extract_lib_arc() {
        let source = r#"
            use triomphe::Arc;

            #[derive(Archive)]
            struct Shared {
                config: Arc<String>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        // Arc uses dedicated intrinsic
        assert!(code.contains("config: r.arc(r.string)"));
    }

    #[test]
    fn test_extract_lib_rc() {
        let source = r#"
            use std::rc::Rc;

            #[derive(Archive)]
            struct Shared {
                data: Rc<String>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("data: r.rc(r.string)"));
    }

    #[test]
    fn test_extract_lib_weak() {
        let source = r#"
            use std::rc::Weak;

            #[derive(Archive)]
            struct MaybeShared {
                weak_ref: Weak<u32>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("weak_ref: r.rcWeak(r.u32)"));
    }

    #[test]
    fn test_custom_registered_type() {
        let source = r#"
            #[derive(Archive)]
            struct MyData {
                custom: CustomVec<u32>,
            }
        "#;

        let mut codegen = CodeGenerator::new();
        use crate::registry::{GenericShape, TypeMapping};
        use crate::types::Import;
        codegen.register_type("CustomVec", TypeMapping {
            codec_expr: "customVec({0})".to_string(),
            ts_type: "{0}[]".to_string(),
            import: Some(Import::new("my-package/codecs", "customVec")),
            generics: GenericShape::Single,
        });
        codegen.add_source_str(source);

        let code = codegen.generate();
        assert!(code.contains("import { customVec } from 'my-package/codecs';"));
        assert!(code.contains("custom: customVec(r.u32)"));
    }
}
