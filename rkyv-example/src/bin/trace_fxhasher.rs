//! Trace what FxHasher64 does internally

fn main() {
    // Simulate FxHasher64's write function
    // Constants from rkyv's implementation
    const ROTATE: u32 = 5;
    const SEED: u64 = 0x517cc1b727220a95;
    
    fn hash_word(hash: u64, word: u64) -> u64 {
        let rotated = hash.rotate_left(ROTATE);
        let xored = rotated ^ word;
        xored.wrapping_mul(SEED)
    }
    
    fn write_bytes(mut hash: u64, bytes: &[u8]) -> u64 {
        let mut offset = 0;
        
        // Process 8 bytes at a time
        while offset + 8 <= bytes.len() {
            let word = u64::from_le_bytes(bytes[offset..offset+8].try_into().unwrap());
            println!("    word (8 bytes): 0x{:016x}", word);
            hash = hash_word(hash, word);
            println!("    hash after: 0x{:016x}", hash);
            offset += 8;
        }
        
        // Process remaining bytes
        if offset < bytes.len() {
            // Pack remaining bytes into a word with 0xff padding
            let mut word_bytes = [0xffu8; 8];
            for (i, &b) in bytes[offset..].iter().enumerate() {
                word_bytes[i] = b;
            }
            let word = u64::from_le_bytes(word_bytes);
            println!("    partial word ({} bytes + padding): 0x{:016x}", bytes.len() - offset, word);
            hash = hash_word(hash, word);
            println!("    hash after: 0x{:016x}", hash);
        }
        
        hash
    }
    
    fn write_u8(hash: u64, byte: u8) -> u64 {
        let word = 0xffffffffffffff00u64 | (byte as u64);
        println!("    write_u8({}): word=0x{:016x}", byte, word);
        let new_hash = hash_word(hash, word);
        println!("    hash after: 0x{:016x}", new_hash);
        new_hash
    }
    
    for s in &["important", "urgent", "reviewed"] {
        println!("Hashing \"{}\":", s);
        let bytes = s.as_bytes();
        let mut hash = 0u64;
        
        println!("  Step 1: write({} bytes)", bytes.len());
        hash = write_bytes(hash, bytes);
        
        println!("  Step 2: write_u8(255)");
        hash = write_u8(hash, 255);
        
        let h2 = (hash >> 57) as u8;
        println!("  Final hash: 0x{:016x}, h2={}\n", hash, h2);
    }
}
