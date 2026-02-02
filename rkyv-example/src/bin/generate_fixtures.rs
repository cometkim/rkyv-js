//! Generates rkyv-serialized test fixtures for round-trip testing.
//!
//! This binary creates fixture directories, each containing:
//! - data.bin: rkyv-serialized binary data
//! - data.json: serde_json-serialized data for comparison
//! - codec.ts: TypeScript binding

use rkyv::rancor::Error;
use rkyv_js_codegen::CodeGenerator;
use rkyv_js_example::{
    Arc, ArcShared, ArrayVec, ArrayVecBuffer, BTreeMapConfig, Bytes, BytesMessage, GameState,
    IndexMap, IndexMapConfig, IndexSet, IndexSetTags, Message, Person, Point, SmallVec,
    SmallVecData, SmolStr, SmolStrConfig, ThinVec, ThinVecData, TinyVec, TinyVecData, Uuid,
    UuidRecord,
};
use serde::Serialize;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

fn main() {
    let out_dir = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("test/fixtures"));

    fs::create_dir_all(&out_dir).expect("Failed to create fixtures directory");

    println!("Generating fixtures...");

    // Point fixtures
    write_fixture::<Point>(&out_dir, "point", &Point { x: 42.5, y: -17.25 });

    // Person fixtures
    write_fixture::<Person>(
        &out_dir,
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
        &out_dir,
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
    write_fixture::<Message>(&out_dir, "message_quit", &Message::Quit);

    write_fixture::<Message>(&out_dir, "message_move", &Message::Move { x: 10, y: -20 });

    write_fixture::<Message>(
        &out_dir,
        "message_write",
        &Message::Write("Hello, World!".to_string()),
    );

    write_fixture::<Message>(
        &out_dir,
        "message_color",
        &Message::ChangeColor(255, 128, 0),
    );

    // GameState fixtures
    write_fixture::<GameState>(
        &out_dir,
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
        &out_dir,
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
        &out_dir,
        "uuid_record",
        &UuidRecord {
            id: Uuid::parse_str("550e8400-e29b-41d4-a716-446655440000").unwrap(),
            name: "Test Record".to_string(),
            active: true,
        },
    );

    // Bytes fixture
    write_fixture::<BytesMessage>(
        &out_dir,
        "bytes_message",
        &BytesMessage {
            payload: Bytes::from_static(&[0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe]),
            checksum: 12345,
        },
    );

    // SmolStr fixture
    write_fixture::<SmolStrConfig>(
        &out_dir,
        "smol_str_config",
        &SmolStrConfig {
            key: SmolStr::new("api_key"),
            value: SmolStr::new("secret-value-12345"),
            priority: 100,
        },
    );

    // ThinVec fixture
    write_fixture::<ThinVecData>(
        &out_dir,
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
        &out_dir,
        "arrayvec_buffer",
        &ArrayVecBuffer {
            data: arrayvec_data,
            name: "test-buffer".to_string(),
        },
    );

    // SmallVec fixture
    write_fixture::<SmallVecData>(
        &out_dir,
        "smallvec_data",
        &SmallVecData {
            items: SmallVec::from_vec(vec![1, 2, 3, 4, 5, 6]),
            tags: SmallVec::from_vec(vec!["tag1".to_string(), "tag2".to_string()]),
        },
    );

    // TinyVec fixture
    write_fixture::<TinyVecData>(
        &out_dir,
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
        &out_dir,
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
    write_fixture::<IndexSetTags>(&out_dir, "indexset_tags", &IndexSetTags { tags, count: 3 });

    // Arc (triomphe) fixture
    write_fixture::<ArcShared>(
        &out_dir,
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
        &out_dir,
        "btreemap_config",
        &BTreeMapConfig {
            settings: btree_settings,
            version: 1,
        },
    );

    println!("Generated fixtures in: {}", out_dir.display());
}

/// Trait for types that can generate their own TypeScript codec.
trait GenerateCodec {
    /// The name of the main codec export (e.g., "ArchivedPoint")
    const CODEC_NAME: &'static str;

    fn generate_codec(codegen: &mut CodeGenerator);
}

impl GenerateCodec for Point {
    const CODEC_NAME: &'static str = "ArchivedPoint";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            #[derive(Archive)]
            struct Point {
                x: f64,
                y: f64,
            }
            "#,
        );
    }
}

impl GenerateCodec for Person {
    const CODEC_NAME: &'static str = "ArchivedPerson";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            #[derive(Archive)]
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

impl GenerateCodec for Message {
    const CODEC_NAME: &'static str = "ArchivedMessage";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            #[derive(Archive)]
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

impl GenerateCodec for GameState {
    const CODEC_NAME: &'static str = "ArchivedGameState";

