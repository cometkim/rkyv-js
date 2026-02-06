//! Type registry for mapping Rust type names to TypeScript codec definitions.
//!
//! The registry provides a data-driven way to teach the code generator how to
//! handle external crate types. Built-in mappings for rkyv's supported crates
//! are registered automatically, and users can add custom mappings.

use std::collections::HashMap;

use crate::types::{ExternalType, Import, TypeDef};

/// Describes how to parse the generic arguments of a Rust type.
///
/// This determines how `syn` type parameters are extracted and passed
/// to the `ExternalType` template.
#[derive(Debug, Clone)]
pub enum GenericShape {
    /// No generic arguments (e.g., `Uuid`, `Bytes`).
    None,
    /// Single type argument: `Foo<T>` (e.g., `VecDeque<T>`, `HashSet<T>`).
    Single,
    /// Two type arguments: `Foo<K, V>` (e.g., `HashMap<K, V>`).
    Pair,
    /// Single array argument: `Foo<[T; N]>` (e.g., `SmallVec<[T; N]>`).
    /// The array length is parsed but discarded (not used in archive format).
    Array,
    /// Type + const generic: `Foo<T, N>` (e.g., `ArrayVec<T, 64>`).
    /// The const generic is parsed but discarded (not used in archive format).
    TypeAndConst,
}

/// A registered type mapping that describes how to convert a Rust type name
/// into a `TypeDef::External`.
///
/// # Example
///
/// ```
/// use rkyv_js_codegen::registry::{TypeMapping, GenericShape};
/// use rkyv_js_codegen::Import;
///
/// let mapping = TypeMapping {
///     codec_expr: "indexMap({0}, {1})".to_string(),
///     ts_type: "Map<{0}, {1}>".to_string(),
///     import: Some(Import::new("rkyv-js/lib/indexmap", "indexMap")),
///     generics: GenericShape::Pair,
/// };
/// ```
#[derive(Debug, Clone)]
pub struct TypeMapping {
    /// Template for the TypeScript codec expression.
    /// Use `{0}`, `{1}`, etc. for type parameter placeholders.
    pub codec_expr: String,

    /// Template for the TypeScript type.
    /// Use `{0}`, `{1}`, etc. for type parameter placeholders.
    pub ts_type: String,

    /// The import required for this type's codec, if any.
    pub import: Option<Import>,

    /// Describes how to parse generic arguments from the Rust type.
    pub generics: GenericShape,
}

impl TypeMapping {
    /// Create a `TypeDef::External` from this mapping with resolved type parameters.
    pub fn to_type_def(&self, type_params: Vec<TypeDef>) -> TypeDef {
        TypeDef::External(ExternalType {
            codec_expr: self.codec_expr.clone(),
            ts_type: self.ts_type.clone(),
            import: self.import.clone(),
            type_params,
        })
    }
}

