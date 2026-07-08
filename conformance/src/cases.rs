//! The conformance case registry: one `case!` line per case.
//!
//! Each case pins one value of one type. `generate` writes
//! `cases/<name>/{data.bin, data.json, meta.json}`; the JS test suite decodes
//! data.bin, compares against data.json, re-encodes, and writes `js.bin`;
//! `verify` then checks js.bin with real rkyv.

use std::fmt::Debug;
use std::io;
use std::path::Path;
use std::rc::{Rc, Weak};

use rkyv::api::high::{HighDeserializer, HighSerializer, HighValidator};
use rkyv::bytecheck::CheckBytes;
use rkyv::rancor::Error;
use rkyv::ser::allocator::ArenaHandle;
use rkyv::util::AlignedVec;
use rkyv::{Archive, Deserialize, Portable, Serialize};

use crate::canonical_json;
use crate::types::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Class {
    /// JS re-encoding must be byte-identical to the Rust golden.
    Identical,
    /// JS re-encoding must be semantically equal (bytecheck + PartialEq +
    /// lookups), but bytes may differ (hash iteration order, shared-pointer
    /// dedup).
    Semantic,
}

impl Class {
    pub fn as_str(self) -> &'static str {
        match self {
            Class::Identical => "identical",
            Class::Semantic => "semantic",
        }
    }
}

pub struct Case {
    pub name: &'static str,
    /// Rust type name; the bindings export is `Archived{type_name}`.
    pub type_name: &'static str,
    pub class: Class,
    /// JS additionally asserts container iteration order (index/btree maps).
    pub ordered: bool,
    pub ops: fn() -> Box<dyn CaseOps>,
}

impl Case {
    pub fn codec(&self) -> String {
        format!("Archived{}", self.type_name)
    }
}

pub trait CaseOps {
    /// Write data.bin + data.json into `dir`.
    fn generate(&self, dir: &Path) -> io::Result<()>;
    /// Check js.bin in `dir` against real rkyv.
    fn verify(&self, dir: &Path, class: Class) -> Result<(), String>;
}

struct TypedCase<T: Archive> {
    make: fn() -> T,
    #[allow(clippy::type_complexity)]
    extra: Option<fn(&T::Archived) -> Result<(), String>>,
}

impl<T> CaseOps for TypedCase<T>
where
    T: Archive + Debug + PartialEq + serde::Serialize,
    T: for<'a> Serialize<HighSerializer<AlignedVec, ArenaHandle<'a>, Error>>,
    T::Archived: Portable
        + for<'a> CheckBytes<HighValidator<'a, Error>>
        + Deserialize<T, HighDeserializer<Error>>,
{
    fn generate(&self, dir: &Path) -> io::Result<()> {
        let value = (self.make)();
        let bytes = rkyv::to_bytes::<Error>(&value).expect("serialization failed");
        std::fs::write(dir.join("data.bin"), &bytes)?;
        std::fs::write(dir.join("data.json"), canonical_json::to_string_pretty(&value))?;
        Ok(())
    }

    fn verify(&self, dir: &Path, class: Class) -> Result<(), String> {
        let js = std::fs::read(dir.join("js.bin"))
            .map_err(|e| format!("missing js.bin (run `yarn test` first): {e}"))?;
        let mut aligned: AlignedVec = AlignedVec::with_capacity(js.len());
        aligned.extend_from_slice(&js);

        // 1. rkyv's own validation must accept the JS-produced buffer.
        let archived = rkyv::access::<T::Archived, Error>(&aligned)
            .map_err(|e| format!("bytecheck failed: {e}"))?;

        // 2. Deserializing must reproduce the exact expected value.
        let deserialized: T =
            rkyv::deserialize::<T, Error>(archived).map_err(|e| format!("deserialize failed: {e}"))?;
        let expected = (self.make)();
        if deserialized != expected {
            return Err(format!(
                "value mismatch:\n  expected: {expected:?}\n  actual:   {deserialized:?}"
            ));
        }

        // 3. Type-specific checks (archived hash/btree lookups etc.).
        if let Some(extra) = self.extra {
            extra(archived)?;
        }

        // 4. Byte identity for cases that guarantee it.
        if class == Class::Identical {
            let golden = std::fs::read(dir.join("data.bin"))
                .map_err(|e| format!("missing data.bin: {e}"))?;
            if js != golden {
                return Err(format!(
                    "byte mismatch (js {} bytes, golden {} bytes)",
                    js.len(),
                    golden.len()
                ));
            }
        }

        Ok(())
    }
}

