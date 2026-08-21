//! Where the rkyv pin lives, and how the generators read it.
//!
//! rkyv is pinned exactly once, in the root workspace manifest
//! (`[workspace.dependencies] rkyv = "=x.y.z"`): workspace crates inherit the
//! pin, and the generators stamp it into their `manifest.json` from here rather
//! than repeating the number. The format-profile smoke crates under
//! `conformance/formats/` form a separate workspace (rkyv's format features are
//! global per build), and Cargo cannot inherit across that boundary, so their
//! workspace repeats the pin; they `#[path]`-include this module to read both
//! and refuse to run if the two drift.

/// The root workspace manifest, embedded at compile time: no repo-relative file
/// access at run time, and the generators rebuild whenever the pin moves.
const WORKSPACE_MANIFEST: &str = include_str!("../../Cargo.toml");

/// The exact rkyv version pinned by the root workspace, e.g. `"0.8.18"`.
pub fn workspace_rkyv_version() -> String {
    exact_rkyv_version(WORKSPACE_MANIFEST, &["workspace", "dependencies"])
        .unwrap_or_else(|err| panic!("workspace Cargo.toml: {err}"))
}

/// The exact rkyv version required by the dependency table at `table` of a
/// manifest (`["workspace", "dependencies"]`, `["dependencies"]`, ...),
/// accepting both `rkyv = "=x.y.z"` and `rkyv = { version = "=x.y.z", ... }`.
///
/// Anything but an exact `=x.y.z` requirement is an error: the goldens record
/// the concrete version they were generated with, and a range would make that
/// stamp (and the "pinned" claim in the README) meaningless.
pub fn exact_rkyv_version(manifest: &str, table: &[&str]) -> Result<String, String> {
    let doc: toml::Value =
        toml::from_str(manifest).map_err(|err| format!("invalid TOML: {err}"))?;
    let table_name = table.join(".");
    let mut node = &doc;
    for &key in table {
        node = node
            .get(key)
            .ok_or_else(|| format!("no [{table_name}] table"))?;
    }
    let rkyv = node
        .get("rkyv")
        .ok_or_else(|| format!("no `rkyv` entry in [{table_name}]"))?;
    let req = match rkyv {
        toml::Value::String(req) => req.as_str(),
        toml::Value::Table(dep) => dep
            .get("version")
            .and_then(toml::Value::as_str)
            .ok_or_else(|| format!("`rkyv` in [{table_name}] has no `version`"))?,
        _ => {
            return Err(format!(
                "`rkyv` in [{table_name}] is neither a version string nor a table"
            ));
        }
    };
    req.strip_prefix('=')
        .map(str::trim)
        .filter(|version| is_full_version(version))
        .map(str::to_owned)
        .ok_or_else(|| format!("rkyv must be pinned exactly (`=x.y.z`), found `{req}`"))
}

/// `MAJOR.MINOR.PATCH`, optionally followed by a pre-release or build suffix.
fn is_full_version(version: &str) -> bool {
    fn numeric(part: Option<&str>) -> bool {
        part.is_some_and(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
    }
    let core = version.split(['-', '+']).next().unwrap_or_default();
    let mut parts = core.split('.');
    numeric(parts.next())
        && numeric(parts.next())
        && numeric(parts.next())
        && parts.next().is_none()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workspace_pin_is_exact() {
        // The embedded workspace manifest must itself satisfy the contract.
        let version = workspace_rkyv_version();
        assert!(is_full_version(&version), "{version}");
    }

    #[test]
    fn accepts_string_and_table_forms() {
        let plain = "[workspace.dependencies]\nrkyv = \"=0.8.18\"\n";
        assert_eq!(
            exact_rkyv_version(plain, &["workspace", "dependencies"]).unwrap(),
            "0.8.18"
        );
        let table =
            "[dependencies]\nrkyv = { version = \"= 1.2.3-rc.1\", features = [\"bytecheck\"] }\n";
        assert_eq!(
            exact_rkyv_version(table, &["dependencies"]).unwrap(),
            "1.2.3-rc.1"
        );
    }

    #[test]
    fn rejects_ranges_and_missing_entries() {
        let err = |manifest: &str, table: &[&str]| exact_rkyv_version(manifest, table).unwrap_err();
        for range in [
            "\"0.8\"",
            "\"=0.8\"",
            "\"^0.8.18\"",
            "\"~0.8.18\"",
            "\"0.8.18\"",
        ] {
            let manifest = format!("[dependencies]\nrkyv = {range}\n");
            assert!(
                err(&manifest, &["dependencies"]).contains("pinned exactly"),
                "{range}"
            );
        }
        assert!(
            err("[dependencies]\nserde = \"1\"\n", &["dependencies"]).contains("no `rkyv` entry")
        );
        assert!(
            err("[package]\nname = \"x\"\n", &["workspace", "dependencies"])
                .contains("no [workspace.dependencies] table")
        );
        assert!(
            err(
                "[dependencies]\nrkyv = { features = [\"bytecheck\"] }\n",
                &["dependencies"]
            )
            .contains("no `version`")
        );
    }
}
