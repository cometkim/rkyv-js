#[path = "../../shared/smoke.rs"]
mod smoke;

fn main() {
    smoke::run(
        "pw16",
        serde_json::json!({ "endian": "little", "pointerWidth": 16, "aligned": true }),
    );
}
