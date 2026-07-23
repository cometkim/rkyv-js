//! Registries mapping Rust paths to codec templates.
//!
//! Two registries drive source extraction:
//!
//! - [`ExternalType`] maps a fully-qualified Rust *type* path (e.g. `uuid::Uuid`, `std::collections::HashMap`) 
//!   to a [`CodecExpr`] template.
//! - [`WithWrapper`] maps a `#[rkyv(with = ...)]` *wrapper* path (e.g. `rkyv::with::AsBox`)
//!   to a transformation of the underlying field codec.
//!
//! Both are keyed by fully-qualified path strings. 
//!
//! Unknown-path lookups produce a did-you-mean suggestion when a registered key shares the last path segment.

use std::collections::BTreeMap;

use crate::error::DiagnosticKind;
use crate::expr::{CodecExpr, codec};

/// A codec template for an external Rust type.
///
/// Templates are built once at registration time;
/// type arguments are filled in per use site via [`CodecExpr::Param`] placeholders.
#[derive(Debug, Clone)]
pub struct ExternalType {
    arity: usize,
    allow_trailing: bool,
    template: CodecExpr,
}

impl ExternalType {
    /// A type with no type parameters (e.g. `uuid::Uuid`).
    pub fn leaf(expr: CodecExpr) -> Self {
        Self {
            arity: 0,
            allow_trailing: false,
            template: expr,
        }
    }

    /// A type with one type parameter.
    /// The closure runs **once** with `Param(0)` to build the template.
    pub fn generic1(build: impl FnOnce(CodecExpr) -> CodecExpr) -> Self {
        Self::generic(1, |params| build(params[0].clone()))
    }

    /// A type with two type parameters.
    /// The closure runs **once** with `Param(0)` and `Param(1)`.
    pub fn generic2(build: impl FnOnce(CodecExpr, CodecExpr) -> CodecExpr) -> Self {
        Self::generic(2, |params| build(params[0].clone(), params[1].clone()))
    }

    /// A type with `arity` type parameters.
    /// The closure runs **once** with `[Param(0), ..., Param(arity - 1)]`.
    ///
    /// # Panics
    ///
    /// Panics if the produced template references a `Param` index `>= arity`.
    pub fn generic(arity: usize, build: impl FnOnce(&[CodecExpr]) -> CodecExpr) -> Self {
        let params: Vec<CodecExpr> = (0..arity).map(CodecExpr::Param).collect();
        let template = build(&params);
        if let Some(max) = template.max_param()
            && max >= arity
        {
            panic!(
                "ExternalType::generic template references Param({max}), but the declared \
                 arity is {arity}"
            );
        }
        Self {
            arity,
            allow_trailing: false,
            template,
        }
    }

    /// Accept (and ignore) extra trailing type arguments beyond the declared arity.
    /// e.g. the hasher parameter of `HashMap<K, V, S>`.
    pub fn allow_trailing_args(mut self) -> Self {
        self.allow_trailing = true;
        self
    }

    /// The number of type parameters the template consumes.
    pub(crate) fn arity(&self) -> usize {
        self.arity
    }

    /// Whether extra trailing type arguments are tolerated.
    pub(crate) fn allows_trailing(&self) -> bool {
        self.allow_trailing
    }

    /// Fill in the template with concrete type arguments.
    ///
    /// The argument count must match the declared arity exactly,
    /// unless [`allow_trailing_args`](ExternalType::allow_trailing_args) was set,
    /// in which case extra trailing arguments are ignored.
    ///
    /// The `rust_path` of a returned [`DiagnosticKind::GenericArity`] is left empty;
    /// the caller fills it in with the use-site path.
    pub(crate) fn instantiate(&self, args: Vec<CodecExpr>) -> Result<CodecExpr, DiagnosticKind> {
        let acceptable = args.len() == self.arity || (self.allow_trailing && args.len() > self.arity);
        if !acceptable {
            return Err(DiagnosticKind::GenericArity {
                rust_path: String::new(),
                expected: self.arity,
                found: args.len(),
            });
        }
        Ok(self.template.substitute(&args[..self.arity]))
    }
}

/// The behavior of a with-wrapper.
#[derive(Debug, Clone)]
enum WithWrapperKind {
    /// Emit a fixed expression, ignoring the underlying field type.
    Replace(CodecExpr),
    /// Transform the underlying field codec (template with `Param(0)`).
    Map(CodecExpr),
    /// Use the underlying field codec unchanged.
    Identity,
    /// Omit the field from the generated bindings entirely.
    Skip,
}