/// A registry of type name -> mapping associations.
///
/// The `TypeRegistry` is the central place where the code generator learns how
/// to handle external types. It ships with built-in mappings for all types
/// supported by rkyv's feature flags.
///
/// # Built-in mappings
///
/// The following types are registered by default (via [`TypeRegistry::with_builtins`]):
///
/// | Rust type | Codec expression | Import |
/// |-----------|-----------------|--------|
/// | `Uuid` | `uuid` | `rkyv-js/lib/uuid` |
/// | `Bytes` | `bytes` | `rkyv-js/lib/bytes` |
/// | `SmolStr` | `r.string` | none |
/// | `VecDeque<T>` | `r.vec({0})` | none |
/// | `ThinVec<T>` | `r.vec({0})` | none |
/// | `ArrayVec<T, N>` | `r.vec({0})` | none |
/// | `SmallVec<[T; N]>` | `r.vec({0})` | none |
/// | `TinyVec<[T; N]>` | `r.vec({0})` | none |
/// | `HashMap<K, V>` | `hashMap({0}, {1})` | `rkyv-js/lib/std-hash-map` |
/// | `HashSet<T>` | `hashSet({0})` | `rkyv-js/lib/std-hash-set` |
/// | `BTreeMap<K, V>` | `btreeMap({0}, {1})` | `rkyv-js/lib/std-btree-map` |
/// | `BTreeSet<T>` | `btreeSet({0})` | `rkyv-js/lib/std-btree-set` |
/// | `IndexMap<K, V>` | `indexMap({0}, {1})` | `rkyv-js/lib/indexmap` |
/// | `IndexSet<T>` | `indexSet({0})` | `rkyv-js/lib/indexmap` |
/// | `Arc<T>` | `r.arc({0})` | none |
/// | `Rc<T>` | `r.rc({0})` | none |
/// | `Weak<T>` | `r.rcWeak({0})` | none |
///
/// # Custom mappings
///
/// ```rust,ignore
/// use rkyv_js_codegen::{CodeGenerator, Import};
/// use rkyv_js_codegen::registry::{TypeMapping, GenericShape};
///
/// let mut gen = CodeGenerator::new();
/// gen.register_type("MyCustomVec", TypeMapping {
///     codec_expr: "myVec({0})".to_string(),
///     ts_type: "{0}[]".to_string(),
///     import: Some(Import::new("my-package/codecs", "myVec")),
///     generics: GenericShape::Single,
/// });
/// ```
#[derive(Debug, Clone)]
pub struct TypeRegistry {
    mappings: HashMap<String, TypeMapping>,
}

impl TypeRegistry {
    /// Create an empty registry with no mappings.
    pub fn new() -> Self {
        Self {
            mappings: HashMap::new(),
        }
    }

    /// Create a registry pre-populated with all built-in rkyv type mappings.
    pub fn with_builtins() -> Self {
        let mut registry = Self::new();
        registry.register_builtins();
        registry
    }

