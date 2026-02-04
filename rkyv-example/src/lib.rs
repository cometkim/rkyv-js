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
pub use std::collections::{BTreeSet, HashMap, HashSet, VecDeque};
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

impl serde::Serialize for ArchivedPoint {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("Point", 2)?;
        s.serialize_field("x", &self.x.to_native())?;
        s.serialize_field("y", &self.y.to_native())?;
        s.end()
    }
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

impl serde::Serialize for ArchivedPerson {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("Person", 5)?;
        s.serialize_field("name", self.name.as_str())?;
        s.serialize_field("age", &self.age.to_native())?;
        s.serialize_field("email", &self.email.as_ref().map(|e| e.as_str()))?;
        s.serialize_field(
            "scores",
            &self
                .scores
                .iter()
                .map(|v| v.to_native())
                .collect::<Vec<_>>(),
        )?;
        s.serialize_field("active", &self.active)?;
        s.end()
    }
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

impl serde::Serialize for ArchivedMessage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        match self {
            ArchivedMessage::Quit => {
                let mut s = serializer.serialize_struct("Message", 2)?;
                s.serialize_field("tag", "Quit")?;
                s.serialize_field("value", &None::<()>)?;
                s.end()
            }
            ArchivedMessage::Move { x, y } => {
                #[derive(serde::Serialize)]
                struct MoveValue {
                    x: i32,
                    y: i32,
                }
                let mut s = serializer.serialize_struct("Message", 2)?;
                s.serialize_field("tag", "Move")?;
                s.serialize_field(
                    "value",
                    &MoveValue {
                        x: x.to_native(),
                        y: y.to_native(),
                    },
                )?;
                s.end()
            }
            ArchivedMessage::Write(text) => {
                #[derive(serde::Serialize)]
                struct WriteValue<'a> {
                    _0: &'a str,
                }
                let mut s = serializer.serialize_struct("Message", 2)?;
                s.serialize_field("tag", "Write")?;
                s.serialize_field("value", &WriteValue { _0: text.as_str() })?;
                s.end()
            }
            ArchivedMessage::ChangeColor(r, g, b) => {
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

impl serde::Serialize for ArchivedGameState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("GameState", 4)?;
        s.serialize_field("player_position", &self.player_position)?;
        s.serialize_field("health", &self.health.to_native())?;
        s.serialize_field(
            "inventory",
            &self
                .inventory
                .iter()
                .map(|v| v.as_str())
                .collect::<Vec<_>>(),
        )?;
        s.serialize_field("current_message", &self.current_message.as_ref())?;
        s.end()
    }
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

impl serde::Serialize for ArchivedUuidRecord {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("UuidRecord", 3)?;
        // ArchivedUuid stores bytes, convert to hyphenated string
        s.serialize_field(
            "id",
            &uuid::Uuid::from_bytes(self.id.into_bytes()).to_string(),
        )?;
        s.serialize_field("name", self.name.as_str())?;
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

impl serde::Serialize for ArchivedBytesMessage {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("BytesMessage", 2)?;
        s.serialize_field("payload", &self.payload.as_slice())?;
        s.serialize_field("checksum", &self.checksum.to_native())?;
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

impl serde::Serialize for ArchivedSmolStrConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("SmolStrConfig", 3)?;
        s.serialize_field("key", self.key.as_str())?;
        s.serialize_field("value", self.value.as_str())?;
        s.serialize_field("priority", &self.priority.to_native())?;
        s.end()
    }
}

/// A data container using thin_vec::ThinVec for stack-efficient storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct ThinVecData {
    pub items: ThinVec<u32>,
    pub labels: ThinVec<String>,
}

impl serde::Serialize for ArchivedThinVecData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("ThinVecData", 2)?;
        s.serialize_field(
            "items",
            &self.items.iter().map(|v| v.to_native()).collect::<Vec<_>>(),
        )?;
        s.serialize_field(
            "labels",
            &self.labels.iter().map(|v| v.as_str()).collect::<Vec<_>>(),
        )?;
        s.end()
    }
}

/// A buffer using arrayvec::ArrayVec for fixed-capacity inline storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct ArrayVecBuffer {
    pub data: ArrayVec<u32, 8>,
    pub name: String,
}

impl serde::Serialize for ArchivedArrayVecBuffer {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("ArrayVecBuffer", 2)?;
        s.serialize_field(
            "data",
            &self.data.iter().map(|v| v.to_native()).collect::<Vec<_>>(),
        )?;
        s.serialize_field("name", self.name.as_str())?;
        s.end()
    }
}

/// Data using smallvec::SmallVec for small-vector optimization.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct SmallVecData {
    pub items: SmallVec<[u32; 4]>,
    pub tags: SmallVec<[String; 2]>,
}

impl serde::Serialize for ArchivedSmallVecData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("SmallVecData", 2)?;
        s.serialize_field(
            "items",
            &self.items.iter().map(|v| v.to_native()).collect::<Vec<_>>(),
        )?;
        s.serialize_field(
            "tags",
            &self.tags.iter().map(|v| v.as_str()).collect::<Vec<_>>(),
        )?;
        s.end()
    }
}

