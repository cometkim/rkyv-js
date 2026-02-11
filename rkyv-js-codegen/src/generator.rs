//! TypeScript code generator for rkyv types.

use crate::registry::TypeRegistry;
use crate::types::{generate_imports, EnumVariant, Import, TypeDef, UnionVariant};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::path::Path;

/// The kind-specific data for a type definition.
#[derive(Debug, Clone)]
pub(crate) enum TypeKind {
    Struct(Vec<(String, TypeDef)>),
    Enum(Vec<EnumVariant>),
    Union(Vec<UnionVariant>),
    Alias(TypeDef),
}

/// A named type definition with optional archived name override.
#[derive(Debug, Clone)]
pub(crate) struct TypeEntry {
    /// The original type name (e.g., `"Foo"`).
    pub name: String,
    /// Custom archived name from `#[rkyv(archived = Name)]`.
    /// When `None`, the default `Archived{name}` convention is used.
    pub archived_name: Option<String>,
    /// The kind-specific data.
    pub kind: TypeKind,
}

impl TypeEntry {
    fn new(name: String, kind: TypeKind) -> Self {
        Self {
            name,
            archived_name: None,
            kind,
        }
    }

    /// Return the archived name, using the custom name or the default convention.
    fn archived_name(&self) -> String {
        self.archived_name
            .clone()
            .unwrap_or_else(|| format!("Archived{}", self.name))
    }
}

/// Code generator that collects type definitions and outputs TypeScript code.
///
/// # Type registry
///
/// The generator includes a [`TypeRegistry`] that maps Rust type names to
/// TypeScript codec definitions. Built-in mappings for all rkyv-supported
/// external crates are registered by default. You can customize the registry
/// via [`register_type`](CodeGenerator::register_type) and
/// [`unregister_type`](CodeGenerator::unregister_type).
///
/// # Example
///
/// ```
/// # fn main() {
/// use rkyv_js_codegen::{CodeGenerator, TypeDef};
///
/// let mut generator = CodeGenerator::new();
///
/// // Register a custom external type
/// generator.register_type("MyVec",
///     TypeDef::new("myVec({0})", "{0}[]")
///         .with_import("my-pkg/codecs", "myVec"),
/// );
///
/// // Add types and generate
/// generator.add_struct("Config", &[
///     ("name", TypeDef::string()),
/// ]);
/// let code = generator.generate();
/// # }
/// ```
#[derive(Debug)]
pub struct CodeGenerator {
    /// All type definitions, keyed by type name.
    types: BTreeMap<String, TypeEntry>,

    /// Custom header comment
    header: Option<String>,

    /// Whether to emit TypeScript-specific syntax (`export type`, `export interface`).
    ///
    /// When `true` (default), the output includes type aliases and interface
    /// declarations that require a `.ts` file extension.  When `false`, only
    /// plain JavaScript (`export const`) is emitted, making the output
    /// compatible with `.js` / `.mjs` files.
    allow_typescript_syntax: bool,

    /// Type registry for resolving external types
    pub(crate) registry: TypeRegistry,
}

impl Default for CodeGenerator {
    fn default() -> Self {
        Self {
            types: BTreeMap::new(),
            header: None,
            allow_typescript_syntax: true,
            registry: TypeRegistry::with_builtins(),
        }
    }
}

impl CodeGenerator {
    /// Create a new code generator with built-in type mappings.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set a custom header comment for the generated file.
    pub fn set_header(&mut self, header: impl Into<String>) -> &mut Self {
        self.header = Some(header.into());
        self
    }

    /// Enable or disable TypeScript-specific syntax in the generated output.
    ///
    /// When `true` (the default), the output includes `export type` aliases
    /// and `export interface` declarations.  When `false`, only plain
    /// JavaScript (`export const`) is emitted, making the output compatible
    /// with `.js` / `.mjs` files.
    pub fn allow_typescript_syntax(&mut self, enabled: bool) -> &mut Self {
        self.allow_typescript_syntax = enabled;
        self
    }

