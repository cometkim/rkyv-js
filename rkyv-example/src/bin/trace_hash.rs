use std::hash::{Hash, Hasher};
use rkyv::hash::FxHasher64;

/// A tracing hasher that wraps FxHasher64
struct TracingHasher {
    inner: FxHasher64,
}

impl TracingHasher {
    fn new() -> Self {
        Self {
            inner: FxHasher64::default(),
        }
    }
}

impl Hasher for TracingHasher {
    fn write(&mut self, bytes: &[u8]) {
        println!("  write({} bytes): {:?}", bytes.len(), bytes);
        self.inner.write(bytes);
    }

    fn write_u8(&mut self, i: u8) {
        println!("  write_u8({})", i);
        self.inner.write_u8(i);
    }

    fn write_u16(&mut self, i: u16) {
        println!("  write_u16({})", i);
        self.inner.write_u16(i);
    }

    fn write_u32(&mut self, i: u32) {
        println!("  write_u32({})", i);
        self.inner.write_u32(i);
    }

    fn write_u64(&mut self, i: u64) {
        println!("  write_u64({})", i);
        self.inner.write_u64(i);
    }

    fn write_usize(&mut self, i: usize) {
        println!("  write_usize({})", i);
        self.inner.write_usize(i);
    }

    fn finish(&self) -> u64 {
        let result = self.inner.finish();
        println!("  finish() -> 0x{:016x}", result);
        result
    }
}

fn main() {
    for s in &["important", "urgent", "reviewed"] {
        println!("Hashing \"{}\":", s);
        let mut hasher = TracingHasher::new();
        s.hash(&mut hasher);
        let hash = hasher.finish();
        let h2 = (hash >> 57) as u8;
        println!("  Result: hash=0x{:016x}, h2={}\n", hash, h2);
    }
}
