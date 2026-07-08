#[path = "../../shared/smoke.rs"]
mod smoke;

fn main() {
    smoke::run(
        "be",
        serde_json::json!({ "endian": "big", "pointerWidth": 32, "aligned": true }),
    );
}
