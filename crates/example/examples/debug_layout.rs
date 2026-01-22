//! Debug the binary layout of archived types.

use rkyv::rancor::Error;
use rkyv_js_example::{ArchivedPerson, ArchivedPoint, Person, Point};
use std::mem;

fn main() {
    println!("=== Type sizes ===");
    println!(
        "Point: {} bytes, align {}",
        mem::size_of::<Point>(),
        mem::align_of::<Point>()
    );
    println!(
        "ArchivedPoint: {} bytes, align {}",
        mem::size_of::<ArchivedPoint>(),
        mem::align_of::<ArchivedPoint>()
    );
    println!();
    println!(
        "Person: {} bytes, align {}",
        mem::size_of::<Person>(),
        mem::align_of::<Person>()
    );
    println!(
        "ArchivedPerson: {} bytes, align {}",
        mem::size_of::<ArchivedPerson>(),
        mem::align_of::<ArchivedPerson>()
    );
    println!();

    // Serialize a simple point
    let point = Point { x: 42.5, y: -17.25 };
    let bytes = rkyv::to_bytes::<Error>(&point).unwrap();
    println!("=== Point ===");
    println!("Serialized size: {} bytes", bytes.len());
    println!("Hex: {:02x?}", bytes.as_slice());

    // Access and print field offsets
    let archived = rkyv::access::<ArchivedPoint, Error>(&bytes).unwrap();
    let base = archived as *const _ as usize;
    let x_ptr = &archived.x as *const _ as usize;
    let y_ptr = &archived.y as *const _ as usize;
    println!(
        "Base address (relative to buffer end): {}",
        bytes.len() - (base - bytes.as_ptr() as usize)
    );
    println!("x offset from base: {}", x_ptr - base);
    println!("y offset from base: {}", y_ptr - base);
    println!();

    // Serialize a person
    let person = Person {
        name: "Alice".to_string(),
        age: 30,
        email: Some("alice@example.com".to_string()),
        scores: vec![100, 95, 87, 92],
        active: true,
    };
    let bytes = rkyv::to_bytes::<Error>(&person).unwrap();
    println!("=== Person ===");
    println!("Serialized size: {} bytes", bytes.len());

    // Print hex in rows
    for (i, chunk) in bytes.chunks(16).enumerate() {
        let hex: Vec<String> = chunk.iter().map(|b| format!("{:02x}", b)).collect();
        let ascii: String = chunk
            .iter()
            .map(|&b| {
                if b >= 0x20 && b < 0x7f {
                    b as char
                } else {
                    '.'
                }
            })
            .collect();
        println!("{:04x}: {}  {}", i * 16, hex.join(" "), ascii);
    }
    println!();

    // Access and print field offsets
    let archived = rkyv::access::<ArchivedPerson, Error>(&bytes).unwrap();
    let base = archived as *const _ as usize;
    let buf_start = bytes.as_ptr() as usize;

    println!("Root struct offset from buffer start: {}", base - buf_start);
    println!(
        "Root struct offset from buffer end: {}",
        bytes.len() - (base - buf_start)
    );
    println!();

    println!("Field offsets from struct base:");
    println!("  name: {}", &archived.name as *const _ as usize - base);
    println!("  age: {}", &archived.age as *const _ as usize - base);
    println!("  email: {}", &archived.email as *const _ as usize - base);
    println!("  scores: {}", &archived.scores as *const _ as usize - base);
    println!("  active: {}", &archived.active as *const _ as usize - base);
    println!();

    println!("Values:");
    println!("  name: \"{}\"", archived.name.as_str());
    println!("  age: {}", archived.age);
    println!("  email: {:?}", archived.email.as_ref().map(|s| s.as_str()));
    println!("  scores: {:?}", archived.scores.as_slice());
    println!("  active: {}", archived.active);

    // Detailed email field debug
    println!();
    println!("=== Email field detail ===");
    let email_offset = &archived.email as *const _ as usize - base;
    println!("Email field at struct offset: {}", email_offset);
    println!(
        "Email field absolute offset: {}",
        base - buf_start + email_offset
    );

    // Print raw bytes of the email field (Option<ArchivedString> = 12 bytes)
    let email_abs = base - buf_start + email_offset;
    println!(
        "Email raw bytes (12 bytes): {:02x?}",
        &bytes[email_abs..email_abs + 12]
    );

    // Option tag
    println!("  tag byte: 0x{:02x}", bytes[email_abs]);

    // ArchivedString starts at email_abs + 4 (after tag + padding)
    let str_offset = email_abs + 4;
    println!("  string field starts at: {}", str_offset);
    println!(
        "  string raw bytes (8 bytes): {:02x?}",
        &bytes[str_offset..str_offset + 8]
    );

    // Parse the string
    let first_byte = bytes[str_offset];
    println!(
        "  first_byte: 0x{:02x} (high bit = {})",
        first_byte,
        (first_byte & 0x80) != 0
    );

    if first_byte & 0x80 != 0 {
        // Out-of-line
        let length_byte = first_byte & 0x7f;
        println!("  out-of-line: length from first byte = {}", length_byte);

        // Read the u32 length field
        let len_u32 = u32::from_le_bytes([
            bytes[str_offset],
            bytes[str_offset + 1],
            bytes[str_offset + 2],
            bytes[str_offset + 3],
        ]);
        println!("  u32 at offset: 0x{:08x}", len_u32);
        println!("  masked length: {}", len_u32 & 0x7fffffff);

        // Relative pointer
        let rel_ptr = i32::from_le_bytes([
            bytes[str_offset + 4],
            bytes[str_offset + 5],
            bytes[str_offset + 6],
            bytes[str_offset + 7],
        ]);
        println!("  relative pointer: {}", rel_ptr);
        println!(
            "  string data at absolute offset: {}",
            (str_offset as i32 + rel_ptr) as usize
        );
    }

    debug_message();
    debug_empty_string();
    debug_string_decode();
    debug_empty_vec();
    debug_person_no_email();
}

