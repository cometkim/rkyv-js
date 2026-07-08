//! Typed TypeScript expression tree for codec bindings.
//!
//! Every codec expression the generator emits is built from [`CodecExpr`]
//! nodes instead of format strings. The tree knows which named imports it
//! needs, which generated types it references, and how to render itself to
//! TypeScript source.

use std::collections::{BTreeMap, BTreeSet};

use crate::error::DiagnosticKind;

/// A named import contributed by a [`CodecExpr::Import`] node.
///
/// # Example
///
/// ```
/// use rkyv_js_codegen::Import;
///
/// let import = Import::new("rkyv-js/lib/uuid", "uuid");
/// assert_eq!(import.module, "rkyv-js/lib/uuid");
/// assert_eq!(import.export, "uuid");
/// ```
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct Import {
    /// The module specifier to import from (e.g. `"rkyv-js/lib/uuid"`).
    pub module: String,
    /// The named export to import (e.g. `"uuid"`).
    pub export: String,
}

impl Import {
    /// Create a new named import.
    pub fn new(module: impl Into<String>, export: impl Into<String>) -> Self {
        Self {
            module: module.into(),
            export: export.into(),
        }
    }
}

/// A TypeScript codec expression.
///
/// Expressions are composed structurally; rendering happens once at
/// [`generate`](crate::CodeGenerator::generate) time, when all generated type
/// names are known.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum CodecExpr {
    /// A member of the core `rkyv-js` namespace import: `Runtime("u32")`
    /// renders as `r.u32`.
    Runtime(&'static str),
    /// A named import; renders as the bare export name and contributes an
    /// entry to the generated import block.
    Import(Import),
    /// A reference to a generated type by its *Rust* name. Resolved to the
    /// archived (exported) name at `generate()` time.
    TypeRef(String),
    /// A call expression: `callee(args...)`.
    Call(Box<CodecExpr>, Vec<CodecExpr>),
    /// An object literal `{ k: v, ... }` — used for enum variant records.
    Object(Vec<(String, CodecExpr)>),
    /// An integer literal (array lengths).
    LitInt(u64),
    /// A placeholder inside registry templates, replaced by
    /// [`substitute`](CodecExpr::substitute).
    Param(usize),
    /// Escape hatch: verbatim TypeScript. Never inspected for imports or
    /// type references.
    Raw(String),
}

impl CodecExpr {
    /// A member of the core namespace import (`r.{name}`).
    pub fn runtime(name: &'static str) -> Self {
        CodecExpr::Runtime(name)
    }

    /// A named import from an arbitrary module.
    pub fn import_from(module: impl Into<String>, export: impl Into<String>) -> Self {
        CodecExpr::Import(Import::new(module, export))
    }

    /// A reference to a generated type by its Rust name.
    pub fn type_ref(name: impl Into<String>) -> Self {
        CodecExpr::TypeRef(name.into())
    }

    /// A call expression `callee(args...)`.
    pub fn call(callee: CodecExpr, args: impl IntoIterator<Item = CodecExpr>) -> Self {
        CodecExpr::Call(Box::new(callee), args.into_iter().collect())
    }

    /// An object literal `{ k: v, ... }`.
    pub fn object(
        entries: impl IntoIterator<Item = (impl Into<String>, CodecExpr)>,
    ) -> Self {
        CodecExpr::Object(entries.into_iter().map(|(k, v)| (k.into(), v)).collect())
    }

    /// Verbatim TypeScript. The generator never inspects the contents.
    pub fn raw(ts: impl Into<String>) -> Self {
        CodecExpr::Raw(ts.into())
    }

