//! Generates rkyv-serialized test fixtures for round-trip testing.
//!
//! This binary creates fixture directories, each containing:
//! - data.bin: rkyv-serialized binary data
//! - data.json: serde_json-serialized data for comparison
//! - codec.ts: TypeScript binding

use rkyv::rancor::Error;
use rkyv_example::{
    Arc, ArcShared, ArrayVec, ArrayVecBuffer, BTreeMapConfig, BTreeSet, BTreeSetData, Bytes,
    BytesMessage, GameState, HashMap, HashMapData, HashSet, HashSetData, IndexMap, IndexMapConfig,
    IndexSet, IndexSetTags, Message, Person, Point, RemoteEvent, SmallVec, SmallVecData, SmolStr,
    SmolStrConfig, ThinVec, ThinVecData, TinyVec, TinyVecData, Uuid, UuidRecord, VecDeque,
    VecDequeData,
};
use rkyv_js_codegen::{CodeGenerator, TypeDef};
use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let workspace_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("Failed to get workspace root")
        .to_path_buf();

    let out_dir = workspace_root.join("test/fixtures");
    let identical_dir = out_dir.join("identical");
    let semantic_dir = out_dir.join("semantic");
    fs::create_dir_all(&identical_dir).expect("Failed to create identical fixtures directory");
    fs::create_dir_all(&semantic_dir).expect("Failed to create semantic fixtures directory");

    println!("Generating fixtures...");

    // Point fixtures
    write_fixture::<Point>(&identical_dir, "point", &Point { x: 42.5, y: -17.25 });

    // Person fixtures
    write_fixture::<Person>(
        &identical_dir,
        "person",
        &Person {
            name: "Alice".to_string(),
            age: 30,
            email: Some("alice@example.com".to_string()),
            scores: vec![100, 95, 87, 92],
            active: true,
        },
    );

    write_fixture::<Person>(
        &identical_dir,
        "person_no_email",
        &Person {
            name: "Bob".to_string(),
            age: 25,
            email: None,
            scores: vec![],
            active: false,
        },
    );

    // Message enum variants
    write_fixture::<Message>(&identical_dir, "message_quit", &Message::Quit);

    write_fixture::<Message>(
        &identical_dir,
        "message_move",
        &Message::Move { x: 10, y: -20 },
    );

    write_fixture::<Message>(
        &identical_dir,
        "message_write",
        &Message::Write("Hello, World!".to_string()),
    );

    write_fixture::<Message>(
        &identical_dir,
        "message_color",
        &Message::ChangeColor(255, 128, 0),
    );

    // GameState fixtures
    write_fixture::<GameState>(
        &identical_dir,
        "game_state",
        &GameState {
            player_position: Point { x: 100.0, y: 200.0 },
            health: 85,
            inventory: vec![
                "sword".to_string(),
                "shield".to_string(),
                "potion".to_string(),
            ],
            current_message: Some(Message::Write("Level up!".to_string())),
        },
    );

    write_fixture::<GameState>(
        &identical_dir,
        "game_state_simple",
        &GameState {
            player_position: Point { x: 0.0, y: 0.0 },
            health: 100,
            inventory: vec![],
            current_message: None,
        },
    );

    // Built-in crate type fixtures
    println!("Generating built-in crate type fixtures...");

    // UUID fixture
    write_fixture::<UuidRecord>(
        &identical_dir,
        "uuid_record",
        &UuidRecord {
            id: Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            name: "Test Record".to_string(),
            active: true,
        },
    );

    // Bytes fixture
    write_fixture::<BytesMessage>(
        &identical_dir,
        "bytes_message",
        &BytesMessage {
            payload: Bytes::from_static(&[0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]),
            checksum: 12345,
        },
    );

    // SmolStr fixture
    write_fixture::<SmolStrConfig>(
        &identical_dir,
        "smol_str_config",
        &SmolStrConfig {
            key: SmolStr::new("api_key"),
            value: SmolStr::new("secret-value-12345"),
            priority: 100,
        },
    );

    // ThinVec fixture
    write_fixture::<ThinVecData>(
        &identical_dir,
        "thin_vec_data",
        &ThinVecData {
            items: ThinVec::from(vec![1, 2, 3, 4, 5]),
            labels: ThinVec::from(vec![
                "first".to_string(),
                "second".to_string(),
                "third".to_string(),
            ]),
        },
    );

    // ArrayVec fixture
    let mut arrayvec_data: ArrayVec<u32, 8> = ArrayVec::new();
    arrayvec_data.push(10);
    arrayvec_data.push(20);
    arrayvec_data.push(30);
    write_fixture::<ArrayVecBuffer>(
        &identical_dir,
        "arrayvec_buffer",
        &ArrayVecBuffer {
            data: arrayvec_data,
            name: "test-buffer".to_string(),
        },
    );

    // SmallVec fixture
    write_fixture::<SmallVecData>(
        &identical_dir,
        "smallvec_data",
        &SmallVecData {
            items: SmallVec::from_vec(vec![1, 2, 3, 4, 5, 6]),
            tags: SmallVec::from_vec(vec!["tag1".to_string(), "tag2".to_string()]),
        },
    );

    // TinyVec fixture
    write_fixture::<TinyVecData>(
        &identical_dir,
        "tinyvec_data",
        &TinyVecData {
            values: TinyVec::from([1, 2, 3, 0]),
            enabled: true,
        },
    );

    // IndexMap fixture
    let mut settings: IndexMap<String, u32> = IndexMap::new();
    settings.insert("timeout".to_string(), 30);
    settings.insert("retries".to_string(), 3);
    settings.insert("max_connections".to_string(), 100);
    write_fixture::<IndexMapConfig>(
        &identical_dir,
        "indexmap_config",
        &IndexMapConfig {
            settings,
            version: 1,
        },
    );

    // IndexSet fixture
    let mut tags: IndexSet<String> = IndexSet::new();
    tags.insert("important".to_string());
    tags.insert("urgent".to_string());
    tags.insert("reviewed".to_string());
    write_fixture::<IndexSetTags>(
        &identical_dir,
        "indexset_tags",
        &IndexSetTags { tags, count: 3 },
    );

    // Arc (triomphe) fixture
    write_fixture::<ArcShared>(
        &identical_dir,
        "arc_shared",
        &ArcShared {
            shared_data: Arc::new("shared-value".to_string()),
            local_data: 42,
        },
    );

    // BTreeMap fixture
    let mut btree_settings: BTreeMap<String, u32> = BTreeMap::new();
    btree_settings.insert("alpha".to_string(), 1);
    btree_settings.insert("beta".to_string(), 2);
    btree_settings.insert("gamma".to_string(), 3);
    write_fixture::<BTreeMapConfig>(
        &identical_dir,
        "btreemap_config",
        &BTreeMapConfig {
            settings: btree_settings,
            version: 1,
        },
    );

    // VecDeque fixture
    let mut queue: VecDeque<u32> = VecDeque::new();
    queue.push_back(10);
    queue.push_back(20);
    queue.push_back(30);
    queue.push_back(40);
    write_fixture::<VecDequeData>(
        &identical_dir,
        "vecdeque_data",
        &VecDequeData {
            items: queue,
            name: "task-queue".to_string(),
        },
    );

    // HashMap fixture - semantic equivalence only (different hash function)
    let mut hash_entries: HashMap<String, u32> = HashMap::with_hasher(Default::default());
    hash_entries.insert("alpha".to_string(), 100);
    hash_entries.insert("beta".to_string(), 200);
    hash_entries.insert("gamma".to_string(), 300);
    write_fixture::<HashMapData>(
        &semantic_dir,
        "hashmap_data",
        &HashMapData {
            entries: hash_entries,
            name: "test-map".to_string(),
        },
    );

    // HashSet fixture - semantic equivalence only (different hash function)
    let mut hash_ids: HashSet<String> = HashSet::with_hasher(Default::default());
    hash_ids.insert("user-001".to_string());
    hash_ids.insert("user-002".to_string());
    hash_ids.insert("user-003".to_string());
    write_fixture::<HashSetData>(
        &semantic_dir,
        "hashset_data",
        &HashSetData {
            ids: hash_ids,
            count: 3,
        },
    );

    // BTreeSet fixture
    let mut btree_values: BTreeSet<i64> = BTreeSet::new();
    btree_values.insert(100);
    btree_values.insert(-50);
    btree_values.insert(200);
    btree_values.insert(0);
    btree_values.insert(-100);
    write_fixture::<BTreeSetData>(
        &identical_dir,
        "btreeset_data",
        &BTreeSetData {
            values: btree_values,
            label: "sorted-values".to_string(),
        },
    );

    // Remote derive fixtures
    println!("Generating remote derive fixtures...");

    write_fixture::<RemoteEvent>(
        &identical_dir,
        "remote_event",
        &RemoteEvent {
            name: "Meeting".to_string(),
            location: rkyv_example::remote::Coord::new(1.5, -2.25),
            priority: 5,
        },
    );

    println!("Generated fixtures in: {}", out_dir.display());
}

