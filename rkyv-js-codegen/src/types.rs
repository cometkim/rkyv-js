//! Type definitions for the code generator.

use std::collections::{BTreeMap, HashSet};

/// Represents a Rust/rkyv type that can be converted to a TypeScript codec.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TypeDef {
    // Primitives
    U8,
    I8,
    U16,
    I16,
    U32,
    I32,
    U64,
    I64,
    F32,
    F64,
    Bool,
    Char,
    Unit,

    // String types
    String,

    // Container types
    Vec(Box<TypeDef>),
    Option(Box<TypeDef>),
    Box(Box<TypeDef>),
    Array(Box<TypeDef>, usize),

    // Tuple (up to 12 elements like Rust)
    Tuple(Vec<TypeDef>),

    // Reference to a named type (struct or enum)
    Named(std::string::String),

    // External type mapped via registry
    External(ExternalType),
}

/// A data-driven description of an external type mapping.
///
/// This replaces the old hardcoded `LibTypeDef` enum with a single, flexible
/// data structure that can represent any type mapping — both built-in rkyv
/// integrations and user-defined custom types.
///
/// # Template syntax
///
/// The `codec_expr` and `ts_type` fields use `{0}`, `{1}`, etc. as placeholders
/// for type parameters. These are substituted with the resolved expressions of
/// the corresponding `type_params` entries.
///
/// # Examples
///
/// ```
/// use rkyv_js_codegen::{ExternalType, Import};
///
/// // A simple type with no parameters (like uuid::Uuid)
/// let uuid = ExternalType {
///     codec_expr: "uuid".to_string(),
///     ts_type: "string".to_string(),
///     import: Some(Import::new("rkyv-js/lib/uuid", "uuid")),
///     type_params: vec![],
/// };
///
/// // A type that maps to an intrinsic (like SmolStr -> r.string)
/// let smol_str = ExternalType {
///     codec_expr: "r.string".to_string(),
///     ts_type: "string".to_string(),
///     import: None,
///     type_params: vec![],
/// };
/// ```
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExternalType {
    /// Template for the TypeScript codec expression.
    ///
    /// Use `{0}`, `{1}`, etc. for type parameter placeholders.
    /// Examples: `"uuid"`, `"hashMap({0}, {1})"`, `"r.vec({0})"`, `"r.arc({0})"`.
    pub codec_expr: std::string::String,

    /// Template for the TypeScript type.
    ///
    /// Use `{0}`, `{1}`, etc. for type parameter placeholders.
    /// Examples: `"string"`, `"Map<{0}, {1}>"`, `"{0}[]"`.
    pub ts_type: std::string::String,

    /// The import required for this type's codec, if any.
    ///
    /// Types that map to intrinsic codecs (e.g. `SmolStr` -> `r.string`)
    /// don't need an import and should set this to `None`.
    pub import: Option<Import>,

    /// Resolved inner type parameters.
    pub type_params: Vec<TypeDef>,
}

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
    pub module_path: std::string::String,
    /// The export name to import (e.g., `"uuid"`, `"indexMap"`).
    pub export_name: std::string::String,
}

impl Import {
    /// Create a new import.
    pub fn new(
        module_path: impl Into<std::string::String>,
        export_name: impl Into<std::string::String>,
    ) -> Self {
        Self {
            module_path: module_path.into(),
            export_name: export_name.into(),
        }
    }
}

impl TypeDef {
    /// Generate the TypeScript codec expression.
    pub fn to_codec_expr(&self) -> std::string::String {
        match self {
            TypeDef::U8 => "r.u8".to_string(),
            TypeDef::I8 => "r.i8".to_string(),
            TypeDef::U16 => "r.u16".to_string(),
            TypeDef::I16 => "r.i16".to_string(),
            TypeDef::U32 => "r.u32".to_string(),
            TypeDef::I32 => "r.i32".to_string(),
            TypeDef::U64 => "r.u64".to_string(),
            TypeDef::I64 => "r.i64".to_string(),
            TypeDef::F32 => "r.f32".to_string(),
            TypeDef::F64 => "r.f64".to_string(),
            TypeDef::Bool => "r.bool".to_string(),
            TypeDef::Char => "r.char".to_string(),
            TypeDef::Unit => "r.unit".to_string(),
            TypeDef::String => "r.string".to_string(),

            TypeDef::Vec(inner) => format!("r.vec({})", inner.to_codec_expr()),
            TypeDef::Option(inner) => format!("r.option({})", inner.to_codec_expr()),
            TypeDef::Box(inner) => format!("r.box({})", inner.to_codec_expr()),
            TypeDef::Array(inner, len) => format!("r.array({}, {})", inner.to_codec_expr(), len),

            TypeDef::Tuple(elements) => {
                let exprs: Vec<_> = elements.iter().map(|t| t.to_codec_expr()).collect();
                format!("r.tuple({})", exprs.join(", "))
            }

            TypeDef::Named(name) => format!("Archived{}", name),

            TypeDef::External(ext) => ext.to_codec_expr(),
        }
    }

