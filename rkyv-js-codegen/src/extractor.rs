//! Rust source extraction: parses files with `syn` and adds every type
//! marked with a recognized derive (default `rkyv::Archive`) to the
//! [`CodeGenerator`].
//!
//! ## Marker detection
//!
//! A derive path marks a type for extraction iff:
//!
//! - it is the exact multi-segment marker path (`rkyv::Archive`, leading
//!   `::` allowed), or
//! - it is a single-segment ident resolving to a marker path through the
//!   file's `use` imports (including renames), or
//! - it is a bare ident and a glob import (`use rkyv::*`) brings a marker
//!   path into scope, or
//! - it matches a path registered via
//!   [`add_marker_path`](CodeGenerator::add_marker_path).
//!
//! ## Use-item analysis
//!
//! `use` trees are flattened into a local-name → fully-qualified-path map:
//!
//! - `use std::collections::BTreeMap` maps `BTreeMap` to
//!   `std::collections::BTreeMap`
//! - `use rkyv::Archive as Rkyv` maps `Rkyv` to `rkyv::Archive`
//! - `type HashMap<K, V> = std::collections::HashMap<K, V, S>` maps
//!   `HashMap` to `std::collections::HashMap` (the alias *path* only; extra
//!   RHS arguments surface as trailing type arguments at the use site)
//!
//! ## Remote proxies
//!
//! A type with `#[rkyv(remote = T)]` is a serialization proxy: it emits no
//! top-level export. Instead, the proxy itself is auto-registered as a
//! with-wrapper whose template is the proxy's own codec expression, so
//! fields annotated `#[rkyv(with = ProxyDef)]` resolve to it (rkyv 0.8
//! semantics).

use std::collections::HashMap;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use quote::ToTokens;
use syn::spanned::Spanned;
use syn::{
    Attribute, Fields, GenericArgument, PathArguments, Type, TypeArray, TypePath, TypeTuple,
    UseTree,
};
use walkdir::WalkDir;

use crate::error::{Diagnostic, DiagnosticKind, Error, SourceLocation};
use crate::expr::{CodecExpr, codec};
use crate::generator::{CodeGenerator, EnumVariant, OnUnknown, TypeKind};
use crate::registry::WithWrapper;

/// Per-file context built from `use` items and type aliases.
struct SourceContext {
    /// Maps local name → fully-qualified path.
    imports: HashMap<String, String>,
    /// Glob import prefixes (`use rkyv::*` → `"rkyv"`).
    globs: Vec<String>,
    /// The file being parsed, if known.
    file: Option<PathBuf>,
}

impl SourceContext {
    fn location(&self, span: proc_macro2::Span) -> SourceLocation {
        let start = span.start();
        SourceLocation {
            file: self.file.clone(),
            line: start.line,
            column: start.column + 1,
        }
    }
}

/// Recursively flatten a `UseTree` into import entries and glob prefixes.
fn collect_imports(
    tree: &UseTree,
    prefix: &[String],
    imports: &mut HashMap<String, String>,
    globs: &mut Vec<String>,
) {
    match tree {
        UseTree::Path(p) => {
            let mut new_prefix = prefix.to_vec();
            new_prefix.push(p.ident.to_string());
            collect_imports(&p.tree, &new_prefix, imports, globs);
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
            if !prefix.is_empty() {
                globs.push(prefix.join("::"));
            }
        }
        UseTree::Group(g) => {
            for item in &g.items {
                collect_imports(item, prefix, imports, globs);
            }
        }
    }
}

fn make_full_path(prefix: &[String], name: &str) -> String {
    if prefix.is_empty() {
        name.to_string()
    } else {
        format!("{}::{}", prefix.join("::"), name)
    }
}

fn path_segments(path: &syn::Path) -> Vec<String> {
    path.segments.iter().map(|s| s.ident.to_string()).collect()
}

/// Build a `SourceContext` from all `use` items and type aliases in a file.
fn build_source_context(file: &syn::File, source_file: Option<PathBuf>) -> SourceContext {
    let mut imports = HashMap::new();
    let mut globs = Vec::new();

    for item in &file.items {
        match item {
            syn::Item::Use(item_use) => {
                collect_imports(&item_use.tree, &[], &mut imports, &mut globs);
            }
            // `type Foo<..> = some::path::Bar<..>` maps `Foo` to
            // `some::path::Bar`. Only the path is resolved; generic
            // parameters on either side are handled at the use site.
            syn::Item::Type(item_type) => {
                if let Type::Path(TypePath { path, .. }) = &*item_type.ty
                    && path.segments.len() > 1
                {
                    imports.insert(
                        item_type.ident.to_string(),
                        path_segments(path).join("::"),
                    );
                }
            }
            _ => {}
        }
    }

    SourceContext {
        imports,
        globs,
        file: source_file,
    }
}

/// Type-level `#[rkyv(...)]` attributes the extractor understands.
#[derive(Default)]
struct RkyvTypeAttrs {
    /// `#[rkyv(remote = T)]`
    remote: Option<syn::Type>,
    /// `#[rkyv(archived = Name)]`
    archived: Option<String>,
}

/// Consume the rest of an unrecognized nested meta so parsing can continue.
fn skip_nested_meta_value(meta: &syn::meta::ParseNestedMeta) -> syn::Result<()> {
    if meta.input.peek(syn::Token![=]) {
        let _eq: syn::Token![=] = meta.input.parse()?;
        while !meta.input.is_empty() && !meta.input.peek(syn::Token![,]) {
            let _tt: proc_macro2::TokenTree = meta.input.parse()?;
        }
    } else if meta.input.peek(syn::token::Paren) {
        let content;
        syn::parenthesized!(content in meta.input);
        let _rest: proc_macro2::TokenStream = content.parse()?;
    }
    Ok(())
}

fn parse_rkyv_type_attrs(attrs: &[Attribute]) -> RkyvTypeAttrs {
    let mut parsed = RkyvTypeAttrs::default();
    for attr in attrs {
        if !attr.path().is_ident("rkyv") {
            continue;
        }
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("remote") {
                parsed.remote = Some(meta.value()?.parse()?);
            } else if meta.path.is_ident("archived") {
                let path: syn::Path = meta.value()?.parse()?;
                if let Some(last) = path.segments.last() {
                    parsed.archived = Some(last.ident.to_string());
                }
            } else {
                skip_nested_meta_value(&meta)?;
            }
            Ok(())
        });
    }
    parsed
}

