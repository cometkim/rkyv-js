//! Canonical JSON for conformance goldens.
//!
//! One custom serde `Serializer` produces a `serde_json::Value` tree with
//! tagged encodings that a single generic JS reviver can reconstruct with no
//! type knowledge, and no precision loss:
//!
//! - `u64`/`i64`/`u128`/`i128` → `{"$bigint": "…"}` (JS decodes 64-bit ints
//!   as `bigint`; plain JSON numbers would lose precision past 2^53)
//! - non-finite floats → `{"$bits32"/"$bits64": "hex"}` (JSON has no NaN)
//! - finite floats → plain numbers (shortest round-trip is exact)
//! - byte strings → `{"$base64": "…"}`
//! - maps → `{"$map": [[k, v], …]}` in iteration order (keys are values,
//!   which plain JSON objects cannot express)
//! - enums → `{"tag": name, "value": …}`, matching the decoded JS shape:
//!   unit variants get `null`, single-field variants the inner value,
//!   multi-field tuple variants `{"_0": …, "_1": …}`
//! - everything else structural (structs → objects, seqs/tuples → arrays,
//!   Option → `null | value`, char → single-char string)

use base64::Engine as _;
use serde::ser::{self, Serialize};
use serde_json::{Map, Number, Value};

pub fn to_value<T: Serialize>(value: &T) -> Value {
    value
        .serialize(CanonicalSerializer)
        .expect("canonical serialization cannot fail")
}

pub fn to_string_pretty<T: Serialize>(value: &T) -> String {
    let mut out = serde_json::to_string_pretty(&to_value(value)).expect("valid json");
    out.push('\n');
    out
}

fn bigint(value: impl ToString) -> Value {
    let mut map = Map::new();
    map.insert("$bigint".into(), Value::String(value.to_string()));
    Value::Object(map)
}

type Error = serde::de::value::Error;

struct CanonicalSerializer;

impl ser::Serializer for CanonicalSerializer {
    type Ok = Value;
    type Error = Error;
    type SerializeSeq = SeqSerializer;
    type SerializeTuple = SeqSerializer;
    type SerializeTupleStruct = SeqSerializer;
    type SerializeTupleVariant = TupleVariantSerializer;
    type SerializeMap = MapSerializer;
    type SerializeStruct = StructSerializer;
    type SerializeStructVariant = StructVariantSerializer;

    fn serialize_bool(self, v: bool) -> Result<Value, Error> {
        Ok(Value::Bool(v))
    }

    fn serialize_i8(self, v: i8) -> Result<Value, Error> {
        Ok(Value::from(v))
    }
    fn serialize_i16(self, v: i16) -> Result<Value, Error> {
        Ok(Value::from(v))
    }
    fn serialize_i32(self, v: i32) -> Result<Value, Error> {
        Ok(Value::from(v))
    }
    fn serialize_i64(self, v: i64) -> Result<Value, Error> {
        Ok(bigint(v))
    }
    fn serialize_i128(self, v: i128) -> Result<Value, Error> {
        Ok(bigint(v))
    }

    fn serialize_u8(self, v: u8) -> Result<Value, Error> {
        Ok(Value::from(v))
    }
    fn serialize_u16(self, v: u16) -> Result<Value, Error> {
        Ok(Value::from(v))
    }
    fn serialize_u32(self, v: u32) -> Result<Value, Error> {
        Ok(Value::from(v))
    }
    fn serialize_u64(self, v: u64) -> Result<Value, Error> {
        Ok(bigint(v))
    }
    fn serialize_u128(self, v: u128) -> Result<Value, Error> {
        Ok(bigint(v))
    }

    fn serialize_f32(self, v: f32) -> Result<Value, Error> {
        if v.is_finite() {
            // f32 -> f64 is exact.
            Ok(Value::Number(Number::from_f64(v as f64).expect("finite")))
        } else {
            let mut map = Map::new();
            map.insert("$bits32".into(), Value::String(format!("{:08x}", v.to_bits())));
            Ok(Value::Object(map))
        }
    }

    fn serialize_f64(self, v: f64) -> Result<Value, Error> {
        if v.is_finite() {
            Ok(Value::Number(Number::from_f64(v).expect("finite")))
        } else {
            let mut map = Map::new();
            map.insert("$bits64".into(), Value::String(format!("{:016x}", v.to_bits())));
            Ok(Value::Object(map))
        }
    }

    fn serialize_char(self, v: char) -> Result<Value, Error> {
        Ok(Value::String(v.to_string()))
    }

    fn serialize_str(self, v: &str) -> Result<Value, Error> {
        Ok(Value::String(v.to_string()))
    }

    fn serialize_bytes(self, v: &[u8]) -> Result<Value, Error> {
        let mut map = Map::new();
        map.insert(
            "$base64".into(),
            Value::String(base64::engine::general_purpose::STANDARD.encode(v)),
        );
        Ok(Value::Object(map))
    }

    fn serialize_none(self) -> Result<Value, Error> {
        Ok(Value::Null)
    }

    fn serialize_some<T: Serialize + ?Sized>(self, value: &T) -> Result<Value, Error> {
        value.serialize(CanonicalSerializer)
    }

    fn serialize_unit(self) -> Result<Value, Error> {
        Ok(Value::Null)
    }

    fn serialize_unit_struct(self, _name: &'static str) -> Result<Value, Error> {
        Ok(Value::Null)
    }

