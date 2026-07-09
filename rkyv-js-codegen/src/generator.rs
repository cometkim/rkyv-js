//! The TypeScript binding generator.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

use crate::error::{Diagnostic, DiagnosticKind, Error, SourceLocation};
use crate::expr::{CodecExpr, generate_import_block};
use crate::registry::{ExternalType, Registry, WithWrapper};

/// How to handle a field whose type cannot be mapped to a codec.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OnUnknown {
    /// Aggregate a diagnostic and fail [`generate`](CodeGenerator::generate).
    #[default]
    Error,
    /// Emit a `cargo:warning` and omit the containing type — and,
    /// transitively, every type referencing it — from the output.
    SkipContainingType,
}

/// An enum variant for [`CodeGenerator::add_enum`].
#[derive(Debug, Clone)]
pub enum EnumVariant {
    /// A unit variant: `Name` — emitted as `Name: null`.
    Unit(String),
    /// A newtype (1-tuple) variant: `Name(T)` — emitted as a bare codec.
    Newtype(String, CodecExpr),
    /// An n-tuple variant (n >= 2): `Name(T0, T1)` — emitted as an array
    /// of codecs (`[t0, t1]`), decoded as an array value. The fields stay
    /// flattened in the enum layout (this is NOT a nested `r.tuple` block).
    Tuple(String, Vec<CodecExpr>),
    /// A struct variant: `Name { a: T }` — emitted as a record of codecs.
    Struct(String, Vec<(String, CodecExpr)>),
}

impl EnumVariant {
    /// The variant name.
    pub fn name(&self) -> &str {
        match self {
            EnumVariant::Unit(name)
            | EnumVariant::Newtype(name, _)
            | EnumVariant::Tuple(name, _)
            | EnumVariant::Struct(name, _) => name,
        }
    }
}

/// The kind-specific payload of a generated type.
#[derive(Debug, Clone)]
pub(crate) enum TypeKind {
    Struct(Vec<(String, CodecExpr)>),
    Enum(Vec<EnumVariant>),
    Alias(CodecExpr),
}

/// The non-default wire format configured via
/// [`set_format`](CodeGenerator::set_format).
#[derive(Debug, Clone)]
struct FormatSpec {
    endian: String,
    pointer_width: u32,
    aligned: bool,
}

impl FormatSpec {
    fn is_default(&self) -> bool {
        self.endian == "little" && self.pointer_width == 32 && self.aligned
    }

    /// The non-default keys as `r.format(...)` options.
    fn options(&self) -> String {
        let mut entries = Vec::new();
        if self.endian != "little" {
            entries.push(format!("endian: '{}'", self.endian));
        }
        if self.pointer_width != 32 {
            entries.push(format!("pointerWidth: {}", self.pointer_width));
        }
        if !self.aligned {
            entries.push("aligned: false".to_string());
        }
        entries.join(", ")
    }
}

/// Collects type definitions — from Rust sources or programmatically — and
/// generates TypeScript codec bindings for the `rkyv-js` runtime.
///
/// # Example
///
/// ```
/// use rkyv_js_codegen::{CodeGenerator, codec};
///
/// let mut generator = CodeGenerator::new();
/// generator.add_struct("Point", [("x", codec::f64()), ("y", codec::f64())]);
/// let code = generator.generate().unwrap();
/// assert!(code.contains("export const ArchivedPoint = r.struct({"));
/// assert!(code.contains("export type Point = r.Infer<typeof ArchivedPoint>;"));
/// ```
#[derive(Debug)]
pub struct CodeGenerator {
    /// Successfully added types, keyed by Rust type name.
    pub(crate) types: BTreeMap<String, TypeKind>,
    /// Types whose extraction produced diagnostics, keyed by Rust type name.
    pub(crate) failed: BTreeMap<String, Vec<Diagnostic>>,
    /// Diagnostics recorded at add time (duplicate type names).
    pub(crate) add_diagnostics: Vec<Diagnostic>,
    /// `set_archived_name` overrides, applied at generate time.
    overrides: BTreeMap<String, String>,
    header: Option<String>,
    allow_typescript_syntax: bool,
    pub(crate) on_unknown: OnUnknown,
    /// Derive paths that mark a type for extraction.
    pub(crate) marker_paths: BTreeSet<String>,
    pub(crate) registry: Registry,
    format: Option<FormatSpec>,
    direction: Direction,
}