    /// Register a custom type in the type registry.
    ///
    /// This allows the code generator to handle custom external types when
    /// parsing Rust source files. The `TypeDef` acts as a template — its
    /// `generics` field describes how to parse type parameters from source,
    /// and `resolve()` is called to fill in `type_params`.
    ///
    /// # Example
    ///
    /// ```
    /// # fn main() {
    /// use rkyv_js_codegen::{CodeGenerator, TypeDef};
    ///
    /// let mut generator = CodeGenerator::new();
    /// generator.register_type("CustomMap",
    ///     TypeDef::new("customMap({0}, {1})", "Map<{0}, {1}>")
    ///         .with_import("my-package/codecs", "customMap"),
    /// );
    /// # }
    /// ```
    pub fn register_type(&mut self, name: impl Into<String>, typedef: TypeDef) -> &mut Self {
        self.registry.register(name, typedef);
        self
    }

    /// Remove a type mapping from the registry.
    ///
    /// This can be used to disable a built-in mapping.
    pub fn unregister_type(&mut self, name: &str) -> &mut Self {
        self.registry.unregister(name);
        self
    }

    /// Get a reference to the type registry.
    pub fn registry(&self) -> &TypeRegistry {
        &self.registry
    }

    /// Set a custom archived name for a type.
    ///
    /// This corresponds to the Rust `#[rkyv(archived = Name)]` attribute.
    /// By default, the archived name is `Archived{TypeName}`. This method
    /// overrides that default.
    ///
    /// The type must already be added via [`add_struct`], [`add_enum`], etc.
    /// If the type doesn't exist yet, the override is silently ignored.
    ///
    /// # Example
    ///
    /// ```
    /// use rkyv_js_codegen::{CodeGenerator, TypeDef};
    ///
    /// let mut codegen = CodeGenerator::new();
    /// codegen.add_struct("Foo", &[("x", TypeDef::u32())]);
    /// codegen.set_archived_name("Foo", "MyArchivedFoo");
    /// let code = codegen.generate();
    /// assert!(code.contains("export const MyArchivedFoo"));
    /// ```
    pub fn set_archived_name(
        &mut self,
        type_name: impl AsRef<str>,
        archived_name: impl Into<String>,
    ) -> &mut Self {
        if let Some(entry) = self.types.get_mut(type_name.as_ref()) {
            entry.archived_name = Some(archived_name.into());
        }
        self
    }

    /// Add a struct definition.
    ///
    /// # Example
    ///
    /// ```
    /// use rkyv_js_codegen::{CodeGenerator, TypeDef};
    ///
    /// let mut generator = CodeGenerator::new();
    /// generator.add_struct("Point", &[
    ///     ("x", TypeDef::f64()),
    ///     ("y", TypeDef::f64()),
    /// ]);
    /// ```
    pub fn add_struct(
        &mut self,
        name: impl Into<String>,
        fields: &[(impl AsRef<str>, TypeDef)],
    ) -> &mut Self {
        let name = name.into();
        let fields: Vec<_> = fields
            .iter()
            .map(|(n, t)| (n.as_ref().to_string(), t.clone()))
            .collect();
        self.types
            .insert(name.clone(), TypeEntry::new(name, TypeKind::Struct(fields)));
        self
    }

    /// Add an enum definition.
    ///
    /// # Example
    ///
    /// ```
    /// use rkyv_js_codegen::{CodeGenerator, TypeDef, EnumVariant};
    ///
    /// let mut generator = CodeGenerator::new();
    /// generator.add_enum("Status", &[
    ///     EnumVariant::Unit("Pending".to_string()),
    ///     EnumVariant::Unit("Active".to_string()),
    ///     EnumVariant::Struct("Error".to_string(), vec![
    ///         ("message".to_string(), TypeDef::string()),
    ///     ]),
    /// ]);
    /// ```
    pub fn add_enum(&mut self, name: impl Into<String>, variants: &[EnumVariant]) -> &mut Self {
        let name = name.into();
        self.types.insert(
            name.clone(),
            TypeEntry::new(name, TypeKind::Enum(variants.to_vec())),
        );
        self
    }

