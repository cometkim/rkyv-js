//! Type definitions for the code generator.

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

    // Map types
    HashMap(Box<TypeDef>, Box<TypeDef>),
    BTreeMap(Box<TypeDef>, Box<TypeDef>),

    // Reference to a named type (struct or enum)
    Named(String),

    // Built-in crate types (r.lib.*)
    Lib(LibTypeDef),
}

/// Types from external crates supported by rkyv's built-in integrations.
///
/// These map to `r.lib.*` codecs in TypeScript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LibTypeDef {
    /// uuid::Uuid - 128-bit UUID (uuid-1 feature)
    Uuid,

    /// bytes::Bytes - Byte buffer (bytes-1 feature)
    Bytes,

    /// smol_str::SmolStr - Small-string optimized type (smol_str-0_2/0_3 feature)
    SmolStr,

    /// thin_vec::ThinVec<T> - Stack-efficient Vec (thin-vec-0_2 feature)
    ThinVec(Box<TypeDef>),

    /// arrayvec::ArrayVec<T, CAP> - Fixed capacity inline vector (arrayvec-0_7 feature)
    /// The capacity is compile-time only and not used in the archived format.
    ArrayVec(Box<TypeDef>, usize),

    /// smallvec::SmallVec<[T; N]> - Small-vector optimization (smallvec-1 feature)
    /// The inline capacity is compile-time only and not used in the archived format.
    SmallVec(Box<TypeDef>, usize),

    /// tinyvec::TinyVec<[T; N]> - Enum of inline array or heap Vec (tinyvec-1 feature)
    TinyVec(Box<TypeDef>, usize),

    /// tinyvec::ArrayVec<[T; N]> - Fixed capacity inline array (tinyvec-1 feature)
    TinyArrayVec(Box<TypeDef>, usize),

    /// indexmap::IndexMap<K, V> - Insertion-order preserving hash map (indexmap-2 feature)
    IndexMap(Box<TypeDef>, Box<TypeDef>),

    /// indexmap::IndexSet<T> - Insertion-order preserving hash set (indexmap-2 feature)
    IndexSet(Box<TypeDef>),

    /// triomphe::Arc<T> - Thread-safe reference-counted pointer (triomphe-0_1 feature)
    Arc(Box<TypeDef>),

    /// std::rc::Rc<T> - Reference-counted pointer (alloc feature)
    Rc(Box<TypeDef>),

    /// std::rc::Weak<T> - Weak reference to Rc data (alloc feature)
    RcWeak(Box<TypeDef>),

    /// std::sync::Weak<T> - Weak reference to Arc data (alloc feature)
    ArcWeak(Box<TypeDef>),
}