/// Which half of the codec surface the generated bindings target.
///
/// The emitted factory calls and type exports are identical in all three
/// modes — only the `rkyv-js` import specifiers change, so a decode-only
/// bundle never pulls the writer/hasher machinery (and vice versa).
#[derive(Clone, Copy, PartialEq, Eq, Debug, Default)]
pub enum Direction {
    /// Full codecs (`rkyv-js`): encode + decode + access.
    #[default]
    Full,
    /// Decoder-only bindings (`rkyv-js/decode`, `rkyv-js/lib/*/decode`).
    Decode,
    /// Encoder-only bindings (`rkyv-js/encode`, `rkyv-js/lib/*/encode`).
    Encode,
}

impl Direction {
    fn suffix(self) -> Option<&'static str> {
        match self {
            Direction::Full => None,
            Direction::Decode => Some("/decode"),
            Direction::Encode => Some("/encode"),
        }
    }

    /// Rewrite an emitted import block's `rkyv-js` specifiers for this
    /// direction. Non-`rkyv-js` specifiers (user `register_external`
    /// modules) are left untouched — hand-written codecs must provide their
    /// own direction-appropriate exports.
    pub(crate) fn rewrite_import_block(self, block: &str) -> String {
        let Some(suffix) = self.suffix() else {
            return block.to_string();
        };
        let mut out = String::with_capacity(block.len() + 64);
        for line in block.lines() {
            if let Some(spec_start) = line.rfind(" from '").map(|i| i + " from '".len())
                && let Some(len) = line[spec_start..].find('\'')
            {
                let spec = &line[spec_start..spec_start + len];
                if spec == "rkyv-js" || spec.starts_with("rkyv-js/lib/") {
                    out.push_str(&line[..spec_start + len]);
                    out.push_str(suffix);
                    out.push_str(&line[spec_start + len..]);
                    out.push('\n');
                    continue;
                }
            }
            out.push_str(line);
            out.push('\n');
        }
        out
    }
}

impl Default for CodeGenerator {
    fn default() -> Self {
        Self::new()
    }
}

impl CodeGenerator {
    /// Create a generator with the built-in type and wrapper registrations.
    pub fn new() -> Self {
        Self {
            types: BTreeMap::new(),
            failed: BTreeMap::new(),
            add_diagnostics: Vec::new(),
            overrides: BTreeMap::new(),
            header: None,
            allow_typescript_syntax: true,
            on_unknown: OnUnknown::Error,
            marker_paths: BTreeSet::from(["rkyv::Archive".to_string()]),
            registry: Registry::with_builtins(),
            format: None,
            direction: Direction::Full,
        }
    }

    /// Replace the header comment of the generated file.
    pub fn set_header(&mut self, header: impl Into<String>) -> &mut Self {
        self.header = Some(header.into());
        self
    }

    /// Emit unidirectional bindings: [`Direction::Decode`] rewrites every
    /// `rkyv-js` import specifier to its `/decode` counterpart
    /// (`rkyv-js/lib/X` becomes `rkyv-js/lib/X/decode`), [`Direction::Encode`]
    /// symmetrically. Factory names and type exports are unchanged; imports
    /// of user modules registered via `register_external` are not rewritten.
    pub fn set_direction(&mut self, direction: Direction) -> &mut Self {
        self.direction = direction;
        self
    }

    /// When `false`, `export type ... = r.Infer<...>` lines are dropped so
    /// the output is valid plain JavaScript. Defaults to `true`.
    pub fn allow_typescript_syntax(&mut self, enabled: bool) -> &mut Self {
        self.allow_typescript_syntax = enabled;
        self
    }

    /// Configure how unmappable field types are handled. Defaults to
    /// [`OnUnknown::Error`].
    pub fn on_unknown_type(&mut self, mode: OnUnknown) -> &mut Self {
        self.on_unknown = mode;
        self
    }

    /// Register an additional derive path that marks types for extraction,
    /// alongside the default `rkyv::Archive`.
    pub fn add_marker_path(&mut self, path: impl Into<String>) -> &mut Self {
        self.marker_paths.insert(path.into());
        self
    }

    /// Register (or replace) an external type mapping for a fully-qualified
    /// Rust path.
    ///
    /// ```
    /// use rkyv_js_codegen::{CodeGenerator, CodecExpr, ExternalType};
    ///
    /// let mut generator = CodeGenerator::new();
    /// generator.register_external(
    ///     "my_crate::MyVec",
    ///     ExternalType::generic1(|t| {
    ///         CodecExpr::call(CodecExpr::import_from("my-pkg/codecs", "myVec"), [t])
    ///     }),
    /// );
    /// ```
    pub fn register_external(
        &mut self,
        path: impl Into<String>,
        external: ExternalType,
    ) -> &mut Self {
        self.registry.register_type(path, external);
        self
    }

