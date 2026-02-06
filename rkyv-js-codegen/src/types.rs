//! Type definitions for the code generator.

use std::collections::{BTreeMap, HashMap, HashSet};

/// Represents an import statement for a codec.
///
/// This is used for both built-in and user-defined external module imports.
///
/// # Example
///
/// ```
/// use rkyv_js_codegen::Import;
///
/// // Built-in import
/// let uuid_import = Import::new("rkyv-js/lib/uuid", "uuid");
///
/// // Custom import
/// let custom_import = Import::new("my-package/codecs", "myCodec");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Import {
    /// The module path to import from (e.g., `"rkyv-js/lib/uuid"`, `"my-package/codecs"`).
    pub module_path: String,
    /// The export name to import (e.g., `"uuid"`, `"indexMap"`).
    pub export_name: String,
}

impl Import {
    /// Create a new import.
    pub fn new(module_path: impl Into<String>, export_name: impl Into<String>) -> Self {
        Self {
            module_path: module_path.into(),
            export_name: export_name.into(),
        }
    }
}

/// A unified type definition for code generation.
///
/// Every type — primitives, containers, named references, and external crate
/// types — is represented as the same struct. Pre-defined types are available
/// as associated functions that mirror the TypeScript codec API.
///
/// # Template syntax
///
/// The `codec_expr` and `ts_type` fields use `{0}`, `{1}`, etc. as placeholders
/// for type parameters. These are substituted with the resolved expressions of
/// the corresponding `type_params` entries.
///
/// # Pre-defined types
///
/// ```
/// use rkyv_js_codegen::TypeDef;
///
/// // Primitives
/// let _ = TypeDef::u32();
/// let _ = TypeDef::string();
/// let _ = TypeDef::bool();
///
/// // Containers
/// let _ = TypeDef::vec(TypeDef::u32());
/// let _ = TypeDef::option(TypeDef::string());
/// let _ = TypeDef::array(TypeDef::u8(), 4);
/// let _ = TypeDef::tuple(vec![TypeDef::u32(), TypeDef::string()]);
///
/// // Named references
/// let _ = TypeDef::named("Point");
///
/// // Custom external types
/// let _ = TypeDef::new("uuid", "string")
///     .with_import("rkyv-js/lib/uuid", "uuid");
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeDef {
    /// Template for the TypeScript codec expression.
    ///
    /// Use `{0}`, `{1}`, etc. for type parameter placeholders.
    pub codec_expr: String,

    /// Template for the TypeScript type annotation.
    ///
    /// Use `{0}`, `{1}`, etc. for type parameter placeholders.
    pub ts_type: String,

    /// The import required for this type's codec, if any.
    pub import: Option<Import>,

    /// Resolved inner type parameters.
    ///
    /// Empty for leaf types (primitives, named refs). Populated for
    /// container/parametric types.
    pub type_params: Vec<TypeDef>,

    /// Whether this type is a named reference to another type in the same codegen scope.
    ///
    /// Only `true` for types created via [`TypeDef::named`]. Used by
    /// [`collect_named_deps`](TypeDef::collect_named_deps) for dependency ordering.
    is_named_ref: bool,
}

impl TypeDef {
    /// Create a new type definition with the given codec expression and TypeScript type templates.
    ///
    /// # Example
    ///
    /// ```
    /// use rkyv_js_codegen::TypeDef;
    ///
    /// let uuid = TypeDef::new("uuid", "string")
    ///     .with_import("rkyv-js/lib/uuid", "uuid");
    /// assert_eq!(uuid.to_codec_expr(), "uuid");
    /// assert_eq!(uuid.to_ts_type(), "string");
    /// ```
    pub fn new(codec_expr: impl Into<String>, ts_type: impl Into<String>) -> Self {
        Self {
            codec_expr: codec_expr.into(),
            ts_type: ts_type.into(),
            import: None,
            type_params: vec![],
            is_named_ref: false,
        }
    }

