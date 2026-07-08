//! Shared smoke-test module for non-default rkyv format profiles.
//!
//! rkyv's format features (`big_endian`, `pointer_width_*`, `unaligned`) are
//! global per build, so each profile is a standalone mini-crate outside the
//! main workspace that includes this file via `#[path]`. Each profile
//! generates `conformance/formats/cases-<profile>/` with one reduced case
//! and verifies the JS re-encoding byte-for-byte.

#[path = "../../src/canonical_json.rs"]
mod canonical_json;

use std::collections::HashMap;
use std::path::PathBuf;

use rkyv::rancor::Error;
use rkyv::util::AlignedVec;
use rkyv::{Archive, Deserialize, Serialize};

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub enum SmokeEnum {
    V { a: u8, b: u32 },
    W { a: u32, b: u64 },
    X,
}

#[derive(Archive, Serialize, Deserialize, Debug, PartialEq, serde::Serialize)]
pub struct SmokeCase {
    pub a: u8,
    pub b: u16,
    pub c: u32,
    pub d: u64,
    pub e: i32,
    pub f: f32,
    pub g: f64,
    pub h: bool,
    pub s_inline: String,
    pub s_long: String,
    pub xs: Vec<u32>,
    pub opt_some: Option<String>,
    pub opt_none: Option<u32>,
    pub e_v: SmokeEnum,
    pub e_w: SmokeEnum,
    // Single entry keeps hash iteration (and therefore golden bytes)
    // deterministic without pinning a hasher.
    pub map: HashMap<String, u32>,
    pub imap: indexmap::IndexMap<String, u32>,
    pub boxed: Box<u64>,
}

pub fn value() -> SmokeCase {
    SmokeCase {
        a: 0xaa,
        b: 0xbbbb,
        c: 0xcccc_cccc,
        d: 0xdddd_dddd_dddd_dddd,
        e: -12345,
        f: 1.5,
        g: -2.25,
        h: true,
        s_inline: "hi".into(),
        s_long: "a string long enough to be out of line at every pointer width".into(),
        xs: vec![1, 2, 3, 4, 5],
        opt_some: Some("optional".into()),
        opt_none: None,
        e_v: SmokeEnum::V { a: 7, b: 0xdead_beef },
        e_w: SmokeEnum::W { a: 0x1234_5678, b: 0x1122_3344_5566_7788 },
        map: HashMap::from_iter([("key".to_string(), 42u32)]),
        imap: [("first", 1u32), ("second", 2), ("third", 3)]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
        boxed: Box::new(0x0102_0304_0506_0708),
    }
}

pub fn run(profile: &str, format: serde_json::Value) {
    let mode = std::env::args().nth(1).unwrap_or_else(|| "generate".into());
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(format!("cases-{profile}"));

    match mode.as_str() {
        "generate" => generate(&dir, profile, format),
        "verify" => verify(&dir, profile),
        other => {
            eprintln!("unknown mode {other}; use generate|verify");
            std::process::exit(2);
        }
    }
}

fn generate(dir: &PathBuf, profile: &str, format: serde_json::Value) {
    std::fs::create_dir_all(dir).expect("create cases dir");
    let value = value();
    let bytes = rkyv::to_bytes::<Error>(&value).expect("serialize");
    std::fs::write(dir.join("data.bin"), &bytes).expect("write data.bin");
    std::fs::write(dir.join("data.json"), canonical_json::to_string_pretty(&value))
        .expect("write data.json");
    let manifest = serde_json::json!({
        "profile": profile,
        "rkyv": "0.8.14",
        "format": format,
        "codec": "ArchivedSmokeCase",
    });
    std::fs::write(
        dir.join("manifest.json"),
        format!("{}\n", serde_json::to_string_pretty(&manifest).unwrap()),
    )
    .expect("write manifest.json");
    println!("[{profile}] generated {} bytes", bytes.len());
}

fn verify(dir: &PathBuf, profile: &str) {
    let js = std::fs::read(dir.join("js.bin")).expect("missing js.bin (run `yarn test` first)");
    let mut aligned: AlignedVec = AlignedVec::with_capacity(js.len());
    aligned.extend_from_slice(&js);

    let archived =
        rkyv::access::<ArchivedSmokeCase, Error>(&aligned).expect("bytecheck failed on js.bin");

    // Archived-container lookups under this format.
    assert_eq!(
        archived.map.get("key").map(|v| v.to_native()),
        Some(42),
        "[{profile}] archived hash lookup failed"
    );
    assert_eq!(
        archived.imap.get("second").map(|v| v.to_native()),
        Some(2),
        "[{profile}] archived index lookup failed"
    );

    let deserialized: SmokeCase =
        rkyv::deserialize::<SmokeCase, Error>(archived).expect("deserialize failed");
    assert_eq!(deserialized, value(), "[{profile}] value mismatch");

    let golden = std::fs::read(dir.join("data.bin")).expect("missing data.bin");
    assert_eq!(js, golden, "[{profile}] byte mismatch");

    println!("[{profile}] verified ({} bytes)", js.len());
}
