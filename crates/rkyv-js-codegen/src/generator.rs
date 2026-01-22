//! TypeScript code generator for rkyv types.

use crate::types::{EnumVariant, TypeDef, UnionVariant};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::io::{self, Write};
use std::path::Path;

/// Code generator that collects type definitions and outputs TypeScript code.
#[derive(Debug)]
pub struct CodeGenerator {
    /// Struct definitions: name -> fields
    structs: BTreeMap<String, Vec<(String, TypeDef)>>,

    /// Enum definitions: name -> variants
    enums: BTreeMap<String, Vec<EnumVariant>>,

    /// Union definitions: name -> variants
    unions: BTreeMap<String, Vec<UnionVariant>>,

    /// Type aliases: alias_name -> target_type
    aliases: BTreeMap<String, TypeDef>,

    /// Custom header comment
    header: Option<String>,

    /// Marker names to look for in derive attributes (default: ["TypeScript"])
    pub(crate) markers: Vec<String>,
}

impl Default for CodeGenerator {
    fn default() -> Self {
        Self {
            structs: BTreeMap::new(),
            enums: BTreeMap::new(),
            unions: BTreeMap::new(),
            aliases: BTreeMap::new(),
            header: None,
            markers: vec!["TypeScript".to_string()],
        }
    }
}

impl CodeGenerator {
    /// Create a new code generator.
    pub fn new() -> Self {
        Self::default()
    }

    /// Set a custom header comment for the generated file.
    pub fn set_header(&mut self, header: impl Into<String>) -> &mut Self {
        self.header = Some(header.into());
        self
    }

    /// Add a marker name to look for in derive attributes.
    ///
    /// By default, the generator looks for `TypeScript` (matching any path ending
    /// with `TypeScript`, such as `TypeScript`, `rkyv_js_codegen::TypeScript`, etc.).
    ///
    /// Use this to add additional marker names if you've aliased the derive macro:
    ///
    /// ```rust,ignore
    /// // If your code uses: `use rkyv_js_codegen::TypeScript as TS;`
    /// generator.add_marker("TS");
    /// ```
    pub fn add_marker(&mut self, marker: impl Into<String>) -> &mut Self {
        self.markers.push(marker.into());
        self
    }

