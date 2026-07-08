//! Verify JS-encoded buffers (`cases/<name>/js.bin`, written by `yarn test`)
//! against real rkyv: bytecheck validation, deserialize + PartialEq against
//! the expected value, archived-container lookups, and byte identity for
//! identical-class cases.

use conformance::cases::all_cases;
use conformance::cases_dir;

fn main() {
    let root = cases_dir();
    let cases = all_cases();

    let mut failures = 0;
    for case in &cases {
        let dir = root.join(case.name);
        match (case.ops)().verify(&dir, case.class) {
            Ok(()) => println!("ok   {} ({})", case.name, case.class.as_str()),
            Err(err) => {
                failures += 1;
                println!("FAIL {} ({}): {err}", case.name, case.class.as_str());
            }
        }
    }

    println!();
    if failures > 0 {
        println!("{failures}/{} cases failed", cases.len());
        std::process::exit(1);
    }
    println!("all {} cases verified", cases.len());
}