    fn serialize_unit_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
    ) -> Result<Value, Error> {
        Ok(enum_value(variant, Value::Null))
    }

    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        value: &T,
    ) -> Result<Value, Error> {
        value.serialize(CanonicalSerializer)
    }

    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        value: &T,
    ) -> Result<Value, Error> {
        Ok(enum_value(variant, value.serialize(CanonicalSerializer)?))
    }

    fn serialize_seq(self, len: Option<usize>) -> Result<SeqSerializer, Error> {
        Ok(SeqSerializer { items: Vec::with_capacity(len.unwrap_or(0)) })
    }

    fn serialize_tuple(self, len: usize) -> Result<SeqSerializer, Error> {
        self.serialize_seq(Some(len))
    }

    fn serialize_tuple_struct(
        self,
        _name: &'static str,
        len: usize,
    ) -> Result<SeqSerializer, Error> {
        self.serialize_seq(Some(len))
    }

    fn serialize_tuple_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<TupleVariantSerializer, Error> {
        Ok(TupleVariantSerializer { variant, items: Vec::with_capacity(len) })
    }

    fn serialize_map(self, _len: Option<usize>) -> Result<MapSerializer, Error> {
        Ok(MapSerializer { entries: Vec::new(), pending_key: None })
    }

    fn serialize_struct(
        self,
        _name: &'static str,
        len: usize,
    ) -> Result<StructSerializer, Error> {
        Ok(StructSerializer { fields: Map::with_capacity(len) })
    }

    fn serialize_struct_variant(
        self,
        _name: &'static str,
        _index: u32,
        variant: &'static str,
        len: usize,
    ) -> Result<StructVariantSerializer, Error> {
        Ok(StructVariantSerializer { variant, fields: Map::with_capacity(len) })
    }
}

fn enum_value(variant: &str, value: Value) -> Value {
    let mut map = Map::new();
    map.insert("tag".into(), Value::String(variant.to_string()));
    map.insert("value".into(), value);
    Value::Object(map)
}

struct SeqSerializer {
    items: Vec<Value>,
}

impl ser::SerializeSeq for SeqSerializer {
    type Ok = Value;
    type Error = Error;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.items.push(value.serialize(CanonicalSerializer)?);
        Ok(())
    }

    fn end(self) -> Result<Value, Error> {
        Ok(Value::Array(self.items))
    }
}

impl ser::SerializeTuple for SeqSerializer {
    type Ok = Value;
    type Error = Error;

    fn serialize_element<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        ser::SerializeSeq::serialize_element(self, value)
    }

    fn end(self) -> Result<Value, Error> {
        ser::SerializeSeq::end(self)
    }
}

impl ser::SerializeTupleStruct for SeqSerializer {
    type Ok = Value;
    type Error = Error;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        ser::SerializeSeq::serialize_element(self, value)
    }

    fn end(self) -> Result<Value, Error> {
        ser::SerializeSeq::end(self)
    }
}

/// Multi-field tuple variants surface as `{tag, value: {"_0": …, "_1": …}}`
/// — the shape the JS enum codec decodes tuple variants into.
struct TupleVariantSerializer {
    variant: &'static str,
    items: Vec<Value>,
}

impl ser::SerializeTupleVariant for TupleVariantSerializer {
    type Ok = Value;
    type Error = Error;

    fn serialize_field<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        self.items.push(value.serialize(CanonicalSerializer)?);
        Ok(())
    }

    fn end(self) -> Result<Value, Error> {
        let mut fields = Map::with_capacity(self.items.len());
        for (i, item) in self.items.into_iter().enumerate() {
            fields.insert(format!("_{i}"), item);
        }
        Ok(enum_value(self.variant, Value::Object(fields)))
    }
}

/// Maps keep their keys as full values: `{"$map": [[k, v], …]}`.
struct MapSerializer {
    entries: Vec<Value>,
    pending_key: Option<Value>,
}

impl ser::SerializeMap for MapSerializer {
    type Ok = Value;
    type Error = Error;

    fn serialize_key<T: Serialize + ?Sized>(&mut self, key: &T) -> Result<(), Error> {
        self.pending_key = Some(key.serialize(CanonicalSerializer)?);
        Ok(())
    }

    fn serialize_value<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), Error> {
        let key = self.pending_key.take().expect("serialize_key before serialize_value");
        self.entries.push(Value::Array(vec![key, value.serialize(CanonicalSerializer)?]));
        Ok(())
    }

    fn end(self) -> Result<Value, Error> {
        let mut map = Map::new();
        map.insert("$map".into(), Value::Array(self.entries));
        Ok(Value::Object(map))
    }
}

struct StructSerializer {
    fields: Map<String, Value>,
}

impl ser::SerializeStruct for StructSerializer {
    type Ok = Value;
    type Error = Error;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.fields.insert(key.to_string(), value.serialize(CanonicalSerializer)?);
        Ok(())
    }

    fn end(self) -> Result<Value, Error> {
        Ok(Value::Object(self.fields))
    }
}

struct StructVariantSerializer {
    variant: &'static str,
    fields: Map<String, Value>,
}

impl ser::SerializeStructVariant for StructVariantSerializer {
    type Ok = Value;
    type Error = Error;

    fn serialize_field<T: Serialize + ?Sized>(
        &mut self,
        key: &'static str,
        value: &T,
    ) -> Result<(), Error> {
        self.fields.insert(key.to_string(), value.serialize(CanonicalSerializer)?);
        Ok(())
    }

    fn end(self) -> Result<Value, Error> {
        Ok(enum_value(self.variant, Value::Object(self.fields)))
    }
}
