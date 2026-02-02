//! Generates rkyv-serialized test fixtures for round-trip testing.
//!
//! This binary creates fixture directories, each containing:
//! - data.bin: rkyv-serialized binary data
//! - data.json: serde_json-serialized data for comparison
//! - codec.ts: TypeScript binding

use rkyv::rancor::Error;
use rkyv_js_codegen::CodeGenerator;
use rkyv_js_example::{GameState, Message, Person, Point};
use serde::Serialize;
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