/// Trait for types that can generate their own TypeScript codec.
trait GenerateFixture {
    /// The name of the main codec export (e.g., "ArchivedPoint")
    const CODEC_NAME: &'static str;

    fn generate_codec(codegen: &mut CodeGenerator);
}

impl GenerateFixture for Point {
    const CODEC_NAME: &'static str = "ArchivedPoint";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            #[derive(rkyv::Archive)]
            struct Point {
                x: f64,
                y: f64,
            }
            "#,
        );
    }
}

impl GenerateFixture for Person {
    const CODEC_NAME: &'static str = "ArchivedPerson";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            #[derive(rkyv::Archive)]
            struct Person {
                name: String,
                age: u32,
                email: Option<String>,
                scores: Vec<u32>,
                active: bool,
            }
            "#,
        );
    }
}

impl GenerateFixture for Message {
    const CODEC_NAME: &'static str = "ArchivedMessage";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            #[derive(rkyv::Archive)]
            enum Message {
                Quit,
                Move { x: i32, y: i32 },
                Write(String),
                ChangeColor(u8, u8, u8),
            }
            "#,
        );
    }
}

impl GenerateFixture for GameState {
    const CODEC_NAME: &'static str = "ArchivedGameState";

    fn generate_codec(codegen: &mut CodeGenerator) {
        // GameState depends on Point and Message, so we need to include them
        codegen.add_source_str(
            r#"
            #[derive(rkyv::Archive)]
            struct Point {
                x: f64,
                y: f64,
            }

            #[derive(rkyv::Archive)]
            enum Message {
                Quit,
                Move { x: i32, y: i32 },
                Write(String),
                ChangeColor(u8, u8, u8),
            }

            #[derive(rkyv::Archive)]
            struct GameState {
                player_position: Point,
                health: u32,
                inventory: Vec<String>,
                current_message: Option<Message>,
            }
            "#,
        );
    }
}

