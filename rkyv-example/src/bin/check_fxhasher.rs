use rkyv::hash::FxHasher64;
use std::hash::Hasher;

fn main() {
    const SEED: u64 = 0x517cc1b727220a95;
    
    // Test with "important" bytes
    let bytes = b"important";
    println!("Testing with \"important\" ({} bytes)", bytes.len());
    
    let mut hasher = FxHasher64::default();
    
    // First write the string bytes
    hasher.write(bytes);
    println!("After write({} bytes): internal state unknown", bytes.len());
    
    // Then write 0xff
    hasher.write_u8(0xff);
    
    let hash = hasher.finish();
    println!("Final hash: 0x{:016x}", hash);
    
    // Let me also check what happens with just the bytes
    println!();
    let mut hasher2 = FxHasher64::default();
    hasher2.write(bytes);
    let hash2 = hasher2.finish();
    println!("Hash of just bytes: 0x{:016x}", hash2);
    
    // And check the SEED value
    println!();
    println!("SEED constant: 0x{:016x}", SEED);
}
