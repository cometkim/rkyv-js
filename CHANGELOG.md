# rkyv-js

## 0.1.0

### Minor Changes

- 4149164: Complete v0.1 redesign:

  - Self-contained codec API.
  - Verified wire-format conformance against rkyv 0.8.14 (fixed e num layouts, swiss-table probing, Rust-compatible key hashing, invalid-pointer sentinels)
  - Format configuration (endianness / pointer width / alignment) is now customizable.
  - Lazy access via explicit `.get(index)` call on `LazyList`, instead of proxy traps.
  - The runtime performance is now comparable to protobufjs.