    /// Set the import for this type definition. Returns self for chaining.
    pub fn with_import(
        mut self,
        module_path: impl Into<String>,
        export_name: impl Into<String>,
    ) -> Self {
        self.import = Some(Import::new(module_path, export_name));
        self
    }

    /// Create a resolved copy of this type definition with the given type parameters.
    ///
    /// This is used by the registry/extractor to produce a concrete `TypeDef`
    /// from a template.
    pub fn resolve(&self, type_params: Vec<TypeDef>) -> Self {
        Self {
            codec_expr: self.codec_expr.clone(),
            ts_type: self.ts_type.clone(),
            import: self.import.clone(),
            type_params,
            is_named_ref: self.is_named_ref,
        }
    }

    // ── Primitives ──────────────────────────────────────────────────

    pub fn u8() -> Self {
        Self::new("r.u8", "number")
    }
    pub fn i8() -> Self {
        Self::new("r.i8", "number")
    }
    pub fn u16() -> Self {
        Self::new("r.u16", "number")
    }
    pub fn i16() -> Self {
        Self::new("r.i16", "number")
    }
    pub fn u32() -> Self {
        Self::new("r.u32", "number")
    }
    pub fn i32() -> Self {
        Self::new("r.i32", "number")
    }
    pub fn u64() -> Self {
        Self::new("r.u64", "bigint")
    }
    pub fn i64() -> Self {
        Self::new("r.i64", "bigint")
    }
    pub fn f32() -> Self {
        Self::new("r.f32", "number")
    }
    pub fn f64() -> Self {
        Self::new("r.f64", "number")
    }
    pub fn bool() -> Self {
        Self::new("r.bool", "boolean")
    }
    pub fn char() -> Self {
        Self::new("r.char", "string")
    }
    pub fn unit() -> Self {
        Self::new("r.unit", "null")
    }
    pub fn string() -> Self {
        Self::new("r.string", "string")
    }

    // ── Containers ──────────────────────────────────────────────────

    pub fn vec(inner: TypeDef) -> Self {
        Self {
            codec_expr: "r.vec({0})".to_string(),
            ts_type: "{0}[]".to_string(),
            import: None,
            type_params: vec![inner],
            is_named_ref: false,
        }
    }

    pub fn option(inner: TypeDef) -> Self {
        Self {
            codec_expr: "r.option({0})".to_string(),
            ts_type: "{0} | null".to_string(),
            import: None,
            type_params: vec![inner],
            is_named_ref: false,
        }
    }

    pub fn boxed(inner: TypeDef) -> Self {
        Self {
            codec_expr: "r.box({0})".to_string(),
            ts_type: "{0}".to_string(),
            import: None,
            type_params: vec![inner],
            is_named_ref: false,
        }
    }

    pub fn array(inner: TypeDef, len: usize) -> Self {
        Self {
            codec_expr: format!("r.array({{0}}, {})", len),
            ts_type: "{0}[]".to_string(),
            import: None,
            type_params: vec![inner],
            is_named_ref: false,
        }
    }

    pub fn tuple(elements: Vec<TypeDef>) -> Self {
        // Build codec template: r.tuple({0}, {1}, ...)
        let placeholders: Vec<String> = (0..elements.len()).map(|i| format!("{{{}}}", i)).collect();
        Self {
            codec_expr: format!("r.tuple({})", placeholders.join(", ")),
            ts_type: format!("[{}]", placeholders.join(", ")),
            import: None,
            type_params: elements,
            is_named_ref: false,
        }
    }

    // ── Named reference ─────────────────────────────────────────────

    /// Reference to a named type (struct or enum defined in the same codegen scope).
    ///
    /// The `codec_expr` stores the raw type name (e.g., `"Point"`). The
    /// generator resolves this to the actual archived name at code generation
    /// time (default `"ArchivedPoint"`, or a custom name from
    /// `#[rkyv(archived = ...)]`).
    pub fn named(name: impl Into<String>) -> Self {
        let name = name.into();
        let mut td = Self::new(name.clone(), name);
        td.is_named_ref = true;
        td
    }

