use std::hash::{Hash, Hasher};
use rkyv::hash::FxHasher64;

fn hash_string(s: &str) -> u64 {
    let mut hasher = FxHasher64::default();
    s.hash(&mut hasher);
    hasher.finish()
}

fn h2(hash: u64) -> u8 {
    (hash >> 57) as u8
}

fn main() {
    for s in &["important", "urgent", "reviewed"] {
        let hash = hash_string(s);
        let h2_val = h2(hash);
        println!("{}: hash={:#018x}, h2={} (0x{:02x})", s, hash, h2_val, h2_val);
    }
}