impl TypeDef {
    /// Generate the unified codec expression using the `r.*` API.
    pub fn to_codec_expr(&self) -> String {
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
            TypeDef::Option(inner) => format!("r.optional({})", inner.to_codec_expr()),
            TypeDef::Box(inner) => format!("r.box({})", inner.to_codec_expr()),
            TypeDef::Array(inner, len) => format!("r.array({}, {})", inner.to_codec_expr(), len),

            TypeDef::Tuple(elements) => {
                let exprs: Vec<_> = elements.iter().map(|t| t.to_codec_expr()).collect();
                format!("r.tuple({})", exprs.join(", "))
            }

            TypeDef::HashMap(key, value) | TypeDef::BTreeMap(key, value) => {
                format!(
                    "r.hashMap({}, {})",
                    key.to_codec_expr(),
                    value.to_codec_expr()
                )
            }

            TypeDef::Named(name) => format!("Archived{}", name),

            TypeDef::Lib(lib_type) => lib_type.to_codec_expr(),
        }
    }

    /// Generate the TypeScript decoder expression for this type.
    /// @deprecated Use to_codec_expr() instead
    pub fn to_decoder_expr(&self) -> String {
        self.to_codec_expr()
    }

    /// Generate the TypeScript encoder expression for this type.
    /// @deprecated Use to_codec_expr() instead
    pub fn to_encoder_expr(&self) -> String {
        self.to_codec_expr()
    }

    /// Generate the TypeScript type for values decoded by this type.
    pub fn to_ts_type(&self) -> String {
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

            TypeDef::HashMap(key, value) | TypeDef::BTreeMap(key, value) => {
                format!("Map<{}, {}>", key.to_ts_type(), value.to_ts_type())
            }

            TypeDef::Named(name) => name.clone(),

            TypeDef::Lib(lib_type) => lib_type.to_ts_type(),
        }
    }

    /// Collect all lib imports required by this type (recursively).
    pub fn collect_lib_imports(&self, imports: &mut std::collections::HashSet<LibImport>) {
        match self {
            TypeDef::Vec(inner)
            | TypeDef::Option(inner)
            | TypeDef::Box(inner)
            | TypeDef::Array(inner, _) => {
                inner.collect_lib_imports(imports);
            }
            TypeDef::Tuple(elements) => {
                for elem in elements {
                    elem.collect_lib_imports(imports);
                }
            }
            TypeDef::HashMap(k, v) | TypeDef::BTreeMap(k, v) => {
                k.collect_lib_imports(imports);
                v.collect_lib_imports(imports);
            }
            TypeDef::Lib(lib_type) => {
                if let Some(import) = lib_type.required_import() {
                    imports.insert(import);
                }
                // Also recurse into inner types
                match lib_type {
                    LibTypeDef::ThinVec(inner)
                    | LibTypeDef::ArrayVec(inner, _)
                    | LibTypeDef::SmallVec(inner, _)
                    | LibTypeDef::TinyVec(inner, _)
                    | LibTypeDef::TinyArrayVec(inner, _)
                    | LibTypeDef::IndexSet(inner)
                    | LibTypeDef::Arc(inner)
                    | LibTypeDef::Rc(inner)
                    | LibTypeDef::RcWeak(inner)
                    | LibTypeDef::ArcWeak(inner) => {
                        inner.collect_lib_imports(imports);
                    }
                    LibTypeDef::IndexMap(k, v) => {
                        k.collect_lib_imports(imports);
                        v.collect_lib_imports(imports);
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
}

/// Represents which lib module needs to be imported
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum LibImport {
    Uuid,
    Bytes,
    IndexMap,
}

impl LibTypeDef {
    /// Generate the codec expression for built-in crate types.
    ///
    /// Many external crate types archive to the same format as built-in types:
    /// - SmolStr -> r.string
    /// - ThinVec<T>, ArrayVec<T, N>, SmallVec<[T; N]>, TinyVec<[T; N]>, TinyArrayVec<[T; N]> -> r.vec(T)
    /// - Arc<T> -> r.box(T)
    ///
    /// Only types with unique archive formats need dedicated imports:
    /// - Uuid -> uuid (from rkyv-js/lib/uuid)
    /// - Bytes -> bytes (from rkyv-js/lib/bytes)
    /// - IndexMap<K, V> -> indexMap(K, V) (from rkyv-js/lib/indexmap)
    /// - IndexSet<T> -> indexSet(T) (from rkyv-js/lib/indexmap)
    pub fn to_codec_expr(&self) -> String {
        match self {
            // Unique archive formats - use dedicated imports
            LibTypeDef::Uuid => "uuid".to_string(),
            LibTypeDef::Bytes => "bytes".to_string(),
            LibTypeDef::IndexMap(key, value) => {
                format!(
                    "indexMap({}, {})",
                    key.to_codec_expr(),
                    value.to_codec_expr()
                )
            }
            LibTypeDef::IndexSet(inner) => {
                format!("indexSet({})", inner.to_codec_expr())
            }

            // Same archive format as r.string
            LibTypeDef::SmolStr => "r.string".to_string(),

            // Same archive format as r.vec(T)
            LibTypeDef::ThinVec(inner)
            | LibTypeDef::ArrayVec(inner, _)
            | LibTypeDef::SmallVec(inner, _)
            | LibTypeDef::TinyVec(inner, _)
            | LibTypeDef::TinyArrayVec(inner, _) => {
                format!("r.vec({})", inner.to_codec_expr())
            }

            // Shared pointers - aliases for r.box / r.weak with same binary format
            LibTypeDef::Arc(inner) => {
                format!("r.arc({})", inner.to_codec_expr())
            }
            LibTypeDef::Rc(inner) => {
                format!("r.rc({})", inner.to_codec_expr())
            }
            LibTypeDef::RcWeak(inner) => {
                format!("r.rcWeak({})", inner.to_codec_expr())
            }
            LibTypeDef::ArcWeak(inner) => {
                format!("r.arcWeak({})", inner.to_codec_expr())
            }
        }
    }

    /// Get the lib import required for this type, if any.
    pub fn required_import(&self) -> Option<LibImport> {
        match self {
            LibTypeDef::Uuid => Some(LibImport::Uuid),
            LibTypeDef::Bytes => Some(LibImport::Bytes),
            LibTypeDef::IndexMap(_, _) | LibTypeDef::IndexSet(_) => Some(LibImport::IndexMap),
            // These map to intrinsics, no lib import needed
            LibTypeDef::SmolStr
            | LibTypeDef::ThinVec(_)
            | LibTypeDef::ArrayVec(_, _)
            | LibTypeDef::SmallVec(_, _)
            | LibTypeDef::TinyVec(_, _)
            | LibTypeDef::TinyArrayVec(_, _)
            | LibTypeDef::Arc(_)
            | LibTypeDef::Rc(_)
            | LibTypeDef::RcWeak(_)
            | LibTypeDef::ArcWeak(_) => None,
        }
    }

    /// Generate the TypeScript type for built-in crate types.
    pub fn to_ts_type(&self) -> String {
        match self {
            LibTypeDef::Uuid => "string".to_string(),
            LibTypeDef::Bytes => "Uint8Array".to_string(),
            LibTypeDef::SmolStr => "string".to_string(),
            LibTypeDef::ThinVec(inner) => format!("{}[]", inner.to_ts_type()),
            LibTypeDef::ArrayVec(inner, _) => format!("{}[]", inner.to_ts_type()),
            LibTypeDef::SmallVec(inner, _) => format!("{}[]", inner.to_ts_type()),
            LibTypeDef::TinyVec(inner, _) => format!("{}[]", inner.to_ts_type()),
            LibTypeDef::TinyArrayVec(inner, _) => format!("{}[]", inner.to_ts_type()),
            LibTypeDef::IndexMap(key, value) => {
                format!("Map<{}, {}>", key.to_ts_type(), value.to_ts_type())
            }
            LibTypeDef::IndexSet(inner) => format!("Set<{}>", inner.to_ts_type()),
            LibTypeDef::Arc(inner) => inner.to_ts_type(),
            LibTypeDef::Rc(inner) => inner.to_ts_type(),
            LibTypeDef::RcWeak(inner) => format!("{} | null", inner.to_ts_type()),
            LibTypeDef::ArcWeak(inner) => format!("{} | null", inner.to_ts_type()),
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
        assert_eq!(option_string.to_codec_expr(), "r.optional(r.string)");
    }

    #[test]
    fn test_nested_codec_expr() {
        let nested = TypeDef::Vec(Box::new(TypeDef::Option(Box::new(TypeDef::U32))));
        assert_eq!(nested.to_codec_expr(), "r.vec(r.optional(r.u32))");
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
    fn test_hashmap_codec_expr() {
        let map = TypeDef::HashMap(Box::new(TypeDef::String), Box::new(TypeDef::U32));
        assert_eq!(map.to_codec_expr(), "r.hashMap(r.string, r.u32)");
    }

    #[test]
    fn test_lib_uuid_codec_expr() {
        let uuid = TypeDef::Lib(LibTypeDef::Uuid);
        assert_eq!(uuid.to_codec_expr(), "uuid");
        assert_eq!(uuid.to_ts_type(), "string");
    }

    #[test]
    fn test_lib_bytes_codec_expr() {
        let bytes = TypeDef::Lib(LibTypeDef::Bytes);
        assert_eq!(bytes.to_codec_expr(), "bytes");
        assert_eq!(bytes.to_ts_type(), "Uint8Array");
    }

    #[test]
    fn test_lib_smol_str_codec_expr() {
        // SmolStr archives to the same format as String
        let smol_str = TypeDef::Lib(LibTypeDef::SmolStr);
        assert_eq!(smol_str.to_codec_expr(), "r.string");
        assert_eq!(smol_str.to_ts_type(), "string");
    }

    #[test]
    fn test_lib_thin_vec_codec_expr() {
        // ThinVec archives to the same format as Vec
        let thin_vec = TypeDef::Lib(LibTypeDef::ThinVec(Box::new(TypeDef::U32)));
        assert_eq!(thin_vec.to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(thin_vec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_lib_arrayvec_codec_expr() {
        // ArrayVec archives to the same format as Vec
        let arrayvec = TypeDef::Lib(LibTypeDef::ArrayVec(Box::new(TypeDef::U32), 8));
        assert_eq!(arrayvec.to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(arrayvec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_lib_smallvec_codec_expr() {
        // SmallVec archives to the same format as Vec
        let smallvec = TypeDef::Lib(LibTypeDef::SmallVec(Box::new(TypeDef::U32), 4));
        assert_eq!(smallvec.to_codec_expr(), "r.vec(r.u32)");
        assert_eq!(smallvec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_lib_tinyvec_codec_expr() {
        // TinyVec archives to the same format as Vec
        let tinyvec = TypeDef::Lib(LibTypeDef::TinyVec(Box::new(TypeDef::String), 4));
        assert_eq!(tinyvec.to_codec_expr(), "r.vec(r.string)");
        assert_eq!(tinyvec.to_ts_type(), "string[]");
    }

    #[test]
    fn test_lib_tiny_arrayvec_codec_expr() {
        // TinyArrayVec archives to the same format as Vec
        let tiny_arrayvec = TypeDef::Lib(LibTypeDef::TinyArrayVec(Box::new(TypeDef::U8), 16));
        assert_eq!(tiny_arrayvec.to_codec_expr(), "r.vec(r.u8)");
        assert_eq!(tiny_arrayvec.to_ts_type(), "number[]");
    }

    #[test]
    fn test_lib_indexmap_codec_expr() {
        let indexmap = TypeDef::Lib(LibTypeDef::IndexMap(
            Box::new(TypeDef::String),
            Box::new(TypeDef::U32),
        ));
        assert_eq!(indexmap.to_codec_expr(), "indexMap(r.string, r.u32)");
        assert_eq!(indexmap.to_ts_type(), "Map<string, number>");
    }

    #[test]
    fn test_lib_indexset_codec_expr() {
        let indexset = TypeDef::Lib(LibTypeDef::IndexSet(Box::new(TypeDef::String)));
        assert_eq!(indexset.to_codec_expr(), "indexSet(r.string)");
        assert_eq!(indexset.to_ts_type(), "Set<string>");
    }

    #[test]
    fn test_lib_arc_codec_expr() {
        // Arc uses r.arc alias (same binary format as r.box)
        let arc = TypeDef::Lib(LibTypeDef::Arc(Box::new(TypeDef::Named(
            "Config".to_string(),
        ))));
        assert_eq!(arc.to_codec_expr(), "r.arc(ArchivedConfig)");
        assert_eq!(arc.to_ts_type(), "Config");
    }

    #[test]
    fn test_lib_rc_codec_expr() {
        // Rc uses r.rc alias (same binary format as r.box)
        let rc = TypeDef::Lib(LibTypeDef::Rc(Box::new(TypeDef::String)));
        assert_eq!(rc.to_codec_expr(), "r.rc(r.string)");
        assert_eq!(rc.to_ts_type(), "string");
    }

    #[test]
    fn test_lib_weak_codec_expr() {
        // RcWeak uses r.rcWeak alias, ArcWeak uses r.arcWeak alias
        let rc_weak = TypeDef::Lib(LibTypeDef::RcWeak(Box::new(TypeDef::U32)));
        assert_eq!(rc_weak.to_codec_expr(), "r.rcWeak(r.u32)");
        assert_eq!(rc_weak.to_ts_type(), "number | null");

        let arc_weak = TypeDef::Lib(LibTypeDef::ArcWeak(Box::new(TypeDef::String)));
        assert_eq!(arc_weak.to_codec_expr(), "r.arcWeak(r.string)");
        assert_eq!(arc_weak.to_ts_type(), "string | null");
    }
}
