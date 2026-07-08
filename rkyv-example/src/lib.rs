//! Example crate demonstrating rkyv-js-codegen usage.
//!
//! Every type below derives `rkyv::Archive`; `build.rs` feeds this file to
//! [`rkyv_js_codegen::CodeGenerator`] and writes the matching TypeScript
//! codec bindings to `generated/bindings.ts`.

pub mod remote;

use rkyv::{Archive, Deserialize, Serialize};

use arrayvec::ArrayVec;
use bytes::Bytes;
use indexmap::{IndexMap, IndexSet};
use smallvec::SmallVec;
use smol_str::SmolStr;
use std::collections::{BTreeSet, VecDeque};
use thin_vec::ThinVec;
use tinyvec::TinyVec;
use triomphe::Arc;
use uuid::Uuid;

/// A deterministic `HashMap` using `DefaultHasher` (SipHash with fixed
/// keys), demonstrating that hasher-parameterized aliases resolve to the
/// `std` builtin.
pub type HashMap<K, V> =
    std::collections::HashMap<K, V, std::hash::BuildHasherDefault<std::hash::DefaultHasher>>;

/// A deterministic `HashSet` using `DefaultHasher` (SipHash with fixed keys).
pub type HashSet<T> =
    std::collections::HashSet<T, std::hash::BuildHasherDefault<std::hash::DefaultHasher>>;

/// A simple 2D point.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// A person with various field types.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
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

/// Game state containing nested structures.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
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

/// A message with binary payload using bytes::Bytes.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct BytesMessage {
    pub payload: Bytes,
    pub checksum: u32,
}

/// A config entry using smol_str::SmolStr for small string optimization.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct SmolStrConfig {
    pub key: SmolStr,
    pub value: SmolStr,
    pub priority: u32,
}

/// A data container using thin_vec::ThinVec for stack-efficient storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct ThinVecData {
    pub items: ThinVec<u32>,
    pub labels: ThinVec<String>,
}

/// A buffer using arrayvec::ArrayVec for fixed-capacity inline storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct ArrayVecBuffer {
    pub data: ArrayVec<u32, 8>,
    pub name: String,
}

/// Data using smallvec::SmallVec for small-vector optimization.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct SmallVecData {
    pub items: SmallVec<[u32; 4]>,
    pub tags: SmallVec<[String; 2]>,
}

/// Data using tinyvec::TinyVec for inline/heap hybrid storage.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
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

/// Tags using indexmap::IndexSet to preserve insertion order.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct IndexSetTags {
    pub tags: IndexSet<String>,
    pub count: u32,
}

/// Shared data using triomphe::Arc for reference counting.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(derive(Debug))]
pub struct ArcShared {
    pub shared_data: Arc<String>,
    pub local_data: u32,
}

/// Configuration using std::collections::BTreeMap for sorted key order.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct BTreeMapConfig {
    pub settings: std::collections::BTreeMap<String, u32>,
    pub version: u32,
}

/// Data using std::collections::VecDeque for double-ended queue.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct VecDequeData {
    pub items: VecDeque<u32>,
    pub name: String,
}

/// Configuration using std::collections::HashMap.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(derive(Debug))]
pub struct HashMapData {
    pub entries: HashMap<String, u32>,
    pub name: String,
}

/// Unique items using std::collections::HashSet.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(derive(Debug))]
pub struct HashSetData {
    pub ids: HashSet<String>,
    pub count: u32,
}

/// Sorted unique items using std::collections::BTreeSet.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct BTreeSetData {
    pub values: BTreeSet<i64>,
    pub label: String,
}

// ── Remote derive types ─────────────────────────────────────────────

/// An `ArchiveWith` wrapper that serializes any `serde::Serialize +
/// serde::Deserialize` type as a JSON string in the rkyv buffer.
///
/// The archived form is `ArchivedString` — a relative pointer + length
/// pointing to UTF-8 JSON text. This demonstrates that rkyv-js custom
/// codecs can use arbitrary wire formats, not just rkyv's own struct layout.
/// `build.rs` registers it with
/// `WithWrapper::replace(import { Coord } from './coord.ts')`.
pub struct AsJson;

impl rkyv::with::ArchiveWith<remote::Coord> for AsJson {
    type Archived = rkyv::string::ArchivedString;
    type Resolver = rkyv::string::StringResolver;

    fn resolve_with(
        field: &remote::Coord,
        resolver: Self::Resolver,
        out: rkyv::Place<Self::Archived>,
    ) {
        let json = serde_json::to_string(field).unwrap();
        rkyv::string::ArchivedString::resolve_from_str(&json, resolver, out);
    }
}

impl<S> rkyv::with::SerializeWith<remote::Coord, S> for AsJson
where
    S: rkyv::rancor::Fallible + ?Sized,
    S::Error: rkyv::rancor::Source,
    str: rkyv::SerializeUnsized<S>,
{
    fn serialize_with(
        field: &remote::Coord,
        serializer: &mut S,
    ) -> Result<Self::Resolver, S::Error> {
        let json = serde_json::to_string(field).map_err(rkyv::rancor::Source::new)?;
        rkyv::string::ArchivedString::serialize_from_str(&json, serializer)
    }
}

impl<D> rkyv::with::DeserializeWith<rkyv::string::ArchivedString, remote::Coord, D> for AsJson
where
    D: rkyv::rancor::Fallible + ?Sized,
    D::Error: rkyv::rancor::Source,
{
    fn deserialize_with(
        archived: &rkyv::string::ArchivedString,
        _deserializer: &mut D,
    ) -> Result<remote::Coord, D::Error> {
        serde_json::from_str(archived.as_str()).map_err(rkyv::rancor::Source::new)
    }
}

/// A struct that uses a remote type via an `AsJson` wrapper.
///
/// The codegen never inspects `remote::Coord` — the registered `AsJson`
/// wrapper replaces the field codec with the hand-written `Coord` codec
/// from `generated/coord.ts`.
#[derive(Debug, Clone, Archive, Deserialize, Serialize)]
#[rkyv(derive(Debug))]
pub struct RemoteEvent {
    pub name: String,
    #[rkyv(with = AsJson)]
    pub location: remote::Coord,
    pub priority: u32,
}
