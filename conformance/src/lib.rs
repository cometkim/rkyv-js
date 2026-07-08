pub mod canonical_json;
pub mod cases;
pub mod types;

use std::path::PathBuf;

/// Repo-relative location of the golden cases.
pub fn cases_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("cases")
}
