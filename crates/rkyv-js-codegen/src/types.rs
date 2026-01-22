//! Type definitions for the code generator.

/// Represents a Rust/rkyv type that can be converted to a TypeScript decoder.
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
    /// Generate the TypeScript decoder expression for this type.
    pub fn to_decoder_expr(&self) -> String {
        match self {
            TypeDef::U8 => "u8".to_string(),
            TypeDef::I8 => "i8".to_string(),
            TypeDef::U16 => "u16".to_string(),
            TypeDef::I16 => "i16".to_string(),
            TypeDef::U32 => "u32".to_string(),
            TypeDef::I32 => "i32".to_string(),
            TypeDef::U64 => "u64".to_string(),
            TypeDef::I64 => "i64".to_string(),
            TypeDef::F32 => "f32".to_string(),
            TypeDef::F64 => "f64".to_string(),
            TypeDef::Bool => "bool".to_string(),
            TypeDef::Char => "char".to_string(),
            TypeDef::Unit => "unit".to_string(),
            TypeDef::String => "string".to_string(),

            TypeDef::Vec(inner) => format!("vec({})", inner.to_decoder_expr()),
            TypeDef::Option(inner) => format!("option({})", inner.to_decoder_expr()),
            TypeDef::Box(inner) => format!("box_({})", inner.to_decoder_expr()),
            TypeDef::Array(inner, len) => format!("array({}, {})", inner.to_decoder_expr(), len),

            TypeDef::Tuple(elements) => {
                let exprs: Vec<_> = elements.iter().map(|t| t.to_decoder_expr()).collect();
                format!("tuple({})", exprs.join(", "))
            }

            TypeDef::HashMap(key, value) | TypeDef::BTreeMap(key, value) => {
                format!(
                    "hashMap({}, {})",
                    key.to_decoder_expr(),
                    value.to_decoder_expr()
                )
            }

            TypeDef::Named(name) => format!("{}Decoder", name),
        }
    }

    /// Generate the TypeScript encoder expression for this type.
    pub fn to_encoder_expr(&self) -> String {
        match self {
            TypeDef::U8 => "u8Encoder".to_string(),
            TypeDef::I8 => "i8Encoder".to_string(),
            TypeDef::U16 => "u16Encoder".to_string(),
            TypeDef::I16 => "i16Encoder".to_string(),
            TypeDef::U32 => "u32Encoder".to_string(),
            TypeDef::I32 => "i32Encoder".to_string(),
            TypeDef::U64 => "u64Encoder".to_string(),
            TypeDef::I64 => "i64Encoder".to_string(),
            TypeDef::F32 => "f32Encoder".to_string(),
            TypeDef::F64 => "f64Encoder".to_string(),
            TypeDef::Bool => "boolEncoder".to_string(),
            TypeDef::Char => "charEncoder".to_string(),
            TypeDef::Unit => "unitEncoder".to_string(),
            TypeDef::String => "stringEncoder".to_string(),

            TypeDef::Vec(inner) => format!("vecEncoder({})", inner.to_encoder_expr()),
            TypeDef::Option(inner) => format!("optionEncoder({})", inner.to_encoder_expr()),
            TypeDef::Box(inner) => format!("boxEncoder({})", inner.to_encoder_expr()),
            TypeDef::Array(inner, len) => {
                format!("arrayEncoder({}, {})", inner.to_encoder_expr(), len)
            }

            TypeDef::Tuple(elements) => {
                let exprs: Vec<_> = elements.iter().map(|t| t.to_encoder_expr()).collect();
                format!("tupleEncoder({})", exprs.join(", "))
            }

            TypeDef::HashMap(key, value) | TypeDef::BTreeMap(key, value) => {
                format!(
                    "hashMapEncoder({}, {})",
                    key.to_encoder_expr(),
                    value.to_encoder_expr()
                )
            }

            TypeDef::Named(name) => format!("{}Encoder", name),
        }
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
    fn test_primitive_decoder_expr() {
        assert_eq!(TypeDef::U32.to_decoder_expr(), "u32");
        assert_eq!(TypeDef::String.to_decoder_expr(), "string");
    }

    #[test]
    fn test_container_decoder_expr() {
        let vec_u32 = TypeDef::Vec(Box::new(TypeDef::U32));
        assert_eq!(vec_u32.to_decoder_expr(), "vec(u32)");

        let option_string = TypeDef::Option(Box::new(TypeDef::String));
        assert_eq!(option_string.to_decoder_expr(), "option(string)");
    }

    #[test]
    fn test_nested_decoder_expr() {
        let nested = TypeDef::Vec(Box::new(TypeDef::Option(Box::new(TypeDef::U32))));
        assert_eq!(nested.to_decoder_expr(), "vec(option(u32))");
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
    fn test_primitive_encoder_expr() {
        assert_eq!(TypeDef::U32.to_encoder_expr(), "u32Encoder");
        assert_eq!(TypeDef::String.to_encoder_expr(), "stringEncoder");
    }

    #[test]
    fn test_container_encoder_expr() {
        let vec_u32 = TypeDef::Vec(Box::new(TypeDef::U32));
        assert_eq!(vec_u32.to_encoder_expr(), "vecEncoder(u32Encoder)");

        let option_string = TypeDef::Option(Box::new(TypeDef::String));
        assert_eq!(
            option_string.to_encoder_expr(),
            "optionEncoder(stringEncoder)"
        );
    }

    #[test]
    fn test_nested_encoder_expr() {
        let nested = TypeDef::Vec(Box::new(TypeDef::Option(Box::new(TypeDef::U32))));
        assert_eq!(
            nested.to_encoder_expr(),
            "vecEncoder(optionEncoder(u32Encoder))"
        );
    }
}