// Built-in crate type implementations

impl GenerateFixture for UuidRecord {
    const CODEC_NAME: &'static str = "ArchivedUuidRecord";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use rkyv::Archive;
            use uuid::Uuid;

            #[derive(rkyv::Archive)]
            struct UuidRecord {
                id: Uuid,
                name: String,
                active: bool,
            }
            "#,
        );
    }
}

impl GenerateFixture for BytesMessage {
    const CODEC_NAME: &'static str = "ArchivedBytesMessage";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use bytes::Bytes;

            #[derive(rkyv::Archive)]
            struct BytesMessage {
                payload: Bytes,
                checksum: u32,
            }
            "#,
        );
    }
}

impl GenerateFixture for SmolStrConfig {
    const CODEC_NAME: &'static str = "ArchivedSmolStrConfig";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use smol_str::SmolStr;

            #[derive(rkyv::Archive)]
            struct SmolStrConfig {
                key: SmolStr,
                value: SmolStr,
                priority: u32,
            }
            "#,
        );
    }
}

impl GenerateFixture for ThinVecData {
    const CODEC_NAME: &'static str = "ArchivedThinVecData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use thin_vec::ThinVec;

            #[derive(rkyv::Archive)]
            struct ThinVecData {
                items: ThinVec<u32>,
                labels: ThinVec<String>,
            }
            "#,
        );
    }
}

impl GenerateFixture for ArrayVecBuffer {
    const CODEC_NAME: &'static str = "ArchivedArrayVecBuffer";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use arrayvec::ArrayVec;

            #[derive(rkyv::Archive)]
            struct ArrayVecBuffer {
                data: ArrayVec<u32, 8>,
                name: String,
            }
            "#,
        );
    }
}

impl GenerateFixture for SmallVecData {
    const CODEC_NAME: &'static str = "ArchivedSmallVecData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use smallvec::SmallVec;

            #[derive(rkyv::Archive)]
            struct SmallVecData {
                items: SmallVec<[u32; 4]>,
                tags: SmallVec<[String; 2]>,
            }
            "#,
        );
    }
}

impl GenerateFixture for TinyVecData {
    const CODEC_NAME: &'static str = "ArchivedTinyVecData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use tinyvec::TinyVec;

            #[derive(rkyv::Archive)]
            struct TinyVecData {
                values: TinyVec<[u32; 4]>,
                enabled: bool,
            }
            "#,
        );
    }
}

impl GenerateFixture for IndexMapConfig {
    const CODEC_NAME: &'static str = "ArchivedIndexMapConfig";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use indexmap::IndexMap;

            #[derive(rkyv::Archive)]
            struct IndexMapConfig {
                settings: IndexMap<String, u32>,
                version: u32,
            }
            "#,
        );
    }
}

impl GenerateFixture for IndexSetTags {
    const CODEC_NAME: &'static str = "ArchivedIndexSetTags";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use indexmap::IndexSet;

            #[derive(rkyv::Archive)]
            struct IndexSetTags {
                tags: IndexSet<String>,
                count: u32,
            }
            "#,
        );
    }
}