    /// Replace every [`CodecExpr::Param`] `i` with `args[i]`.
    ///
    /// Parameters without a matching argument are left in place; the registry
    /// checks arity before substituting.
    pub fn substitute(&self, args: &[CodecExpr]) -> CodecExpr {
        match self {
            CodecExpr::Param(i) => args.get(*i).cloned().unwrap_or(CodecExpr::Param(*i)),
            CodecExpr::Call(callee, call_args) => CodecExpr::Call(
                Box::new(callee.substitute(args)),
                call_args.iter().map(|a| a.substitute(args)).collect(),
            ),
            CodecExpr::Object(entries) => CodecExpr::Object(
                entries
                    .iter()
                    .map(|(k, v)| (k.clone(), v.substitute(args)))
                    .collect(),
            ),
            other => other.clone(),
        }
    }

    /// Walk the expression tree in pre-order, calling `f` on every node.
    ///
    /// [`CodecExpr::Raw`] contents are never inspected (the node itself is
    /// still visited).
    pub fn visit(&self, f: &mut impl FnMut(&CodecExpr)) {
        f(self);
        match self {
            CodecExpr::Call(callee, args) => {
                callee.visit(f);
                for arg in args {
                    arg.visit(f);
                }
            }
            CodecExpr::Object(entries) => {
                for (_, v) in entries {
                    v.visit(f);
                }
            }
            _ => {}
        }
    }

    /// The highest [`CodecExpr::Param`] index in the tree, if any.
    pub fn max_param(&self) -> Option<usize> {
        let mut max: Option<usize> = None;
        self.visit(&mut |node| {
            if let CodecExpr::Param(i) = node {
                max = Some(max.map_or(*i, |m| m.max(*i)));
            }
        });
        max
    }

    /// Collect every [`Import`] referenced by the tree.
    pub(crate) fn collect_imports(&self, into: &mut BTreeSet<Import>) {
        self.visit(&mut |node| {
            if let CodecExpr::Import(import) = node {
                into.insert(import.clone());
            }
        });
    }

    /// Collect every [`CodecExpr::TypeRef`] name in the tree.
    pub(crate) fn collect_type_refs(&self, into: &mut BTreeSet<String>) {
        self.visit(&mut |node| {
            if let CodecExpr::TypeRef(name) = node {
                into.insert(name.clone());
            }
        });
    }

    /// Render the expression to TypeScript source.
    ///
    /// `archived_names` maps Rust type names to their exported archived
    /// names. A [`CodecExpr::TypeRef`] missing from the map produces
    /// [`DiagnosticKind::UnresolvedTypeRef`].
    pub fn render(
        &self,
        archived_names: &BTreeMap<String, String>,
    ) -> Result<String, DiagnosticKind> {
        match self {
            CodecExpr::Runtime(name) => Ok(format!("r.{name}")),
            CodecExpr::Import(import) => Ok(import.export.clone()),
            CodecExpr::TypeRef(name) => archived_names.get(name).cloned().ok_or_else(|| {
                DiagnosticKind::UnresolvedTypeRef { name: name.clone() }
            }),
            CodecExpr::Call(callee, args) => {
                let callee = callee.render(archived_names)?;
                let args = args
                    .iter()
                    .map(|a| a.render(archived_names))
                    .collect::<Result<Vec<_>, _>>()?;
                Ok(format!("{}({})", callee, args.join(", ")))
            }
            CodecExpr::Object(entries) => {
                if entries.is_empty() {
                    return Ok("{}".to_string());
                }
                let entries = entries
                    .iter()
                    .map(|(k, v)| Ok(format!("{}: {}", k, v.render(archived_names)?)))
                    .collect::<Result<Vec<_>, DiagnosticKind>>()?;
                Ok(format!("{{ {} }}", entries.join(", ")))
            }
            CodecExpr::LitInt(n) => Ok(n.to_string()),
            CodecExpr::Param(i) => panic!(
                "CodecExpr::Param({i}) escaped template instantiation; registry templates \
                 must be instantiated before rendering"
            ),
            CodecExpr::Raw(ts) => Ok(ts.clone()),
        }
    }
}