    /// Add a type alias (newtype pattern).
    pub fn add_alias(&mut self, name: impl Into<String>, target: TypeDef) -> &mut Self {
        let name = name.into();
        self.types
            .insert(name.clone(), TypeEntry::new(name, TypeKind::Alias(target)));
        self
    }

    /// Add a union definition.
    ///
    /// Unions are untagged - all variants occupy the same memory location.
    /// This is used for Rust `#[repr(C)]` unions.
    ///
    /// # Example
    ///
    /// ```
    /// use rkyv_js_codegen::{CodeGenerator, TypeDef, UnionVariant};
    ///
    /// let mut generator = CodeGenerator::new();
    /// generator.add_union("NumberUnion", &[
    ///     UnionVariant::new("as_u32", TypeDef::u32()),
    ///     UnionVariant::new("as_f32", TypeDef::f32()),
    ///     UnionVariant::new("as_bytes", TypeDef::array(TypeDef::u8(), 4)),
    /// ]);
    /// ```
    pub fn add_union(&mut self, name: impl Into<String>, variants: &[UnionVariant]) -> &mut Self {
        let name = name.into();
        self.types.insert(
            name.clone(),
            TypeEntry::new(name, TypeKind::Union(variants.to_vec())),
        );
        self
    }

    /// Build the archived name resolution map from all type entries.
    ///
    /// This maps type name → archived name for every type in the generator,
    /// used by [`TypeDef::resolve_codec_expr`] to resolve named references.
    fn build_archived_names(&self) -> HashMap<String, String> {
        self.types
            .values()
            .map(|entry| (entry.name.clone(), entry.archived_name()))
            .collect()
    }

    /// Generate the TypeScript code as a string.
    pub fn generate(&self) -> String {
        let mut output = String::new();

        // Header
        if let Some(header) = &self.header {
            output.push_str("/**\n");
            for line in header.lines() {
                output.push_str(" * ");
                output.push_str(line);
                output.push('\n');
            }
            output.push_str(" */\n\n");
        } else {
            output.push_str("/**\n");
            output.push_str(" * Auto-generated by rkyv-js-codegen\n");
            output.push_str(" * DO NOT EDIT MANUALLY\n");
            output.push_str(" */\n\n");
        }

        let archived_names = self.build_archived_names();

        // Imports
        output.push_str(&self.generate_import_block());
        output.push_str("\n\n");

        // Get topologically sorted order for types
        let sorted_types = self.topological_sort();

        // Generate types in dependency order
        for type_name in &sorted_types {
            if let Some(entry) = self.types.get(type_name) {
                let code = match &entry.kind {
                    TypeKind::Alias(target) => self.generate_alias(entry, target, &archived_names),
                    TypeKind::Struct(fields) => {
                        self.generate_struct(entry, fields, &archived_names)
                    }
                    TypeKind::Enum(variants) => {
                        self.generate_enum(entry, variants, &archived_names)
                    }
                    TypeKind::Union(variants) => {
                        self.generate_union(entry, variants, &archived_names)
                    }
                };
                output.push_str(&code);
                output.push_str("\n\n");
            }
        }

        output.trim_end().to_string() + "\n"
    }

