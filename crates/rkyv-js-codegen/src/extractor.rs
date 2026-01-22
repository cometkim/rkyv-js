//! Source file parser that extracts types annotated with `#[derive(TypeScript)]`.
//!
//! This module provides functionality to scan Rust source files and automatically
//! extract type definitions for TypeScript binding generation.

use crate::types::{EnumVariant, TypeDef};
use crate::CodeGenerator;
use std::fs;
use std::path::Path;
use syn::{
    Attribute, Data, DeriveInput, Fields, GenericArgument, PathArguments, Type, TypeArray,
    TypePath, TypeTuple,
};
use walkdir::WalkDir;

/// Check if a derive input has the `TypeScript` derive macro.
fn has_typescript_derive(attrs: &[Attribute]) -> bool {
    for attr in attrs {
        if attr.path().is_ident("derive") {
            if let Ok(nested) = attr.parse_args_with(
                syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
            ) {
                for path in nested {
                    if path.is_ident("TypeScript") {
                        return true;
                    }
                }
            }
        }
    }
    false
}

/// Convert a syn Type to our TypeDef.
fn type_to_typedef(ty: &Type) -> Option<TypeDef> {
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
                    let inner_def = type_to_typedef(inner)?;
                    Some(TypeDef::Vec(Box::new(inner_def)))
                }
                "Option" => {
                    let inner = get_single_generic_arg(segment)?;
                    let inner_def = type_to_typedef(inner)?;
                    Some(TypeDef::Option(Box::new(inner_def)))
                }
                "Box" => {
                    let inner = get_single_generic_arg(segment)?;
                    let inner_def = type_to_typedef(inner)?;
                    Some(TypeDef::Box(Box::new(inner_def)))
                }
                "HashMap" => {
                    let (key, value) = get_two_generic_args(segment)?;
                    let key_def = type_to_typedef(key)?;
                    let value_def = type_to_typedef(value)?;
                    Some(TypeDef::HashMap(Box::new(key_def), Box::new(value_def)))
                }
                "BTreeMap" => {
                    let (key, value) = get_two_generic_args(segment)?;
                    let key_def = type_to_typedef(key)?;
                    let value_def = type_to_typedef(value)?;
                    Some(TypeDef::BTreeMap(Box::new(key_def), Box::new(value_def)))
                }

                // Named type (custom struct/enum)
                _ => Some(TypeDef::Named(ident_str)),
            }
        }
        Type::Array(TypeArray { elem, len, .. }) => {
            let elem_def = type_to_typedef(elem)?;
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
                let elem_defs: Option<Vec<_>> = elems.iter().map(type_to_typedef).collect();
                Some(TypeDef::Tuple(elem_defs?))
            }
        }
        Type::Reference(reference) => {
            // For &str, treat as String
            if let Type::Path(TypePath { path, .. }) = &*reference.elem {
                if path.is_ident("str") {
                    return Some(TypeDef::String);
                }
            }
            // Otherwise, follow the reference
            type_to_typedef(&reference.elem)
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
fn extract_struct(fields: &Fields) -> Option<Vec<(String, TypeDef)>> {
    match fields {
        Fields::Named(named) => {
            let field_defs: Option<Vec<_>> = named
                .named
                .iter()
                .map(|f| {
                    let field_name = f.ident.as_ref()?.to_string();
                    let type_def = type_to_typedef(&f.ty)?;
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
                    let type_def = type_to_typedef(&f.ty)?;
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
                        .map(|f| type_to_typedef(&f.ty))
                        .collect();
                    Some(EnumVariant::Tuple(variant_name, types?))
                }
                Fields::Named(fields) => {
                    let field_defs: Option<Vec<_>> = fields
                        .named
                        .iter()
                        .map(|f| {
                            let field_name = f.ident.as_ref()?.to_string();
                            let type_def = type_to_typedef(&f.ty)?;
                            Some((field_name, type_def))
                        })
                        .collect();
                    Some(EnumVariant::Struct(variant_name, field_defs?))
                }
            }
        })
        .collect()
}

/// Process a single DeriveInput and add it to the generator if it has TypeScript derive.
fn process_derive_input(gen: &mut CodeGenerator, input: &DeriveInput) {
    if !has_typescript_derive(&input.attrs) {
        return;
    }

    let name = input.ident.to_string();

    match &input.data {
        Data::Struct(data) => {
            if let Some(fields) = extract_struct(&data.fields) {
                let fields_ref: Vec<_> = fields
                    .iter()
                    .map(|(n, t)| (n.as_str(), t.clone()))
                    .collect();
                gen.add_struct(&name, &fields_ref);
            }
        }
        Data::Enum(data) => {
            if let Some(variants) = extract_enum(&data.variants) {
                gen.add_enum(&name, &variants);
            }
        }
        Data::Union(_) => {
            // Unions are not supported via derive, use add_union manually
        }
    }
}

/// Parse a Rust source file and extract TypeScript-annotated types.
fn parse_source_file(gen: &mut CodeGenerator, source: &str) {
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
            process_derive_input(gen, &input);
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
            process_derive_input(gen, &input);
        }
    }
}