    /// Register all built-in rkyv type mappings.
    pub fn register_builtins(&mut self) {
        // uuid::Uuid
        self.register(
            "Uuid",
            TypeMapping {
                codec_expr: "uuid".to_string(),
                ts_type: "string".to_string(),
                import: Some(Import::new("rkyv-js/lib/uuid", "uuid")),
                generics: GenericShape::None,
            },
        );

        // bytes::Bytes
        self.register(
            "Bytes",
            TypeMapping {
                codec_expr: "bytes".to_string(),
                ts_type: "Uint8Array".to_string(),
                import: Some(Import::new("rkyv-js/lib/bytes", "bytes")),
                generics: GenericShape::None,
            },
        );

        // smol_str::SmolStr -> same as r.string
        self.register(
            "SmolStr",
            TypeMapping {
                codec_expr: "r.string".to_string(),
                ts_type: "string".to_string(),
                import: None,
                generics: GenericShape::None,
            },
        );

        // std::collections::VecDeque<T> -> same as r.vec(T)
        self.register(
            "VecDeque",
            TypeMapping {
                codec_expr: "r.vec({0})".to_string(),
                ts_type: "{0}[]".to_string(),
                import: None,
                generics: GenericShape::Single,
            },
        );

        // thin_vec::ThinVec<T> -> same as r.vec(T)
        self.register(
            "ThinVec",
            TypeMapping {
                codec_expr: "r.vec({0})".to_string(),
                ts_type: "{0}[]".to_string(),
                import: None,
                generics: GenericShape::Single,
            },
        );

        // arrayvec::ArrayVec<T, CAP> -> same as r.vec(T)
        self.register(
            "ArrayVec",
            TypeMapping {
                codec_expr: "r.vec({0})".to_string(),
                ts_type: "{0}[]".to_string(),
                import: None,
                generics: GenericShape::TypeAndConst,
            },
        );

        // smallvec::SmallVec<[T; N]> -> same as r.vec(T)
        self.register(
            "SmallVec",
            TypeMapping {
                codec_expr: "r.vec({0})".to_string(),
                ts_type: "{0}[]".to_string(),
                import: None,
                generics: GenericShape::Array,
            },
        );

        // tinyvec::TinyVec<[T; N]> -> same as r.vec(T)
        self.register(
            "TinyVec",
            TypeMapping {
                codec_expr: "r.vec({0})".to_string(),
                ts_type: "{0}[]".to_string(),
                import: None,
                generics: GenericShape::Array,
            },
        );

        // tinyvec::ArrayVec<[T; N]> -> same as r.vec(T)
        // Note: tinyvec::ArrayVec is different from arrayvec::ArrayVec
        // tinyvec::ArrayVec uses array syntax [T; N], while arrayvec::ArrayVec uses <T, N>
        // Since both are registered as "ArrayVec" (last path segment), the latter registration wins.
        // tinyvec::ArrayVec is less common, so we keep arrayvec::ArrayVec as the default.

        // std::collections::HashMap<K, V>
        self.register(
            "HashMap",
            TypeMapping {
                codec_expr: "hashMap({0}, {1})".to_string(),
                ts_type: "Map<{0}, {1}>".to_string(),
                import: Some(Import::new("rkyv-js/lib/std-hash-map", "hashMap")),
                generics: GenericShape::Pair,
            },
        );

        // std::collections::HashSet<T>
        self.register(
            "HashSet",
            TypeMapping {
                codec_expr: "hashSet({0})".to_string(),
                ts_type: "Set<{0}>".to_string(),
                import: Some(Import::new("rkyv-js/lib/std-hash-set", "hashSet")),
                generics: GenericShape::Single,
            },
        );

        // std::collections::BTreeMap<K, V>
        self.register(
            "BTreeMap",
            TypeMapping {
                codec_expr: "btreeMap({0}, {1})".to_string(),
                ts_type: "Map<{0}, {1}>".to_string(),
                import: Some(Import::new("rkyv-js/lib/std-btree-map", "btreeMap")),
                generics: GenericShape::Pair,
            },
        );

        // std::collections::BTreeSet<T>
        self.register(
            "BTreeSet",
            TypeMapping {
                codec_expr: "btreeSet({0})".to_string(),
                ts_type: "Set<{0}>".to_string(),
                import: Some(Import::new("rkyv-js/lib/std-btree-set", "btreeSet")),
                generics: GenericShape::Single,
            },
        );

        // indexmap::IndexMap<K, V>
        self.register(
            "IndexMap",
            TypeMapping {
                codec_expr: "indexMap({0}, {1})".to_string(),
                ts_type: "Map<{0}, {1}>".to_string(),
                import: Some(Import::new("rkyv-js/lib/indexmap", "indexMap")),
                generics: GenericShape::Pair,
            },
        );

        // indexmap::IndexSet<T>
        self.register(
            "IndexSet",
            TypeMapping {
                codec_expr: "indexSet({0})".to_string(),
                ts_type: "Set<{0}>".to_string(),
                import: Some(Import::new("rkyv-js/lib/indexmap", "indexSet")),
                generics: GenericShape::Single,
            },
        );

        // triomphe::Arc<T> or std::sync::Arc<T>
        self.register(
            "Arc",
            TypeMapping {
                codec_expr: "r.arc({0})".to_string(),
                ts_type: "{0}".to_string(),
                import: None,
                generics: GenericShape::Single,
            },
        );

        // std::rc::Rc<T>
        self.register(
            "Rc",
            TypeMapping {
                codec_expr: "r.rc({0})".to_string(),
                ts_type: "{0}".to_string(),
                import: None,
                generics: GenericShape::Single,
            },
        );

        // std::rc::Weak<T> or std::sync::Weak<T>
        self.register(
            "Weak",
            TypeMapping {
                codec_expr: "r.rcWeak({0})".to_string(),
                ts_type: "{0} | null".to_string(),
                import: None,
                generics: GenericShape::Single,
            },
        );
    }