    /// Perform topological sort to order types by dependencies.
    fn topological_sort(&self) -> Vec<String> {
        let mut deps: HashMap<String, HashSet<String>> = HashMap::new();
        let all_types: HashSet<String> = self.types.keys().cloned().collect();

        for (name, entry) in &self.types {
            let type_deps = deps.entry(name.clone()).or_default();
            match &entry.kind {
                TypeKind::Struct(fields) => {
                    for (_, ty) in fields {
                        ty.collect_named_deps(type_deps);
                    }
                }
                TypeKind::Enum(variants) => {
                    for variant in variants {
                        match variant {
                            EnumVariant::Unit(_) => {}
                            EnumVariant::Tuple(_, types) => {
                                for ty in types {
                                    ty.collect_named_deps(type_deps);
                                }
                            }
                            EnumVariant::Struct(_, fields) => {
                                for (_, ty) in fields {
                                    ty.collect_named_deps(type_deps);
                                }
                            }
                        }
                    }
                }
                TypeKind::Union(variants) => {
                    for variant in variants {
                        variant.ty.collect_named_deps(type_deps);
                    }
                }
                TypeKind::Alias(ty) => {
                    ty.collect_named_deps(type_deps);
                }
            }
            type_deps.retain(|d| all_types.contains(d));
        }

        // Kahn's algorithm for topological sort
        let mut in_degree: HashMap<String, usize> = HashMap::new();
        for name in &all_types {
            in_degree.insert(name.clone(), 0);
        }
        for type_deps in deps.values() {
            for dep in type_deps {
                *in_degree.get_mut(dep).unwrap() += 1;
            }
        }

        let mut result = Vec::new();
        let mut queue: Vec<String> = all_types
            .iter()
            .filter(|n| deps.get(*n).map(|d| d.is_empty()).unwrap_or(true))
            .cloned()
            .collect();
        queue.sort();

        let mut visited = HashSet::new();
        while let Some(name) = queue.pop() {
            if visited.contains(&name) {
                continue;
            }
            visited.insert(name.clone());
            result.push(name.clone());

            for (other, other_deps) in &deps {
                if other_deps.contains(&name) && !visited.contains(other) {
                    let all_deps_met = other_deps.iter().all(|d| visited.contains(d));
                    if all_deps_met {
                        queue.push(other.clone());
                    }
                }
            }
            queue.sort();
            queue.reverse();
        }

        for name in &all_types {
            if !visited.contains(name) {
                result.push(name.clone());
            }
        }

        result
    }

    /// Write the generated code to a file.
    pub fn write_to_file(&self, path: impl AsRef<Path>) -> io::Result<()> {
        let code = self.generate();
        fs::write(path, code)
    }

    /// Write the generated code to a writer.
    pub fn write_to<W: Write>(&self, mut writer: W) -> io::Result<()> {
        let code = self.generate();
        writer.write_all(code.as_bytes())
    }

    fn generate_import_block(&self) -> String {
        let mut lib_imports: HashSet<Import> = HashSet::new();

        for entry in self.types.values() {
            match &entry.kind {
                TypeKind::Struct(fields) => {
                    for (_, ty) in fields {
                        ty.collect_imports(&mut lib_imports);
                    }
                }
                TypeKind::Enum(variants) => {
                    for variant in variants {
                        match variant {
                            EnumVariant::Unit(_) => {}
                            EnumVariant::Tuple(_, types) => {
                                for ty in types {
                                    ty.collect_imports(&mut lib_imports);
                                }
                            }
                            EnumVariant::Struct(_, fields) => {
                                for (_, ty) in fields {
                                    ty.collect_imports(&mut lib_imports);
                                }
                            }
                        }
                    }
                }
                TypeKind::Union(variants) => {
                    for variant in variants {
                        variant.ty.collect_imports(&mut lib_imports);
                    }
                }
                TypeKind::Alias(ty) => {
                    ty.collect_imports(&mut lib_imports);
                }
            }
        }

        let mut output = String::new();
        output.push_str("import * as r from 'rkyv-js';\n");
        output.push_str(&generate_imports(&lib_imports));
        output.trim_end().to_string()
    }

    fn generate_alias(
        &self,
        entry: &TypeEntry,
        target: &TypeDef,
        archived_names: &HashMap<String, String>,
    ) -> String {
        let name = &entry.name;
        let archived = entry.archived_name();
        let mut output = format!("// Type alias: {name}\n");
        if self.allow_typescript_syntax {
            output.push_str(&format!("export type {name} = {};\n", target.to_ts_type()));
        }
        output.push_str(&format!(
            "export const {archived} = {};",
            target.resolve_codec_expr(archived_names)
        ));
        output
    }