    fn generate_codec(codegen: &mut CodeGenerator) {
        // GameState depends on Point and Message, so we need to include them
        codegen.add_source_str(
            r#"
            #[derive(Archive)]
            struct Point {
                x: f64,
                y: f64,
            }

            #[derive(Archive)]
            enum Message {
                Quit,
                Move { x: i32, y: i32 },
                Write(String),
                ChangeColor(u8, u8, u8),
            }

            #[derive(Archive)]
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

impl GenerateCodec for UuidRecord {
    const CODEC_NAME: &'static str = "ArchivedUuidRecord";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use uuid::Uuid;

            #[derive(Archive)]
            struct UuidRecord {
                id: Uuid,
                name: String,
                active: bool,
            }
            "#,
        );
    }
}

impl GenerateCodec for BytesMessage {
    const CODEC_NAME: &'static str = "ArchivedBytesMessage";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use bytes::Bytes;

            #[derive(Archive)]
            struct BytesMessage {
                payload: Bytes,
                checksum: u32,
            }
            "#,
        );
    }
}

impl GenerateCodec for SmolStrConfig {
    const CODEC_NAME: &'static str = "ArchivedSmolStrConfig";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use smol_str::SmolStr;

            #[derive(Archive)]
            struct SmolStrConfig {
                key: SmolStr,
                value: SmolStr,
                priority: u32,
            }
            "#,
        );
    }
}

impl GenerateCodec for ThinVecData {
    const CODEC_NAME: &'static str = "ArchivedThinVecData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use thin_vec::ThinVec;

            #[derive(Archive)]
            struct ThinVecData {
                items: ThinVec<u32>,
                labels: ThinVec<String>,
            }
            "#,
        );
    }
}

impl GenerateCodec for ArrayVecBuffer {
    const CODEC_NAME: &'static str = "ArchivedArrayVecBuffer";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use arrayvec::ArrayVec;

            #[derive(Archive)]
            struct ArrayVecBuffer {
                data: ArrayVec<u32, 8>,
                name: String,
            }
            "#,
        );
    }
}

impl GenerateCodec for SmallVecData {
    const CODEC_NAME: &'static str = "ArchivedSmallVecData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use smallvec::SmallVec;

            #[derive(Archive)]
            struct SmallVecData {
                items: SmallVec<[u32; 4]>,
                tags: SmallVec<[String; 2]>,
            }
            "#,
        );
    }
}

impl GenerateCodec for TinyVecData {
    const CODEC_NAME: &'static str = "ArchivedTinyVecData";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use tinyvec::TinyVec;

            #[derive(Archive)]
            struct TinyVecData {
                values: TinyVec<[u32; 4]>,
                enabled: bool,
            }
            "#,
        );
    }
}

impl GenerateCodec for IndexMapConfig {
    const CODEC_NAME: &'static str = "ArchivedIndexMapConfig";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use indexmap::IndexMap;

            #[derive(Archive)]
            struct IndexMapConfig {
                settings: IndexMap<String, u32>,
                version: u32,
            }
            "#,
        );
    }
}

impl GenerateCodec for IndexSetTags {
    const CODEC_NAME: &'static str = "ArchivedIndexSetTags";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use indexmap::IndexSet;

            #[derive(Archive)]
            struct IndexSetTags {
                tags: IndexSet<String>,
                count: u32,
            }
            "#,
        );
    }
}

impl GenerateCodec for ArcShared {
    const CODEC_NAME: &'static str = "ArchivedArcShared";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use triomphe::Arc;

            #[derive(Archive)]
            struct ArcShared {
                shared_data: Arc<String>,
                local_data: u32,
            }
            "#,
        );
    }
}

impl GenerateCodec for BTreeMapConfig {
    const CODEC_NAME: &'static str = "ArchivedBTreeMapConfig";

    fn generate_codec(codegen: &mut CodeGenerator) {
        codegen.add_source_str(
            r#"
            use std::collections::BTreeMap;

            #[derive(Archive)]
            struct BTreeMapConfig {
                settings: BTreeMap<String, u32>,
                version: u32,
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
        > + Serialize
        + GenerateCodec,
{
    // Create fixture directory
    let fixture_dir = dir.join(name);
    fs::create_dir_all(&fixture_dir).expect("Failed to create fixture directory");

    // Write binary file
    let bytes = rkyv::to_bytes::<Error>(value).expect("Failed to serialize");
    let bin_path = fixture_dir.join("data.bin");
    fs::write(&bin_path, bytes.as_slice()).expect("Failed to write binary file");

    // Write JSON file
    let json = serde_json::to_string_pretty(value).expect("Failed to serialize to JSON");
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
