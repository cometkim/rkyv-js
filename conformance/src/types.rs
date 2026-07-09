//! Case types for the conformance suite. Every type is defined exactly once
//! and shared by `generate` (Rust → golden files) and `verify` (JS output →
//! Rust checks). `generate` also feeds this file to rkyv-js-codegen to
//! produce `cases/bindings.ts`, so the derives are written out per type
//! (macro-generated items are invisible to source-level extraction).
//!
//! Hash containers use a pinned, zero-key SipHasher13 so their iteration
//! order is process-stable (std's `DefaultHasher` is randomly seeded).
//! Iteration order still varies with std's internal hashbrown layout
//! across Rust toolchains, so the golden `data.json` never depends on it:
//! unordered containers serialize through
//! `canonical_json::sorted_map`/`sorted_set`. The archived `data.bin`
//! placement is independent of iteration order and of this hasher (rkyv's
//! derive/std impls always use FxHasher64 over the key set). The one
//! exception is [`SipKeyedMap`], which archives with a custom hasher on
//! purpose to pin the JS side's pluggable-hasher support.

use std::hash::BuildHasherDefault;
use std::rc::{Rc, Weak};

use rkyv::collections::swiss_table::map::{ArchivedHashMap, HashMapResolver};
use rkyv::rancor::{Fallible, Source};
use rkyv::ser::{Allocator, Writer};
use rkyv::string::ArchivedString;
use rkyv::{Archive, Archived, Deserialize, Place, Serialize};
use siphasher::sip::SipHasher13;

pub type FixedState = BuildHasherDefault<siphasher::sip::SipHasher13>;
pub type HashMap<K, V> = std::collections::HashMap<K, V, FixedState>;
pub type HashSet<T> = std::collections::HashSet<T, FixedState>;

pub fn hash_map<K: std::hash::Hash + Eq, V>(entries: impl IntoIterator<Item = (K, V)>) -> HashMap<K, V> {
    let mut map = HashMap::default();
    for (k, v) in entries {
        map.insert(k, v);
    }
    map
}

pub fn hash_set<T: std::hash::Hash + Eq>(items: impl IntoIterator<Item = T>) -> HashSet<T> {
    let mut set = HashSet::default();
    for item in items {
        set.insert(item);
    }
    set
}

// ============================================================================
// Primitives
// ============================================================================

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct Primitives {
    pub a: u8,
    pub b: i8,
    pub c: u16,
    pub d: i16,
    pub e: u32,
    pub f: i32,
    pub g: u64,
    pub h: i64,
    pub i: f32,
    pub j: f64,
    pub k: bool,
    pub l: char,
}

#[derive(Archive, Serialize, Deserialize, Debug, serde::Serialize)]
pub struct FloatSpecials {
    pub nan32: f32,
    pub nan64: f64,
    pub pos_inf: f64,
    pub neg_inf: f32,
    pub pos_zero: f64,
    pub neg_zero: f64,
    pub subnormal32: f32,
    pub subnormal64: f64,
}