/// A handler for a `#[rkyv(with = W)]` field wrapper.
#[derive(Debug, Clone)]
pub struct WithWrapper {
    kind: WithWrapperKind,
}

impl WithWrapper {
    /// Emit `expr` for the field, ignoring the underlying Rust type
    /// (e.g. an `AsJson` wrapper backed by a custom codec).
    pub fn replace(expr: CodecExpr) -> Self {
        Self {
            kind: WithWrapperKind::Replace(expr),
        }
    }

    /// Transform the underlying field codec.
    /// The closure runs **once** with `Param(0)` standing in for the underlying codec expression.
    pub fn map(build: impl FnOnce(CodecExpr) -> CodecExpr) -> Self {
        Self {
            kind: WithWrapperKind::Map(build(CodecExpr::Param(0))),
        }
    }

    /// Use the underlying field codec unchanged (e.g. `rkyv::with::Inline`).
    pub fn identity() -> Self {
        Self {
            kind: WithWrapperKind::Identity,
        }
    }

    /// Omit the field entirely (`rkyv::with::Skip`).
    pub fn skip() -> Self {
        Self {
            kind: WithWrapperKind::Skip,
        }
    }

    /// Whether this wrapper needs the underlying field type resolved.
    pub(crate) fn needs_underlying(&self) -> bool {
        matches!(
            self.kind,
            WithWrapperKind::Map(_) | WithWrapperKind::Identity
        )
    }

    /// Apply the wrapper. `underlying` is only consulted for [`map`](WithWrapper::map) and [`identity`](WithWrapper::identity) wrappers;
    /// `None` is returned for [`skip`](WithWrapper::skip).
    pub(crate) fn apply(&self, underlying: Option<CodecExpr>) -> Option<CodecExpr> {
        match &self.kind {
            WithWrapperKind::Replace(expr) => Some(expr.clone()),
            WithWrapperKind::Map(template) => {
                let underlying = underlying.expect("map wrapper requires the underlying codec");
                Some(template.substitute(&[underlying]))
            }
            WithWrapperKind::Identity => {
                Some(underlying.expect("identity wrapper requires the underlying codec"))
            }
            WithWrapperKind::Skip => None,
        }
    }
}

/// The registries backing a [`CodeGenerator`](crate::CodeGenerator).
#[derive(Debug, Clone)]
pub(crate) struct Registry {
    types: BTreeMap<String, ExternalType>,
    wrappers: BTreeMap<String, WithWrapper>,
}

impl Registry {
    /// An empty registry.
    pub(crate) fn empty() -> Self {
        Self {
            types: BTreeMap::new(),
            wrappers: BTreeMap::new(),
        }
    }

    /// A registry pre-populated with the built-in rkyv mappings.
    pub(crate) fn with_builtins() -> Self {
        let mut registry = Self::empty();

        registry.register_type(
            "uuid::Uuid",
            ExternalType::leaf(CodecExpr::import_from("rkyv-js/lib/uuid", "uuid")),
        );
        registry.register_type(
            "bytes::Bytes",
            ExternalType::leaf(CodecExpr::import_from("rkyv-js/lib/bytes", "bytes")),
        );
        registry.register_type("smol_str::SmolStr", ExternalType::leaf(codec::string()));

        // Vec-shaped containers.
        registry.register_type(
            "std::collections::VecDeque",
            ExternalType::generic1(codec::vec),
        );
        registry.register_type("thin_vec::ThinVec", ExternalType::generic1(codec::vec));
        // `ArrayVec<T, N>`: the const-generic capacity is skipped during argument collection, but tolerate it anyway.
        registry.register_type(
            "arrayvec::ArrayVec",
            ExternalType::generic1(codec::vec).allow_trailing_args(),
        );
        // `SmallVec<[T; N]>` / `TinyVec<[T; N]>`: the array argument is unwrapped to `T` during argument collection.
        registry.register_type("smallvec::SmallVec", ExternalType::generic1(codec::vec));
        registry.register_type("tinyvec::TinyVec", ExternalType::generic1(codec::vec));

        // BTree collections.
        registry.register_type(
            "std::collections::BTreeMap",
            ExternalType::generic2(|k, v| {
                CodecExpr::call(CodecExpr::import_from("rkyv-js/lib/btreemap", "btreeMap"), [k, v])
            }),
        );
        registry.register_type(
            "std::collections::BTreeSet",
            ExternalType::generic1(|t| {
                CodecExpr::call(CodecExpr::import_from("rkyv-js/lib/btreemap", "btreeSet"), [t])
            }),
        );

        // Hash collections (trailing hasher parameter allowed).
        for path in ["std::collections::HashMap", "hashbrown::HashMap"] {
            registry.register_type(
                path,
                ExternalType::generic2(|k, v| {
                    CodecExpr::call(CodecExpr::import_from("rkyv-js/lib/hashmap", "hashMap"), [k, v])
                })
                .allow_trailing_args(),
            );
        }
        for path in ["std::collections::HashSet", "hashbrown::HashSet"] {
            registry.register_type(
                path,
                ExternalType::generic1(|t| {
                    CodecExpr::call(CodecExpr::import_from("rkyv-js/lib/hashmap", "hashSet"), [t])
                })
                .allow_trailing_args(),
            );
        }

        // Index collections (trailing hasher parameter allowed).
        registry.register_type(
            "indexmap::IndexMap",
            ExternalType::generic2(|k, v| {
                CodecExpr::call(CodecExpr::import_from("rkyv-js/lib/indexmap", "indexMap"), [k, v])
            })
            .allow_trailing_args(),
        );
        registry.register_type(
            "indexmap::IndexSet",
            ExternalType::generic1(|t| {
                CodecExpr::call(CodecExpr::import_from("rkyv-js/lib/indexmap", "indexSet"), [t])
            })
            .allow_trailing_args(),
        );

        // Shared pointers.
        for path in ["std::rc::Rc", "std::sync::Arc", "triomphe::Arc"] {
            registry.register_type(path, ExternalType::generic1(codec::rc));
        }
        for path in ["std::rc::Weak", "std::sync::Weak"] {
            registry.register_type(path, ExternalType::generic1(codec::weak));
        }

        // Built-in with-wrappers.
        registry.register_wrapper("rkyv::with::AsBox", WithWrapper::map(codec::boxed));
        registry.register_wrapper("rkyv::with::Inline", WithWrapper::identity());
        registry.register_wrapper("rkyv::with::InlineAsBox", WithWrapper::map(codec::boxed));
        registry.register_wrapper("rkyv::with::Skip", WithWrapper::skip());

        registry
    }