    /// Generate the TypeScript type for values decoded by this type.
    pub fn to_ts_type(&self) -> std::string::String {
        match self {
            TypeDef::U8
            | TypeDef::I8
            | TypeDef::U16
            | TypeDef::I16
            | TypeDef::U32
            | TypeDef::I32
            | TypeDef::F32
            | TypeDef::F64 => "number".to_string(),

            TypeDef::U64 | TypeDef::I64 => "bigint".to_string(),

            TypeDef::Bool => "boolean".to_string(),
            TypeDef::Char | TypeDef::String => "string".to_string(),
            TypeDef::Unit => "null".to_string(),

            TypeDef::Vec(inner) | TypeDef::Array(inner, _) => {
                format!("{}[]", inner.to_ts_type())
            }

            TypeDef::Option(inner) => format!("{} | null", inner.to_ts_type()),
            TypeDef::Box(inner) => inner.to_ts_type(),

            TypeDef::Tuple(elements) => {
                let types: Vec<_> = elements.iter().map(|t| t.to_ts_type()).collect();
                format!("[{}]", types.join(", "))
            }

            TypeDef::Named(name) => name.clone(),

            TypeDef::External(ext) => ext.to_ts_type(),
        }
    }

    /// Collect all imports required by this type (recursively).
    pub fn collect_imports(&self, imports: &mut HashSet<Import>) {
        match self {
            TypeDef::Vec(inner)
            | TypeDef::Option(inner)
            | TypeDef::Box(inner)
            | TypeDef::Array(inner, _) => {
                inner.collect_imports(imports);
            }
            TypeDef::Tuple(elements) => {
                for elem in elements {
                    elem.collect_imports(imports);
                }
            }
            TypeDef::External(ext) => {
                if let Some(import) = &ext.import {
                    imports.insert(import.clone());
                }
                for param in &ext.type_params {
                    param.collect_imports(imports);
                }
            }
            _ => {}
        }
    }
}

impl ExternalType {
    /// Generate the TypeScript codec expression.
    pub fn to_codec_expr(&self) -> std::string::String {
        let mut result = self.codec_expr.clone();
        for (i, param) in self.type_params.iter().enumerate() {
            let placeholder = format!("{{{}}}", i);
            result = result.replace(&placeholder, &param.to_codec_expr());
        }
        result
    }

    /// Generate the TypeScript type.
    pub fn to_ts_type(&self) -> std::string::String {
        let mut result = self.ts_type.clone();
        for (i, param) in self.type_params.iter().enumerate() {
            let placeholder = format!("{{{}}}", i);
            result = result.replace(&placeholder, &param.to_ts_type());
        }
        result
    }
}

/// Represents an enum variant for code generation.
#[derive(Debug, Clone)]
pub enum EnumVariant {
    /// Unit variant: `Variant`
    Unit(std::string::String),

    /// Tuple variant: `Variant(T1, T2, ...)`
    Tuple(std::string::String, Vec<TypeDef>),

    /// Struct variant: `Variant { field1: T1, field2: T2, ... }`
    Struct(std::string::String, Vec<(std::string::String, TypeDef)>),
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
    pub name: std::string::String,
    /// The type of this variant
    pub ty: TypeDef,
}