impl CodeGenerator {
    /// Parse a single Rust source file and extract types with `#[derive(TypeScript)]`.
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
        parse_source_file(self, &source);
        Ok(self)
    }

    /// Parse Rust source from a string and extract types with `#[derive(TypeScript)]`.
    pub fn add_source_str(&mut self, source: &str) -> &mut Self {
        parse_source_file(self, source);
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
        for entry in WalkDir::new(path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.extension().map(|e| e == "rs").unwrap_or(false) {
                self.add_source_file(path)?;
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
            use rkyv_js_codegen::TypeScript;

            #[derive(TypeScript)]
            struct Point {
                x: f64,
                y: f64,
            }
        "#;

        let mut gen = CodeGenerator::new();
        gen.add_source_str(source);

        let code = gen.generate();
        assert!(code.contains("export interface Point"));
        assert!(code.contains("x: number"));
        assert!(code.contains("y: number"));
        assert!(code.contains("PointDecoder"));
        assert!(code.contains("PointEncoder"));
    }

    #[test]
    fn test_extract_struct_with_containers() {
        let source = r#"
            #[derive(TypeScript)]
            struct Person {
                name: String,
                age: u32,
                scores: Vec<u32>,
                email: Option<String>,
            }
        "#;

        let mut gen = CodeGenerator::new();
        gen.add_source_str(source);

        let code = gen.generate();
        assert!(code.contains("export interface Person"));
        assert!(code.contains("name: string"));
        assert!(code.contains("scores: number[]"));
        assert!(code.contains("email: string | null"));
    }

    #[test]
    fn test_extract_enum() {
        let source = r#"
            #[derive(TypeScript)]
            enum Message {
                Quit,
                Move { x: i32, y: i32 },
                Write(String),
            }
        "#;

        let mut gen = CodeGenerator::new();
        gen.add_source_str(source);

        let code = gen.generate();
        assert!(code.contains("export type Message"));
        assert!(code.contains("MessageDecoder"));
        assert!(code.contains("MessageEncoder"));
        assert!(code.contains("Quit"));
        assert!(code.contains("Move"));
        assert!(code.contains("Write"));
    }

    #[test]
    fn test_ignores_non_typescript_types() {
        let source = r#"
            #[derive(Debug)]
            struct NotExported {
                x: i32,
            }

            #[derive(TypeScript)]
            struct Exported {
                y: i32,
            }
        "#;

        let mut gen = CodeGenerator::new();
        gen.add_source_str(source);

        let code = gen.generate();
        assert!(!code.contains("NotExported"));
        assert!(code.contains("Exported"));
    }

    #[test]
    fn test_extract_nested_types() {
        let source = r#"
            #[derive(TypeScript)]
            struct Inner {
                value: u32,
            }

            #[derive(TypeScript)]
            struct Outer {
                inner: Inner,
                items: Vec<Inner>,
            }
        "#;

        let mut gen = CodeGenerator::new();
        gen.add_source_str(source);

        let code = gen.generate();
        assert!(code.contains("export interface Inner"));
        assert!(code.contains("export interface Outer"));
        assert!(code.contains("inner: Inner"));
        assert!(code.contains("InnerDecoder"));
        assert!(code.contains("InnerEncoder"));
    }
}