    /// Set the marker names to look for, replacing the defaults.
    ///
    /// ```rust,ignore
    /// // Only look for `TS`, not `TypeScript`
    /// generator.set_markers(&["TS"]);
    /// ```
    pub fn set_markers(&mut self, markers: &[impl AsRef<str>]) -> &mut Self {
        self.markers = markers.iter().map(|s| s.as_ref().to_string()).collect();
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
    ///     ("x", TypeDef::F64),
    ///     ("y", TypeDef::F64),
    /// ]);
    /// ```
    pub fn add_struct(
        &mut self,
        name: impl Into<String>,
        fields: &[(impl AsRef<str>, TypeDef)],
    ) -> &mut Self {
        let fields: Vec<_> = fields
            .iter()
            .map(|(n, t)| (n.as_ref().to_string(), t.clone()))
            .collect();
        self.structs.insert(name.into(), fields);
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
    ///         ("message".to_string(), TypeDef::String),
    ///     ]),
    /// ]);
    /// ```
    pub fn add_enum(&mut self, name: impl Into<String>, variants: &[EnumVariant]) -> &mut Self {
        self.enums.insert(name.into(), variants.to_vec());
        self
    }

    /// Add a type alias (newtype pattern).
    pub fn add_alias(&mut self, name: impl Into<String>, target: TypeDef) -> &mut Self {
        self.aliases.insert(name.into(), target);
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
    ///     UnionVariant::new("as_u32", TypeDef::U32),
    ///     UnionVariant::new("as_f32", TypeDef::F32),
    ///     UnionVariant::new("as_bytes", TypeDef::Array(Box::new(TypeDef::U8), 4)),
    /// ]);
    /// ```
    pub fn add_union(&mut self, name: impl Into<String>, variants: &[UnionVariant]) -> &mut Self {
        self.unions.insert(name.into(), variants.to_vec());
        self
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

        // Imports
        output.push_str(&self.generate_imports());
        output.push_str("\n\n");

        // Get topologically sorted order for types
        let sorted_types = self.topological_sort();

        // Generate types in dependency order
        for type_name in &sorted_types {
            if let Some(target) = self.aliases.get(type_name) {
                output.push_str(&self.generate_alias(type_name, target));
                output.push_str("\n\n");
            } else if let Some(fields) = self.structs.get(type_name) {
                output.push_str(&self.generate_struct(type_name, fields));
                output.push_str("\n\n");
            } else if let Some(variants) = self.enums.get(type_name) {
                output.push_str(&self.generate_enum(type_name, variants));
                output.push_str("\n\n");
            } else if let Some(variants) = self.unions.get(type_name) {
                output.push_str(&self.generate_union(type_name, variants));
                output.push_str("\n\n");
            }
        }

        output.trim_end().to_string() + "\n"
    }

    /// Perform topological sort to order types by dependencies.
    /// Types that are depended upon come first.
    fn topological_sort(&self) -> Vec<String> {
        // Build dependency graph
        let mut deps: HashMap<String, HashSet<String>> = HashMap::new();
        let mut all_types: HashSet<String> = HashSet::new();

        // Collect all type names
        for name in self.structs.keys() {
            all_types.insert(name.clone());
        }
        for name in self.enums.keys() {
            all_types.insert(name.clone());
        }
        for name in self.unions.keys() {
            all_types.insert(name.clone());
        }
        for name in self.aliases.keys() {
            all_types.insert(name.clone());
        }

        // Build dependencies for structs
        for (name, fields) in &self.structs {
            let type_deps = deps.entry(name.clone()).or_default();
            for (_, ty) in fields {
                Self::collect_named_deps(ty, type_deps);
            }
            // Only keep deps that are in our type set
            type_deps.retain(|d| all_types.contains(d));
        }

        // Build dependencies for enums
        for (name, variants) in &self.enums {
            let type_deps = deps.entry(name.clone()).or_default();
            for variant in variants {
                match variant {
                    EnumVariant::Unit(_) => {}
                    EnumVariant::Tuple(_, types) => {
                        for ty in types {
                            Self::collect_named_deps(ty, type_deps);
                        }
                    }
                    EnumVariant::Struct(_, fields) => {
                        for (_, ty) in fields {
                            Self::collect_named_deps(ty, type_deps);
                        }
                    }
                }
            }
            type_deps.retain(|d| all_types.contains(d));
        }

        // Build dependencies for unions
        for (name, variants) in &self.unions {
            let type_deps = deps.entry(name.clone()).or_default();
            for variant in variants {
                Self::collect_named_deps(&variant.ty, type_deps);
            }
            type_deps.retain(|d| all_types.contains(d));
        }

        // Build dependencies for aliases
        for (name, ty) in &self.aliases {
            let type_deps = deps.entry(name.clone()).or_default();
            Self::collect_named_deps(ty, type_deps);
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

        // Note: We need types with NO dependents first (leaf types)
        // So we reverse the usual topological sort logic
        let mut result = Vec::new();
        let mut queue: Vec<String> = all_types
            .iter()
            .filter(|n| deps.get(*n).map(|d| d.is_empty()).unwrap_or(true))
            .cloned()
            .collect();
        queue.sort(); // Deterministic ordering

        let mut visited = HashSet::new();
        while let Some(name) = queue.pop() {
            if visited.contains(&name) {
                continue;
            }
            visited.insert(name.clone());
            result.push(name.clone());

            // Find types that depend on this one
            for (other, other_deps) in &deps {
                if other_deps.contains(&name) && !visited.contains(other) {
                    // Check if all dependencies are satisfied
                    let all_deps_met = other_deps.iter().all(|d| visited.contains(d));
                    if all_deps_met {
                        queue.push(other.clone());
                    }
                }
            }
            queue.sort();
            queue.reverse(); // Process in reverse alphabetical for determinism
        }

        // Add any remaining types (handles cycles)
        for name in &all_types {
            if !visited.contains(name) {
                result.push(name.clone());
            }
        }

        result
    }

    fn collect_named_deps(ty: &TypeDef, deps: &mut HashSet<String>) {
        match ty {
            TypeDef::Named(name) => {
                deps.insert(name.clone());
            }
            TypeDef::Vec(inner)
            | TypeDef::Option(inner)
            | TypeDef::Box(inner)
            | TypeDef::Array(inner, _) => {
                Self::collect_named_deps(inner, deps);
            }
            TypeDef::Tuple(elements) => {
                for elem in elements {
                    Self::collect_named_deps(elem, deps);
                }
            }
            TypeDef::HashMap(k, v) | TypeDef::BTreeMap(k, v) => {
                Self::collect_named_deps(k, deps);
                Self::collect_named_deps(v, deps);
            }
            _ => {}
        }
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

    fn generate_imports(&self) -> String {
        // With the unified codec API, we only need to import `r`
        "import { r } from 'rkyv-js';".to_string()
    }

    fn generate_alias(&self, name: &str, target: &TypeDef) -> String {
        format!(
            "// Type alias: {name}\nexport type {name} = {};\nexport const {name} = {};",
            target.to_ts_type(),
            target.to_codec_expr()
        )
    }

    fn generate_struct(&self, name: &str, fields: &[(String, TypeDef)]) -> String {
        let mut output = String::new();

        // Unified codec using r.object()
        output.push_str(&format!("export const {} = r.object({{\n", name));
        for (field_name, field_type) in fields {
            output.push_str(&format!(
                "  {}: {},\n",
                field_name,
                field_type.to_codec_expr()
            ));
        }
        output.push_str("});\n\n");

        // TypeScript type inference
        output.push_str(&format!("export type {} = r.infer<typeof {}>;", name, name));

        output
    }

    fn generate_enum(&self, name: &str, variants: &[EnumVariant]) -> String {
        let mut output = String::new();

        // Unified codec using r.taggedEnum()
        output.push_str(&format!("export const {} = r.taggedEnum({{\n", name));
        for variant in variants {
            match variant {
                EnumVariant::Unit(vname) => {
                    output.push_str(&format!("  {}: r.unit,\n", vname));
                }
                EnumVariant::Tuple(vname, types) => {
                    // For tuple variants, use numbered fields in an object
                    let fields: Vec<_> = types
                        .iter()
                        .enumerate()
                        .map(|(i, t)| format!("_{}: {}", i, t.to_codec_expr()))
                        .collect();
                    output.push_str(&format!(
                        "  {}: r.object({{ {} }}),\n",
                        vname,
                        fields.join(", ")
                    ));
                }
                EnumVariant::Struct(vname, fields) => {
                    let field_defs: Vec<_> = fields
                        .iter()
                        .map(|(n, t)| format!("{}: {}", n, t.to_codec_expr()))
                        .collect();
                    output.push_str(&format!(
                        "  {}: r.object({{ {} }}),\n",
                        vname,
                        field_defs.join(", ")
                    ));
                }
            }
        }
        output.push_str("});\n\n");

        // TypeScript type inference
        output.push_str(&format!("export type {} = r.infer<typeof {}>;", name, name));

        output
    }

    fn generate_union(&self, name: &str, variants: &[UnionVariant]) -> String {
        let mut output = String::new();

        // Generate the variants interface for documentation
        output.push_str(&format!("export interface {}Variants {{\n", name));
        for variant in variants {
            output.push_str(&format!(
                "  {}: {};\n",
                variant.name,
                variant.ty.to_ts_type()
            ));
        }
        output.push_str("}\n\n");

        // Generate the union codec using r.union()
        // Note: r.union requires a discriminate function - for now we generate a placeholder
        output.push_str(&format!(
            "// Union codec for {}\n// Note: You need to provide a discriminate function based on your data format\n",
            name
        ));
        output.push_str(&format!(
            "export const {} = r.union(\n  // discriminate: (reader, offset) => keyof {}Variants\n  (reader, offset) => {{ throw new Error('Discriminate function not implemented for {}'); }},\n  {{\n",
            name, name, name
        ));
        for variant in variants {
            output.push_str(&format!(
                "    {}: {},\n",
                variant.name,
                variant.ty.to_codec_expr()
            ));
        }
        output.push_str("  }\n);\n\n");

        // TypeScript type inference
        output.push_str(&format!("export type {} = r.infer<typeof {}>;", name, name));

        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_simple_struct() {
        let mut codegen = CodeGenerator::new();
        codegen.add_struct("Point", &[("x", TypeDef::F64), ("y", TypeDef::F64)]);

        let code = codegen.generate();
        assert!(code.contains("import { r } from 'rkyv-js';"));
        assert!(code.contains("export const Point = r.object({"));
        assert!(code.contains("x: r.f64"));
        assert!(code.contains("y: r.f64"));
        assert!(code.contains("export type Point = r.infer<typeof Point>;"));
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
        assert!(code.contains("export const Status = r.taggedEnum({"));
        assert!(code.contains("Pending: r.unit"));
        assert!(code.contains("Active: r.unit"));
        assert!(code.contains("export type Status = r.infer<typeof Status>;"));
    }

    #[test]
    fn test_generate_nested_types() {
        let mut codegen = CodeGenerator::new();
        codegen.add_struct(
            "Person",
            &[
                ("name", TypeDef::String),
                ("age", TypeDef::U32),
                ("scores", TypeDef::Vec(Box::new(TypeDef::U32))),
                ("email", TypeDef::Option(Box::new(TypeDef::String))),
            ],
        );

        let code = codegen.generate();
        assert!(code.contains("name: r.string"));
        assert!(code.contains("age: r.u32"));
        assert!(code.contains("scores: r.vec(r.u32)"));
        assert!(code.contains("email: r.optional(r.string)"));
    }

    #[test]
    fn test_generate_union() {
        let mut codegen = CodeGenerator::new();
        codegen.add_union(
            "NumberUnion",
            &[
                UnionVariant::new("asU32", TypeDef::U32),
                UnionVariant::new("asF32", TypeDef::F32),
                UnionVariant::new("asBytes", TypeDef::Array(Box::new(TypeDef::U8), 4)),
            ],
        );

        let code = codegen.generate();
        assert!(code.contains("export interface NumberUnionVariants"));
        assert!(code.contains("asU32: number"));
        assert!(code.contains("asF32: number"));
        assert!(code.contains("asBytes: number[]"));
        assert!(code.contains("export const NumberUnion = r.union("));
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
                        ("x".to_string(), TypeDef::I32),
                        ("y".to_string(), TypeDef::I32),
                    ],
                ),
                EnumVariant::Tuple("Write".to_string(), vec![TypeDef::String]),
            ],
        );

        let code = codegen.generate();
        assert!(code.contains("Quit: r.unit"));
        assert!(code.contains("Move: r.object({ x: r.i32, y: r.i32 })"));
        assert!(code.contains("Write: r.object({ _0: r.string })"));
    }
}