/// Data using tinyvec::TinyVec for inline/heap hybrid storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(derive(Debug))]
pub struct TinyVecData {
    pub values: TinyVec<[u32; 4]>,
    pub enabled: bool,
}

impl serde::Serialize for ArchivedTinyVecData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("TinyVecData", 2)?;
        s.serialize_field(
            "values",
            &self
                .values
                .iter()
                .map(|v| v.to_native())
                .collect::<Vec<_>>(),
        )?;
        s.serialize_field("enabled", &self.enabled)?;
        s.end()
    }
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

impl serde::Serialize for ArchivedIndexMapConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            settings: Vec<(&'a str, u32)>,
            version: u32,
        }
        let inner = Inner {
            settings: self
                .settings
                .iter()
                .map(|(k, v)| (k.as_str(), v.to_native()))
                .collect(),
            version: self.version.to_native(),
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

impl serde::Serialize for ArchivedIndexSetTags {
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
            count: self.count.to_native(),
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

impl serde::Serialize for ArchivedArcShared {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("ArcShared", 2)?;
        s.serialize_field("shared_data", self.shared_data.as_str())?;
        s.serialize_field("local_data", &self.local_data.to_native())?;
        s.end()
    }
}

/// Configuration using std::collections::BTreeMap for sorted key order.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct BTreeMapConfig {
    pub settings: std::collections::BTreeMap<String, u32>,
    pub version: u32,
}

// Custom serde serializer for BTreeMapConfig
impl serde::Serialize for BTreeMapConfig {
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

impl serde::Serialize for ArchivedBTreeMapConfig {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            settings: Vec<(&'a str, u32)>,
            version: u32,
        }
        let inner = Inner {
            settings: self
                .settings
                .iter()
                .map(|(k, v)| (k.as_str(), v.to_native()))
                .collect(),
            version: self.version.to_native(),
        };
        inner.serialize(serializer)
    }
}

/// Data using std::collections::VecDeque for double-ended queue.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct VecDequeData {
    pub items: VecDeque<u32>,
    pub name: String,
}

impl serde::Serialize for ArchivedVecDequeData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        let mut s = serializer.serialize_struct("VecDequeData", 2)?;
        s.serialize_field(
            "items",
            &self.items.iter().map(|v| v.to_native()).collect::<Vec<_>>(),
        )?;
        s.serialize_field("name", self.name.as_str())?;
        s.end()
    }
}

/// Configuration using std::collections::HashMap.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(derive(Debug))]
pub struct HashMapData {
    pub entries: HashMap<String, u32>,
    pub name: String,
}

// Custom serde serializer for HashMapData to serialize as array of tuples
impl serde::Serialize for HashMapData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            entries: Vec<(&'a str, &'a u32)>,
            name: &'a str,
        }
        let inner = Inner {
            entries: self.entries.iter().map(|(k, v)| (k.as_str(), v)).collect(),
            name: &self.name,
        };
        inner.serialize(serializer)
    }
}

impl serde::Serialize for ArchivedHashMapData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            entries: Vec<(&'a str, u32)>,
            name: &'a str,
        }
        let inner = Inner {
            entries: self
                .entries
                .iter()
                .map(|(k, v)| (k.as_str(), v.to_native()))
                .collect(),
            name: self.name.as_str(),
        };
        inner.serialize(serializer)
    }
}

/// Unique items using std::collections::HashSet.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(derive(Debug))]
pub struct HashSetData {
    pub ids: HashSet<String>,
    pub count: u32,
}

// Custom serde serializer for HashSetData to serialize as array
impl serde::Serialize for HashSetData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            ids: Vec<&'a str>,
            count: u32,
        }
        let inner = Inner {
            ids: self.ids.iter().map(|s| s.as_str()).collect(),
            count: self.count,
        };
        inner.serialize(serializer)
    }
}

impl serde::Serialize for ArchivedHashSetData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            ids: Vec<&'a str>,
            count: u32,
        }
        let inner = Inner {
            ids: self.ids.iter().map(|s| s.as_str()).collect(),
            count: self.count.to_native(),
        };
        inner.serialize(serializer)
    }
}

/// Sorted unique items using std::collections::BTreeSet.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct BTreeSetData {
    pub values: BTreeSet<i64>,
    pub label: String,
}

// Custom serde serializer for BTreeSetData to serialize as array
impl serde::Serialize for BTreeSetData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            values: Vec<&'a i64>,
            label: &'a str,
        }
        let inner = Inner {
            values: self.values.iter().collect(),
            label: &self.label,
        };
        inner.serialize(serializer)
    }
}

impl serde::Serialize for ArchivedBTreeSetData {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        #[derive(serde::Serialize)]
        struct Inner<'a> {
            values: Vec<i64>,
            label: &'a str,
        }
        let inner = Inner {
            values: self.values.iter().map(|v| v.to_native()).collect(),
            label: self.label.as_str(),
        };
        inner.serialize(serializer)
    }
}