/// The `W` of a field-level `#[rkyv(with = W)]`, if present.
fn parse_rkyv_field_with(attrs: &[Attribute]) -> Option<syn::Type> {
    let mut with: Option<syn::Type> = None;
    for attr in attrs {
        if !attr.path().is_ident("rkyv") {
            continue;
        }
        let _ = attr.parse_nested_meta(|meta| {
            if meta.path.is_ident("with") {
                if with.is_none() {
                    with = Some(meta.value()?.parse()?);
                } else {
                    skip_nested_meta_value(&meta)?;
                }
            } else {
                skip_nested_meta_value(&meta)?;
            }
            Ok(())
        });
    }
    with
}

/// Check whether one of the derive paths marks the type for extraction.
fn has_marker_derive(attrs: &[Attribute], ctx: &SourceContext, codegen: &CodeGenerator) -> bool {
    let markers = &codegen.marker_paths;
    for attr in attrs {
        if !attr.path().is_ident("derive") {
            continue;
        }
        let Ok(nested) = attr.parse_args_with(
            syn::punctuated::Punctuated::<syn::Path, syn::Token![,]>::parse_terminated,
        ) else {
            continue;
        };
        for path in nested {
            let segments = path_segments(&path);
            if segments.len() == 1 {
                let ident = &segments[0];
                // A user marker registered as a bare name.
                if markers.contains(ident) {
                    return true;
                }
                // Resolve through imports (incl. renames).
                if ctx.imports.get(ident).is_some_and(|fq| markers.contains(fq)) {
                    return true;
                }
                // Resolve through glob imports.
                if ctx
                    .globs
                    .iter()
                    .any(|glob| markers.contains(&format!("{glob}::{ident}")))
                {
                    return true;
                }
            } else {
                let joined = segments.join("::");
                if markers.contains(&joined) {
                    return true;
                }
            }
        }
    }
    false
}

fn type_to_string(ty: &Type) -> String {
    ty.to_token_stream().to_string()
}

/// Convert a syn type to a codec expression.
///
/// Errors carry only the [`DiagnosticKind`]; the calling field attaches
/// `referenced_by` and location provenance.
fn type_to_expr(
    ty: &Type,
    codegen: &CodeGenerator,
    ctx: &SourceContext,
) -> Result<CodecExpr, DiagnosticKind> {
    match ty {
        Type::Path(TypePath { qself: None, path }) => {
            let segment = path.segments.last().expect("type paths are non-empty");
            let raw_ident = segment.ident.to_string();

            // Multi-segment paths are already fully qualified; single-segment
            // idents resolve through the file's imports.
            let full_path = if path.segments.len() > 1 {
                path_segments(path).join("::")
            } else {
                ctx.imports
                    .get(&raw_ident)
                    .cloned()
                    .unwrap_or_else(|| raw_ident.clone())
            };

            match full_path.as_str() {
                "u8" => Ok(codec::u8()),
                "i8" => Ok(codec::i8()),
                "u16" => Ok(codec::u16()),
                "i16" => Ok(codec::i16()),
                "u32" => Ok(codec::u32()),
                "i32" => Ok(codec::i32()),
                "u64" => Ok(codec::u64()),
                "i64" => Ok(codec::i64()),
                "f32" => Ok(codec::f32()),
                "f64" => Ok(codec::f64()),
                "bool" => Ok(codec::bool_()),
                "char" => Ok(codec::char_()),
                "String" | "std::string::String" => Ok(codec::string()),
                "Vec" | "std::vec::Vec" => {
                    let inner = single_generic_arg(segment, ty)?;
                    Ok(codec::vec(type_to_expr(inner, codegen, ctx)?))
                }
                "Option" | "std::option::Option" => {
                    let inner = single_generic_arg(segment, ty)?;
                    Ok(codec::option(type_to_expr(inner, codegen, ctx)?))
                }
                "Box" | "std::boxed::Box" => {
                    let inner = single_generic_arg(segment, ty)?;
                    Ok(codec::boxed(type_to_expr(inner, codegen, ctx)?))
                }
                _ => {
                    if let Some(external) = codegen.registry.get_type(&full_path) {
                        let raw_args = collect_type_args(segment);
                        // Trailing arguments (hashers, allocators) are
                        // discarded, so never try to resolve them to codecs.
                        let keep = if external.allows_trailing() && raw_args.len() > external.arity()
                        {
                            external.arity()
                        } else {
                            raw_args.len()
                        };
                        let args = raw_args[..keep]
                            .iter()
                            .map(|arg| type_to_expr(arg, codegen, ctx))
                            .collect::<Result<Vec<_>, _>>()?;
                        external.instantiate(args).map_err(|kind| match kind {
                            DiagnosticKind::GenericArity {
                                expected, found, ..
                            } => DiagnosticKind::GenericArity {
                                rust_path: full_path.clone(),
                                expected,
                                found,
                            },
                            other => other,
                        })
                    } else if path.segments.len() == 1 && full_path == raw_ident {
                        // A bare local ident: a reference to another
                        // generated type, validated at generate time.
                        Ok(codec::named(raw_ident))
                    } else {
                        Err(DiagnosticKind::UnknownType {
                            suggestion: codegen.registry.suggest_type(&full_path),
                            rust_path: full_path,
                        })
                    }
                }
            }
        }
        Type::Array(TypeArray { elem, len, .. }) => {
            let elem_expr = type_to_expr(elem, codegen, ctx)?;
            if let syn::Expr::Lit(syn::ExprLit {
                lit: syn::Lit::Int(lit_int),
                ..
            }) = len
                && let Ok(len_val) = lit_int.base10_parse::<u64>()
            {
                Ok(codec::array(elem_expr, len_val))
            } else {
                Err(DiagnosticKind::UnsupportedFieldType {
                    rust_type: type_to_string(ty),
                })
            }
        }
        Type::Tuple(TypeTuple { elems, .. }) => {
            let elem_exprs = elems
                .iter()
                .map(|elem| type_to_expr(elem, codegen, ctx))
                .collect::<Result<Vec<_>, _>>()?;
            Ok(codec::tuple(elem_exprs))
        }
        Type::Reference(reference) => {
            if let Type::Path(TypePath { path, .. }) = &*reference.elem
                && path.is_ident("str")
            {
                return Ok(codec::string());
            }
            type_to_expr(&reference.elem, codegen, ctx)
        }
        Type::Paren(paren) => type_to_expr(&paren.elem, codegen, ctx),
        Type::Group(group) => type_to_expr(&group.elem, codegen, ctx),
        other => Err(DiagnosticKind::UnsupportedFieldType {
            rust_type: type_to_string(other),
        }),
    }
}

