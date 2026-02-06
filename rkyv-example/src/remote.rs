//! Simulates an external crate that does NOT support rkyv.
//!
//! These types are used to demonstrate `#[rkyv(remote = ...)]` support.
//! In a real project, these would come from a third-party crate.

/// A simple 2D coordinate from an "external" crate.
///
/// This type does NOT derive `Archive` — it simulates a type from a crate
/// that doesn't have rkyv support.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct Coord {
    pub x: f32,
    pub y: f32,
}

impl Coord {
    pub fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }
}