    fn generate_struct(
        &self,
        entry: &TypeEntry,
        fields: &[(String, TypeDef)],
        archived_names: &HashMap<String, String>,
    ) -> String {
        let name = &entry.name;
        let archived = entry.archived_name();
        let mut output = String::new();
        output.push_str(&format!("export const {} = r.struct({{\n", archived));
        for (field_name, field_type) in fields {
            output.push_str(&format!(
                "  {}: {},\n",
                field_name,
                field_type.resolve_codec_expr(archived_names)
            ));
        }
        output.push_str("});");
        if self.allow_typescript_syntax {
            output.push_str(&format!(
                "\n\nexport type {} = r.Infer<typeof {}>;",
                name, archived
            ));
        }
        output
    }

    fn generate_enum(
        &self,
        entry: &TypeEntry,
        variants: &[EnumVariant],
        archived_names: &HashMap<String, String>,
    ) -> String {
        let name = &entry.name;
        let archived = entry.archived_name();
        let mut output = String::new();
        output.push_str(&format!("export const {} = r.taggedEnum({{\n", archived));
        for variant in variants {
            match variant {
                EnumVariant::Unit(vname) => {
                    output.push_str(&format!("  {}: r.unit,\n", vname));
                }
                EnumVariant::Tuple(vname, types) => {
                    let fields: Vec<_> = types
                        .iter()
                        .enumerate()
                        .map(|(i, t)| format!("_{}: {}", i, t.resolve_codec_expr(archived_names)))
                        .collect();
                    output.push_str(&format!(
                        "  {}: r.struct({{ {} }}),\n",
                        vname,
                        fields.join(", ")
                    ));
                }
                EnumVariant::Struct(vname, fields) => {
                    let field_defs: Vec<_> = fields
                        .iter()
                        .map(|(n, t)| format!("{}: {}", n, t.resolve_codec_expr(archived_names)))
                        .collect();
                    output.push_str(&format!(
                        "  {}: r.struct({{ {} }}),\n",
                        vname,
                        field_defs.join(", ")
                    ));
                }
            }
        }
        output.push_str("});");
        if self.allow_typescript_syntax {
            output.push_str(&format!(
                "\n\nexport type {} = r.Infer<typeof {}>;",
                name, archived
            ));
        }
        output
    }

