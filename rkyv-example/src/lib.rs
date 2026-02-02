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

/// A simple 2D point.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct Point {
    pub x: f64,
    pub y: f64,
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

/// Game state containing nested structures.
#[derive(Debug, Clone, Archive, Deserialize, Serialize, serde::Serialize)]
#[rkyv(compare(PartialEq), derive(Debug))]
pub struct GameState {
    pub player_position: Point,
    pub health: u32,
    pub inventory: Vec<String>,
    pub current_message: Option<Message>,
}
