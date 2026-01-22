//! Example crate demonstrating rkyv-js-codegen usage.
//!
//! This crate shows how to define Rust types with rkyv serialization
//! and generate TypeScript bindings for them.
//!
//! The `#[derive(TypeScript)]` macro is a no-op annotation that serves
//! as documentation. The actual binding generation happens in build.rs
//! using `CodeGenerator`.

use rkyv::{Archive, Deserialize, Serialize};
use rkyv_js_codegen::TypeScript;

/// A simple 2D point.
#[derive(Archive, Deserialize, Serialize, TypeScript, Debug, Clone)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct Point {
    pub x: f64,
    pub y: f64,
}

/// A person with various field types.
#[derive(Archive, Deserialize, Serialize, TypeScript, Debug, Clone)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct Person {
    pub name: String,
    pub age: u32,
    pub email: Option<String>,
    pub scores: Vec<u32>,
    pub active: bool,
}

/// A message enum with different variant types.
#[derive(Archive, Deserialize, Serialize, TypeScript, Debug, Clone)]
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
#[derive(Archive, Deserialize, Serialize, TypeScript, Debug, Clone)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct GameState {
    pub player_position: Point,
    pub health: u32,
    pub inventory: Vec<String>,
    pub current_message: Option<Message>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use rkyv::rancor::Error;

    #[test]
    fn test_roundtrip() {
        let state = GameState {
            player_position: Point { x: 10.5, y: 20.3 },
            health: 100,
            inventory: vec!["sword".to_string(), "shield".to_string()],
            current_message: Some(Message::Write("Hello!".to_string())),
        };

        let bytes = rkyv::to_bytes::<Error>(&state).unwrap();
        let archived = rkyv::access::<ArchivedGameState, Error>(&bytes).unwrap();

        assert_eq!(archived.health, 100);
        assert_eq!(archived.player_position.x, 10.5);
    }
}
