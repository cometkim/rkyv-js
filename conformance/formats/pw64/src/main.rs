#[path = "../../shared/smoke.rs"]
mod smoke;

fn main() {
    smoke::run(
        "pw64",
        serde_json::json!({ "endian": "little", "pointerWidth": 64, "aligned": true }),
    );
}