fn single_generic_arg<'a>(
    segment: &'a syn::PathSegment,
    whole: &Type,
) -> Result<&'a Type, DiagnosticKind> {
    if let PathArguments::AngleBracketed(args) = &segment.arguments
        && let Some(GenericArgument::Type(ty)) = args.args.first()
    {
        return Ok(ty);
    }
    Err(DiagnosticKind::UnsupportedFieldType {
        rust_type: type_to_string(whole),
    })
}

/// Collect the type arguments of a path segment.
///
/// - `[T; N]` array arguments are unwrapped to `T` (SmallVec/TinyVec-style
///   parameters).
/// - Lifetimes and const generics are skipped.
fn collect_type_args(segment: &syn::PathSegment) -> Vec<&Type> {
    let PathArguments::AngleBracketed(args) = &segment.arguments else {
        return vec![];
    };

    let mut type_args = Vec::new();
    for arg in &args.args {
        if let GenericArgument::Type(ty) = arg {
            if let Type::Array(TypeArray { elem, .. }) = ty {
                type_args.push(elem.as_ref());
            } else {
                type_args.push(ty);
            }
        }
    }
    type_args
}

/// Resolve the `W` of `#[rkyv(with = W)]` to a registry lookup key.
fn resolve_wrapper_path(ty: &syn::Type, ctx: &SourceContext) -> Option<String> {
    let Type::Path(TypePath { qself: None, path }) = ty else {
        return None;
    };
    let segments = path_segments(path);
    if segments.len() == 1 {
        Some(
            ctx.imports
                .get(&segments[0])
                .cloned()
                .unwrap_or_else(|| segments[0].clone()),
        )
    } else {
        Some(segments.join("::"))
    }
}

/// Resolve a field to its codec expression.
///
/// `Ok(None)` means the field is omitted (a `Skip` wrapper).
fn field_expr(
    field: &syn::Field,
    context: &str,
    codegen: &CodeGenerator,
    ctx: &SourceContext,
) -> Result<Option<CodecExpr>, Diagnostic> {
    if let Some(with_type) = parse_rkyv_field_with(&field.attrs) {
        let location = ctx.location(with_type.span());
        let resolved = resolve_wrapper_path(&with_type, ctx);
        let wrapper = resolved
            .as_deref()
            .and_then(|path| lookup_wrapper(codegen, ctx, path));
        let Some(wrapper) = wrapper else {
            return Err(Diagnostic::new(DiagnosticKind::UnknownWithWrapper {
                wrapper_path: resolved.unwrap_or_else(|| type_to_string(&with_type)),
            })
            .referenced_by(context)
            .at(Some(location)));
        };
        let underlying = if wrapper.needs_underlying() {
            let expr = type_to_expr(&field.ty, codegen, ctx).map_err(|kind| {
                Diagnostic::new(kind)
                    .referenced_by(context)
                    .at(Some(ctx.location(field.ty.span())))
            })?;
            Some(expr)
        } else {
            None
        };
        return Ok(wrapper.apply(underlying));
    }

    type_to_expr(&field.ty, codegen, ctx)
        .map(Some)
        .map_err(|kind| {
            Diagnostic::new(kind)
                .referenced_by(context)
                .at(Some(ctx.location(field.ty.span())))
        })
}

/// Look up a with-wrapper by resolved path, trying glob prefixes for bare
/// idents (`use rkyv::with::*` + `with = AsBox`).
fn lookup_wrapper(
    codegen: &CodeGenerator,
    ctx: &SourceContext,
    path: &str,
) -> Option<WithWrapper> {
    if let Some(wrapper) = codegen.registry.get_wrapper(path) {
        return Some(wrapper.clone());
    }
    if !path.contains("::") {
        for glob in &ctx.globs {
            if let Some(wrapper) = codegen.registry.get_wrapper(&format!("{glob}::{path}")) {
                return Some(wrapper.clone());
            }
        }
    }
    None
}

fn extract_struct_fields(
    type_name: &str,
    fields: &Fields,
    codegen: &CodeGenerator,
    ctx: &SourceContext,
) -> Result<Vec<(String, CodecExpr)>, Vec<Diagnostic>> {
    let mut out = Vec::new();
    let mut diagnostics = Vec::new();

    match fields {
        Fields::Named(named) => {
            for field in &named.named {
                let field_name = field
                    .ident
                    .as_ref()
                    .expect("named fields have idents")
                    .to_string();
                let context = format!("{type_name}.{field_name}");
                match field_expr(field, &context, codegen, ctx) {
                    Ok(Some(expr)) => out.push((field_name, expr)),
                    Ok(None) => {}
                    Err(diagnostic) => diagnostics.push(diagnostic),
                }
            }
        }
        Fields::Unnamed(unnamed) => {
            for (index, field) in unnamed.unnamed.iter().enumerate() {
                let context = format!("{type_name}.{index}");
                match field_expr(field, &context, codegen, ctx) {
                    Ok(Some(expr)) => out.push((format!("_{}", out.len()), expr)),
                    Ok(None) => {}
                    Err(diagnostic) => diagnostics.push(diagnostic),
                }
            }
        }
        Fields::Unit => {}
    }

    if diagnostics.is_empty() {
        Ok(out)
    } else {
        Err(diagnostics)
    }
}

