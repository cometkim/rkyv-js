//! Type registry for mapping Rust type names to TypeScript codec definitions.
//!
//! The registry provides a data-driven way to teach the code generator how to
//! handle external crate types. Built-in mappings for rkyv's supported crates
//! are registered automatically, and users can add custom mappings.

use std::collections::HashMap;

use crate::types::TypeDef;

/// A registry of type name -> `TypeDef` template associations.
///
/// The `TypeRegistry` is the central place where the code generator learns how
/// to handle external types. It ships with built-in mappings for all types
/// supported by rkyv's feature flags.
///
/// Each entry is a `TypeDef` template — the number of type parameters is inferred
/// from the placeholder count in the template (e.g., `{0}`, `{1}`), and
/// `resolve()` is called to produce a concrete `TypeDef` with `type_params` filled in.
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
/// ```
/// # fn main() {
/// use rkyv_js_codegen::{CodeGenerator, TypeDef};
///
/// let mut generator = CodeGenerator::new();
/// generator.register_type("MyCustomVec",
///     TypeDef::new("myVec({0})", "{0}[]")
///         .with_import("my-package/codecs", "myVec"),
/// );
/// # }
/// ```
#[derive(Debug, Clone)]
pub struct TypeRegistry {
    mappings: HashMap<String, TypeDef>,
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
            TypeDef::new("uuid", "string").with_import("rkyv-js/lib/uuid", "uuid"),
        );

        // bytes::Bytes
        self.register(
            "Bytes",
            TypeDef::new("bytes", "Uint8Array").with_import("rkyv-js/lib/bytes", "bytes"),
        );

        // smol_str::SmolStr -> same as r.string
        self.register("SmolStr", TypeDef::new("r.string", "string"));

        // std::collections::VecDeque<T> -> same as r.vec(T)
        self.register("VecDeque", TypeDef::new("r.vec({0})", "{0}[]"));

        // thin_vec::ThinVec<T> -> same as r.vec(T)
        self.register("ThinVec", TypeDef::new("r.vec({0})", "{0}[]"));

        // arrayvec::ArrayVec<T, CAP> -> same as r.vec(T)
        self.register("ArrayVec", TypeDef::new("r.vec({0})", "{0}[]"));

        // smallvec::SmallVec<[T; N]> -> same as r.vec(T)
        self.register("SmallVec", TypeDef::new("r.vec({0})", "{0}[]"));

        // tinyvec::TinyVec<[T; N]> -> same as r.vec(T)
        self.register("TinyVec", TypeDef::new("r.vec({0})", "{0}[]"));

        // std::collections::HashMap<K, V>
        self.register(
            "HashMap",
            TypeDef::new("hashMap({0}, {1})", "Map<{0}, {1}>")
                .with_import("rkyv-js/lib/std-hash-map", "hashMap"),
        );

        // std::collections::HashSet<T>
        self.register(
            "HashSet",
            TypeDef::new("hashSet({0})", "Set<{0}>")
                .with_import("rkyv-js/lib/std-hash-set", "hashSet"),
        );

        // std::collections::BTreeMap<K, V>
        self.register(
            "BTreeMap",
            TypeDef::new("btreeMap({0}, {1})", "Map<{0}, {1}>")
                .with_import("rkyv-js/lib/std-btree-map", "btreeMap"),
        );

        // std::collections::BTreeSet<T>
        self.register(
            "BTreeSet",
            TypeDef::new("btreeSet({0})", "Set<{0}>")
                .with_import("rkyv-js/lib/std-btree-set", "btreeSet"),
        );

        // indexmap::IndexMap<K, V>
        self.register(
            "IndexMap",
            TypeDef::new("indexMap({0}, {1})", "Map<{0}, {1}>")
                .with_import("rkyv-js/lib/indexmap", "indexMap"),
        );

        // indexmap::IndexSet<T>
        self.register(
            "IndexSet",
            TypeDef::new("indexSet({0})", "Set<{0}>")
                .with_import("rkyv-js/lib/indexmap", "indexSet"),
        );

        // triomphe::Arc<T> or std::sync::Arc<T>
        self.register("Arc", TypeDef::new("r.arc({0})", "{0}"));

        // std::rc::Rc<T>
        self.register("Rc", TypeDef::new("r.rc({0})", "{0}"));

        // std::rc::Weak<T> or std::sync::Weak<T>
        self.register("Weak", TypeDef::new("r.rcWeak({0})", "{0} | null"));
    }

    /// Register a type for a Rust type name.
    ///
    /// The name should be the last path segment of the type (e.g., `"Uuid"` for `uuid::Uuid`).
    /// If a mapping already exists for this name, it is replaced.
    pub fn register(&mut self, name: impl Into<String>, typedef: TypeDef) {
        self.mappings.insert(name.into(), typedef);
    }

    /// Look up the type definition template for a Rust type name.
    pub fn get(&self, name: &str) -> Option<&TypeDef> {
        self.mappings.get(name)
    }

    /// Check if a type name is registered.
    pub fn contains(&self, name: &str) -> bool {
        self.mappings.contains_key(name)
    }

    /// Remove a type mapping.
    pub fn unregister(&mut self, name: &str) -> Option<TypeDef> {
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
            TypeDef::new("myCodec({0})", "MyType<{0}>").with_import("my-pkg/codecs", "myCodec"),
        );

        let template = registry.get("MyType").unwrap();
        let td = template.resolve(vec![TypeDef::string()]);
        assert_eq!(td.to_codec_expr(), "myCodec(r.string)");
        assert_eq!(td.to_ts_type(), "MyType<string>");
    }

    #[test]
    fn test_registry_override_builtin() {
        let mut registry = TypeRegistry::with_builtins();
        registry.register(
            "Uuid",
            TypeDef::new("customUuid", "CustomUuid").with_import("my-pkg/uuid", "customUuid"),
        );

        let template = registry.get("Uuid").unwrap();
        let td = template.resolve(vec![]);
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
    fn test_builtin_uuid() {
        let registry = TypeRegistry::with_builtins();
        let td = registry.get("Uuid").unwrap().resolve(vec![]);
        assert_eq!(td.to_codec_expr(), "uuid");
        assert_eq!(td.to_ts_type(), "string");
    }

    #[test]
    fn test_builtin_hashmap() {
        let registry = TypeRegistry::with_builtins();
        let td = registry
            .get("HashMap")
            .unwrap()
            .resolve(vec![TypeDef::string(), TypeDef::u32()]);
        assert_eq!(td.to_codec_expr(), "hashMap(r.string, r.u32)");
        assert_eq!(td.to_ts_type(), "Map<string, number>");
    }

    #[test]
    fn test_builtin_smolstr() {
        let registry = TypeRegistry::with_builtins();
        let td = registry.get("SmolStr").unwrap().resolve(vec![]);
        assert_eq!(td.to_codec_expr(), "r.string");
        assert_eq!(td.to_ts_type(), "string");
    }
}
