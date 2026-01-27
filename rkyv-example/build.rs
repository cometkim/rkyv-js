use rkyv_js_codegen::CodeGenerator;
use std::env;
use std::path::PathBuf;

fn main() {
    let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let out_dir = PathBuf::from(env::var("OUT_DIR").unwrap());

    let mut codegen = CodeGenerator::new();

    codegen.set_header(
        "Generated TypeScript bindings for rkyv-js-example\n\
         These types match the Rust structs in src/lib.rs",
    );

    // Automatically extract all types annotated with #[derive(TypeScript)]
    codegen.add_source_file(manifest_dir.join("src/lib.rs"))
        .expect("Failed to parse source file");

    // Write to OUT_DIR (standard cargo location)
    codegen.write_to_file(out_dir.join("bindings.ts"))
        .expect("Failed to write bindings");

    // Also write to a more accessible location during development
    let dev_bindings = manifest_dir.join("generated/bindings.ts");
    if let Some(parent) = dev_bindings.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    codegen.write_to_file(&dev_bindings).ok();

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=build.rs");
}