    // ── Template introspection ─────────────────────────────────────

    /// Return the number of type parameters this template expects.
    ///
    /// Computed from the highest placeholder index in `codec_expr` and `ts_type`.
    /// For example, `"hashMap({0}, {1})"` has arity 2, `"uuid"` has arity 0.
    pub fn arity(&self) -> usize {
        fn max_placeholder(template: &str) -> Option<usize> {
            let mut max_idx: Option<usize> = None;
            let mut chars = template.chars().peekable();
            while let Some(c) = chars.next() {
                if c == '{' {
                    let mut num = String::new();
                    for d in chars.by_ref() {
                        if d == '}' {
                            break;
                        }
                        num.push(d);
                    }
                    if let Ok(idx) = num.parse::<usize>() {
                        max_idx = Some(max_idx.map_or(idx, |m: usize| m.max(idx)));
                    }
                }
            }
            max_idx
        }

        let codec_max = max_placeholder(&self.codec_expr);
        let ts_max = max_placeholder(&self.ts_type);
        let max_idx = match (codec_max, ts_max) {
            (Some(a), Some(b)) => Some(a.max(b)),
            (a, b) => a.or(b),
        };
        max_idx.map_or(0, |m| m + 1)
    }

    // ── Code generation ─────────────────────────────────────────────

    /// Generate the TypeScript codec expression with substituted type parameters.
    ///
    /// For named references, this uses the default `Archived{Name}` convention.
    /// Use [`resolve_codec_expr`](TypeDef::resolve_codec_expr) to resolve with
    /// custom archived names from `#[rkyv(archived = ...)]`.
    pub fn to_codec_expr(&self) -> String {
        self.resolve_codec_expr(&HashMap::new())
    }

    /// Generate the TypeScript codec expression, resolving named references
    /// against the given archived name map.
    ///
    /// The map keys are type names (e.g., `"Foo"`), values are custom archived
    /// names (e.g., `"MyArchivedFoo"`). Types not in the map use the default
    /// `Archived{Name}` convention.
    pub fn resolve_codec_expr(&self, archived_names: &HashMap<String, String>) -> String {
        if self.is_named_ref {
            // codec_expr stores the raw type name for named refs
            return archived_names
                .get(&self.codec_expr)
                .cloned()
                .unwrap_or_else(|| format!("Archived{}", self.codec_expr));
        }
        let mut result = self.codec_expr.clone();
        for (i, param) in self.type_params.iter().enumerate() {
            let placeholder = format!("{{{}}}", i);
            result = result.replace(&placeholder, &param.resolve_codec_expr(archived_names));
        }
        result
    }

    /// Generate the TypeScript type with substituted type parameters.
    pub fn to_ts_type(&self) -> String {
        let mut result = self.ts_type.clone();
        for (i, param) in self.type_params.iter().enumerate() {
            let placeholder = format!("{{{}}}", i);
            result = result.replace(&placeholder, &param.to_ts_type());
        }
        result
    }

    /// Collect all imports required by this type (recursively).
    pub fn collect_imports(&self, imports: &mut HashSet<Import>) {
        if let Some(import) = &self.import {
            imports.insert(import.clone());
        }
        for param in &self.type_params {
            param.collect_imports(imports);
        }
    }

    /// Collect all named type references (for dependency ordering).
    pub fn collect_named_deps(&self, deps: &mut HashSet<String>) {
        if self.is_named_ref {
            deps.insert(self.ts_type.clone());
        }
        for param in &self.type_params {
            param.collect_named_deps(deps);
        }
    }
}

/// Represents an enum variant for code generation.
#[derive(Debug, Clone)]
pub enum EnumVariant {
    /// Unit variant: `Variant`
    Unit(String),

    /// Tuple variant: `Variant(T1, T2, ...)`
    Tuple(String, Vec<TypeDef>),