// Debug Message enum layout
fn debug_message() {
    use rkyv_js_example::{ArchivedMessage, Message};
    use std::mem;

    println!();
    println!("=== Message enum ===");
    println!(
        "Message size: {}, align: {}",
        mem::size_of::<Message>(),
        mem::align_of::<Message>()
    );
    println!(
        "ArchivedMessage size: {}, align: {}",
        mem::size_of::<ArchivedMessage>(),
        mem::align_of::<ArchivedMessage>()
    );

    // Serialize ChangeColor
    let msg = Message::ChangeColor(255, 128, 0);
    let bytes = rkyv::to_bytes::<rkyv::rancor::Error>(&msg).unwrap();
    println!();
    println!("ChangeColor serialized: {} bytes", bytes.len());
    println!("Hex: {:02x?}", bytes.as_slice());
}

// Debug empty string
fn debug_empty_string() {
    use rkyv::rancor::Error;

    println!();
    println!("=== Empty String ===");
    let empty = String::new();
    let bytes = rkyv::to_bytes::<Error>(&empty).unwrap();
    println!("Empty string serialized: {} bytes", bytes.len());
    println!("Hex: {:02x?}", bytes.as_slice());
}

// Debug string decoding
fn debug_string_decode() {
    use rkyv::rancor::Error;
    use rkyv::string::ArchivedString;
    
    println!();
    println!("=== String Decode Test ===");
    
    // Empty string
    let empty = String::new();
    let bytes = rkyv::to_bytes::<Error>(&empty).unwrap();
    let archived = rkyv::access::<ArchivedString, Error>(&bytes).unwrap();
    println!("Empty string decoded: \"{}\"", archived.as_str());
    println!("Empty string length: {}", archived.len());
    
    // Short string
    let short = "hi".to_string();
    let bytes = rkyv::to_bytes::<Error>(&short).unwrap();
    println!("Short string hex: {:02x?}", bytes.as_slice());
    let archived = rkyv::access::<ArchivedString, Error>(&bytes).unwrap();
    println!("Short string decoded: \"{}\"", archived.as_str());
}

// Debug empty Vec
fn debug_empty_vec() {
    use rkyv::rancor::Error;
    
    println!();
    println!("=== Empty Vec ===");
    let empty: Vec<u32> = vec![];
    let bytes = rkyv::to_bytes::<Error>(&empty).unwrap();
    println!("Empty Vec<u32> serialized: {} bytes", bytes.len());
    println!("Hex: {:02x?}", bytes.as_slice());
}

// Debug person_no_email
fn debug_person_no_email() {
    use rkyv::rancor::Error;
    use rkyv_js_example::{Person, ArchivedPerson};
    
    println!();
    println!("=== Person (no email) ===");
    let person = Person {
        name: "Bob".to_string(),
        age: 25,
        email: None,
        scores: vec![],
        active: false,
    };
    let bytes = rkyv::to_bytes::<Error>(&person).unwrap();
    println!("Serialized size: {} bytes", bytes.len());
    
    // Print hex in rows
    for (i, chunk) in bytes.chunks(16).enumerate() {
        let hex: Vec<String> = chunk.iter().map(|b| format!("{:02x}", b)).collect();
        println!("{:04x}: {}", i * 16, hex.join(" "));
    }
    
    let archived = rkyv::access::<ArchivedPerson, Error>(&bytes).unwrap();
    let base = archived as *const _ as usize;
    let buf_start = bytes.as_ptr() as usize;
    
    println!("Root offset: {}", base - buf_start);
    println!("scores offset in struct: {}", &archived.scores as *const _ as usize - base);
}
