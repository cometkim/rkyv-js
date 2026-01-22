//! Generates rkyv-serialized test fixtures for round-trip testing.
//!
//! This binary creates .bin files containing rkyv-serialized data
//! and .txt files with the debug representation.

use rkyv::rancor::Error;
use rkyv_js_example::{GameState, Message, Person, Point};
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let out_dir = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("fixtures"));

    fs::create_dir_all(&out_dir).expect("Failed to create fixtures directory");

    println!("Generating fixtures...");

    // Test case 1: Simple Point struct
    let point = Point { x: 42.5, y: -17.25 };
    write_fixture(&out_dir, "point", &point);

    // Test case 2: Person with all field types
    let person = Person {
        name: "Alice".to_string(),
        age: 30,
        email: Some("alice@example.com".to_string()),
        scores: vec![100, 95, 87, 92],
        active: true,
    };
    write_fixture(&out_dir, "person", &person);

    // Test case 3: Person with None email
    let person_no_email = Person {
        name: "Bob".to_string(),
        age: 25,
        email: None,
        scores: vec![],
        active: false,
    };
    write_fixture(&out_dir, "person_no_email", &person_no_email);

    // Test case 4: Enum variants
    let msg_quit = Message::Quit;
    write_fixture(&out_dir, "message_quit", &msg_quit);

    let msg_move = Message::Move { x: 10, y: -20 };
    write_fixture(&out_dir, "message_move", &msg_move);

    let msg_write = Message::Write("Hello, World!".to_string());
    write_fixture(&out_dir, "message_write", &msg_write);

    let msg_color = Message::ChangeColor(255, 128, 0);
    write_fixture(&out_dir, "message_color", &msg_color);

    // Test case 5: Complex nested GameState
    let game_state = GameState {
        player_position: Point { x: 100.0, y: 200.0 },
        health: 85,
        inventory: vec![
            "sword".to_string(),
            "shield".to_string(),
            "potion".to_string(),
        ],
        current_message: Some(Message::Write("Level up!".to_string())),
    };
    write_fixture(&out_dir, "game_state", &game_state);

    // Test case 6: GameState with no message
    let game_state_simple = GameState {
        player_position: Point { x: 0.0, y: 0.0 },
        health: 100,
        inventory: vec![],
        current_message: None,
    };
    write_fixture(&out_dir, "game_state_simple", &game_state_simple);

    println!("Generated fixtures in: {}", out_dir.display());
}

fn write_fixture<T>(dir: &PathBuf, name: &str, value: &T)
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
        >,
    T: std::fmt::Debug,
{
    let bytes = rkyv::to_bytes::<Error>(value).expect("Failed to serialize");

    // Write binary file
    let bin_path = dir.join(format!("{}.bin", name));
    fs::write(&bin_path, bytes.as_slice()).expect("Failed to write binary file");

    // Write debug representation for reference
    let debug_path = dir.join(format!("{}.txt", name));
    fs::write(&debug_path, format!("{:#?}", value)).expect("Failed to write debug file");

    println!("  {} ({} bytes)", name, bytes.len());
}