fn extract_enum_variants(
    type_name: &str,
    variants: &syn::punctuated::Punctuated<syn::Variant, syn::token::Comma>,
    codegen: &CodeGenerator,
    ctx: &SourceContext,
) -> Result<Vec<EnumVariant>, Vec<Diagnostic>> {
    let mut out = Vec::new();
    let mut diagnostics = Vec::new();

    for variant in variants {
        let variant_name = variant.ident.to_string();
        match &variant.fields {
            Fields::Unit => out.push(EnumVariant::Unit(variant_name)),
            Fields::Unnamed(unnamed) => {
                let mut exprs = Vec::new();
                for (index, field) in unnamed.unnamed.iter().enumerate() {
                    let context = format!("{type_name}::{variant_name}.{index}");
                    match field_expr(field, &context, codegen, ctx) {
                        Ok(Some(expr)) => exprs.push(expr),
                        Ok(None) => {}
                        Err(diagnostic) => diagnostics.push(diagnostic),
                    }
                }
                let variant = if unnamed.unnamed.len() == 1 {
                    // A newtype variant decodes as the bare inner value; a
                    // fully skipped one degenerates to a unit variant.
                    match exprs.pop() {
                        Some(expr) => EnumVariant::Newtype(variant_name, expr),
                        None => EnumVariant::Unit(variant_name),
                    }
                } else {
                    EnumVariant::Tuple(variant_name, exprs)
                };
                out.push(variant);
            }
            Fields::Named(named) => {
                let mut fields = Vec::new();
                for field in &named.named {
                    let field_name = field
                        .ident
                        .as_ref()
                        .expect("named fields have idents")
                        .to_string();
                    let context = format!("{type_name}::{variant_name}.{field_name}");
                    match field_expr(field, &context, codegen, ctx) {
                        Ok(Some(expr)) => fields.push((field_name, expr)),
                        Ok(None) => {}
                        Err(diagnostic) => diagnostics.push(diagnostic),
                    }
                }
                out.push(EnumVariant::Struct(variant_name, fields));
            }
        }
    }

    if diagnostics.is_empty() {
        Ok(out)
    } else {
        Err(diagnostics)
    }
}

/// The inline codec expression for a struct (used for remote proxies).
fn struct_expr(fields: Vec<(String, CodecExpr)>) -> CodecExpr {
    CodecExpr::call(
        CodecExpr::runtime("struct"),
        [CodecExpr::object(fields)],
    )
}

/// The inline codec expression for an enum (used for remote proxies).
fn enum_expr(variants: Vec<EnumVariant>) -> CodecExpr {
    let entries = variants.into_iter().map(|variant| match variant {
        EnumVariant::Unit(name) => (name, CodecExpr::raw("null")),
        EnumVariant::Newtype(name, expr) => (name, expr),
        EnumVariant::Tuple(name, exprs) => (
            name,
            CodecExpr::object(
                exprs
                    .into_iter()
                    .enumerate()
                    .map(|(i, expr)| (format!("_{i}"), expr)),
            ),
        ),
        EnumVariant::Struct(name, fields) => (name, CodecExpr::object(fields)),
    });
    CodecExpr::call(
        CodecExpr::runtime("taggedEnum"),
        [CodecExpr::object(entries)],
    )
}

/// A top-level struct or enum item.
enum TypeItem<'a> {
    Struct(&'a syn::ItemStruct),
    Enum(&'a syn::ItemEnum),
}

impl TypeItem<'_> {
    fn attrs(&self) -> &[Attribute] {
        match self {
            TypeItem::Struct(item) => &item.attrs,
            TypeItem::Enum(item) => &item.attrs,
        }
    }

    fn ident(&self) -> &syn::Ident {
        match self {
            TypeItem::Struct(item) => &item.ident,
            TypeItem::Enum(item) => &item.ident,
        }
    }
}

fn type_items(file: &syn::File) -> Vec<TypeItem<'_>> {
    file.items
        .iter()
        .filter_map(|item| match item {
            syn::Item::Struct(s) => Some(TypeItem::Struct(s)),
            syn::Item::Enum(e) => Some(TypeItem::Enum(e)),
            _ => None,
        })
        .collect()
}

fn parse_source(
    codegen: &mut CodeGenerator,
    source: &str,
    file: Option<PathBuf>,
) -> Result<(), Error> {
    let parsed = syn::parse_file(source).map_err(|source| Error::Parse {
        file: file.clone(),
        source,
    })?;
    let ctx = build_source_context(&parsed, file);
    let items = type_items(&parsed);

    // Pass 1: remote proxies. `#[rkyv(remote = T)]` types register
    // themselves as with-wrappers and emit no top-level export. Running
    // this pass first makes proxy usage order-independent within a file.
    for item in &items {
        if !has_marker_derive(item.attrs(), &ctx, codegen) {
            continue;
        }
        let attrs = parse_rkyv_type_attrs(item.attrs());
        if attrs.remote.is_none() {
            continue;
        }
        let name = item.ident().to_string();
        let built = match item {
            TypeItem::Struct(s) => {
                extract_struct_fields(&name, &s.fields, codegen, &ctx).map(struct_expr)
            }
            TypeItem::Enum(e) => {
                extract_enum_variants(&name, &e.variants, codegen, &ctx).map(enum_expr)
            }
        };
        match built {
            Ok(expr) => {
                if let Some(fq_path) = ctx.imports.get(&name) {
                    codegen
                        .registry
                        .register_wrapper(fq_path.clone(), WithWrapper::replace(expr.clone()));
                }
                codegen
                    .registry
                    .register_wrapper(name, WithWrapper::replace(expr));
            }
            Err(diagnostics) => match codegen.on_unknown {
                OnUnknown::Error => codegen.add_diagnostics.extend(diagnostics),
                OnUnknown::SkipContainingType => {
                    for diagnostic in diagnostics {
                        eprintln!(
                            "cargo:warning=rkyv-js-codegen: skipping remote proxy `{name}`: \
                             {diagnostic}"
                        );
                    }
                }
            },
        }
    }

    // Pass 2: regular types.
    for item in &items {
        if !has_marker_derive(item.attrs(), &ctx, codegen) {
            continue;
        }
        let attrs = parse_rkyv_type_attrs(item.attrs());
        if attrs.remote.is_some() {
            continue;
        }
        let name = item.ident().to_string();
        let location = Some(ctx.location(item.ident().span()));
        let extracted = match item {
            TypeItem::Struct(s) => {
                extract_struct_fields(&name, &s.fields, codegen, &ctx).map(TypeKind::Struct)
            }
            TypeItem::Enum(e) => {
                extract_enum_variants(&name, &e.variants, codegen, &ctx).map(TypeKind::Enum)
            }
        };
        match extracted {
            Ok(kind) => codegen.add_type(name.clone(), kind, location),
            Err(diagnostics) => codegen.add_failed_type(name.clone(), diagnostics, location),
        }
        if let Some(archived) = attrs.archived {
            codegen.set_archived_name(name, archived);
        }
    }

    Ok(())
}