impl GenerateFixture for ArcShared {
    const CODEC_NAME: &'static str = "ArchivedArcShared";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use triomphe::Arc;

            #[derive(rkyv::Archive)]
            struct ArcShared {
                shared_data: Arc<String>,
                local_data: u32,
            }
            "#,
        );
    }
}

impl GenerateFixture for BTreeMapConfig {
    const CODEC_NAME: &'static str = "ArchivedBTreeMapConfig";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use std::collections::BTreeMap;

            #[derive(rkyv::Archive)]
            struct BTreeMapConfig {
                settings: BTreeMap<String, u32>,
                version: u32,
            }
            "#,
        );
    }
}

impl GenerateFixture for VecDequeData {
    const CODEC_NAME: &'static str = "ArchivedVecDequeData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use std::collections::VecDeque;

            #[derive(rkyv::Archive)]
            struct VecDequeData {
                items: VecDeque<u32>,
                name: String,
            }
            "#,
        );
    }
}

impl GenerateFixture for HashMapData {
    const CODEC_NAME: &'static str = "ArchivedHashMapData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use std::collections::HashMap;

            #[derive(rkyv::Archive)]
            struct HashMapData {
                entries: HashMap<String, u32>,
                name: String,
            }
            "#,
        );
    }
}

impl GenerateFixture for HashSetData {
    const CODEC_NAME: &'static str = "ArchivedHashSetData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use std::collections::HashSet;

            #[derive(rkyv::Archive)]
            struct HashSetData {
                ids: HashSet<String>,
                count: u32,
            }
            "#,
        );
    }
}

impl GenerateFixture for BTreeSetData {
    const CODEC_NAME: &'static str = "ArchivedBTreeSetData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use std::collections::BTreeSet;

            #[derive(rkyv::Archive)]
            struct BTreeSetData {
                values: BTreeSet<i64>,
                label: String,
            }
            "#,
        );
    }
}

impl GenerateFixture for RemoteEvent {
    const CODEC_NAME: &'static str = "ArchivedRemoteEvent";

    fn generate_codec(codegen: &mut CodeGenerator) {
        // Register a user-provided codec for the remote type.
        // The JS implementation must be provided separately — the codegen
        // only needs to know the codec name and where to import it from.
        //
        // In this example, `Coord` is serialized as a JSON string via the
        // `AsJson` ArchiveWith wrapper. The custom JS codec reads/writes an
        // rkyv String containing JSON text, then parses/serializes it.
        codegen.register_type(
            "Coord",
            TypeDef::new("Coord", "Coord").with_import("./coord.ts", "Coord"),
        );

        // Feed the source for RemoteEvent — the `location` field uses `Coord`
        // (resolved from the registered type). The codegen doesn't need to know
        // about `AsJson` — it just sees `Coord` as a user-provided codec.
        codegen.add_source_str(
            r#"
            #[derive(rkyv::Archive)]
            struct RemoteEvent {
                name: String,
                location: Coord,
                priority: u32,
            }
            "#,
        );
    }
}

fn write_fixture<T>(dir: &Path, name: &str, value: &T)
where
    T: rkyv::Archive
        + for<'a> rkyv::Serialize<
            rkyv::rancor::Strategy<
                rkyv::ser::Serializer<
                    rkyv::util::AlignedVec,
                    rkyv::ser::allocator::ArenaHandle<'a>,
                    rkyv::ser::sharing::Share,
                >,
                Error,
            >,
        > + GenerateFixture,
    T::Archived: serde::Serialize,
{
    // Create fixture directory
    let fixture_dir = dir.join(name);
    fs::create_dir_all(&fixture_dir).expect("Failed to create fixture directory");

    // Write binary file
    let bytes = rkyv::to_bytes::<Error>(value).expect("Failed to serialize");
    let bin_path = fixture_dir.join("data.bin");
    fs::write(&bin_path, bytes.as_slice()).expect("Failed to write binary file");

    // Write JSON file from archived data
    let archived = unsafe { rkyv::access_unchecked::<T::Archived>(&bytes) };
    let json = serde_json::to_string_pretty(archived).expect("Failed to serialize to JSON");
    let json_path = fixture_dir.join("data.json");
    fs::write(&json_path, &json).expect("Failed to write JSON file");

    // Generate and write TypeScript codec
    let mut codegen = CodeGenerator::new();
    T::generate_codec(&mut codegen);

    let ts_code = format!(
        "{}\nexport default {};\n",
        codegen.generate(),
        T::CODEC_NAME
    );
    let ts_path = fixture_dir.join("codec.ts");
    fs::write(&ts_path, &ts_code).expect("Failed to write TypeScript file");

    println!("  {} ({} bytes)", name, bytes.len());
}
