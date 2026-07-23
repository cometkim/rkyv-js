use std::env;
use std::path::PathBuf;

use rkyv_js_codegen::{CodeGenerator, CodecExpr, Error, WithWrapper};

fn main() -> Result<(), Error> {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    let mut codegen = CodeGenerator::new();

    codegen.set_header(
        "Generated TypeScript bindings for rkyv-js-example\n\
         These types match the Rust structs in src/lib.rs",
    );

    // `#[rkyv(with = AsJson)]` fields are backed by the hand-written JSON string codec next to the generated bindings (generated/coord.ts).
    codegen.register_with(
        "AsJson",
        WithWrapper::replace(CodecExpr::import_from("./coord.ts", "Coord")),
    );

    // Extract every type annotated with #[derive(Archive)].
    codegen.add_source_file(manifest_dir.join("src/lib.rs"))?;

    // Write to OUT_DIR (standard cargo location) and to the in-tree copy consumed by the TypeScript workspace.
    codegen.write_to_file(out_dir.join("bindings.ts"))?;
    codegen.write_to_file(manifest_dir.join("generated/bindings.ts"))?;

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=build.rs");
    Ok(())
}
