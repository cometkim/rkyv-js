# rkyv-js

 [![npm](https://img.shields.io/npm/v/rkyv-js.svg)](https://npmx.dev/package/rkyv-js)
 [![LICENSE - MIT](https://img.shields.io/github/license/cometkim/rkyv-js)](#license)

An unofficial library to use [rkyv] (zero-copy deserialization framework for Rust) in JavaScript/TypeScript projects, a wire protocol for Rust-JS interop with no schema files.

## Motivation

This library allows JavaScript programs to efficiently exchange data with a Rust backend using rkyv types.

- Archived Rust types can be read directly from JS programs without an additional deserialization/transform layer.
- Bytes written in JS programs can be read in Rust programs in a zero-copy manner, including archived hash map lookups, which work byte-for-byte like Rust's own.
- Unlike Protobuf or Cap'n Proto, the type is derived directly from your Rust codebase without having to manage additional schema files.

Wire compatibility is enforced by a bidirectional conformance suite: every release is verified against a pinned rkyv version (currently **0.8.14**).

## Components

- [`rkyv-js`](#): JavaScript runtime for encoding/decoding rkyv archives. Documented here.
- [`rkyv-js-codegen`](rkyv-js-codegen): Generates JavaScript codec bindings from Rust source. Documented on [docs.rs](https://docs.rs/rkyv-js-codegen).
- [`rkyv-example`](rkyv-example) is an example project for exercising both.

## Installation

```bash
yarn add rkyv-js
```

```toml
[build-dependencies]
rkyv-js-codegen = "0.1"
```

Requires Node.js ≥ 22.18 (or any runtime with `TextEncoder`/`DataView`; the package ships plain ESM).

## Quick Start

### Option 1: Code generation (recommended)

Annotate your Rust types with `#[derive(Archive)]`:

```rust
use rkyv::{Archive, Deserialize, Serialize};

#[derive(Archive, Serialize, Deserialize)]
struct Person {
    name: String,
    age: u32,
    email: Option<String>,
    scores: Vec<u32>,
}
```

Configure the output in your `build.rs`:

```rust
use rkyv_js_codegen::CodeGenerator;

fn main() -> Result<(), rkyv_js_codegen::Error> {
    CodeGenerator::new()
        .add_source_file("src/lib.rs")?
        .write_to_file("generated/bindings.ts")?;

    println!("cargo:rerun-if-changed=src/lib.rs");
    Ok(())
}
```

Then you can import generated codecs from `generated/bindings` in your JavaScript/TypeScript project like:

```typescript
import { ArchivedPerson, type Person } from './generated/bindings.ts';

const bytes = ArchivedPerson.encode(person); // Uint8Array
const person = ArchivedPerson.decode(bytes); // plain object
const lazy = ArchivedPerson.access(bytes);   // lazy view, fields decode partially on read
```

### Option 2: Manual schema definition

```typescript
import * as r from 'rkyv-js';

const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.option(r.string),
  scores: r.vec(r.u32),
});

// TypeScript types always derive from the codec:
type Person = r.Infer<typeof ArchivedPerson>;

const data = ArchivedPerson.encode({
  name: 'Alice',
  age: 30,
  email: 'alice@example.com',
  scores: [95, 87, 92],
});

const person = ArchivedPerson.decode(data);
```

## Lazy access

`access()` returns a view whose fields decode only when read, the fastest way to read a few fields out of a large archive:

```typescript
const lazy = ArchivedPerson.access(bytes);
lazy.name;              // decodes only `name` (memoized)
lazy.scores.at(1);      // decodes only one element
lazy.scores.length;     // free
[...lazy.scores];       // iterable
lazy.scores.toArray();  // eager copy of the sequence
JSON.stringify(lazy);   // works (decodes everything)
```

Sequences appear as `LazyList<E>` (`length`, `at`, iteration, `toArray`) rather than plain arrays.

For full traversals of plain data, `decode()` is faster than `access()`, reach for `access()` when you read a subset.

## Codec API

### Primitives

| Rust type | Codec | TypeScript type |
|-----------|-------|-----------------|
| `u8`, `i8`, `u16`, `i16`, `u32`, `i32` | `r.u8` … `r.i32` | `number` |
| `u64`, `i64` | `r.u64`, `r.i64` | `bigint` |
| `f32`, `f64` | `r.f32`, `r.f64` | `number` |
| `bool` | `r.bool` | `boolean` |
| `char` | `r.char` | `string` (one scalar value) |
| `()` | `r.unit` | `null` |
| `String` | `r.string` | `string` |

### Containers

| Rust type | Codec | TypeScript type |
|-----------|-------|-----------------|
| `Vec<T>` | `r.vec(T)` | `T[]` |
| `Option<T>` | `r.option(T)` | `T \| null` |
| `Box<T>` | `r.box(T)` | `T` |
| `[T; N]` | `r.array(T, N)` | `T[]` |
| `(T1, T2, …)` | `r.tuple(T1, T2, …)` | `[T1, T2, …]` |

### Structs & enums

From Rust source:

```rust
#[derive(Archive)]
enum Shape {
    Circle { radius: f64 },
    Wrap(String),
    Color(u8, u8, u8),
    Empty,
}
```

Into JavaScript:

```typescript
const ArchivedShape = r.taggedEnum({
  Circle: { radius: r.f64 },  // struct variant → record of codecs
  Wrap: r.string,             // newtype variant → bare codec
  Color: [r.u8, r.u8, r.u8],  // tuple variant → array of codecs
  Empty: null,                // unit variant
});
```

Enum variants are laid out exactly like rkyv's `repr(u8)` enums (fields flattened after the tag).

### Smart pointers


| Rust type | Codec | TypeScript type |
|-----------|-------|-----------------|
| `Rc<T>`, `Arc<T>`, `triomphe::Arc<T>` | `r.rc(T)` | `T` |
| `rc::Weak<T>`, `sync::Weak<T>` | `r.weak(T)` | `T \| null` |

### External crate types

The codegen recognizes types from [external crates that rkyv supports](https://docs.rs/rkyv/latest/rkyv/#crates):


| Rust type | Codec |
|-----------|-------|
| `uuid::Uuid` | `import { uuid } from 'rkyv-js/lib/uuid'` → `string` |
| `bytes::Bytes` | `import { bytes } from 'rkyv-js/lib/bytes'` → `Uint8Array` (zero-copy view) |
| `BTreeMap<K, V>` / `BTreeSet<T>` | `btreeMap` / `btreeSet` from `rkyv-js/lib/btreemap` → `Map` / `Set` |
| `HashMap<K, V>` / `HashSet<T>` (std & hashbrown) | `hashMap` / `hashSet` from `rkyv-js/lib/hashmap` → `Map` / `Set` |
| `indexmap::IndexMap` / `IndexSet` | `indexMap` / `indexSet` from `rkyv-js/lib/indexmap` → `Map` / `Set` (insertion-ordered) |
| `smol_str::SmolStr` | `r.string` |
| `VecDeque`, `ThinVec`, `ArrayVec`, `SmallVec`, `TinyVec` | `r.vec(T)` |


### Map keys

Archived hash containers require keys that hash exactly like Rust's `Hash` implementations (rkyv-js ships a cross-platform FxHasher64 - rkyv's default archived hasher). Supported key types: strings, integers (including `u64`/`i64`), `bool`, `char`, `uuid`, and structs/tuples composed of those. Codecs advertise this via `codec.hashable`; `hashMap()` throws at construction for unhashable keys. Floats (not `Eq` in Rust) and sequences are not supported as keys.

Maps archived with a custom `H` (a manual `serialize_from_iter` impl) can pass any `RkyvHasher` through the `hasher` option; `rkyv-js/lib/fx-hasher` exports the default `FxHasher`, and `rkyv-js/lib/sip-hasher` ships a `SipHasher13` (zero keys by default, `new SipHasher13(k0, k1)` for `new_with_keys`, keys must be fixed constants shared with the Rust side).

JS-encoded maps are fully searchable from Rust. `archived.map.get(key)` works, at any size.

## Format configuration

rkyv's non-default wire formats are supported end-to-end:

```typescript
import { format } from 'rkyv-js/core';

const be64 = format({ endian: 'big', pointerWidth: 64 });
const bytes = ArchivedPerson.encode(person, be64);
const person = ArchivedPerson.decode(bytes, be64);

// Or pin a codec to a format once:
const Pinned = r.withFormat(ArchivedPerson, be64);
Pinned.encode(person);
```


| Option | rkyv default | rkyv feature |
|--------|--------------|--------------|
| `endian` | `'little'` | `big_endian` |
| `pointerWidth` | `32` | `pointer_width_16` / `pointer_width_64` |
| `aligned` | `true` | `unaligned` |

In codegen, `set_format(...)` emits a `FORMAT` constant and wraps every export with `r.withFormat`, matching the Rust crate's compile-time features. Non-default formats are conformance-tested with a reduced smoke matrix.

## Unidirectional codecs

The runtime ships every codec in three directions.

full (`rkyv-js`), decode-only (`rkyv-js/decode`), and encode-only (`rkyv-js/encode`), with identical factory names, so switching direction is switching an import path:

```typescript
import * as r from 'rkyv-js/decode';

const ArchivedPerson = r.struct({ /* same schema */ });
ArchivedPerson.decode(bytes);   // ✓
ArchivedPerson.access(bytes);   // ✓
// .encode() does not exist on this chain
```

Class methods can't be tree-shaken, so a full codec always carries both halves; the one-direction modules cut the unused half out at the module-graph level.

Measured on a Person + hash-map binding set (min+gz): 3.3 KB decode-only / 4.7 KB encode-only vs 7.8 KB full (−57% / −40%).

The decode chain never pulls in the writer, a hasher, or the swiss-table builder; the encode chain never pulls in the reader or the lazy-view machinery.

External-crate codecs split the same way (`rkyv-js/lib/hashmap/decode`, etc).

In codegen, `set_direction` rewrites only the rkyv-js import specifiers in the emitted bindings (registered externals are untouched), so a browser client and a Rust-facing service can share one schema with direction-matched bundles:

```rust
codegen.set_direction(Direction::Decode); // bindings import from rkyv-js/decode
```

At the type level, `Decoder<T>` and `Encoder<T>` are the public contracts. 

A full `Codec` satisfies both, and containers accept full and one-direction children interchangeably.

## Opt-in JIT compilation

`rkyv-js/jit` pre-compiles a codec into specialized read/write functions with `new Function`, field offsets become integer constants and every remaining child call gets its own monomorphic call site, the property that makes per-message codegen (protobufjs-style) fast:

```typescript
import { compileCodec } from 'rkyv-js/jit';

const Compiled = compileCodec(ArchivedPerson);
Compiled.decode(bytes);    // specialized read
Compiled.encode(person);   // specialized archive/resolve (struct & tuple roots)
```

The result is a drop-in codec with the identical surface; swap it in at one boundary.

- Measured 1.14–1.22x faster encode over the interpreter on the comparison payloads; the decode gain is smaller and too noisy on V8 to quote. On tiny messages the wrapper overhead can outweigh the win — benchmark your own shapes.
- The default import path never touches this module, and where `new Function` is blocked (CSP) `compileCodec` returns the interpreter codec unchanged (pass `{ onUnsupported: 'throw' }` to raise instead).
- Maps, custom codecs, and recursive types stay on the interpreter behind monomorphic call sites. Generated source receives untrusted content only through `JSON.stringify`-quoted property names.
- `emitDecoderSource(codec)` / `emitEncoderSource(codec)` return the exact source `compileCodec` evaluates (snapshot-friendly).
- Custom codecs can opt into inlining by declaring their shape descriptor (`meta` in `defineCodec`).

## Custom codecs

Implement `Codec` for full control over a type's binary format — extend the class or use the object-literal helper:

```typescript
import { transform, string } from 'rkyv-js';

// e.g. a field serialized as a JSON string on the Rust side:
export const Coord = transform(
  string,
  (json): Coord => JSON.parse(json),
  (coord: Coord): string => JSON.stringify(coord),
);
```

`defineCodec(spec)` accepts the low-level two-phase contract (`layout`, `read`, `archive`, `resolve`, optional `readLazy`/`hash`), mirroring rkyv's Archive/Resolver model.

## Code generation

Bindings are generated from your Rust source by the [`rkyv-js-codegen`](https://crates.io/crates/rkyv-js-codegen) crate, driven from `build.rs` as shown in [Quick Start](#option-1-code-generation-recommended).

Beyond the defaults it covers:

- Source extraction: `add_source_file` / `add_source_dir` / `add_source_str`, with `use` imports resolved to fully-qualified paths and a configurable `#[derive(Archive)]` marker. Unmappable types are hard errors carrying source locations and did-you-mean suggestions.
- External types: register any crate's types against a typed codec-expression tree, including generic arity and trailing hasher/allocator parameters.
- `with`-wrappers and remote types: `rkyv::with::{AsBox, Inline, InlineAsBox, Skip}` are built in; `#[rkyv(with = ...)]` and `#[rkyv(remote = ...)]` resolve through an extensible registry.
- Output shaping: `set_direction` for the unidirectional builds above, `set_format` for non-default wire formats, `set_archived_name` for `#[rkyv(archived = ...)]`, and a plain-JavaScript mode.
- Programmatic API: declare structs, enums, and aliases directly, without parsing any Rust.

See **[docs.rs/rkyv-js-codegen](https://docs.rs/rkyv-js-codegen)** for the full API.

## Conformance & guarantees

- Tested against **rkyv 0.8.14** (pinned; `conformance/cases/manifest.json` records the version). rkyv patch bumps can legitimately change wire bytes - regenerate goldens when bumping.
- The committed golden suite covers primitives at boundary values, string length boundaries, float specials, options, sequences, mixed-alignment enums, pointers, hash/index/btree containers at multiple sizes and key types, external crate types, and non-default format profiles. CI regenerates goldens and fails on diff.
- `cargo run -p conformance --bin verify` proves JS output with rkyv itself: `bytecheck` validation, deserialization + `PartialEq`, and archived-map key lookups.

### Limitations

- **No input validation**: like rkyv's `access_unchecked`, decoding assumes trusted bytes. Do not decode untrusted data.
- **No shared-pointer dedup on encode**: rkyv writes shared `Rc`/`Arc` data once; rkyv-js writes one copy per occurrence (semantically equal, not byte-identical). Consequently, a *live* `Weak` encoded from JS deserializes as dangling in Rust; dead weaks work exactly.
- `Option<Option<T>>`'s `Some(None)` is not representable in the JS value model (`T | null` collapses it).
- Hash map re-encoding is semantically equal but not byte-identical (bucket placement depends on insertion sequence); index maps and B-trees re-encode byte-identically.
- Trait objects (`rkyv_dyn`) are not supported.

## Performance

Measured against [protobufjs] 8.7.0, [capnp-es] 0.0.14, [cbor-x] 1.6.4

- Decode is a tie with protobufjs, slightly behind on the smallest payloads.
- Encode is generally better than protobufjs.
- Lazy `access()` can be more than twice as fast when reading only parts of the payload. On a full traversal, it is slower than `decode()`.
- `rkyv-js/jit` generally adds a 20% perf gain over the interpreter.
- cbor-x decodes the small payloads faster than rkyv-js; capnp-es was slower than protobufjs on every row of this suite.

These are microbenchmarks on three fixed payload shapes; Run them against your own before drawing conclusions: `yarn bench:*`.

## Why use rkyv-js over alternatives?

This library doesn't claim or aim for best-in-class performance. It heavily depends on the codec design of rkyv. However, the goal is to make it comparable to using schema-based codecs such as Protobuf or Cap'n Proto.

The advantages of the library are inherited from rkyv. Rust codebase as schema, and zero-copy deserialization where possible.

## Development

```bash
yarn test                  # unit + conformance (JS side)
yarn check                 # typecheck (isolatedDeclarations enforced on src)
yarn conformance:generate  # regenerate golden cases (Rust)
yarn conformance:verify    # verify JS output with real rkyv
yarn bench:comparison      # protobufjs/cbor-x/capnp-es comparison
yarn build                 # dist/ via amaro (type stripping) + oxc (declarations)
```

## License

MIT

[rkyv]: https://rkyv.org/
[protobufjs]: https://github.com/protobufjs/protobuf.js
[capnp-es]: https://github.com/unjs/capnp-es
[cbor-x]: https://github.com/kriszyp/cbor-x