macro_rules! case {
    ($name:literal, $ty:ident, $class:ident, ordered: $ordered:literal, $make:expr $(, verify: $extra:expr)? $(,)?) => {
        Case {
            name: $name,
            type_name: stringify!($ty),
            class: Class::$class,
            ordered: $ordered,
            ops: || {
                #[allow(unused_mut, unused_assignments)]
                let mut extra: Option<fn(&<$ty as Archive>::Archived) -> Result<(), String>> = None;
                $( extra = Some($extra); )?
                Box::new(TypedCase::<$ty> { make: || $make, extra })
            },
        }
    };
}

// ============================================================================
// Value builders & lookup helpers
// ============================================================================

fn str_map(n: u32) -> HashMapStr {
    HashMapStr { m: hash_map((0..n).map(|i| (format!("key_{i}"), i * 10))) }
}

fn check_str_map_lookups(a: &ArchivedHashMapStr, n: u32) -> Result<(), String> {
    for i in 0..n {
        let key = format!("key_{i}");
        match a.m.get(key.as_str()) {
            Some(v) if v.to_native() == i * 10 => {}
            Some(v) => return Err(format!("wrong value for {key}: {}", v.to_native())),
            None => return Err(format!("archived lookup missed key {key}")),
        }
    }
    Ok(())
}

macro_rules! str_map_lookup {
    ($n:literal) => {
        |a: &ArchivedHashMapStr| check_str_map_lookups(a, $n)
    };
}

fn sink() -> KitchenSink {
    KitchenSink {
        id: uuid::Uuid::from_u128(0x550e8400_e29b_41d4_a716_446655440000),
        name: "kitchen sink with a decidedly out-of-line name".into(),
        position: Point { x: 1.5, y: -2.5 },
        health: Some(100),
        state: MixedAlign::V { a: 7, b: 0xdead_beef },
        inventory: Inventory {
            items: vec!["sword".into(), "shield".into()],
            counts: hash_map([("sword".to_string(), 1u32), ("shield".to_string(), 2u32)]),
        },
        tags: ["alpha", "beta", "gamma"].into_iter().map(String::from).collect(),
        settings: [("volume".to_string(), -3i64), ("depth".to_string(), i64::MAX)]
            .into_iter()
            .collect(),
        history: vec![
            TupleVariants::Color(1, 2, 3),
            TupleVariants::Empty,
            TupleVariants::Wrap("wrapped".into()),
        ],
        parent: Some(Box::new(KitchenSinkRef {
            id: uuid::Uuid::from_u128(0x6ba7b810_9dad_11d1_80b4_00c04fd430c8),
            name: "parent".into(),
        })),
    }
}

// ============================================================================
// The registry
// ============================================================================

