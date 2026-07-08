#[path = "../../shared/smoke.rs"]
mod smoke;

fn main() {
    smoke::run(
        "unaligned",
        serde_json::json!({ "endian": "little", "pointerWidth": 32, "aligned": false }),
    );
}