impl UnionVariant {
    pub fn new(name: impl Into<std::string::String>, ty: TypeDef) -> Self {
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
pub fn generate_imports(imports: &HashSet<Import>) -> std::string::String {
    // Group imports by module path
    let mut by_module: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for import in imports {
        by_module
            .entry(&import.module_path)
            .or_default()
            .push(&import.export_name);
    }

    // Generate import statements
    let mut output = std::string::String::new();
    for (module_path, mut exports) in by_module {
        exports.sort(); // Deterministic ordering
        exports.dedup(); // Remove duplicates
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
        assert_eq!(TypeDef::U32.to_codec_expr(), "r.u32");
        assert_eq!(TypeDef::String.to_codec_expr(), "r.string");
        assert_eq!(TypeDef::Bool.to_codec_expr(), "r.bool");
    }

    #[test]
    fn test_container_codec_expr() {
        let vec_u32 = TypeDef::Vec(Box::new(TypeDef::U32));
        assert_eq!(vec_u32.to_codec_expr(), "r.vec(r.u32)");

        let option_string = TypeDef::Option(Box::new(TypeDef::String));
        assert_eq!(option_string.to_codec_expr(), "r.option(r.string)");
    }

    #[test]
    fn test_nested_codec_expr() {
        let nested = TypeDef::Vec(Box::new(TypeDef::Option(Box::new(TypeDef::U32))));
        assert_eq!(nested.to_codec_expr(), "r.vec(r.option(r.u32))");
    }

    #[test]
    fn test_ts_types() {
        assert_eq!(TypeDef::U32.to_ts_type(), "number");
        assert_eq!(TypeDef::U64.to_ts_type(), "bigint");
        assert_eq!(TypeDef::String.to_ts_type(), "string");

        let vec_u32 = TypeDef::Vec(Box::new(TypeDef::U32));
        assert_eq!(vec_u32.to_ts_type(), "number[]");
    }

    #[test]
    fn test_named_type_codec_expr() {
        let named = TypeDef::Named("Point".to_string());
        assert_eq!(named.to_codec_expr(), "ArchivedPoint");
    }

    #[test]
    fn test_array_codec_expr() {
        let arr = TypeDef::Array(Box::new(TypeDef::U8), 4);
        assert_eq!(arr.to_codec_expr(), "r.array(r.u8, 4)");
    }

    #[test]
    fn test_tuple_codec_expr() {
        let tuple = TypeDef::Tuple(vec![TypeDef::U32, TypeDef::String]);
        assert_eq!(tuple.to_codec_expr(), "r.tuple(r.u32, r.string)");
    }

    #[test]
    fn test_external_uuid_codec_expr() {
        let uuid = TypeDef::External(ExternalType {
            codec_expr: "uuid".to_string(),
            ts_type: "string".to_string(),
            import: Some(Import::new("rkyv-js/lib/uuid", "uuid")),
            type_params: vec![],
        });
        assert_eq!(uuid.to_codec_expr(), "uuid");
        assert_eq!(uuid.to_ts_type(), "string");
    }

    #[test]
    fn test_external_bytes_codec_expr() {
        let bytes = TypeDef::External(ExternalType {
            codec_expr: "bytes".to_string(),
            ts_type: "Uint8Array".to_string(),
            import: Some(Import::new("rkyv-js/lib/bytes", "bytes")),
            type_params: vec![],
        });
        assert_eq!(bytes.to_codec_expr(), "bytes");
        assert_eq!(bytes.to_ts_type(), "Uint8Array");
    }

    #[test]
    fn test_external_smol_str_codec_expr() {
        // SmolStr archives to the same format as String
        let smol_str = TypeDef::External(ExternalType {
            codec_expr: "r.string".to_string(),
            ts_type: "string".to_string(),
            import: None,
            type_params: vec![],
        });
        assert_eq!(smol_str.to_codec_expr(), "r.string");
        assert_eq!(smol_str.to_ts_type(), "string");
    }

    #[test]
    fn test_external_thin_vec_codec_expr() {
        // ThinVec archives to the same format as Vec
        let thin_vec = TypeDef::External(ExternalType {
            codec_expr: "r.vec({0})".to_string(),
            ts_type: "{0}[]".to_string(),
            import: None,
            type_params: vec![TypeDef::U32],
        });
        assert_eq!(thin_vec.to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(thin_vec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_external_arrayvec_codec_expr() {
        // ArrayVec archives to the same format as Vec
        let arrayvec = TypeDef::External(ExternalType {
            codec_expr: "r.vec({0})".to_string(),
            ts_type: "{0}[]".to_string(),
            import: None,
            type_params: vec![TypeDef::U32],
        });
        assert_eq!(arrayvec.to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(arrayvec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_external_smallvec_codec_expr() {
        let smallvec = TypeDef::External(ExternalType {
            codec_expr: "r.vec({0})".to_string(),
            ts_type: "{0}[]".to_string(),
            import: None,
            type_params: vec![TypeDef::U32],
        });
        assert_eq!(smallvec.to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(smallvec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_external_tinyvec_codec_expr() {
        let tinyvec = TypeDef::External(ExternalType {
            codec_expr: "r.vec({0})".to_string(),
            ts_type: "{0}[]".to_string(),
            import: None,
            type_params: vec![TypeDef::String],
        });
        assert_eq!(tinyvec.to_codec_expr(), "r.vec(r.string)");
        assert_eq!(tinyvec.to_ts_type(), "string[]");
    }

    #[test]
    fn test_external_tiny_arrayvec_codec_expr() {
        let tiny_arrayvec = TypeDef::External(ExternalType {
            codec_expr: "r.vec({0})".to_string(),
            ts_type: "{0}[]".to_string(),
            import: None,
            type_params: vec![TypeDef::U8],
        });
        assert_eq!(tiny_arrayvec.to_codec_expr(), "r.vec(r.u8)");
        assert_eq!(tiny_arrayvec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_external_vec_deque_codec_expr() {
        let vec_deque = TypeDef::External(ExternalType {
            codec_expr: "r.vec({0})".to_string(),
            ts_type: "{0}[]".to_string(),
            import: None,
            type_params: vec![TypeDef::U32],
        });
        assert_eq!(vec_deque.to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(vec_deque.to_ts_type(), "number[]");
    }

    #[test]
    fn test_external_hash_set_codec_expr() {
        let hash_set = TypeDef::External(ExternalType {
            codec_expr: "hashSet({0})".to_string(),
            ts_type: "Set<{0}>".to_string(),
            import: Some(Import::new("rkyv-js/lib/std-hash-set", "hashSet")),
            type_params: vec![TypeDef::String],
        });
        assert_eq!(hash_set.to_codec_expr(), "hashSet(r.string)");
        assert_eq!(hash_set.to_ts_type(), "Set<string>");
    }

    #[test]
    fn test_external_btree_set_codec_expr() {
        let btree_set = TypeDef::External(ExternalType {
            codec_expr: "btreeSet({0})".to_string(),
            ts_type: "Set<{0}>".to_string(),
            import: Some(Import::new("rkyv-js/lib/std-btree-set", "btreeSet")),
            type_params: vec![TypeDef::U64],
        });
        assert_eq!(btree_set.to_codec_expr(), "btreeSet(r.u64)");
        assert_eq!(btree_set.to_ts_type(), "Set<bigint>");
    }

    #[test]
    fn test_external_indexmap_codec_expr() {
        let indexmap = TypeDef::External(ExternalType {
            codec_expr: "indexMap({0}, {1})".to_string(),
            ts_type: "Map<{0}, {1}>".to_string(),
            import: Some(Import::new("rkyv-js/lib/indexmap", "indexMap")),
            type_params: vec![TypeDef::String, TypeDef::U32],
        });
        assert_eq!(indexmap.to_codec_expr(), "indexMap(r.string, r.u32)");
        assert_eq!(indexmap.to_ts_type(), "Map<string, number>");
    }

    #[test]
    fn test_external_indexset_codec_expr() {
        let indexset = TypeDef::External(ExternalType {
            codec_expr: "indexSet({0})".to_string(),
            ts_type: "Set<{0}>".to_string(),
            import: Some(Import::new("rkyv-js/lib/indexmap", "indexSet")),
            type_params: vec![TypeDef::String],
        });
        assert_eq!(indexset.to_codec_expr(), "indexSet(r.string)");
        assert_eq!(indexset.to_ts_type(), "Set<string>");
    }

    #[test]
    fn test_external_arc_codec_expr() {
        let arc = TypeDef::External(ExternalType {
            codec_expr: "r.arc({0})".to_string(),
            ts_type: "{0}".to_string(),
            import: None,
            type_params: vec![TypeDef::Named("Config".to_string())],
        });
        assert_eq!(arc.to_codec_expr(), "r.arc(ArchivedConfig)");
        assert_eq!(arc.to_ts_type(), "Config");
    }

    #[test]
    fn test_external_rc_codec_expr() {
        let rc = TypeDef::External(ExternalType {
            codec_expr: "r.rc({0})".to_string(),
            ts_type: "{0}".to_string(),
            import: None,
            type_params: vec![TypeDef::String],
        });
        assert_eq!(rc.to_codec_expr(), "r.rc(r.string)");
        assert_eq!(rc.to_ts_type(), "string");
    }

    #[test]
    fn test_external_weak_codec_expr() {
        let rc_weak = TypeDef::External(ExternalType {
            codec_expr: "r.rcWeak({0})".to_string(),
            ts_type: "{0} | null".to_string(),
            import: None,
            type_params: vec![TypeDef::U32],
        });
        assert_eq!(rc_weak.to_codec_expr(), "r.rcWeak(r.u32)");
        assert_eq!(rc_weak.to_ts_type(), "number | null");

        let arc_weak = TypeDef::External(ExternalType {
            codec_expr: "r.arcWeak({0})".to_string(),
            ts_type: "{0} | null".to_string(),
            import: None,
            type_params: vec![TypeDef::String],
        });
        assert_eq!(arc_weak.to_codec_expr(), "r.arcWeak(r.string)");
        assert_eq!(arc_weak.to_ts_type(), "string | null");
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
        // Modules are sorted alphabetically by module path
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