    /// Register (or replace) a `#[rkyv(with = ...)]` wrapper handler.
    pub fn register_with(&mut self, path: impl Into<String>, wrapper: WithWrapper) -> &mut Self {
        self.registry.register_wrapper(path, wrapper);
        self
    }

    /// Remove an external type mapping (e.g. to disable a builtin).
    pub fn unregister_external(&mut self, path: &str) -> &mut Self {
        self.registry.unregister_type(path);
        self
    }

    /// Add a struct definition.
    pub fn add_struct(
        &mut self,
        name: impl Into<String>,
        fields: impl IntoIterator<Item = (impl Into<String>, CodecExpr)>,
    ) -> &mut Self {
        let fields = fields
            .into_iter()
            .map(|(field, expr)| (field.into(), expr))
            .collect();
        self.add_type(name.into(), TypeKind::Struct(fields), None);
        self
    }

    /// Add an enum definition.
    pub fn add_enum(
        &mut self,
        name: impl Into<String>,
        variants: impl IntoIterator<Item = EnumVariant>,
    ) -> &mut Self {
        let variants = variants.into_iter().collect();
        self.add_type(name.into(), TypeKind::Enum(variants), None);
        self
    }

    /// Add a type alias: `export const Archived{name} = <expr>;`.
    pub fn add_alias(&mut self, name: impl Into<String>, target: CodecExpr) -> &mut Self {
        self.add_type(name.into(), TypeKind::Alias(target), None);
        self
    }

    /// Record a type entry, diagnosing duplicate names.
    pub(crate) fn add_type(
        &mut self,
        name: String,
        kind: TypeKind,
        location: Option<SourceLocation>,
    ) {
        if self.is_known_type(&name) {
            self.add_diagnostics.push(
                Diagnostic::new(DiagnosticKind::DuplicateType { name }).at(location),
            );
            return;
        }
        self.types.insert(name, kind);
    }

    /// Record a type whose extraction produced diagnostics.
    pub(crate) fn add_failed_type(
        &mut self,
        name: String,
        diagnostics: Vec<Diagnostic>,
        location: Option<SourceLocation>,
    ) {
        if self.is_known_type(&name) {
            self.add_diagnostics.push(
                Diagnostic::new(DiagnosticKind::DuplicateType { name }).at(location),
            );
            return;
        }
        self.failed.insert(name, diagnostics);
    }

    fn is_known_type(&self, name: &str) -> bool {
        self.types.contains_key(name) || self.failed.contains_key(name)
    }

    /// Override the archived (exported) name of a type, corresponding to
    /// `#[rkyv(archived = Name)]`.
    ///
    /// Order-independent: the target type may be added before or after this
    /// call. A target that never materializes is reported as
    /// [`DiagnosticKind::UnknownRenameTarget`] at generate time.
    pub fn set_archived_name(
        &mut self,
        type_name: impl Into<String>,
        archived_name: impl Into<String>,
    ) -> &mut Self {
        self.overrides.insert(type_name.into(), archived_name.into());
        self
    }

    /// The archived (exported) name a type will be emitted under, or `None`
    /// if no type with that name has been added.
    pub fn archived_name_of(&self, type_name: &str) -> Option<String> {
        if !self.is_known_type(type_name) {
            return None;
        }
        Some(self.resolved_archived_name(type_name))
    }

    fn resolved_archived_name(&self, type_name: &str) -> String {
        self.overrides
            .get(type_name)
            .cloned()
            .unwrap_or_else(|| format!("Archived{type_name}"))
    }

    /// Configure the rkyv wire format of the generated bindings.
    ///
    /// When the format differs from the default (`little`/32/aligned), the
    /// output declares `const FORMAT = r.format({ ... })` with the
    /// non-default keys and wraps every exported codec in
    /// `r.withFormat(<expr>, FORMAT)`.
    pub fn set_format(&mut self, endian: &str, pointer_width: u32, aligned: bool) -> &mut Self {
        self.format = Some(FormatSpec {
            endian: endian.to_string(),
            pointer_width,
            aligned,
        });
        self
    }

    /// The active non-default format, if any.
    fn nondefault_format(&self) -> Option<&FormatSpec> {
        self.format.as_ref().filter(|spec| !spec.is_default())
    }