/// Builders mirroring the `rkyv-js` runtime combinators.
///
/// # Example
///
/// ```
/// use rkyv_js_codegen::codec;
/// use std::collections::BTreeMap;
///
/// let expr = codec::vec(codec::option(codec::u32()));
/// assert_eq!(expr.render(&BTreeMap::new()).unwrap(), "r.vec(r.option(r.u32))");
/// ```
pub mod codec {
    use super::CodecExpr;

    /// `r.u8`
    pub fn u8() -> CodecExpr {
        CodecExpr::runtime("u8")
    }
    /// `r.i8`
    pub fn i8() -> CodecExpr {
        CodecExpr::runtime("i8")
    }
    /// `r.u16`
    pub fn u16() -> CodecExpr {
        CodecExpr::runtime("u16")
    }
    /// `r.i16`
    pub fn i16() -> CodecExpr {
        CodecExpr::runtime("i16")
    }
    /// `r.u32`
    pub fn u32() -> CodecExpr {
        CodecExpr::runtime("u32")
    }
    /// `r.i32`
    pub fn i32() -> CodecExpr {
        CodecExpr::runtime("i32")
    }
    /// `r.u64`
    pub fn u64() -> CodecExpr {
        CodecExpr::runtime("u64")
    }
    /// `r.i64`
    pub fn i64() -> CodecExpr {
        CodecExpr::runtime("i64")
    }
    /// `r.f32`
    pub fn f32() -> CodecExpr {
        CodecExpr::runtime("f32")
    }
    /// `r.f64`
    pub fn f64() -> CodecExpr {
        CodecExpr::runtime("f64")
    }
    /// `r.bool`
    pub fn bool_() -> CodecExpr {
        CodecExpr::runtime("bool")
    }
    /// `r.char`
    pub fn char_() -> CodecExpr {
        CodecExpr::runtime("char")
    }
    /// `r.unit`
    pub fn unit() -> CodecExpr {
        CodecExpr::runtime("unit")
    }
    /// `r.string`
    pub fn string() -> CodecExpr {
        CodecExpr::runtime("string")
    }
    /// `r.vec(inner)`
    pub fn vec(inner: CodecExpr) -> CodecExpr {
        CodecExpr::call(CodecExpr::runtime("vec"), [inner])
    }
    /// `r.option(inner)`
    pub fn option(inner: CodecExpr) -> CodecExpr {
        CodecExpr::call(CodecExpr::runtime("option"), [inner])
    }
    /// `r.box(inner)`
    pub fn boxed(inner: CodecExpr) -> CodecExpr {
        CodecExpr::call(CodecExpr::runtime("box"), [inner])
    }
    /// `r.rc(inner)`
    pub fn rc(inner: CodecExpr) -> CodecExpr {
        CodecExpr::call(CodecExpr::runtime("rc"), [inner])
    }
    /// `r.weak(inner)`
    pub fn weak(inner: CodecExpr) -> CodecExpr {
        CodecExpr::call(CodecExpr::runtime("weak"), [inner])
    }
    /// `r.array(inner, len)`
    pub fn array(inner: CodecExpr, len: u64) -> CodecExpr {
        CodecExpr::call(CodecExpr::runtime("array"), [inner, CodecExpr::LitInt(len)])
    }
    /// `r.tuple(e0, e1, ...)` — the empty tuple is `r.unit`.
    pub fn tuple(elems: impl IntoIterator<Item = CodecExpr>) -> CodecExpr {
        let elems: Vec<_> = elems.into_iter().collect();
        if elems.is_empty() {
            unit()
        } else {
            CodecExpr::call(CodecExpr::runtime("tuple"), elems)
        }
    }
    /// A reference to a generated type by its Rust name; resolved to the
    /// archived name at `generate()` time.
    pub fn named(rust_name: impl Into<String>) -> CodecExpr {
        CodecExpr::type_ref(rust_name)
    }
}