    /// Struct variant: `Variant { field1: T1, field2: T2, ... }`
    Struct(String, Vec<(String, TypeDef)>),
}

impl EnumVariant {
    pub fn name(&self) -> &str {
        match self {
            EnumVariant::Unit(name) => name,
            EnumVariant::Tuple(name, _) => name,
            EnumVariant::Struct(name, _) => name,
        }
    }
}

/// Represents a union variant for code generation.
///
/// Unlike enum variants, union variants don't have discriminants -
/// all variants occupy the same memory location.
#[derive(Debug, Clone)]
pub struct UnionVariant {
    /// The name used to access this variant
    pub name: String,
    /// The type of this variant
    pub ty: TypeDef,
}

impl UnionVariant {
    pub fn new(name: impl Into<String>, ty: TypeDef) -> Self {
        Self {
            name: name.into(),
            ty,
        }
    }
}

/// Generate import statements for the given set of imports.
///
/// Imports are grouped by module path, and multiple exports from the same module
/// are combined into a single import statement.
///
/// # Example
///
/// ```
/// use std::collections::HashSet;
/// use rkyv_js_codegen::Import;
///
/// let mut imports = HashSet::new();
/// imports.insert(Import::new("rkyv-js/lib/indexmap", "indexMap"));
/// imports.insert(Import::new("rkyv-js/lib/indexmap", "indexSet"));
///
/// let result = rkyv_js_codegen::generate_imports(&imports);
/// assert_eq!(result, "import { indexMap, indexSet } from 'rkyv-js/lib/indexmap';\n");
/// ```
pub fn generate_imports(imports: &HashSet<Import>) -> String {
    // Group imports by module path
    let mut by_module: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for import in imports {
        by_module
            .entry(&import.module_path)
            .or_default()
            .push(&import.export_name);
    }

    // Generate import statements
    let mut output = String::new();
    for (module_path, mut exports) in by_module {
        exports.sort();
        exports.dedup();
        let exports_str = exports.join(", ");
        output.push_str(&format!(
            "import {{ {} }} from '{}';\n",
            exports_str, module_path
        ));
    }

    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_primitive_codec_expr() {
        assert_eq!(TypeDef::u32().to_codec_expr(), "r.u32");
        assert_eq!(TypeDef::string().to_codec_expr(), "r.string");
        assert_eq!(TypeDef::bool().to_codec_expr(), "r.bool");
    }

    #[test]
    fn test_container_codec_expr() {
        assert_eq!(TypeDef::vec(TypeDef::u32()).to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(
            TypeDef::option(TypeDef::string()).to_codec_expr(),
            "r.option(r.string)"
        );
    }

    #[test]
    fn test_nested_codec_expr() {
        let nested = TypeDef::vec(TypeDef::option(TypeDef::u32()));
        assert_eq!(nested.to_codec_expr(), "r.vec(r.option(r.u32))");
    }

    #[test]
    fn test_ts_types() {
        assert_eq!(TypeDef::u32().to_ts_type(), "number");
        assert_eq!(TypeDef::u64().to_ts_type(), "bigint");
        assert_eq!(TypeDef::string().to_ts_type(), "string");
        assert_eq!(TypeDef::vec(TypeDef::u32()).to_ts_type(), "number[]");
    }

    #[test]
    fn test_named_type() {
        let named = TypeDef::named("Point");
        assert_eq!(named.to_codec_expr(), "ArchivedPoint");
        assert_eq!(named.to_ts_type(), "Point");
    }

    #[test]
    fn test_array_codec_expr() {
        let arr = TypeDef::array(TypeDef::u8(), 4);
        assert_eq!(arr.to_codec_expr(), "r.array(r.u8, 4)");
    }

    #[test]
    fn test_tuple_codec_expr() {
        let t = TypeDef::tuple(vec![TypeDef::u32(), TypeDef::string()]);
        assert_eq!(t.to_codec_expr(), "r.tuple(r.u32, r.string)");
        assert_eq!(t.to_ts_type(), "[number, string]");
    }

    #[test]
    fn test_custom_type_with_import() {
        let uuid = TypeDef::new("uuid", "string").with_import("rkyv-js/lib/uuid", "uuid");
        assert_eq!(uuid.to_codec_expr(), "uuid");
        assert_eq!(uuid.to_ts_type(), "string");

        let mut imports = HashSet::new();
        uuid.collect_imports(&mut imports);
        assert!(imports.contains(&Import::new("rkyv-js/lib/uuid", "uuid")));
    }

    #[test]
    fn test_parametric_external_type() {
        let hash_map = TypeDef::new("hashMap({0}, {1})", "Map<{0}, {1}>")
            .with_import("rkyv-js/lib/std-hash-map", "hashMap");
        let resolved = hash_map.resolve(vec![TypeDef::string(), TypeDef::u32()]);
        assert_eq!(resolved.to_codec_expr(), "hashMap(r.string, r.u32)");
        assert_eq!(resolved.to_ts_type(), "Map<string, number>");
    }

    #[test]
    fn test_vec_like_external() {
        let thin_vec = TypeDef::new("r.vec({0})", "{0}[]").resolve(vec![TypeDef::u32()]);
        assert_eq!(thin_vec.to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(thin_vec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_arc_external() {
        let arc = TypeDef::new("r.arc({0})", "{0}").resolve(vec![TypeDef::named("Config")]);
        assert_eq!(arc.to_codec_expr(), "r.arc(ArchivedConfig)");
        assert_eq!(arc.to_ts_type(), "Config");
    }

    #[test]
    fn test_weak_external() {
        let rc_weak = TypeDef::new("r.rcWeak({0})", "{0} | null").resolve(vec![TypeDef::u32()]);
        assert_eq!(rc_weak.to_codec_expr(), "r.rcWeak(r.u32)");
        assert_eq!(rc_weak.to_ts_type(), "number | null");
    }

    #[test]
    fn test_collect_named_deps() {
        let td = TypeDef::vec(TypeDef::named("Point"));
        let mut deps = HashSet::new();
        td.collect_named_deps(&mut deps);
        assert!(deps.contains("Point"));
    }

    #[test]
    fn test_generate_imports_single_export() {
        let mut imports = HashSet::new();
        imports.insert(Import::new("rkyv-js/lib/uuid", "uuid"));
        let result = generate_imports(&imports);
        assert_eq!(result, "import { uuid } from 'rkyv-js/lib/uuid';\n");
    }

    #[test]
    fn test_generate_imports_multiple_exports_same_module() {
        let mut imports = HashSet::new();
        imports.insert(Import::new("rkyv-js/lib/indexmap", "indexMap"));
        imports.insert(Import::new("rkyv-js/lib/indexmap", "indexSet"));
        let result = generate_imports(&imports);
        assert_eq!(
            result,
            "import { indexMap, indexSet } from 'rkyv-js/lib/indexmap';\n"
        );
    }

    #[test]
    fn test_generate_imports_multiple_modules() {
        let mut imports = HashSet::new();
        imports.insert(Import::new("rkyv-js/lib/uuid", "uuid"));
        imports.insert(Import::new("rkyv-js/lib/bytes", "bytes"));
        imports.insert(Import::new("rkyv-js/lib/indexmap", "indexMap"));
        let result = generate_imports(&imports);
        assert!(result.contains("import { bytes } from 'rkyv-js/lib/bytes';"));
        assert!(result.contains("import { indexMap } from 'rkyv-js/lib/indexmap';"));
        assert!(result.contains("import { uuid } from 'rkyv-js/lib/uuid';"));
    }

    #[test]
    fn test_generate_imports_custom_module() {
        let mut imports = HashSet::new();
        imports.insert(Import::new("my-package/custom", "foo"));
        imports.insert(Import::new("my-package/custom", "bar"));
        let result = generate_imports(&imports);
        assert_eq!(result, "import { bar, foo } from 'my-package/custom';\n");
    }
}