pub fn all_cases() -> Vec<Case> {
    vec![
        case!("primitives_basic", Primitives, Identical, ordered: false, Primitives {
            a: 42, b: -7, c: 1000, d: -1000, e: 123_456_789, f: -123_456_789,
            g: 1_234_567_890_123_456_789, h: -1_234_567_890_123_456_789,
            i: 1.5, j: -2.25, k: true, l: 'K',
        }),
        case!("primitives_extremes", Primitives, Identical, ordered: false, Primitives {
            a: u8::MAX, b: i8::MIN, c: u16::MAX, d: i16::MIN, e: u32::MAX, f: i32::MIN,
            g: u64::MAX, h: i64::MIN,
            i: f32::MAX, j: f64::MIN_POSITIVE, k: false, l: '\u{10FFFF}',
        }),
        case!("float_specials", FloatSpecials, Identical, ordered: false, FloatSpecials {
            nan32: f32::NAN, nan64: f64::NAN,
            pos_inf: f64::INFINITY, neg_inf: f32::NEG_INFINITY,
            pos_zero: 0.0, neg_zero: -0.0,
            subnormal32: f32::from_bits(1), subnormal64: f64::from_bits(1),
        }),
        case!("strings", Strings, Identical, ordered: false, Strings {
            empty: String::new(),
            one: "a".into(),
            seven: "1234567".into(),
            eight: "12345678".into(),
            nine: "123456789".into(),
            sixty_three: "x".repeat(63),
            sixty_four: "x".repeat(64),
            long: "the quick brown fox jumps over the lazy dog, twice over".into(),
            multibyte: "한국어 텍스트와 中文".into(),
            astral: "🚀🌒🛰️".into(),
        }),
        case!("options", Options, Identical, ordered: false, Options {
            none_int: None,
            some_int: Some(0xdead_beef),
            none_str: None,
            some_str: Some("an optional out-of-line string".into()),
            nested: Some(Some(7)),
            nested_none: None,
        }),
        case!("vecs", Vecs, Identical, ordered: false, Vecs {
            empty: vec![],
            one: vec![42],
            many: (0..100).collect(),
            strings: vec!["inline".into(), "a very long string that is written out of line".into(), String::new()],
            structs: vec![Point { x: 1.0, y: 2.0 }, Point { x: -3.5, y: 0.0 }],
            nested: vec![vec![1], vec![], vec![2, 3, 4]],
        }),
        case!("arrays_tuples", ArraysTuples, Identical, ordered: false, ArraysTuples {
            arr: [1, 2, 3, 4],
            arr_str: ["left".into(), "a rather long right side string".into()],
            tup: (7, "seven".into(), 7.7),
            pair: (1, 2),
        }),
        case!("enums", EnumCases, Identical, ordered: false, EnumCases {
            unit: UnitOnly::B,
            mixed_v: MixedAlign::V { a: 0xaa, b: 0xdead_beef },
            mixed_w: MixedAlign::W { a: 0x1234_5678, b: 0x1122_3344_5566_7788 },
            mixed_x: MixedAlign::X(u64::MAX),
            mixed_y: MixedAlign::Y,
            tuple_variant: TupleVariants::Color(255, 128, 0),
            wrap: TupleVariants::Wrap("a wrapped out-of-line string value".into()),
            in_option: Some(MixedAlign::V { a: 1, b: 2 }),
        }),
        case!("pointers", Pointers, Identical, ordered: false, Pointers {
            boxed: Box::new("boxed string, long enough to go out of line".into()),
            boxed_int: Box::new(0x1122_3344_5566_7788),
            rc: Rc::new("reference counted".into()),
            weak_dead: Weak::new(),
        }),
        case!("shared_rc", SharedRc, Semantic, ordered: false, {
            let shared = Rc::new("shared allocation".to_string());
            SharedRc { a: Rc::clone(&shared), b: shared }
        }),
        // Hash maps: semantic class (bucket placement depends on insertion
        // sequence under collisions); archived lookups are the real proof.
        case!("hash_map_str_empty", HashMapStr, Semantic, ordered: false, str_map(0)),
        case!("hash_map_str_1", HashMapStr, Semantic, ordered: false, str_map(1), verify: str_map_lookup!(1)),
        case!("hash_map_str_8", HashMapStr, Semantic, ordered: false, str_map(8), verify: str_map_lookup!(8)),
        case!("hash_map_str_9", HashMapStr, Semantic, ordered: false, str_map(9), verify: str_map_lookup!(9)),
        case!("hash_map_str_57", HashMapStr, Semantic, ordered: false, str_map(57), verify: str_map_lookup!(57)),
        case!("hash_map_str_100", HashMapStr, Semantic, ordered: false, str_map(100), verify: str_map_lookup!(100)),
        case!("hash_map_str_5000", HashMapStr, Semantic, ordered: false, str_map(5000), verify: str_map_lookup!(5000)),
        case!("hash_map_u32", HashMapU32, Semantic, ordered: false,
            HashMapU32 { m: hash_map((0..100).map(|i| (i * 7 + 1, i))) },
            verify: |a: &ArchivedHashMapU32| {
                for i in 0..100u32 {
                    let key = i * 7 + 1;
                    match a.m.get_with(&key, |q, k| k.to_native() == *q) {
                        Some(v) if v.to_native() == i => {}
                        _ => return Err(format!("archived lookup missed u32 key {key}")),
                    }
                }
                Ok(())
            }),
        case!("hash_map_u64", HashMapU64, Semantic, ordered: false,
            HashMapU64 { m: hash_map([(1u64, "one".to_string()), (u64::MAX, "max".to_string()), (0, "zero".to_string())]) },
            verify: |a: &ArchivedHashMapU64| {
                for key in [1u64, u64::MAX, 0] {
                    if a.m.get_with(&key, |q, k| k.to_native() == *q).is_none() {
                        return Err(format!("archived lookup missed u64 key {key}"));
                    }
                }
                Ok(())
            }),
        case!("hash_map_i32", HashMapI32, Semantic, ordered: false,
            HashMapI32 { m: hash_map([(-1, true), (i32::MIN, false), (i32::MAX, true), (0, false)]) },
            verify: |a: &ArchivedHashMapI32| {
                for key in [-1, i32::MIN, i32::MAX, 0] {
                    if a.m.get_with(&key, |q, k| k.to_native() == *q).is_none() {
                        return Err(format!("archived lookup missed i32 key {key}"));
                    }
                }
                Ok(())
            }),
        case!("hash_map_tuple_key", HashMapTupleKey, Semantic, ordered: false,
            HashMapTupleKey { m: hash_map([
                (("alpha".to_string(), 1u32), true),
                (("beta".to_string(), 2), false),
                (("a longer tuple key element that leaves the inline range".to_string(), 3), true),
            ]) },
            verify: |a: &ArchivedHashMapTupleKey| {
                let keys = [("alpha", 1u32), ("beta", 2), ("a longer tuple key element that leaves the inline range", 3)];
                for (s, n) in keys {
                    let found = a.m.get_with(&(s, n), |q, k| k.0.as_str() == q.0 && k.1.to_native() == q.1);
                    if found.is_none() {
                        return Err(format!("archived lookup missed tuple key ({s}, {n})"));
                    }
                }
                Ok(())
            }),
        case!("hash_map_struct_key", HashMapStructKey, Semantic, ordered: false,
            HashMapStructKey { m: hash_map([
                (StructKey { id: 1, tag: "one".into() }, 100u32),
                (StructKey { id: 2, tag: "two".into() }, 200),
                (StructKey { id: 3, tag: "a considerably longer key tag string".into() }, 300),
            ]) },
            verify: |a: &ArchivedHashMapStructKey| {
                let keys = [(1u32, "one"), (2, "two"), (3, "a considerably longer key tag string")];
                for (id, tag) in keys {
                    let found = a.m.get_with(&(id, tag), |q, k| k.id.to_native() == q.0 && k.tag.as_str() == q.1);
                    if found.is_none() {
                        return Err(format!("archived lookup missed struct key ({id}, {tag})"));
                    }
                }
                Ok(())
            }),
        case!("hash_set_str", HashSetStr, Semantic, ordered: false,
            HashSetStr { s: hash_set((0..40).map(|i| format!("item_{i}"))) },
            verify: |a: &ArchivedHashSetStr| {
                for i in 0..40 {
                    let key = format!("item_{i}");
                    if !a.s.contains(key.as_str()) {
                        return Err(format!("archived set missed {key}"));
                    }
                }
                Ok(())
            }),
        case!("hash_set_u32", HashSetU32, Semantic, ordered: false,
            HashSetU32 { s: hash_set((0..40).map(|i| i * 3)) },
            verify: |a: &ArchivedHashSetU32| {
                for i in 0..40u32 {
                    // rend ints hash via to_native(), so archived keys look
                    // up with the same hash as the original u32.
                    let key = rkyv::rend::u32_le::from_native(i * 3);
                    if !a.s.contains(&key) {
                        return Err(format!("archived set missed {}", i * 3));
                    }
                }
                Ok(())
            }),
        // Archived with a custom hasher (SipHasher13) — the lookups prove
        // JS placed every bucket with the pluggable hasher, not FxHasher64.
        case!("sip_hashed_map", SipHashedMap, Semantic, ordered: false,
            SipHashedMap { m: SipKeyedMap(hash_map((0..9u32).map(|i| (format!("sip_{i}"), i * 11)))) },
            verify: |a: &ArchivedSipHashedMap| {
                for i in 0..9u32 {
                    let key = format!("sip_{i}");
                    match a.m.get(key.as_str()) {
                        Some(v) if v.to_native() == i * 11 => {}
                        _ => return Err(format!("archived sip-map lookup missed {key}")),
                    }
                }
                if a.m.get("absent").is_some() {
                    return Err("archived sip-map lookup found a phantom key".into());
                }
                Ok(())
            }),
        // Index maps preserve insertion order; JS re-encoding from the
        // decoded value reproduces the exact bytes.
        case!("index_map_str_empty", IndexMapStr, Identical, ordered: true,
            IndexMapStr { m: indexmap::IndexMap::new() }),
        case!("index_map_str", IndexMapStr, Identical, ordered: true,
            IndexMapStr { m: (0..60).map(|i| (format!("setting_{i}"), i * 2)).collect() },
            verify: |a: &ArchivedIndexMapStr| {
                for i in 0..60u32 {
                    let key = format!("setting_{i}");
                    match a.m.get(key.as_str()) {
                        Some(v) if v.to_native() == i * 2 => {}
                        _ => return Err(format!("archived index lookup missed {key}")),
                    }
                }
                Ok(())
            }),
        case!("index_map_u32", IndexMapU32, Identical, ordered: true,
            IndexMapU32 { m: [(42u32, "answer".to_string()), (7, "lucky".to_string()), (0, "zero".to_string())].into_iter().collect() },
            verify: |a: &ArchivedIndexMapU32| {
                for key in [42u32, 7, 0] {
                    if a.m.get_with(&key, |q, k| k.to_native() == *q).is_none() {
                        return Err(format!("archived index lookup missed u32 key {key}"));
                    }
                }
                Ok(())
            }),
        case!("index_set_str", IndexSetStr, Identical, ordered: true,
            IndexSetStr { s: ["zebra", "apple", "mango"].into_iter().map(String::from).collect() }),
        case!("btree_map_str_empty", BTreeMapStr, Identical, ordered: true,
            BTreeMapStr { m: std::collections::BTreeMap::new() }),
        case!("btree_map_str_1", BTreeMapStr, Identical, ordered: true,
            BTreeMapStr { m: [("solo".to_string(), 1u32)].into_iter().collect() }),
        case!("btree_map_str_5", BTreeMapStr, Identical, ordered: true,
            BTreeMapStr { m: (0..5).map(|i| (format!("k{i}"), i)).collect() }),
        case!("btree_map_str_6", BTreeMapStr, Identical, ordered: true,
            BTreeMapStr { m: (0..6).map(|i| (format!("k{i}"), i)).collect() },
            verify: |a: &ArchivedBTreeMapStr| {
                for i in 0..6u32 {
                    let key = format!("k{i}");
                    match a.m.get(key.as_str()) {
                        Some(v) if v.to_native() == i => {}
                        _ => return Err(format!("archived btree lookup missed {key}")),
                    }
                }
                Ok(())
            }),
        case!("btree_map_str_100", BTreeMapStr, Identical, ordered: true,
            BTreeMapStr { m: (0..100).map(|i| (format!("key_{i:03}"), i)).collect() },
            verify: |a: &ArchivedBTreeMapStr| {
                for i in 0..100u32 {
                    let key = format!("key_{i:03}");
                    match a.m.get(key.as_str()) {
                        Some(v) if v.to_native() == i => {}
                        _ => return Err(format!("archived btree lookup missed {key}")),
                    }
                }
                Ok(())
            }),
        case!("btree_map_u32", BTreeMapU32, Identical, ordered: true,
            BTreeMapU32 { m: (0..23).map(|i| (i * 5, format!("v{i}"))).collect() }),
        case!("btree_set_str", BTreeSetStr, Identical, ordered: true,
            BTreeSetStr { s: ["x", "y", "z", "and a very long member that goes out of line"].into_iter().map(String::from).collect() }),
        case!("external_types", ExternalTypes, Identical, ordered: false, ExternalTypes {
            id: uuid::Uuid::from_u128(0x550e8400_e29b_41d4_a716_446655440000),
            payload: bytes::Bytes::from_static(&[1, 2, 3, 250, 251, 252]),
            small_name: smol_str::SmolStr::new("small"),
            thin: [10, 20, 30].into_iter().collect(),
            array_vec: arrayvec::ArrayVec::from_iter([1, 2, 3]),
            small_vec: [5, 6, 7, 8, 9].into_iter().collect(),
            tiny_vec: [100, 200].into_iter().collect(),
            deque: (0..10).collect(),
            shared: triomphe::Arc::new("triomphe shared string".into()),
        }),
        case!("kitchen_sink", KitchenSink, Semantic, ordered: false, sink()),
    ]
}