impl CodeGenerator {
    /// Parse a Rust source file and extract every type with a marker derive.
    ///
    /// # Example
    ///
    /// ```no_run
    /// use rkyv_js_codegen::CodeGenerator;
    ///
    /// fn main() -> Result<(), rkyv_js_codegen::Error> {
    ///     CodeGenerator::new()
    ///         .add_source_file("src/lib.rs")?
    ///         .write_to_file("generated/bindings.ts")?;
    ///     Ok(())
    /// }
    /// ```
    pub fn add_source_file(&mut self, path: impl AsRef<Path>) -> Result<&mut Self, Error> {
        let path = path.as_ref();
        let source = fs::read_to_string(path)?;
        parse_source(self, &source, Some(path.to_path_buf()))?;
        Ok(self)
    }

    /// Parse Rust source from a string and extract every type with a marker
    /// derive.
    pub fn add_source_str(&mut self, source: &str) -> Result<&mut Self, Error> {
        parse_source(self, source, None)?;
        Ok(self)
    }

    /// Recursively scan a directory for `.rs` files and extract every type
    /// with a marker derive. Files are processed in path order.
    pub fn add_source_dir(&mut self, path: impl AsRef<Path>) -> Result<&mut Self, Error> {
        let mut files: Vec<PathBuf> = Vec::new();
        for entry in WalkDir::new(path) {
            let entry = entry.map_err(io::Error::other)?;
            let entry_path = entry.path();
            if entry_path.extension().is_some_and(|ext| ext == "rs") {
                files.push(entry_path.to_path_buf());
            }
        }
        files.sort();
        for file in files {
            self.add_source_file(&file)?;
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error::DiagnosticKind;
    use crate::registry::ExternalType;

    fn generate(source: &str) -> String {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source).unwrap();
        codegen.generate().unwrap()
    }

    fn generate_diagnostics(source: &str) -> Vec<Diagnostic> {
        let mut codegen = CodeGenerator::new();
        codegen.add_source_str(source).unwrap();
        match codegen.generate() {
            Err(Error::Codegen(diagnostics)) => diagnostics,
            other => panic!("expected codegen diagnostics, got {other:?}"),
        }
    }

    // ── Basic extraction ────────────────────────────────────────────

    #[test]
    fn extracts_simple_struct() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Point { x: f64, y: f64 }
        "#,
        );
        assert!(code.contains("export const ArchivedPoint = r.struct({\n  x: r.f64,\n  y: r.f64,\n});"));
        assert!(code.contains("export type Point = r.Infer<typeof ArchivedPoint>;"));
    }

    #[test]
    fn extracts_containers_and_str() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Person {
                name: String,
                nickname: &'static str,
                age: u32,
                scores: Vec<u32>,
                email: Option<String>,
                boxed: Box<u64>,
                arr: [u16; 4],
                tup: (u8, String, f64),
                unit: (),
            }
        "#,
        );
        assert!(code.contains("name: r.string,"));
        assert!(code.contains("nickname: r.string,"));
        assert!(code.contains("scores: r.vec(r.u32),"));
        assert!(code.contains("email: r.option(r.string),"));
        assert!(code.contains("boxed: r.box(r.u64),"));
        assert!(code.contains("arr: r.array(r.u16, 4),"));
        assert!(code.contains("tup: r.tuple(r.u8, r.string, r.f64),"));
        assert!(code.contains("unit: r.unit,"));
    }

    #[test]
    fn extracts_enum_with_new_variant_shapes() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            enum Message {
                Quit,
                Move { x: i32, y: i32 },
                Write(String),
                ChangeColor(u8, u8, u8),
            }
        "#,
        );
        assert!(code.contains(
            "export const ArchivedMessage = r.taggedEnum({\n\
             \x20 Quit: null,\n\
             \x20 Move: { x: r.i32, y: r.i32 },\n\
             \x20 Write: r.string,\n\
             \x20 ChangeColor: { _0: r.u8, _1: r.u8, _2: r.u8 },\n\
             });"
        ));
    }

    #[test]
    fn extracts_tuple_struct() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Pair(u32, String);
        "#,
        );
        assert!(code.contains("export const ArchivedPair = r.struct({\n  _0: r.u32,\n  _1: r.string,\n});"));
    }

    #[test]
    fn cross_references_resolve_to_archived_names() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Inner { value: u32 }
            #[derive(Archive)]
            struct Outer { inner: Inner, items: Vec<Inner> }
        "#,
        );
        assert!(code.contains("inner: ArchivedInner,"));
        assert!(code.contains("items: r.vec(ArchivedInner),"));
        let inner_pos = code.find("export const ArchivedInner").unwrap();
        let outer_pos = code.find("export const ArchivedOuter").unwrap();
        assert!(inner_pos < outer_pos);
    }

    // ── Marker detection ────────────────────────────────────────────

    #[test]
    fn marker_via_plain_import() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Debug)]
            struct NotExported { x: i32 }
            #[derive(Debug, Archive)]
            struct Exported { y: i32 }
        "#,
        );
        assert!(!code.contains("ArchivedNotExported"));
        assert!(code.contains("ArchivedExported"));
    }

    #[test]
    fn marker_via_qualified_path() {
        let code = generate(
            r#"
            #[derive(rkyv::Archive)]
            struct QualifiedPath { value: u32 }
            #[derive(::rkyv::Archive)]
            struct LeadingColons { value: u32 }
        "#,
        );
        assert!(code.contains("ArchivedQualifiedPath"));
        assert!(code.contains("ArchivedLeadingColons"));
    }

    #[test]
    fn marker_via_rename() {
        let code = generate(
            r#"
            use rkyv::Archive as Rkyv;
            #[derive(Rkyv)]
            struct AliasedMarker { value: i32 }
        "#,
        );
        assert!(code.contains("ArchivedAliasedMarker"));
    }

    #[test]
    fn marker_via_glob_import() {
        let code = generate(
            r#"
            use rkyv::*;
            #[derive(Archive)]
            struct GlobMarked { value: i32 }
        "#,
        );
        assert!(code.contains("ArchivedGlobMarked"));
    }

    #[test]
    fn marker_via_add_marker_path() {
        let mut codegen = CodeGenerator::new();
        codegen.add_marker_path("my_macros::TS");
        codegen
            .add_source_str(
                r#"
                use my_macros::TS;
                #[derive(TS)]
                struct Custom { value: u8 }
                #[derive(my_macros::TS)]
                struct CustomQualified { value: u8 }
            "#,
            )
            .unwrap();
        let code = codegen.generate().unwrap();
        assert!(code.contains("ArchivedCustom"));
        assert!(code.contains("ArchivedCustomQualified"));
    }

    #[test]
    fn foreign_archive_paths_do_not_match() {
        // The old `ends_with("::Archive")` over-match must be gone.
        let mut codegen = CodeGenerator::new();
        codegen
            .add_source_str(
                r#"
                #[derive(some_alias::Archive)]
                struct NotOurs { id: u64 }
                #[derive(deeply::nested::module::Archive)]
                struct AlsoNotOurs { data: String }
            "#,
            )
            .unwrap();
        let code = codegen.generate().unwrap();
        assert!(!code.contains("ArchivedNotOurs"));
        assert!(!code.contains("ArchivedAlsoNotOurs"));
    }

    #[test]
    fn bare_marker_without_import_does_not_match() {
        let code = generate(
            r#"
            #[derive(Archive)]
            struct NotDetected { a: i32 }
            #[derive(Rkyv)]
            struct AlsoNotDetected { b: i32 }
        "#,
        );
        assert!(!code.contains("ArchivedNotDetected"));
        assert!(!code.contains("ArchivedAlsoNotDetected"));
    }

    // ── Built-in external types ─────────────────────────────────────

    #[test]
    fn builtin_leaf_types() {
        let code = generate(
            r#"
            use rkyv::Archive;
            use uuid::Uuid;
            use bytes::Bytes;
            use smol_str::SmolStr;
            #[derive(Archive)]
            struct Record { id: Uuid, payload: Bytes, key: SmolStr }
        "#,
        );
        assert!(code.contains("import { bytes } from 'rkyv-js/lib/bytes';"));
        assert!(code.contains("import { uuid } from 'rkyv-js/lib/uuid';"));
        assert!(code.contains("id: uuid,"));
        assert!(code.contains("payload: bytes,"));
        assert!(code.contains("key: r.string,"));
    }

    #[test]
    fn builtin_vec_like_types() {
        let code = generate(
            r#"
            use rkyv::Archive;
            use thin_vec::ThinVec;
            use arrayvec::ArrayVec;
            use smallvec::SmallVec;
            use tinyvec::TinyVec;
            use std::collections::VecDeque;
            #[derive(Archive)]
            struct Data {
                thin: ThinVec<u32>,
                array_vec: ArrayVec<u8, 64>,
                small: SmallVec<[u32; 4]>,
                tiny: TinyVec<[String; 8]>,
                deque: VecDeque<u32>,
            }
        "#,
        );
        assert!(code.contains("thin: r.vec(r.u32),"));
        assert!(code.contains("array_vec: r.vec(r.u8),"));
        assert!(code.contains("small: r.vec(r.u32),"));
        assert!(code.contains("tiny: r.vec(r.string),"));
        assert!(code.contains("deque: r.vec(r.u32),"));
    }

    #[test]
    fn builtin_maps_and_sets() {
        let code = generate(
            r#"
            use rkyv::Archive;
            use std::collections::{HashMap, HashSet, BTreeMap, BTreeSet};
            use indexmap::{IndexMap, IndexSet};
            #[derive(Archive)]
            struct Collections {
                hm: HashMap<String, u32>,
                hs: HashSet<String>,
                bm: BTreeMap<String, u64>,
                bs: BTreeSet<i64>,
                im: IndexMap<String, u32>,
                is: IndexSet<String>,
            }
        "#,
        );
        assert!(code.contains("import { btreeMap, btreeSet } from 'rkyv-js/lib/btreemap';"));
        assert!(code.contains("import { hashMap, hashSet } from 'rkyv-js/lib/hashmap';"));
        assert!(code.contains("import { indexMap, indexSet } from 'rkyv-js/lib/indexmap';"));
        assert!(code.contains("hm: hashMap(r.string, r.u32),"));
        assert!(code.contains("hs: hashSet(r.string),"));
        assert!(code.contains("bm: btreeMap(r.string, r.u64),"));
        assert!(code.contains("bs: btreeSet(r.i64),"));
        assert!(code.contains("im: indexMap(r.string, r.u32),"));
        assert!(code.contains("is: indexSet(r.string),"));
    }

    #[test]
    fn builtin_pointer_types() {
        let code = generate(
            r#"
            use rkyv::Archive;
            use std::rc::{Rc, Weak};
            #[derive(Archive)]
            struct Shared { data: Rc<String>, weak_ref: Weak<u32>, arc: triomphe::Arc<String> }
        "#,
        );
        assert!(code.contains("data: r.rc(r.string),"));
        assert!(code.contains("weak_ref: r.weak(r.u32),"));
        assert!(code.contains("arc: r.rc(r.string),"));
    }

    #[test]
    fn renamed_imports_resolve() {
        let code = generate(
            r#"
            use rkyv::Archive;
            use std::collections::{HashMap as Map, BTreeSet as SortedSet};
            use uuid::Uuid as Id;
            #[derive(Archive)]
            struct Data { map: Map<String, u32>, set: SortedSet<String>, id: Id }
        "#,
        );
        assert!(code.contains("map: hashMap(r.string, r.u32),"));
        assert!(code.contains("set: btreeSet(r.string),"));
        assert!(code.contains("id: uuid,"));
    }

    #[test]
    fn generic_type_alias_resolves_to_registry_path() {
        // The pinned-hasher alias pattern: generic parameters on the LEFT,
        // a trailing hasher argument on the RIGHT. Only the path resolves;
        // the use site supplies exactly K and V.
        let code = generate(
            r#"
            use rkyv::Archive;
            pub type FixedState = std::hash::BuildHasherDefault<Hasher13>;
            pub type HashMap<K, V> = std::collections::HashMap<K, V, FixedState>;
            #[derive(Archive)]
            struct Data { m: HashMap<String, u32> }
        "#,
        );
        assert!(code.contains("m: hashMap(r.string, r.u32),"));
    }

    #[test]
    fn inline_trailing_hasher_is_allowed() {
        let code = generate(
            r#"
            use rkyv::Archive;
            pub type State = std::hash::BuildHasherDefault<Hasher13>;
            #[derive(Archive)]
            struct Data { m: std::collections::HashMap<String, u32, State> }
        "#,
        );
        assert!(code.contains("m: hashMap(r.string, r.u32),"));
    }

    // ── Diagnostics ─────────────────────────────────────────────────

    #[test]
    fn generic_arity_too_few_args() {
        let diagnostics = generate_diagnostics(
            r#"
            use rkyv::Archive;
            use std::collections::HashMap;
            #[derive(Archive)]
            struct Data { m: HashMap<String> }
        "#,
        );
        assert_eq!(diagnostics.len(), 1);
        assert!(matches!(
            &diagnostics[0].kind,
            DiagnosticKind::GenericArity { rust_path, expected: 2, found: 1 }
                if rust_path == "std::collections::HashMap"
        ));
        assert_eq!(diagnostics[0].referenced_by.as_deref(), Some("Data.m"));
    }

    #[test]
    fn generic_arity_too_many_args_without_trailing() {
        let diagnostics = generate_diagnostics(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Data { m: std::collections::BTreeMap<String, u32, Extra> }
        "#,
        );
        assert!(matches!(
            &diagnostics[0].kind,
            DiagnosticKind::GenericArity { rust_path, expected: 2, found: 3 }
                if rust_path == "std::collections::BTreeMap"
        ));
    }

    #[test]
    fn unknown_type_reports_path_and_suggestion() {
        let diagnostics = generate_diagnostics(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Event { id: my_uuid::Uuid, at: chrono::NaiveDate }
        "#,
        );
        assert_eq!(diagnostics.len(), 2);
        assert!(diagnostics.iter().any(|diagnostic| matches!(
            &diagnostic.kind,
            DiagnosticKind::UnknownType { rust_path, suggestion: Some(suggestion) }
                if rust_path == "my_uuid::Uuid" && suggestion == "uuid::Uuid"
        )));
        assert!(diagnostics.iter().any(|diagnostic| matches!(
            &diagnostic.kind,
            DiagnosticKind::UnknownType { rust_path, suggestion: None }
                if rust_path == "chrono::NaiveDate"
        )));
    }

    #[test]
    fn unknown_imported_type_is_not_a_dangling_ref() {
        // A single-segment ident that resolves via imports to an
        // unregistered path must be an UnknownType error, not a silent
        // `ArchivedNaiveDate` type reference.
        let diagnostics = generate_diagnostics(
            r#"
            use rkyv::Archive;
            use chrono::NaiveDate;
            #[derive(Archive)]
            struct Event { at: NaiveDate }
        "#,
        );
        assert!(matches!(
            &diagnostics[0].kind,
            DiagnosticKind::UnknownType { rust_path, .. } if rust_path == "chrono::NaiveDate"
        ));
    }

    #[test]
    fn diagnostics_carry_source_locations() {
        let diagnostics = generate_diagnostics(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Event { at: chrono::NaiveDate }
        "#,
        );
        let location = diagnostics[0].location.as_ref().unwrap();
        assert_eq!(location.file, None);
        assert_eq!(location.line, 4);
        assert!(location.column > 1);
    }

    #[test]
    fn undeclared_local_ref_is_unresolved() {
        let diagnostics = generate_diagnostics(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Outer { inner: NeverDeclared }
        "#,
        );
        assert!(matches!(
            &diagnostics[0].kind,
            DiagnosticKind::UnresolvedTypeRef { name } if name == "NeverDeclared"
        ));
        assert_eq!(diagnostics[0].referenced_by.as_deref(), Some("Outer.inner"));
    }

    #[test]
    fn duplicate_types_across_sources() {
        let mut codegen = CodeGenerator::new();
        codegen
            .add_source_str("use rkyv::Archive; #[derive(Archive)] struct Point { x: f64 }")
            .unwrap();
        codegen
            .add_source_str("use rkyv::Archive; #[derive(Archive)] struct Point { y: f64 }")
            .unwrap();
        let Err(Error::Codegen(diagnostics)) = codegen.generate() else {
            panic!("expected duplicate diagnostic");
        };
        assert!(matches!(
            &diagnostics[0].kind,
            DiagnosticKind::DuplicateType { name } if name == "Point"
        ));
    }

    #[test]
    fn parse_errors_propagate() {
        let mut codegen = CodeGenerator::new();
        let error = codegen.add_source_str("struct {").unwrap_err();
        assert!(matches!(error, Error::Parse { file: None, .. }));
    }

    // ── OnUnknown::SkipContainingType ───────────────────────────────

    #[test]
    fn skip_mode_omits_unknown_and_dependents() {
        let mut codegen = CodeGenerator::new();
        codegen.on_unknown_type(OnUnknown::SkipContainingType);
        codegen
            .add_source_str(
                r#"
                use rkyv::Archive;
                #[derive(Archive)]
                struct Fine { x: u32 }
                #[derive(Archive)]
                struct Broken { at: chrono::NaiveDate }
                #[derive(Archive)]
                struct UsesBroken { broken: Broken }
                #[derive(Archive)]
                struct UsesUsesBroken { nested: UsesBroken }
            "#,
            )
            .unwrap();
        let code = codegen.generate().unwrap();
        assert!(code.contains("ArchivedFine"));
        assert!(!code.contains("ArchivedBroken"));
        assert!(!code.contains("ArchivedUsesBroken"));
        assert!(!code.contains("ArchivedUsesUsesBroken"));
    }

    // ── With-wrappers ───────────────────────────────────────────────

    #[test]
    fn with_asbox_boxes_the_underlying_codec() {
        let code = generate(
            r#"
            use rkyv::Archive;
            use rkyv::with::AsBox;
            #[derive(Archive)]
            struct Data {
                #[rkyv(with = AsBox)]
                big: String,
            }
        "#,
        );
        assert!(code.contains("big: r.box(r.string),"));
    }

    #[test]
    fn with_inline_is_identity() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Data {
                #[rkyv(with = rkyv::with::Inline)]
                value: u32,
                #[rkyv(with = rkyv::with::InlineAsBox)]
                other: u64,
            }
        "#,
        );
        assert!(code.contains("value: r.u32,"));
        assert!(code.contains("other: r.box(r.u64),"));
    }

    #[test]
    fn with_skip_omits_the_field() {
        let code = generate(
            r#"
            use rkyv::Archive;
            use rkyv::with::Skip;
            #[derive(Archive)]
            struct Data {
                kept: u32,
                #[rkyv(with = Skip)]
                dropped: String,
            }
        "#,
        );
        assert!(code.contains("kept: r.u32,"));
        assert!(!code.contains("dropped"));
    }

    #[test]
    fn with_unknown_wrapper_is_a_diagnostic() {
        let diagnostics = generate_diagnostics(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Data {
                #[rkyv(with = Mystery)]
                value: u32,
            }
        "#,
        );
        assert!(matches!(
            &diagnostics[0].kind,
            DiagnosticKind::UnknownWithWrapper { wrapper_path } if wrapper_path == "Mystery"
        ));
        assert_eq!(diagnostics[0].referenced_by.as_deref(), Some("Data.value"));
    }

    #[test]
    fn with_replace_never_resolves_the_field_type() {
        // remote::Coord is not registered; a replace wrapper must not care.
        let mut codegen = CodeGenerator::new();
        codegen.register_with(
            "AsJson",
            WithWrapper::replace(CodecExpr::import_from("./coord.ts", "Coord")),
        );
        codegen
            .add_source_str(
                r#"
                use rkyv::Archive;
                #[derive(Archive)]
                struct RemoteEvent {
                    name: String,
                    #[rkyv(with = AsJson)]
                    location: remote::Coord,
                    priority: u32,
                }
            "#,
            )
            .unwrap();
        let code = codegen.generate().unwrap();
        assert!(code.contains("import { Coord } from './coord.ts';"));
        assert!(code.contains("location: Coord,"));
    }

    #[test]
    fn with_wrapper_resolves_through_glob_imports() {
        let code = generate(
            r#"
            use rkyv::Archive;
            use rkyv::with::*;
            #[derive(Archive)]
            struct Data {
                #[rkyv(with = AsBox)]
                big: String,
            }
        "#,
        );
        assert!(code.contains("big: r.box(r.string),"));
    }

    // ── Remote proxies ──────────────────────────────────────────────

    #[test]
    fn remote_proxy_registers_itself_as_wrapper() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(remote = chrono::NaiveDate)]
            struct NaiveDateDef {
                year: i32,
                ordinal: u32,
            }
            #[derive(Archive)]
            struct Event {
                name: String,
                #[rkyv(with = NaiveDateDef)]
                date: chrono::NaiveDate,
            }
        "#,
        );
        // The proxy emits no top-level export…
        assert!(!code.contains("ArchivedNaiveDateDef"));
        // …and the consuming field gets the proxy's own struct codec.
        assert!(code.contains("date: r.struct({ year: r.i32, ordinal: r.u32 }),"));
    }

    #[test]
    fn remote_proxy_is_order_independent_within_a_file() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            struct Event {
                #[rkyv(with = CoordDef)]
                location: remote::Coord,
            }
            #[derive(Archive)]
            #[rkyv(remote = remote::Coord)]
            struct CoordDef { x: f32, y: f32 }
        "#,
        );
        assert!(code.contains("location: r.struct({ x: r.f32, y: r.f32 }),"));
        assert!(!code.contains("ArchivedCoordDef"));
    }

    #[test]
    fn remote_field_without_with_is_unknown() {
        // rkyv 0.8 consumes remote proxies via #[rkyv(with = ProxyDef)];
        // a bare field of the remote type does not resolve.
        let diagnostics = generate_diagnostics(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(remote = chrono::NaiveDate)]
            struct NaiveDateDef { year: i32, ordinal: u32 }
            #[derive(Archive)]
            struct Event { date: chrono::NaiveDate }
        "#,
        );
        assert!(matches!(
            &diagnostics[0].kind,
            DiagnosticKind::UnknownType { rust_path, .. } if rust_path == "chrono::NaiveDate"
        ));
    }

    // ── Archived renames ────────────────────────────────────────────

    #[test]
    fn archived_rename_attribute() {
        let code = generate(
            r#"
            use rkyv::Archive;
            #[derive(Archive)]
            #[rkyv(compare(PartialEq), archived = CustomPoint, derive(Debug))]
            struct Point { x: f64, y: f64 }
            #[derive(Archive)]
            struct Line { start: Point, end: Point }
        "#,
        );
        assert!(code.contains("export const CustomPoint = r.struct({"));
        assert!(code.contains("export type Point = r.Infer<typeof CustomPoint>;"));
        assert!(code.contains("start: CustomPoint,"));
        assert!(!code.contains("ArchivedPoint"));
    }

    // ── Custom registrations ────────────────────────────────────────

    #[test]
    fn custom_external_type() {
        let mut codegen = CodeGenerator::new();
        codegen.register_external(
            "my_crate::CustomVec",
            ExternalType::generic1(|t| {
                CodecExpr::call(CodecExpr::import_from("my-package/codecs", "customVec"), [t])
            }),
        );
        codegen
            .add_source_str(
                r#"
                use rkyv::Archive;
                use my_crate::CustomVec;
                #[derive(Archive)]
                struct MyData { custom: CustomVec<u32> }
            "#,
            )
            .unwrap();
        let code = codegen.generate().unwrap();
        assert!(code.contains("import { customVec } from 'my-package/codecs';"));
        assert!(code.contains("custom: customVec(r.u32),"));
    }

    #[test]
    fn unregister_external_removes_builtin() {
        let mut codegen = CodeGenerator::new();
        codegen.unregister_external("uuid::Uuid");
        codegen
            .add_source_str(
                r#"
                use rkyv::Archive;
                use uuid::Uuid;
                #[derive(Archive)]
                struct Record { id: Uuid }
            "#,
            )
            .unwrap();
        let Err(Error::Codegen(diagnostics)) = codegen.generate() else {
            panic!("expected unknown type diagnostic");
        };
        assert!(matches!(
            &diagnostics[0].kind,
            DiagnosticKind::UnknownType { rust_path, .. } if rust_path == "uuid::Uuid"
        ));
    }
}