    /// Register a type mapping for a Rust type name.
    ///
    /// The name should be the last path segment of the type (e.g., `"Uuid"` for `uuid::Uuid`).
    /// If a mapping already exists for this name, it is replaced.
    pub fn register(&mut self, name: impl Into<String>, mapping: TypeMapping) {
        self.mappings.insert(name.into(), mapping);
    }

    /// Look up the mapping for a Rust type name.
    pub fn get(&self, name: &str) -> Option<&TypeMapping> {
        self.mappings.get(name)
    }

    /// Check if a type name is registered.
    pub fn contains(&self, name: &str) -> bool {
        self.mappings.contains_key(name)
    }

    /// Remove a type mapping.
    pub fn unregister(&mut self, name: &str) -> Option<TypeMapping> {
        self.mappings.remove(name)
    }
}

impl Default for TypeRegistry {
    fn default() -> Self {
        Self::with_builtins()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_with_builtins() {
        let registry = TypeRegistry::with_builtins();
        assert!(registry.contains("Uuid"));
        assert!(registry.contains("Bytes"));
        assert!(registry.contains("SmolStr"));
        assert!(registry.contains("VecDeque"));
        assert!(registry.contains("HashMap"));
        assert!(registry.contains("Arc"));
        assert!(!registry.contains("NonExistent"));
    }

    #[test]
    fn test_registry_custom_type() {
        let mut registry = TypeRegistry::new();
        registry.register(
            "MyType",
            TypeMapping {
                codec_expr: "myCodec({0})".to_string(),
                ts_type: "MyType<{0}>".to_string(),
                import: Some(Import::new("my-pkg/codecs", "myCodec")),
                generics: GenericShape::Single,
            },
        );

        let mapping = registry.get("MyType").unwrap();
        let td = mapping.to_type_def(vec![TypeDef::String]);
        assert_eq!(td.to_codec_expr(), "myCodec(r.string)");
        assert_eq!(td.to_ts_type(), "MyType<string>");
    }

    #[test]
    fn test_registry_override_builtin() {
        let mut registry = TypeRegistry::with_builtins();

        // Override Uuid with a custom mapping
        registry.register(
            "Uuid",
            TypeMapping {
                codec_expr: "customUuid".to_string(),
                ts_type: "CustomUuid".to_string(),
                import: Some(Import::new("my-pkg/uuid", "customUuid")),
                generics: GenericShape::None,
            },
        );

        let mapping = registry.get("Uuid").unwrap();
        let td = mapping.to_type_def(vec![]);
        assert_eq!(td.to_codec_expr(), "customUuid");
    }

    #[test]
    fn test_registry_unregister() {
        let mut registry = TypeRegistry::with_builtins();
        assert!(registry.contains("Uuid"));
        registry.unregister("Uuid");
        assert!(!registry.contains("Uuid"));
    }

    #[test]
    fn test_builtin_uuid_mapping() {
        let registry = TypeRegistry::with_builtins();
        let mapping = registry.get("Uuid").unwrap();
        let td = mapping.to_type_def(vec![]);
        assert_eq!(td.to_codec_expr(), "uuid");
        assert_eq!(td.to_ts_type(), "string");
    }

    #[test]
    fn test_builtin_hashmap_mapping() {
        let registry = TypeRegistry::with_builtins();
        let mapping = registry.get("HashMap").unwrap();
        let td = mapping.to_type_def(vec![TypeDef::String, TypeDef::U32]);
        assert_eq!(td.to_codec_expr(), "hashMap(r.string, r.u32)");
        assert_eq!(td.to_ts_type(), "Map<string, number>");
    }

    #[test]
    fn test_builtin_smolstr_mapping() {
        let registry = TypeRegistry::with_builtins();
        let mapping = registry.get("SmolStr").unwrap();
        let td = mapping.to_type_def(vec![]);
        assert_eq!(td.to_codec_expr(), "r.string");
        assert_eq!(td.to_ts_type(), "string");
    }
}