/// Generate the import block for a set of expressions.
///
/// Always starts with `import * as r from 'rkyv-js';`, followed by named
/// imports grouped by module and sorted by module specifier (exports sorted
/// within each statement).
///
/// The same export name imported from two different modules is reported as
/// [`DiagnosticKind::ImportConflict`].
pub fn generate_import_block<'a>(
    exprs: impl IntoIterator<Item = &'a CodecExpr>,
) -> Result<String, Vec<DiagnosticKind>> {
    let mut imports: BTreeSet<Import> = BTreeSet::new();
    for expr in exprs {
        expr.collect_imports(&mut imports);
    }

    // Detect the same export name pulled from different modules.
    let mut export_modules: BTreeMap<&str, BTreeSet<&str>> = BTreeMap::new();
    for import in &imports {
        export_modules
            .entry(&import.export)
            .or_default()
            .insert(&import.module);
    }
    let conflicts: Vec<DiagnosticKind> = export_modules
        .iter()
        .filter(|(_, modules)| modules.len() > 1)
        .map(|(export, modules)| DiagnosticKind::ImportConflict {
            export: export.to_string(),
            modules: modules.iter().map(|m| m.to_string()).collect(),
        })
        .collect();
    if !conflicts.is_empty() {
        return Err(conflicts);
    }

    let mut by_module: BTreeMap<&str, Vec<&str>> = BTreeMap::new();
    for import in &imports {
        by_module
            .entry(&import.module)
            .or_default()
            .push(&import.export);
    }

    let mut output = String::from("import * as r from 'rkyv-js';\n");
    for (module, exports) in by_module {
        output.push_str(&format!(
            "import {{ {} }} from '{}';\n",
            exports.join(", "),
            module
        ));
    }
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn render(expr: &CodecExpr) -> String {
        expr.render(&BTreeMap::new()).unwrap()
    }

    #[test]
    fn renders_primitives() {
        assert_eq!(render(&codec::u8()), "r.u8");
        assert_eq!(render(&codec::u64()), "r.u64");
        assert_eq!(render(&codec::bool_()), "r.bool");
        assert_eq!(render(&codec::char_()), "r.char");
        assert_eq!(render(&codec::unit()), "r.unit");
        assert_eq!(render(&codec::string()), "r.string");
    }

    #[test]
    fn renders_containers() {
        assert_eq!(render(&codec::vec(codec::u32())), "r.vec(r.u32)");
        assert_eq!(render(&codec::option(codec::string())), "r.option(r.string)");
        assert_eq!(render(&codec::boxed(codec::u64())), "r.box(r.u64)");
        assert_eq!(render(&codec::rc(codec::string())), "r.rc(r.string)");
        assert_eq!(render(&codec::weak(codec::u32())), "r.weak(r.u32)");
        assert_eq!(render(&codec::array(codec::u16(), 4)), "r.array(r.u16, 4)");
        assert_eq!(
            render(&codec::tuple([codec::u8(), codec::string()])),
            "r.tuple(r.u8, r.string)"
        );
        assert_eq!(render(&codec::tuple([])), "r.unit");
    }

    #[test]
    fn renders_nested() {
        let expr = codec::vec(codec::option(codec::vec(codec::u16())));
        assert_eq!(render(&expr), "r.vec(r.option(r.vec(r.u16)))");
    }

    #[test]
    fn renders_object() {
        let expr = CodecExpr::object([("a", codec::u8()), ("b", codec::u32())]);
        assert_eq!(render(&expr), "{ a: r.u8, b: r.u32 }");
        assert_eq!(render(&CodecExpr::Object(Vec::new())), "{}");
    }

    #[test]
    fn renders_import_and_raw() {
        let expr = CodecExpr::call(
            CodecExpr::import_from("rkyv-js/lib/hashmap", "hashMap"),
            [codec::string(), codec::u32()],
        );
        assert_eq!(render(&expr), "hashMap(r.string, r.u32)");
        assert_eq!(render(&CodecExpr::raw("myCustom(r.u8)")), "myCustom(r.u8)");
    }

    #[test]
    fn renders_type_ref_via_map() {
        let mut names = BTreeMap::new();
        names.insert("Point".to_string(), "ArchivedPoint".to_string());
        let expr = codec::vec(codec::named("Point"));
        assert_eq!(expr.render(&names).unwrap(), "r.vec(ArchivedPoint)");
    }

    #[test]
    fn missing_type_ref_is_an_error() {
        let expr = codec::named("Missing");
        let err = expr.render(&BTreeMap::new()).unwrap_err();
        assert!(matches!(
            err,
            DiagnosticKind::UnresolvedTypeRef { ref name } if name == "Missing"
        ));
    }

    #[test]
    fn substitute_replaces_params() {
        let template = codec::vec(CodecExpr::Param(0));
        let out = template.substitute(&[codec::u32()]);
        assert_eq!(render(&out), "r.vec(r.u32)");

        let template = CodecExpr::call(
            CodecExpr::import_from("m", "pair"),
            [CodecExpr::Param(0), CodecExpr::Param(1)],
        );
        let out = template.substitute(&[codec::string(), codec::u8()]);
        assert_eq!(render(&out), "pair(r.string, r.u8)");
    }

    #[test]
    fn substitute_inside_objects() {
        let template = CodecExpr::object([("inner", CodecExpr::Param(0))]);
        let out = template.substitute(&[codec::u8()]);
        assert_eq!(render(&out), "{ inner: r.u8 }");
    }

    #[test]
    fn max_param_walks_the_tree() {
        assert_eq!(codec::u8().max_param(), None);
        let expr = CodecExpr::call(
            CodecExpr::runtime("x"),
            [CodecExpr::Param(0), codec::vec(CodecExpr::Param(3))],
        );
        assert_eq!(expr.max_param(), Some(3));
    }

    #[test]
    fn raw_is_never_inspected() {
        let expr = CodecExpr::raw("hashMap(r.u8)");
        let mut imports = BTreeSet::new();
        expr.collect_imports(&mut imports);
        assert!(imports.is_empty());
        let mut refs = BTreeSet::new();
        expr.collect_type_refs(&mut refs);
        assert!(refs.is_empty());
        assert_eq!(expr.max_param(), None);
    }

    #[test]
    fn import_block_groups_and_sorts() {
        let exprs = [
            CodecExpr::import_from("rkyv-js/lib/indexmap", "indexSet"),
            CodecExpr::import_from("rkyv-js/lib/indexmap", "indexMap"),
            CodecExpr::import_from("rkyv-js/lib/bytes", "bytes"),
            codec::u8(),
        ];
        let block = generate_import_block(exprs.iter()).unwrap();
        assert_eq!(
            block,
            "import * as r from 'rkyv-js';\n\
             import { bytes } from 'rkyv-js/lib/bytes';\n\
             import { indexMap, indexSet } from 'rkyv-js/lib/indexmap';\n"
        );
    }

    #[test]
    fn import_block_dedups() {
        let exprs = [
            CodecExpr::import_from("rkyv-js/lib/uuid", "uuid"),
            CodecExpr::import_from("rkyv-js/lib/uuid", "uuid"),
        ];
        let block = generate_import_block(exprs.iter()).unwrap();
        assert_eq!(
            block,
            "import * as r from 'rkyv-js';\nimport { uuid } from 'rkyv-js/lib/uuid';\n"
        );
    }

    #[test]
    fn import_block_detects_conflicts() {
        let exprs = [
            CodecExpr::import_from("pkg-a", "codec"),
            CodecExpr::import_from("pkg-b", "codec"),
        ];
        let errs = generate_import_block(exprs.iter()).unwrap_err();
        assert_eq!(errs.len(), 1);
        assert!(matches!(
            &errs[0],
            DiagnosticKind::ImportConflict { export, modules }
                if export == "codec" && modules == &vec!["pkg-a".to_string(), "pkg-b".to_string()]
        ));
    }

    #[test]
    #[should_panic(expected = "escaped template instantiation")]
    fn rendering_a_param_panics() {
        let _ = CodecExpr::Param(0).render(&BTreeMap::new());
    }
}
