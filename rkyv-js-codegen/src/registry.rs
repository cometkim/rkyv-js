//! Type registry for mapping Rust type paths to TypeScript codec definitions.
//!
//! The registry provides a data-driven way to teach the code generator how to
//! handle external crate types. Built-in mappings for rkyv's supported crates
//! are registered automatically, and users can add custom mappings.

use std::collections::HashMap;

use crate::types::TypeDef;

/// A registry of fully-qualified Rust type path -> `TypeDef` template associations.
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
/// | `uuid::Uuid` | `uuid` | `rkyv-js/lib/uuid` |
/// | `bytes::Bytes` | `bytes` | `rkyv-js/lib/bytes` |
/// | `smol_str::SmolStr` | `r.string` | none |
/// | `std::collections::VecDeque<T>` | `r.vec({0})` | none |
/// | `thin_vec::ThinVec<T>` | `r.vec({0})` | none |
/// | `arrayvec::ArrayVec<T, N>` | `r.vec({0})` | none |
/// | `smallvec::SmallVec<[T; N]>` | `r.vec({0})` | none |
/// | `tinyvec::TinyVec<[T; N]>` | `r.vec({0})` | none |
/// | `std::collections::BTreeMap<K, V>` | `btreeMap({0}, {1})` | `rkyv-js/lib/btreemap` |
/// | `std::collections::BTreeSet<T>` | `btreeSet({0})` | `rkyv-js/lib/btreemap` |
/// | `std::collections::HashMap<K, V>` | `hashMap({0}, {1})` | `rkyv-js/lib/hashmap` |
/// | `std::collections::HashSet<T>` | `hashSet({0})` | `rkyv-js/lib/hashmap` |
/// | `hashbrown::HashMap<K, V>` | `hashMap({0}, {1})` | `rkyv-js/lib/hashmap` |
/// | `hashbrown::HashSet<T>` | `hashSet({0})` | `rkyv-js/lib/hashmap` |
/// | `indexmap::IndexMap<K, V>` | `indexMap({0}, {1})` | `rkyv-js/lib/indexmap` |
/// | `indexmap::IndexSet<T>` | `indexSet({0})` | `rkyv-js/lib/indexmap` |
/// | `std::sync::Arc<T>` / `triomphe::Arc<T>` | `r.arc({0})` | none |
/// | `std::rc::Rc<T>` | `r.rc({0})` | none |
/// | `std::rc::Weak<T>` / `std::sync::Weak<T>` | `r.rcWeak({0})` | none |
///
/// # Custom mappings
///
/// ```
/// # fn main() {
/// use rkyv_js_codegen::{CodeGenerator, TypeDef};
///
/// let mut generator = CodeGenerator::new();
/// generator.register_type("my_crate::MyCustomVec",
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
            "uuid::Uuid",
            TypeDef::new("uuid", "string").with_import("rkyv-js/lib/uuid", "uuid"),
        );

        // bytes::Bytes
        self.register(
            "bytes::Bytes",
            TypeDef::new("bytes", "Uint8Array").with_import("rkyv-js/lib/bytes", "bytes"),
        );

        // smol_str::SmolStr -> same as r.string
        self.register("smol_str::SmolStr", TypeDef::new("r.string", "string"));

        // std::collections::VecDeque<T> -> same as r.vec(T)
        self.register(
            "std::collections::VecDeque",
            TypeDef::new("r.vec({0})", "{0}[]"),
        );

        // thin_vec::ThinVec<T> -> same as r.vec(T)
        self.register("thin_vec::ThinVec", TypeDef::new("r.vec({0})", "{0}[]"));

        // arrayvec::ArrayVec<T, CAP> -> same as r.vec(T)
        self.register("arrayvec::ArrayVec", TypeDef::new("r.vec({0})", "{0}[]"));

        // smallvec::SmallVec<[T; N]> -> same as r.vec(T)
        self.register("smallvec::SmallVec", TypeDef::new("r.vec({0})", "{0}[]"));

        // tinyvec::TinyVec<[T; N]> -> same as r.vec(T)
        self.register("tinyvec::TinyVec", TypeDef::new("r.vec({0})", "{0}[]"));

        // std::collections::BTreeMap<K, V>
        self.register(
            "std::collections::BTreeMap",
            TypeDef::new("btreeMap({0}, {1})", "Map<{0}, {1}>")
                .with_import("rkyv-js/lib/btreemap", "btreeMap"),
        );

        // std::collections::BTreeSet<T>
        self.register(
            "std::collections::BTreeSet",
            TypeDef::new("btreeSet({0})", "Set<{0}>")
                .with_import("rkyv-js/lib/btreemap", "btreeSet"),
        );

        // std::collections::HashMap<K, V>
        self.register(
            "std::collections::HashMap",
            TypeDef::new("hashMap({0}, {1})", "Map<{0}, {1}>")
                .with_import("rkyv-js/lib/hashmap", "hashMap"),
        );

        // std::collections::HashSet<T>
        self.register(
            "std::collections::HashSet",
            TypeDef::new("hashSet({0})", "Set<{0}>")
                .with_import("rkyv-js/lib/hashmap", "hashSet"),
        );

        // hashbrown::HashMap<K, V> -> same as std HashMap
        self.register(
            "hashbrown::HashMap",
            TypeDef::new("hashMap({0}, {1})", "Map<{0}, {1}>")
                .with_import("rkyv-js/lib/hashmap", "hashMap"),
        );

        // hashbrown::HashSet<T> -> same as std HashSet
        self.register(
            "hashbrown::HashSet",
            TypeDef::new("hashSet({0})", "Set<{0}>")
                .with_import("rkyv-js/lib/hashmap", "hashSet"),
        );

        // indexmap::IndexMap<K, V>
        self.register(
            "indexmap::IndexMap",
            TypeDef::new("indexMap({0}, {1})", "Map<{0}, {1}>")
                .with_import("rkyv-js/lib/indexmap", "indexMap"),
        );

        // indexmap::IndexSet<T>
        self.register(
            "indexmap::IndexSet",
            TypeDef::new("indexSet({0})", "Set<{0}>")
                .with_import("rkyv-js/lib/indexmap", "indexSet"),
        );

        // triomphe::Arc<T>
        self.register("triomphe::Arc", TypeDef::new("r.arc({0})", "{0}"));

        // std::sync::Arc<T>
        self.register("std::sync::Arc", TypeDef::new("r.arc({0})", "{0}"));

        // std::rc::Rc<T>
        self.register("std::rc::Rc", TypeDef::new("r.rc({0})", "{0}"));

        // std::rc::Weak<T>
        self.register("std::rc::Weak", TypeDef::new("r.rcWeak({0})", "{0} | null"));

        // std::sync::Weak<T>
        self.register(
            "std::sync::Weak",
            TypeDef::new("r.rcWeak({0})", "{0} | null"),
        );
    }

    /// Register a type for a fully-qualified Rust type path.
    ///
    /// The name should be the full module path of the type
    /// (e.g., `"uuid::Uuid"`, `"std::collections::HashMap"`).
    /// If a mapping already exists for this path, it is replaced.
    pub fn register(&mut self, name: impl Into<String>, typedef: TypeDef) {
        self.mappings.insert(name.into(), typedef);
    }

    /// Look up the type definition template for a fully-qualified Rust type path.
    pub fn get(&self, name: &str) -> Option<&TypeDef> {
        self.mappings.get(name)
    }

    /// Check if a type path is registered.
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
        assert!(registry.contains("uuid::Uuid"));
        assert!(registry.contains("bytes::Bytes"));
        assert!(registry.contains("smol_str::SmolStr"));
        assert!(registry.contains("std::collections::VecDeque"));
        assert!(registry.contains("std::collections::HashMap"));
        assert!(registry.contains("triomphe::Arc"));
        assert!(registry.contains("std::sync::Arc"));
        assert!(!registry.contains("NonExistent"));
    }

    #[test]
    fn test_registry_custom_type() {
        let mut registry = TypeRegistry::new();
        registry.register(
            "my_crate::MyType",
            TypeDef::new("myCodec({0})", "MyType<{0}>").with_import("my-pkg/codecs", "myCodec"),
        );

        let template = registry.get("my_crate::MyType").unwrap();
        let td = template.resolve(vec![TypeDef::string()]);
        assert_eq!(td.to_codec_expr(), "myCodec(r.string)");
        assert_eq!(td.to_ts_type(), "MyType<string>");
    }

    #[test]
    fn test_registry_override_builtin() {
        let mut registry = TypeRegistry::with_builtins();
        registry.register(
            "uuid::Uuid",
            TypeDef::new("customUuid", "CustomUuid").with_import("my-pkg/uuid", "customUuid"),
        );

        let template = registry.get("uuid::Uuid").unwrap();
        let td = template.resolve(vec![]);
        assert_eq!(td.to_codec_expr(), "customUuid");
    }

    #[test]
    fn test_registry_unregister() {
        let mut registry = TypeRegistry::with_builtins();
        assert!(registry.contains("uuid::Uuid"));
        registry.unregister("uuid::Uuid");
        assert!(!registry.contains("uuid::Uuid"));
    }

    #[test]
    fn test_builtin_uuid() {
        let registry = TypeRegistry::with_builtins();
        let td = registry.get("uuid::Uuid").unwrap().resolve(vec![]);
        assert_eq!(td.to_codec_expr(), "uuid");
        assert_eq!(td.to_ts_type(), "string");
    }

    #[test]
    fn test_builtin_hashmap() {
        let registry = TypeRegistry::with_builtins();
        let td = registry
            .get("std::collections::HashMap")
            .unwrap()
            .resolve(vec![TypeDef::string(), TypeDef::u32()]);
        assert_eq!(td.to_codec_expr(), "hashMap(r.string, r.u32)");
        assert_eq!(td.to_ts_type(), "Map<string, number>");
    }

    #[test]
    fn test_builtin_hashbrown_hashmap() {
        let registry = TypeRegistry::with_builtins();
        let td = registry
            .get("hashbrown::HashMap")
            .unwrap()
            .resolve(vec![TypeDef::string(), TypeDef::u32()]);
        assert_eq!(td.to_codec_expr(), "hashMap(r.string, r.u32)");
        assert_eq!(td.to_ts_type(), "Map<string, number>");
    }

    #[test]
    fn test_builtin_hashbrown_hashset() {
        let registry = TypeRegistry::with_builtins();
        let td = registry
            .get("hashbrown::HashSet")
            .unwrap()
            .resolve(vec![TypeDef::string()]);
        assert_eq!(td.to_codec_expr(), "hashSet(r.string)");
        assert_eq!(td.to_ts_type(), "Set<string>");
    }

    #[test]
    fn test_builtin_smolstr() {
        let registry = TypeRegistry::with_builtins();
        let td = registry.get("smol_str::SmolStr").unwrap().resolve(vec![]);
        assert_eq!(td.to_codec_expr(), "r.string");
        assert_eq!(td.to_ts_type(), "string");
    }
}
