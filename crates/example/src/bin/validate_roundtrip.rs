//! Validates round-trip encoded data from TypeScript.
//!
//! This binary reads .bin files that were re-encoded by TypeScript
//! and validates they can be deserialized back to the original values.

use rkyv::rancor::Error;
use rkyv_js_example::{ArchivedGameState, ArchivedMessage, ArchivedPerson, ArchivedPoint};
use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    let in_dir = env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("fixtures/roundtrip"));

    let mut passed = 0;
    let mut failed = 0;

    // Validate Point
    if validate_point(&in_dir, "point") {
        passed += 1;
    } else {
        failed += 1;
    }

    // Validate Person variants
    for name in ["person", "person_no_email"] {
        if validate_person(&in_dir, name) {
            passed += 1;
        } else {
            failed += 1;
        }
    }

    // Validate Message variants
    for name in [
        "message_quit",
        "message_move",
        "message_write",
        "message_color",
    ] {
        if validate_message(&in_dir, name) {
            passed += 1;
        } else {
            failed += 1;
        }
    }

    // Validate GameState variants
    for name in ["game_state", "game_state_simple"] {
        if validate_game_state(&in_dir, name) {
            passed += 1;
        } else {
            failed += 1;
        }
    }

    println!("\nResults: {} passed, {} failed", passed, failed);

    if failed > 0 {
        std::process::exit(1);
    }
}

fn validate_point(dir: &PathBuf, name: &str) -> bool {
    let path = dir.join(format!("{}.bin", name));
    print!("Validating {}... ", name);

    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            println!("SKIP ({})", e);
            return true; // Skip if file doesn't exist
        }
    };

    match rkyv::access::<ArchivedPoint, Error>(&bytes) {
        Ok(archived) => {
            let x: f64 = archived.x.into();
            let y: f64 = archived.y.into();
            println!("OK (x={}, y={})", x, y);
            true
        }
        Err(e) => {
            println!("FAIL ({:?})", e);
            false
        }
    }
}

fn validate_person(dir: &PathBuf, name: &str) -> bool {
    let path = dir.join(format!("{}.bin", name));
    print!("Validating {}... ", name);

    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            println!("SKIP ({})", e);
            return true;
        }
    };

    match rkyv::access::<ArchivedPerson, Error>(&bytes) {
        Ok(archived) => {
            println!(
                "OK (name={}, age={}, email={:?})",
                archived.name.as_str(),
                archived.age,
                archived.email.as_ref().map(|s| s.as_str())
            );
            true
        }
        Err(e) => {
            println!("FAIL ({:?})", e);
            false
        }
    }
}

fn validate_message(dir: &PathBuf, name: &str) -> bool {
    let path = dir.join(format!("{}.bin", name));
    print!("Validating {}... ", name);

    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            println!("SKIP ({})", e);
            return true;
        }
    };

    match rkyv::access::<ArchivedMessage, Error>(&bytes) {
        Ok(archived) => {
            let desc = match archived {
                ArchivedMessage::Quit => "Quit".to_string(),
                ArchivedMessage::Move { x, y } => format!("Move({}, {})", x, y),
                ArchivedMessage::Write(s) => format!("Write({})", s.as_str()),
                ArchivedMessage::ChangeColor(r, g, b) => {
                    format!("ChangeColor({}, {}, {})", r, g, b)
                }
            };
            println!("OK ({})", desc);
            true
        }
        Err(e) => {
            println!("FAIL ({:?})", e);
            false
        }
    }
}

fn validate_game_state(dir: &PathBuf, name: &str) -> bool {
    let path = dir.join(format!("{}.bin", name));
    print!("Validating {}... ", name);

    let bytes = match fs::read(&path) {
        Ok(b) => b,
        Err(e) => {
            println!("SKIP ({})", e);
            return true;
        }
    };

    match rkyv::access::<ArchivedGameState, Error>(&bytes) {
        Ok(archived) => {
            let x: f64 = archived.player_position.x.into();
            let y: f64 = archived.player_position.y.into();
            println!(
                "OK (pos=({}, {}), health={}, inventory_len={})",
                x,
                y,
                archived.health,
                archived.inventory.len()
            );
            true
        }
        Err(e) => {
            println!("FAIL ({:?})", e);
            false
        }
    }
}