    /// Every codec expression of a type, labelled with its `Type.field`
    /// provenance for diagnostics.
    fn exprs_with_context<'a>(
        type_name: &str,
        kind: &'a TypeKind,
    ) -> Vec<(String, &'a CodecExpr)> {
        match kind {
            TypeKind::Struct(fields) => fields
                .iter()
                .map(|(field, expr)| (format!("{type_name}.{field}"), expr))
                .collect(),
            TypeKind::Enum(variants) => {
                let mut out = Vec::new();
                for variant in variants {
                    match variant {
                        EnumVariant::Unit(_) => {}
                        EnumVariant::Newtype(vname, expr) => {
                            out.push((format!("{type_name}::{vname}"), expr));
                        }
                        EnumVariant::Tuple(vname, exprs) => {
                            for (i, expr) in exprs.iter().enumerate() {
                                out.push((format!("{type_name}::{vname}.{i}"), expr));
                            }
                        }
                        EnumVariant::Struct(vname, fields) => {
                            for (field, expr) in fields {
                                out.push((format!("{type_name}::{vname}.{field}"), expr));
                            }
                        }
                    }
                }
                out
            }
            TypeKind::Alias(expr) => vec![(type_name.to_string(), expr)],
        }
    }

    /// Generate the TypeScript bindings.
    ///
    /// Validation runs first; every problem is aggregated into a single
    /// [`Error::Codegen`].
    pub fn generate(&self) -> Result<String, Error> {
        let mut diagnostics: Vec<Diagnostic> = self.add_diagnostics.clone();

        // Rename overrides must target a type that materialized.
        for target in self.overrides.keys() {
            if !self.is_known_type(target) {
                diagnostics.push(Diagnostic::new(DiagnosticKind::UnknownRenameTarget {
                    type_name: target.clone(),
                }));
            }
        }

        // Extraction failures: hard errors, or skipped with a warning.
        let mut skipped: BTreeSet<String> = BTreeSet::new();
        match self.on_unknown {
            OnUnknown::Error => {
                for failure_diagnostics in self.failed.values() {
                    diagnostics.extend(failure_diagnostics.iter().cloned());
                }
            }
            OnUnknown::SkipContainingType => {
                for (name, failure_diagnostics) in &self.failed {
                    skipped.insert(name.clone());
                    for diagnostic in failure_diagnostics {
                        eprintln!(
                            "cargo:warning=rkyv-js-codegen: skipping `{name}`: {diagnostic}"
                        );
                    }
                }
            }
        }

        // Validate type references.
        match self.on_unknown {
            OnUnknown::Error => {
                for (name, kind) in &self.types {
                    for (context, expr) in Self::exprs_with_context(name, kind) {
                        let mut refs = BTreeSet::new();
                        expr.collect_type_refs(&mut refs);
                        for reference in refs {
                            if !self.is_known_type(&reference) {
                                diagnostics.push(
                                    Diagnostic::new(DiagnosticKind::UnresolvedTypeRef {
                                        name: reference,
                                    })
                                    .referenced_by(context.clone()),
                                );
                            }
                        }
                    }
                }
            }
            OnUnknown::SkipContainingType => {
                // Transitively omit types referencing skipped or missing types.
                loop {
                    let mut newly_skipped = Vec::new();
                    for (name, kind) in &self.types {
                        if skipped.contains(name) {
                            continue;
                        }
                        let broken = Self::exprs_with_context(name, kind).iter().any(
                            |(_, expr)| {
                                let mut refs = BTreeSet::new();
                                expr.collect_type_refs(&mut refs);
                                refs.iter().any(|reference| {
                                    skipped.contains(reference)
                                        || !self.types.contains_key(reference)
                                })
                            },
                        );
                        if broken {
                            newly_skipped.push(name.clone());
                        }
                    }
                    if newly_skipped.is_empty() {
                        break;
                    }
                    for name in newly_skipped {
                        eprintln!(
                            "cargo:warning=rkyv-js-codegen: skipping `{name}`: it references \
                             a type that was omitted or never added"
                        );
                        skipped.insert(name);
                    }
                }
            }
        }

        // The set of types actually emitted, in stable order.
        let emitted: BTreeMap<&String, &TypeKind> = self
            .types
            .iter()
            .filter(|(name, _)| !skipped.contains(*name))
            .collect();

        // Import conflicts across everything emitted.
        let all_exprs: Vec<&CodecExpr> = emitted
            .iter()
            .flat_map(|(name, kind)| Self::exprs_with_context(name, kind))
            .map(|(_, expr)| expr)
            .collect();
        let import_block = match generate_import_block(all_exprs.iter().copied()) {
            Ok(block) => self.direction.rewrite_import_block(&block),
            Err(conflicts) => {
                diagnostics.extend(conflicts.into_iter().map(Diagnostic::new));
                String::new()
            }
        };

        if !diagnostics.is_empty() {
            return Err(Error::Codegen(diagnostics));
        }

        // Topological sort (Kahn's) so dependencies emit before dependents;
        // ties resolve in BTreeMap (name) order.
        let order = Self::topological_sort(&emitted);

        let archived_names: BTreeMap<String, String> = emitted
            .keys()
            .map(|name| ((*name).clone(), self.resolved_archived_name(name)))
            .collect();

        // Assemble the output.
        let mut blocks: Vec<String> = Vec::new();

        let header = self
            .header
            .as_deref()
            .unwrap_or("Auto-generated by rkyv-js-codegen\nDO NOT EDIT MANUALLY");
        let mut header_block = String::from("/**\n");
        for line in header.lines() {
            if line.is_empty() {
                header_block.push_str(" *\n");
            } else {
                header_block.push_str(" * ");
                header_block.push_str(line);
                header_block.push('\n');
            }
        }
        header_block.push_str(" */");
        blocks.push(header_block);

        blocks.push(import_block.trim_end().to_string());

        if let Some(spec) = self.nondefault_format() {
            blocks.push(format!("const FORMAT = r.format({{ {} }});", spec.options()));
        }

        for name in &order {
            let kind = emitted.get(name).expect("ordered names come from emitted");
            blocks.push(self.emit_type(name, kind, &archived_names));
        }

        Ok(blocks.join("\n\n") + "\n")
    }

    fn topological_sort(emitted: &BTreeMap<&String, &TypeKind>) -> Vec<String> {
        let mut deps: BTreeMap<&str, BTreeSet<String>> = BTreeMap::new();
        for (name, kind) in emitted {
            let mut refs = BTreeSet::new();
            for (_, expr) in Self::exprs_with_context(name, kind) {
                expr.collect_type_refs(&mut refs);
            }
            refs.retain(|reference| {
                emitted.contains_key(reference) && reference != name.as_str()
            });
            deps.insert(name.as_str(), refs);
        }

        let mut dependents: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
        let mut in_degree: BTreeMap<&str, usize> = BTreeMap::new();
        for (name, type_deps) in &deps {
            in_degree.insert(name, type_deps.len());
            for dep in type_deps {
                dependents.entry(dep.as_str()).or_default().push(name);
            }
        }

        let mut ready: BTreeSet<&str> = in_degree
            .iter()
            .filter(|(_, degree)| **degree == 0)
            .map(|(name, _)| *name)
            .collect();
        let mut order: Vec<String> = Vec::new();
        let mut done: BTreeSet<&str> = BTreeSet::new();

        while let Some(name) = ready.pop_first() {
            order.push(name.to_string());
            done.insert(name);
            if let Some(children) = dependents.get(name) {
                for child in children {
                    let degree = in_degree.get_mut(child).unwrap();
                    *degree -= 1;
                    if *degree == 0 {
                        ready.insert(child);
                    }
                }
            }
        }

        // Cycles (only possible through user-provided Raw/TypeRef loops):
        // append the remaining names in stable order.
        for name in deps.keys() {
            if !done.contains(name) {
                order.push((*name).to_string());
            }
        }

        order
    }

    fn emit_type(
        &self,
        name: &str,
        kind: &TypeKind,
        archived_names: &BTreeMap<String, String>,
    ) -> String {
        let archived = archived_names
            .get(name)
            .expect("emitted types have archived names")
            .clone();
        let render = |expr: &CodecExpr| -> String {
            expr.render(archived_names)
                .expect("type references are validated before emission")
        };

        let codec_expr = match kind {
            TypeKind::Struct(fields) => {
                if fields.is_empty() {
                    "r.struct({})".to_string()
                } else {
                    let mut body = String::from("r.struct({\n");
                    for (field, expr) in fields {
                        body.push_str(&format!("  {}: {},\n", field, render(expr)));
                    }
                    body.push_str("})");
                    body
                }
            }
            TypeKind::Enum(variants) => {
                if variants.is_empty() {
                    "r.taggedEnum({})".to_string()
                } else {
                    let mut body = String::from("r.taggedEnum({\n");
                    for variant in variants {
                        let value = match variant {
                            EnumVariant::Unit(_) => "null".to_string(),
                            EnumVariant::Newtype(_, expr) => render(expr),
                            EnumVariant::Tuple(_, exprs) => {
                                render(&CodecExpr::array(exprs.iter().cloned()))
                            }
                            EnumVariant::Struct(_, fields) => {
                                let record = CodecExpr::object(fields.iter().cloned());
                                render(&record)
                            }
                        };
                        body.push_str(&format!("  {}: {},\n", variant.name(), value));
                    }
                    body.push_str("})");
                    body
                }
            }
            TypeKind::Alias(expr) => render(expr),
        };

        let codec_expr = match self.nondefault_format() {
            Some(_) => format!("r.withFormat({codec_expr}, FORMAT)"),
            None => codec_expr,
        };

        let mut block = format!("export const {archived} = {codec_expr};");
        if self.allow_typescript_syntax {
            block.push_str(&format!(
                "\n\nexport type {name} = r.Infer<typeof {archived}>;"
            ));
        }
        block
    }

    /// Generate the bindings and write them to `path`.
    pub fn write_to_file(&self, path: impl AsRef<Path>) -> Result<(), Error> {
        let code = self.generate()?;
        fs::write(path, code)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::expr::codec;

    fn diagnostics(error: Error) -> Vec<Diagnostic> {
        match error {
            Error::Codegen(diagnostics) => diagnostics,
            other => panic!("expected Error::Codegen, got {other:?}"),
        }
    }

    #[test]
    fn struct_emission_snapshot() {
        let mut generator = CodeGenerator::new();
        generator.add_struct("Point", [("x", codec::f64()), ("y", codec::f64())]);
        let code = generator.generate().unwrap();
        assert_eq!(
            code,
            "/**\n\
             \x20* Auto-generated by rkyv-js-codegen\n\
             \x20* DO NOT EDIT MANUALLY\n\
             \x20*/\n\
             \n\
             import * as r from 'rkyv-js';\n\
             \n\
             export const ArchivedPoint = r.struct({\n\
             \x20 x: r.f64,\n\
             \x20 y: r.f64,\n\
             });\n\
             \n\
             export type Point = r.Infer<typeof ArchivedPoint>;\n"
        );
    }

    #[test]
    fn enum_emission_snapshot() {
        let mut generator = CodeGenerator::new();
        generator.add_enum(
            "MixedAlign",
            [
                EnumVariant::Struct(
                    "V".to_string(),
                    vec![("a".to_string(), codec::u8()), ("b".to_string(), codec::u32())],
                ),
                EnumVariant::Newtype("X".to_string(), codec::u64()),
                EnumVariant::Tuple("Color".to_string(), vec![codec::u8(), codec::u8()]),
                EnumVariant::Unit("Y".to_string()),
            ],
        );
        let code = generator.generate().unwrap();
        assert!(code.contains(
            "export const ArchivedMixedAlign = r.taggedEnum({\n\
             \x20 V: { a: r.u8, b: r.u32 },\n\
             \x20 X: r.u64,\n\
             \x20 Color: [r.u8, r.u8],\n\
             \x20 Y: null,\n\
             });"
        ));
        assert!(code.contains("export type MixedAlign = r.Infer<typeof ArchivedMixedAlign>;"));
    }

    #[test]
    fn alias_emission_snapshot() {
        let mut generator = CodeGenerator::new();
        generator.add_alias("UserId", codec::u32());
        let code = generator.generate().unwrap();
        assert!(code.contains("export const ArchivedUserId = r.u32;"));
        assert!(code.contains("export type UserId = r.Infer<typeof ArchivedUserId>;"));
    }

    #[test]
    fn imports_are_collected_and_deduped() {
        let mut generator = CodeGenerator::new();
        generator.add_struct(
            "A",
            [
                (
                    "m",
                    CodecExpr::call(
                        CodecExpr::import_from("rkyv-js/lib/hashmap", "hashMap"),
                        [codec::string(), codec::u32()],
                    ),
                ),
                (
                    "s",
                    CodecExpr::call(
                        CodecExpr::import_from("rkyv-js/lib/hashmap", "hashSet"),
                        [codec::string()],
                    ),
                ),
            ],
        );
        generator.add_struct(
            "B",
            [(
                "s2",
                CodecExpr::call(
                    CodecExpr::import_from("rkyv-js/lib/hashmap", "hashSet"),
                    [codec::u32()],
                ),
            )],
        );
        let code = generator.generate().unwrap();
        assert!(code.contains("import { hashMap, hashSet } from 'rkyv-js/lib/hashmap';"));
        assert_eq!(code.matches("hashSet }").count(), 1);
    }

    #[test]
    fn import_conflict_is_reported() {
        let mut generator = CodeGenerator::new();
        generator.add_struct("A", [("x", CodecExpr::import_from("pkg-a", "codec"))]);
        generator.add_struct("B", [("y", CodecExpr::import_from("pkg-b", "codec"))]);
        let errors = diagnostics(generator.generate().unwrap_err());
        assert!(errors.iter().any(|diagnostic| matches!(
            &diagnostic.kind,
            DiagnosticKind::ImportConflict { export, .. } if export == "codec"
        )));
    }

    #[test]
    fn topo_sort_handles_forward_references() {
        let mut generator = CodeGenerator::new();
        // "AOuter" sorts before "Inner" alphabetically, but references it.
        generator.add_struct("AOuter", [("inner", codec::named("Inner"))]);
        generator.add_struct("Inner", [("value", codec::u32())]);
        let code = generator.generate().unwrap();
        let inner_pos = code.find("export const ArchivedInner").unwrap();
        let outer_pos = code.find("export const ArchivedAOuter").unwrap();
        assert!(inner_pos < outer_pos, "dependency must be emitted first");
        assert!(code.contains("inner: ArchivedInner,"));
    }

    #[test]
    fn unresolved_type_ref_reports_referrer() {
        let mut generator = CodeGenerator::new();
        generator.add_struct("Outer", [("inner", codec::named("Missing"))]);
        let errors = diagnostics(generator.generate().unwrap_err());
        assert_eq!(errors.len(), 1);
        assert!(matches!(
            &errors[0].kind,
            DiagnosticKind::UnresolvedTypeRef { name } if name == "Missing"
        ));
        assert_eq!(errors[0].referenced_by.as_deref(), Some("Outer.inner"));
    }

    #[test]
    fn duplicate_type_is_reported_at_generate() {
        let mut generator = CodeGenerator::new();
        generator.add_struct("Point", [("x", codec::f64())]);
        generator.add_struct("Point", [("y", codec::f64())]);
        let errors = diagnostics(generator.generate().unwrap_err());
        assert!(errors.iter().any(|diagnostic| matches!(
            &diagnostic.kind,
            DiagnosticKind::DuplicateType { name } if name == "Point"
        )));
    }

    #[test]
    fn set_archived_name_is_order_independent() {
        // Before add.
        let mut generator = CodeGenerator::new();
        generator.set_archived_name("Foo", "MyFoo");
        generator.add_struct("Foo", [("x", codec::u32())]);
        let code = generator.generate().unwrap();
        assert!(code.contains("export const MyFoo = r.struct({"));
        assert!(code.contains("export type Foo = r.Infer<typeof MyFoo>;"));
        assert!(!code.contains("ArchivedFoo"));

        // After add.
        let mut generator = CodeGenerator::new();
        generator.add_struct("Foo", [("x", codec::u32())]);
        generator.set_archived_name("Foo", "MyFoo");
        let code = generator.generate().unwrap();
        assert!(code.contains("export const MyFoo = r.struct({"));
    }

    #[test]
    fn archived_rename_applies_to_cross_references() {
        let mut generator = CodeGenerator::new();
        generator.set_archived_name("Inner", "CustomInner");
        generator.add_struct("Inner", [("value", codec::u32())]);
        generator.add_struct("Outer", [("inner", codec::named("Inner"))]);
        let code = generator.generate().unwrap();
        assert!(code.contains("export const CustomInner = r.struct({"));
        assert!(code.contains("inner: CustomInner,"));
        assert!(!code.contains("ArchivedInner"));
    }

    #[test]
    fn unknown_rename_target_is_a_diagnostic() {
        let mut generator = CodeGenerator::new();
        generator.add_struct("Foo", [("x", codec::u32())]);
        generator.set_archived_name("Nope", "MyNope");
        let errors = diagnostics(generator.generate().unwrap_err());
        assert!(errors.iter().any(|diagnostic| matches!(
            &diagnostic.kind,
            DiagnosticKind::UnknownRenameTarget { type_name } if type_name == "Nope"
        )));
    }

    #[test]
    fn archived_name_of_accessor() {
        let mut generator = CodeGenerator::new();
        generator.add_struct("Foo", [("x", codec::u32())]);
        assert_eq!(generator.archived_name_of("Foo").as_deref(), Some("ArchivedFoo"));
        generator.set_archived_name("Foo", "MyFoo");
        assert_eq!(generator.archived_name_of("Foo").as_deref(), Some("MyFoo"));
        assert_eq!(generator.archived_name_of("Bar"), None);
    }

    #[test]
    fn js_mode_omits_type_lines() {
        let mut generator = CodeGenerator::new();
        generator.allow_typescript_syntax(false);
        generator.add_struct("Point", [("x", codec::f64())]);
        generator.add_alias("UserId", codec::u32());
        let code = generator.generate().unwrap();
        assert!(code.contains("export const ArchivedPoint = r.struct({"));
        assert!(code.contains("export const ArchivedUserId = r.u32;"));
        assert!(!code.contains("export type"));
        assert!(!code.contains("r.Infer"));
    }

    #[test]
    fn set_format_default_is_a_no_op() {
        let mut generator = CodeGenerator::new();
        generator.set_format("little", 32, true);
        generator.add_struct("Point", [("x", codec::f64())]);
        let code = generator.generate().unwrap();
        assert!(!code.contains("FORMAT"));
        assert!(!code.contains("withFormat"));
    }

    #[test]
    fn set_format_nondefault_wraps_exports() {
        let mut generator = CodeGenerator::new();
        generator.set_format("big", 64, false);
        generator.add_struct("Point", [("x", codec::f64())]);
        generator.add_alias("UserId", codec::u32());
        let code = generator.generate().unwrap();
        assert!(code.contains(
            "const FORMAT = r.format({ endian: 'big', pointerWidth: 64, aligned: false });"
        ));
        assert!(code.contains("export const ArchivedPoint = r.withFormat(r.struct({\n"));
        assert!(code.contains("}), FORMAT);"));
        assert!(code.contains("export const ArchivedUserId = r.withFormat(r.u32, FORMAT);"));
    }

    #[test]
    fn set_format_emits_only_nondefault_keys() {
        let mut generator = CodeGenerator::new();
        generator.set_format("little", 16, true);
        generator.add_struct("Point", [("x", codec::f64())]);
        let code = generator.generate().unwrap();
        assert!(code.contains("const FORMAT = r.format({ pointerWidth: 16 });"));
    }

    #[test]
    fn custom_header_replaces_default() {
        let mut generator = CodeGenerator::new();
        generator.set_header("Custom header\nsecond line");
        generator.add_struct("Point", [("x", codec::f64())]);
        let code = generator.generate().unwrap();
        assert!(code.starts_with("/**\n * Custom header\n * second line\n */\n"));
        assert!(!code.contains("Auto-generated by rkyv-js-codegen"));
    }

    #[test]
    fn set_direction_full_is_a_no_op() {
        let mut generator = CodeGenerator::new();
        generator.set_direction(Direction::Full);
        generator.add_struct("Point", [("x", codec::f64())]);
        let code = generator.generate().unwrap();
        assert!(code.contains("import * as r from 'rkyv-js';"));
    }

    #[test]
    fn set_direction_rewrites_rkyv_specifiers_only() {
        let mut generator = CodeGenerator::new();
        generator.set_direction(Direction::Decode);
        generator.add_struct(
            "Event",
            [
                ("id", codec::u32()),
                (
                    "tags",
                    CodecExpr::call(
                        CodecExpr::import_from("rkyv-js/lib/hashmap", "hashSet"),
                        [codec::string()],
                    ),
                ),
                (
                    "custom",
                    CodecExpr::import_from("./my-codec.ts", "MyCodec"),
                ),
            ],
        );
        let code = generator.generate().unwrap();
        assert!(code.contains("import * as r from 'rkyv-js/decode';"));
        assert!(code.contains("import { hashSet } from 'rkyv-js/lib/hashmap/decode';"));
        // User modules keep their exact specifier.
        assert!(code.contains("import { MyCodec } from './my-codec.ts';"));
        // Emitted factory calls and type exports are direction-independent.
        assert!(code.contains("export const ArchivedEvent = r.struct({"));
        assert!(code.contains("export type Event = r.Infer<typeof ArchivedEvent>;"));
    }

    #[test]
    fn set_direction_encode_uses_encode_suffix() {
        let mut generator = CodeGenerator::new();
        generator.set_direction(Direction::Encode);
        generator.add_struct("Point", [("x", codec::f64())]);
        let code = generator.generate().unwrap();
        assert!(code.contains("import * as r from 'rkyv-js/encode';"));
    }
}
