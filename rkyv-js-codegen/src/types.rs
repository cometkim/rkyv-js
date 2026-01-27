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
}