// Bit-pattern equality: NaN == NaN must hold, and -0.0 != +0.0 must fail.
impl PartialEq for FloatSpecials {
    fn eq(&self, other: &Self) -> bool {
        self.nan32.to_bits() == other.nan32.to_bits()
            && self.nan64.to_bits() == other.nan64.to_bits()
            && self.pos_inf.to_bits() == other.pos_inf.to_bits()
            && self.neg_inf.to_bits() == other.neg_inf.to_bits()
            && self.pos_zero.to_bits() == other.pos_zero.to_bits()
            && self.neg_zero.to_bits() == other.neg_zero.to_bits()
            && self.subnormal32.to_bits() == other.subnormal32.to_bits()
            && self.subnormal64.to_bits() == other.subnormal64.to_bits()
    }
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct Strings {
    pub empty: String,
    pub one: String,
    pub seven: String,
    pub eight: String,
    pub nine: String,
    pub sixty_three: String,
    pub sixty_four: String,
    pub long: String,
    pub multibyte: String,
    pub astral: String,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct Options {
    pub none_int: Option<u32>,
    pub some_int: Option<u32>,
    pub none_str: Option<String>,
    pub some_str: Option<String>,
    // NOTE: Some(None) is not representable in the JS value model
    // (T | null collapses it); nested options are tested as
    // Some(Some(_)) and None only.
    pub nested: Option<Option<u8>>,
    pub nested_none: Option<Option<u8>>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct Vecs {
    pub empty: Vec<u32>,
    pub one: Vec<u32>,
    pub many: Vec<u32>,
    pub strings: Vec<String>,
    pub structs: Vec<Point>,
    pub nested: Vec<Vec<u16>>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct ArraysTuples {
    pub arr: [u16; 4],
    pub arr_str: [String; 2],
    pub tup: (u8, String, f64),
    pub pair: (u32, u32),
}

// ============================================================================
// Enums
// ============================================================================

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub enum UnitOnly {
    A,
    B,
    C,
}

/// The audit's smoking gun: variants whose first field has smaller alignment
/// than the widest field. repr(u8) flattens fields directly after the tag.
#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub enum MixedAlign {
    V { a: u8, b: u32 },
    W { a: u32, b: u64 },
    X(u64),
    Y,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub enum TupleVariants {
    Color(u8, u8, u8),
    Wrap(String),
    Empty,
}

// NOTE: rkyv's derive rejects enums with more than 256 variants (u8
// discriminant only); the JS taggedEnum enforces the same limit.

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct EnumCases {
    pub unit: UnitOnly,
    pub mixed_v: MixedAlign,
    pub mixed_w: MixedAlign,
    pub mixed_x: MixedAlign,
    pub mixed_y: MixedAlign,
    pub tuple_variant: TupleVariants,
    pub wrap: TupleVariants,
    pub in_option: Option<MixedAlign>,
}

// ============================================================================
// Pointers
// ============================================================================

/// std Weak has no serde impl; serialize as `Option<T>` via upgrade — the
/// exact shape the JS `weak` codec decodes to (`T | null`).
fn serde_weak<T: serde::Serialize, S: serde::Serializer>(
    weak: &Weak<T>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    match weak.upgrade() {
        Some(rc) => serializer.serialize_some(&*rc),
        None => serializer.serialize_none(),
    }
}

fn serde_triomphe<T: serde::Serialize, S: serde::Serializer>(
    arc: &triomphe::Arc<T>,
    serializer: S,
) -> Result<S::Ok, S::Error> {
    T::serialize(arc, serializer)
}

#[derive(Archive, Serialize, Deserialize, Debug, serde::Serialize)]
pub struct Pointers {
    pub boxed: Box<String>,
    pub boxed_int: Box<u64>,
    pub rc: Rc<String>,
    #[serde(serialize_with = "serde_weak")]
    pub weak_dead: Weak<u32>,
}

// std Weak has no PartialEq; compare by upgraded value.
impl PartialEq for Pointers {
    fn eq(&self, other: &Self) -> bool {
        self.boxed == other.boxed
            && self.boxed_int == other.boxed_int
            && self.rc == other.rc
            && self.weak_dead.upgrade().map(|rc| *rc) == other.weak_dead.upgrade().map(|rc| *rc)
    }
}

/// Two Rcs to the SAME allocation: rkyv dedups these on the Rust side;
/// rkyv-js writes one copy per occurrence. Semantic-class only.
#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct SharedRc {
    pub a: Rc<String>,
    pub b: Rc<String>,
}

// NOTE: there is deliberately no live-Weak case. rkyv-js does not dedup
// shared pointers on encode, so a JS-encoded live `Weak` points at its own
// copy of the target; Rust's deserializer drops that temporary Rc and the
// weak comes out dangling. The wire is valid, but sharing identity is lost —
// a documented v1 limitation. Dead weaks are covered by `pointers`.

// ============================================================================
// Hash collections
// ============================================================================

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct HashMapStr {
    #[serde(serialize_with = "crate::canonical_json::sorted_map")]
    pub m: HashMap<String, u32>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct HashMapU32 {
    #[serde(serialize_with = "crate::canonical_json::sorted_map")]
    pub m: HashMap<u32, u32>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct HashMapU64 {
    #[serde(serialize_with = "crate::canonical_json::sorted_map")]
    pub m: HashMap<u64, String>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct HashMapI32 {
    #[serde(serialize_with = "crate::canonical_json::sorted_map")]
    pub m: HashMap<i32, bool>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct HashMapTupleKey {
    #[serde(serialize_with = "crate::canonical_json::sorted_map")]
    pub m: HashMap<(String, u32), bool>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct CompositeKey {
    pub id: u32,
    pub name: String,
}

// Struct keys need Hash + Eq on both the native and archived types.
#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, Eq, Hash, serde::Serialize)]
#[rkyv(derive(Hash, PartialEq, Eq))]
pub struct StructKey {
    pub id: u32,
    pub tag: String,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct HashMapStructKey {
    #[serde(serialize_with = "crate::canonical_json::sorted_map")]
    pub m: HashMap<StructKey, u32>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct HashSetStr {
    #[serde(serialize_with = "crate::canonical_json::sorted_set")]
    pub s: HashSet<String>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct HashSetU32 {
    #[serde(serialize_with = "crate::canonical_json::sorted_set")]
    pub s: HashSet<u32>,
}

// ============================================================================
// Custom archived hasher
// ============================================================================

/// A map archived with `H = SipHasher13` instead of rkyv's default
/// `FxHasher64`, through manual impls mirroring rkyv's own `HashMap` impls
/// (`rkyv/src/impls/std/collections/hash_map.rs`). Bucket placement on the
/// wire and archived `get()` both depend on `H`, so this pins the JS side's
/// pluggable `hasher` option against real rkyv bytes.
#[derive(Debug, PartialEq, serde::Serialize)]
pub struct SipKeyedMap(
    #[serde(serialize_with = "crate::canonical_json::sorted_map")] pub HashMap<String, u32>,
);

impl Archive for SipKeyedMap {
    type Archived = ArchivedHashMap<ArchivedString, Archived<u32>, SipHasher13>;
    type Resolver = HashMapResolver;

    fn resolve(&self, resolver: Self::Resolver, out: Place<Self::Archived>) {
        ArchivedHashMap::resolve_from_len(self.0.len(), (7, 8), resolver, out);
    }
}

impl<S> Serialize<S> for SipKeyedMap
where
    S: Fallible + Writer + Allocator + ?Sized,
    S::Error: Source,
{
    fn serialize(&self, serializer: &mut S) -> Result<Self::Resolver, S::Error> {
        ArchivedHashMap::<ArchivedString, Archived<u32>, SipHasher13>::serialize_from_iter::<
            _,
            _,
            _,
            String,
            u32,
            S,
        >(self.0.iter(), (7, 8), serializer)
    }
}

impl<D> Deserialize<SipKeyedMap, D>
    for ArchivedHashMap<ArchivedString, Archived<u32>, SipHasher13>
where
    D: Fallible + ?Sized,
{
    fn deserialize(&self, deserializer: &mut D) -> Result<SipKeyedMap, D::Error> {
        let mut result = HashMap::default();
        for (k, v) in self.iter() {
            result.insert(k.deserialize(deserializer)?, v.deserialize(deserializer)?);
        }
        Ok(SipKeyedMap(result))
    }
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct SipHashedMap {
    pub m: SipKeyedMap,
}

// ============================================================================
// Index collections
// ============================================================================

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct IndexMapStr {
    pub m: indexmap::IndexMap<String, u32>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct IndexMapU32 {
    pub m: indexmap::IndexMap<u32, String>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct IndexSetStr {
    pub s: indexmap::IndexSet<String>,
}

// ============================================================================
// BTree collections
// ============================================================================

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct BTreeMapStr {
    pub m: std::collections::BTreeMap<String, u32>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct BTreeMapU32 {
    pub m: std::collections::BTreeMap<u32, String>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct BTreeSetStr {
    pub s: std::collections::BTreeSet<String>,
}

// ============================================================================
// External crate types
// ============================================================================

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct ExternalTypes {
    pub id: uuid::Uuid,
    pub payload: bytes::Bytes,
    pub small_name: smol_str::SmolStr,
    pub thin: thin_vec::ThinVec<u32>,
    pub array_vec: arrayvec::ArrayVec<u32, 8>,
    pub small_vec: smallvec::SmallVec<[u32; 4]>,
    pub tiny_vec: tinyvec::TinyVec<[u32; 4]>,
    pub deque: std::collections::VecDeque<u32>,
    #[serde(serialize_with = "serde_triomphe")]
    pub shared: triomphe::Arc<String>,
}

// ============================================================================
// Kitchen sink
// ============================================================================

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct Inventory {
    pub items: Vec<String>,
    #[serde(serialize_with = "crate::canonical_json::sorted_map")]
    pub counts: HashMap<String, u32>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct KitchenSink {
    pub id: uuid::Uuid,
    pub name: String,
    pub position: Point,
    pub health: Option<u32>,
    pub state: MixedAlign,
    pub inventory: Inventory,
    pub tags: indexmap::IndexSet<String>,
    pub settings: std::collections::BTreeMap<String, i64>,
    pub history: Vec<TupleVariants>,
    pub parent: Option<Box<KitchenSinkRef>>,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct KitchenSinkRef {
    pub id: uuid::Uuid,
    pub name: String,
}
