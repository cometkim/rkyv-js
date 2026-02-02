//! Example crate demonstrating rkyv-js-codegen usage.
//!
//! This crate shows how to define Rust types with rkyv serialization
//! and generate TypeScript bindings for them.
//!
//! The `#[derive(Archive)]` macro is a no-op annotation that serves
//! as documentation. The actual binding generation happens in build.rs
//! using `CodeGenerator`.

use rkyv::{Archive, Deserialize, Serialize};
use serde::ser::{SerializeStruct, Serializer};

// Re-export built-in crate types for use in fixtures
pub use arrayvec::ArrayVec;
pub use bytes::Bytes;
pub use indexmap::{IndexMap, IndexSet};
pub use smallvec::SmallVec;
pub use smol_str::SmolStr;
pub use thin_vec::ThinVec;
pub use tinyvec::TinyVec;
pub use triomphe::Arc;
pub use uuid::Uuid;

/// A simple 2D point.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// A person with various field types.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct Person {
    pub name: String,
    pub age: u32,
    pub email: Option<String>,
    pub scores: Vec<u32>,
    pub active: bool,
}

/// A message enum with different variant types.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub enum Message {
    /// No content
    Quit,
    /// Movement with coordinates
    Move { x: i32, y: i32 },
    /// A text message
    Write(String),
    /// RGB color change
    ChangeColor(u8, u8, u8),
}

// Custom serializer for Message to match the rkyv-js representation
impl serde::Serialize for Message {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            Message::Quit => {
                let mut s = serializer.serialize_struct("Message", 2)?;
                s.serialize_field("tag", "Quit")?;
                s.serialize_field("value", &None::<()>)?;
                s.end()
            }
            Message::Move { x, y } => {
                #[derive(serde::Serialize)]
                struct MoveValue {
                    x: i32,
                    y: i32,
                }
                let mut s = serializer.serialize_struct("Message", 2)?;
                s.serialize_field("tag", "Move")?;
                s.serialize_field("value", &MoveValue { x: *x, y: *y })?;
                s.end()
            }
            Message::Write(text) => {
                #[derive(serde::Serialize)]
                struct WriteValue<'a> {
                    _0: &'a str,
                }
                let mut s = serializer.serialize_struct("Message", 2)?;
                s.serialize_field("tag", "Write")?;
                s.serialize_field("value", &WriteValue { _0: text })?;
                s.end()
            }
            Message::ChangeColor(r, g, b) => {
                #[derive(serde::Serialize)]
                struct ChangeColorValue {
                    _0: u8,
                    _1: u8,
                    _2: u8,
                }
                let mut s = serializer.serialize_struct("Message", 2)?;
                s.serialize_field("tag", "ChangeColor")?;
                s.serialize_field(
                    "value",
                    &ChangeColorValue {
                        _0: *r,
                        _1: *g,
                        _2: *b,
                    },
                )?;
                s.end()
            }
        }
    }
}

/// Game state containing nested structures.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct GameState {
    pub player_position: Point,
    pub health: u32,
    pub inventory: Vec<String>,
    pub current_message: Option<Message>,
}

// ============================================================================
// Built-in crate types examples
// ============================================================================

/// A record with a UUID identifier.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct UuidRecord {
    pub id: Uuid,
    pub name: String,
    pub active: bool,
}

// Custom serde serializer for UuidRecord to format UUID as string
impl serde::Serialize for UuidRecord {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("UuidRecord", 3)?;
        s.serialize_field("id", &self.id.to_string())?;
        s.serialize_field("name", &self.name)?;
        s.serialize_field("active", &self.active)?;
        s.end()
    }
}

/// A message with binary payload using bytes::Bytes.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct BytesMessage {
    pub payload: Bytes,
    pub checksum: u32,
}

// Custom serde serializer for BytesMessage to serialize bytes as array
impl serde::Serialize for BytesMessage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("BytesMessage", 2)?;
        s.serialize_field("payload", &self.payload.to_vec())?;
        s.serialize_field("checksum", &self.checksum)?;
        s.end()
    }
}

/// A config entry using smol_str::SmolStr for small string optimization.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct SmolStrConfig {
    pub key: SmolStr,
    pub value: SmolStr,
    pub priority: u32,
}

/// A data container using thin_vec::ThinVec for stack-efficient storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct ThinVecData {
    pub items: ThinVec<u32>,
    pub labels: ThinVec<String>,
}

/// A buffer using arrayvec::ArrayVec for fixed-capacity inline storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct ArrayVecBuffer {
    pub data: ArrayVec<u32, 8>,
    pub name: String,
}

/// Data using smallvec::SmallVec for small-vector optimization.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct SmallVecData {
    pub items: SmallVec<[u32; 4]>,
    pub tags: SmallVec<[String; 2]>,
}

/// Data using tinyvec::TinyVec for inline/heap hybrid storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(derive(Debug))]
pub struct TinyVecData {
    pub values: TinyVec<[u32; 4]>,
    pub enabled: bool,
}

/// Configuration using indexmap::IndexMap to preserve insertion order.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct IndexMapConfig {
    pub settings: IndexMap<String, u32>,
    pub version: u32,
}

// Custom serde serializer for IndexMapConfig to preserve order
impl serde::Serialize for IndexMapConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            settings: Vec<(&'a str, &'a u32)>,
            version: u32,
        }
        let inner = Inner {
            settings: self.settings.iter().map(|(k, v)| (k.as_str(), v)).collect(),
            version: self.version,
        };
        inner.serialize(serializer)
    }
}

/// Tags using indexmap::IndexSet to preserve insertion order.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct IndexSetTags {
    pub tags: IndexSet<String>,
    pub count: u32,
}

// Custom serde serializer for IndexSetTags to preserve order
impl serde::Serialize for IndexSetTags {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            tags: Vec<&'a str>,
            count: u32,
        }
        let inner = Inner {
            tags: self.tags.iter().map(|s| s.as_str()).collect(),
            count: self.count,
        };
        inner.serialize(serializer)
    }
}

/// Shared data using triomphe::Arc for reference counting.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(derive(Debug))]
pub struct ArcShared {
    pub shared_data: Arc<String>,
    pub local_data: u32,
}