    pub(crate) fn register_type(&mut self, path: impl Into<String>, external: ExternalType) {
        self.types.insert(path.into(), external);
    }

    pub(crate) fn unregister_type(&mut self, path: &str) {
        self.types.remove(path);
    }

    pub(crate) fn get_type(&self, path: &str) -> Option<&ExternalType> {
        self.types.get(path)
    }

    pub(crate) fn register_wrapper(&mut self, path: impl Into<String>, wrapper: WithWrapper) {
        self.wrappers.insert(path.into(), wrapper);
    }

    pub(crate) fn get_wrapper(&self, path: &str) -> Option<&WithWrapper> {
        self.wrappers.get(path)
    }

    /// A registered type path sharing the last segment with `path`, if any.
    pub(crate) fn suggest_type(&self, path: &str) -> Option<String> {
        let last = path.rsplit("::").next()?;
        self.types
            .keys()
            .find(|key| key.rsplit("::").next() == Some(last))
            .cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap as Map;

    fn render(expr: &CodecExpr) -> String {
        expr.render(&Map::new()).unwrap()
    }

    #[test]
    fn leaf_instantiates_with_no_args() {
        let uuid = ExternalType::leaf(CodecExpr::import_from("rkyv-js/lib/uuid", "uuid"));
        let expr = uuid.instantiate(vec![]).unwrap();
        assert_eq!(render(&expr), "uuid");
    }

    #[test]
    fn generic1_builds_once_with_param0() {
        let vec_like = ExternalType::generic1(codec::vec);
        let expr = vec_like.instantiate(vec![codec::u32()]).unwrap();
        assert_eq!(render(&expr), "r.vec(r.u32)");
    }

    #[test]
    fn generic2_instantiates_in_order() {
        let map_like = ExternalType::generic2(|k, v| {
            CodecExpr::call(CodecExpr::import_from("m", "pair"), [k, v])
        });
        let expr = map_like
            .instantiate(vec![codec::string(), codec::u32()])
            .unwrap();
        assert_eq!(render(&expr), "pair(r.string, r.u32)");
    }

    #[test]
    fn too_few_args_is_an_arity_error() {
        let map_like = ExternalType::generic2(|k, v| {
            CodecExpr::call(CodecExpr::runtime("pair"), [k, v])
        });
        let err = map_like.instantiate(vec![codec::string()]).unwrap_err();
        assert!(matches!(
            err,
            DiagnosticKind::GenericArity {
                expected: 2,
                found: 1,
                ..
            }
        ));
    }

    #[test]
    fn too_many_args_is_an_arity_error_without_trailing() {
        let set_like = ExternalType::generic1(codec::vec);
        let err = set_like
            .instantiate(vec![codec::u8(), codec::u16()])
            .unwrap_err();
        assert!(matches!(
            err,
            DiagnosticKind::GenericArity {
                expected: 1,
                found: 2,
                ..
            }
        ));
    }

    #[test]
    fn trailing_args_are_ignored_when_allowed() {
        let map_like = ExternalType::generic2(|k, v| {
            CodecExpr::call(CodecExpr::import_from("m", "hashMap"), [k, v])
        })
        .allow_trailing_args();
        let expr = map_like
            .instantiate(vec![codec::string(), codec::u32(), codec::u8()])
            .unwrap();
        assert_eq!(render(&expr), "hashMap(r.string, r.u32)");
        // Too few args still fail even with trailing allowed.
        assert!(map_like.instantiate(vec![codec::string()]).is_err());
    }

    #[test]
    #[should_panic(expected = "references Param(1)")]
    fn generic_panics_on_out_of_range_param() {
        let _ = ExternalType::generic(1, |_| {
            CodecExpr::call(CodecExpr::runtime("x"), [CodecExpr::Param(1)])
        });
    }

    #[test]
    fn wrapper_replace_ignores_underlying() {
        let wrapper = WithWrapper::replace(CodecExpr::import_from("./coord.ts", "Coord"));
        assert!(!wrapper.needs_underlying());
        let expr = wrapper.apply(None).unwrap();
        assert_eq!(render(&expr), "Coord");
    }

    #[test]
    fn wrapper_map_transforms_underlying() {
        let wrapper = WithWrapper::map(codec::boxed);
        assert!(wrapper.needs_underlying());
        let expr = wrapper.apply(Some(codec::string())).unwrap();
        assert_eq!(render(&expr), "r.box(r.string)");
    }

    #[test]
    fn wrapper_identity_passes_through() {
        let wrapper = WithWrapper::identity();
        let expr = wrapper.apply(Some(codec::u32())).unwrap();
        assert_eq!(render(&expr), "r.u32");
    }

    #[test]
    fn wrapper_skip_omits() {
        let wrapper = WithWrapper::skip();
        assert!(!wrapper.needs_underlying());
        assert!(wrapper.apply(None).is_none());
    }

    #[test]
    fn builtins_are_registered() {
        let registry = Registry::with_builtins();
        for path in [
            "uuid::Uuid",
            "bytes::Bytes",
            "smol_str::SmolStr",
            "std::collections::VecDeque",
            "thin_vec::ThinVec",
            "arrayvec::ArrayVec",
            "smallvec::SmallVec",
            "tinyvec::TinyVec",
            "std::collections::BTreeMap",
            "std::collections::BTreeSet",
            "std::collections::HashMap",
            "std::collections::HashSet",
            "hashbrown::HashMap",
            "hashbrown::HashSet",
            "indexmap::IndexMap",
            "indexmap::IndexSet",
            "std::rc::Rc",
            "std::sync::Arc",
            "triomphe::Arc",
            "std::rc::Weak",
            "std::sync::Weak",
        ] {
            assert!(registry.get_type(path).is_some(), "missing builtin {path}");
        }
        for path in [
            "rkyv::with::AsBox",
            "rkyv::with::Inline",
            "rkyv::with::InlineAsBox",
            "rkyv::with::Skip",
        ] {
            assert!(registry.get_wrapper(path).is_some(), "missing wrapper {path}");
        }
    }

    #[test]
    fn hashmap_accepts_trailing_hasher() {
        let registry = Registry::with_builtins();
        let map = registry.get_type("std::collections::HashMap").unwrap();
        let expr = map
            .instantiate(vec![codec::string(), codec::u32(), CodecExpr::raw("S")])
            .unwrap();
        assert_eq!(render(&expr), "hashMap(r.string, r.u32)");
    }

    #[test]
    fn btreemap_rejects_trailing_args() {
        let registry = Registry::with_builtins();
        let map = registry.get_type("std::collections::BTreeMap").unwrap();
        let err = map
            .instantiate(vec![codec::string(), codec::u32(), CodecExpr::raw("S")])
            .unwrap_err();
        assert!(matches!(err, DiagnosticKind::GenericArity { .. }));
    }

    #[test]
    fn suggestion_matches_last_segment() {
        let registry = Registry::with_builtins();
        assert_eq!(
            registry.suggest_type("collections::HashMap"),
            Some("hashbrown::HashMap".to_string()),
        );
        assert_eq!(
            registry.suggest_type("other::Uuid"),
            Some("uuid::Uuid".to_string()),
        );
        assert_eq!(registry.suggest_type("chrono::NaiveDate"), None);
    }
}