    fn generate_union(
        &self,
        entry: &TypeEntry,
        variants: &[UnionVariant],
        archived_names: &HashMap<String, String>,
    ) -> String {
        let name = &entry.name;
        let archived = entry.archived_name();
        let mut output = String::new();
        if self.allow_typescript_syntax {
            output.push_str(&format!("export interface {}Variants {{\n", name));
            for variant in variants {
                output.push_str(&format!(
                    "  {}: {};\n",
                    variant.name,
                    variant.ty.to_ts_type()
                ));
            }
            output.push_str("}\n\n");
        }
        output.push_str(&format!(
            "// Union codec for {}\n// Note: You need to provide a discriminate function based on your data format\n",
            name
        ));
        output.push_str(&format!(
            "export const {} = r.union(\n  // discriminate: (reader, offset) => keyof {}Variants\n  (reader, offset) => {{ throw new Error('Discriminate function not implemented for {}'); }},\n  {{\n",
            archived, name, name
        ));
        for variant in variants {
            output.push_str(&format!(
                "    {}: {},\n",
                variant.name,
                variant.ty.resolve_codec_expr(archived_names)
            ));
        }
        output.push_str("  }\n);");
        if self.allow_typescript_syntax {
            output.push_str(&format!(
                "\n\nexport type {} = r.Infer<typeof {}>;",
                name, archived
            ));
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_simple_struct() {
        let mut codegen = CodeGenerator::new();
        codegen.add_struct("Point", &[("x", TypeDef::f64()), ("y", TypeDef::f64())]);

        let code = codegen.generate();
        assert!(code.contains("import * as r from 'rkyv-js';\n"));
        assert!(code.contains("export const ArchivedPoint = r.struct({"));
        assert!(code.contains("x: r.f64"));
        assert!(code.contains("y: r.f64"));
        assert!(code.contains("export type Point = r.Infer<typeof ArchivedPoint>;"));
    }

    #[test]
    fn test_generate_enum() {
        let mut codegen = CodeGenerator::new();
        codegen.add_enum(
            "Status",
            &[
                EnumVariant::Unit("Pending".to_string()),
                EnumVariant::Unit("Active".to_string()),
            ],
        );

        let code = codegen.generate();
        assert!(code.contains("export const ArchivedStatus = r.taggedEnum({"));
        assert!(code.contains("Pending: r.unit"));
        assert!(code.contains("Active: r.unit"));
        assert!(code.contains("export type Status = r.Infer<typeof ArchivedStatus>;"));
    }

    #[test]
    fn test_generate_nested_types() {
        let mut codegen = CodeGenerator::new();
        codegen.add_struct(
            "Person",
            &[
                ("name", TypeDef::string()),
                ("age", TypeDef::u32()),
                ("scores", TypeDef::vec(TypeDef::u32())),
                ("email", TypeDef::option(TypeDef::string())),
            ],
        );

        let code = codegen.generate();
        assert!(code.contains("name: r.string"));
        assert!(code.contains("age: r.u32"));
        assert!(code.contains("scores: r.vec(r.u32)"));
        assert!(code.contains("email: r.option(r.string)"));
    }

    #[test]
    fn test_generate_union() {
        let mut codegen = CodeGenerator::new();
        codegen.add_union(
            "NumberUnion",
            &[
                UnionVariant::new("asU32", TypeDef::u32()),
                UnionVariant::new("asF32", TypeDef::f32()),
                UnionVariant::new("asBytes", TypeDef::array(TypeDef::u8(), 4)),
            ],
        );

        let code = codegen.generate();
        assert!(code.contains("export interface NumberUnionVariants"));
        assert!(code.contains("asU32: number"));
        assert!(code.contains("asF32: number"));
        assert!(code.contains("asBytes: number[]"));
        assert!(code.contains("export const ArchivedNumberUnion = r.union("));
        assert!(code.contains("asU32: r.u32"));
    }

    #[test]
    fn test_generate_enum_with_data() {
        let mut codegen = CodeGenerator::new();
        codegen.add_enum(
            "Message",
            &[
                EnumVariant::Unit("Quit".to_string()),
                EnumVariant::Struct(
                    "Move".to_string(),
                    vec![
                        ("x".to_string(), TypeDef::i32()),
                        ("y".to_string(), TypeDef::i32()),
                    ],
                ),
                EnumVariant::Tuple("Write".to_string(), vec![TypeDef::string()]),
            ],
        );

        let code = codegen.generate();
        assert!(code.contains("Quit: r.unit"));
        assert!(code.contains("Move: r.struct({ x: r.i32, y: r.i32 })"));
        assert!(code.contains("Write: r.struct({ _0: r.string })"));
    }

    // ── Archived name override tests ──────────────────────────────────

    #[test]
    fn test_set_archived_name_struct() {
        let mut codegen = CodeGenerator::new();
        codegen.add_struct("Foo", &[("x", TypeDef::u32())]);
        codegen.set_archived_name("Foo", "MyFoo");
        let code = codegen.generate();
        assert!(code.contains("export const MyFoo = r.struct({"));
        assert!(code.contains("export type Foo = r.Infer<typeof MyFoo>;"));
        assert!(!code.contains("ArchivedFoo"));
    }

    #[test]
    fn test_set_archived_name_enum() {
        let mut codegen = CodeGenerator::new();
        codegen.add_enum("Status", &[EnumVariant::Unit("Active".to_string())]);
        codegen.set_archived_name("Status", "MyStatus");
        let code = codegen.generate();
        assert!(code.contains("export const MyStatus = r.taggedEnum({"));
        assert!(code.contains("export type Status = r.Infer<typeof MyStatus>;"));
        assert!(!code.contains("ArchivedStatus"));
    }

    #[test]
    fn test_archived_name_cross_reference() {
        let mut codegen = CodeGenerator::new();
        codegen.add_struct("Inner", &[("value", TypeDef::u32())]);
        codegen.set_archived_name("Inner", "CustomInner");
        codegen.add_struct("Outer", &[("inner", TypeDef::named("Inner"))]);
        let code = codegen.generate();
        // Inner should use the custom name
        assert!(code.contains("export const CustomInner = r.struct({"));
        // Outer should reference CustomInner, not ArchivedInner
        assert!(code.contains("inner: CustomInner"));
        assert!(!code.contains("ArchivedInner"));
    }

    #[test]
    fn test_archived_name_default_when_not_set() {
        let mut codegen = CodeGenerator::new();
        codegen.add_struct("Point", &[("x", TypeDef::f64())]);
        // No set_archived_name call
        let code = codegen.generate();
        assert!(code.contains("export const ArchivedPoint = r.struct({"));
        assert!(code.contains("export type Point = r.Infer<typeof ArchivedPoint>;"));
    }

    // ── JavaScript-compatible output tests ─────────────────────────────

    #[test]
    fn test_js_mode_struct_omits_type() {
        let mut codegen = CodeGenerator::new();
        codegen.allow_typescript_syntax(false);
        codegen.add_struct("Point", &[("x", TypeDef::f64()), ("y", TypeDef::f64())]);
        let code = codegen.generate();
        assert!(code.contains("export const ArchivedPoint = r.struct({"));
        assert!(!code.contains("export type"));
        assert!(!code.contains("r.Infer"));
    }

    #[test]
    fn test_js_mode_enum_omits_type() {
        let mut codegen = CodeGenerator::new();
        codegen.allow_typescript_syntax(false);
        codegen.add_enum(
            "Status",
            &[
                EnumVariant::Unit("Pending".to_string()),
                EnumVariant::Unit("Active".to_string()),
            ],
        );
        let code = codegen.generate();
        assert!(code.contains("export const ArchivedStatus = r.taggedEnum({"));
        assert!(!code.contains("export type"));
        assert!(!code.contains("r.Infer"));
    }

    #[test]
    fn test_js_mode_union_omits_interface_and_type() {
        let mut codegen = CodeGenerator::new();
        codegen.allow_typescript_syntax(false);
        codegen.add_union(
            "NumberUnion",
            &[
                UnionVariant::new("asU32", TypeDef::u32()),
                UnionVariant::new("asF32", TypeDef::f32()),
            ],
        );
        let code = codegen.generate();
        assert!(code.contains("export const ArchivedNumberUnion = r.union("));
        assert!(!code.contains("export interface"));
        assert!(!code.contains("export type"));
        assert!(!code.contains("r.Infer"));
    }

    #[test]
    fn test_js_mode_alias_omits_type() {
        let mut codegen = CodeGenerator::new();
        codegen.allow_typescript_syntax(false);
        codegen.add_alias("UserId", TypeDef::u32());
        let code = codegen.generate();
        assert!(code.contains("export const ArchivedUserId = r.u32;"));
        assert!(!code.contains("export type"));
    }

    #[test]
    fn test_ts_mode_is_default() {
        let mut codegen = CodeGenerator::new();
        codegen.add_struct("Point", &[("x", TypeDef::f64())]);
        let code = codegen.generate();
        // Default should include TypeScript syntax
        assert!(code.contains("export type Point = r.Infer<typeof ArchivedPoint>;"));
    }
}
