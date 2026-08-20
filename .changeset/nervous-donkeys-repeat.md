---
"rkyv-js": minor
"rkyv-js-codegen": minor
---

**BREAKING:** the unidirectional entry points are renamed to match their module names.

Every direction-split module is a sibling file of the module it splits (`src/lib/hashmap.decode.ts` next to `src/lib/hashmap.ts`), but the export subpath spelled it as a directory. The specifier now mirrors the file:

| before | after |
|--------|-------|
| `rkyv-js/lib/hashmap/decode` | `rkyv-js/lib/hashmap.decode` |
| `rkyv-js/lib/hashmap/encode` | `rkyv-js/lib/hashmap.encode` |
| `rkyv-js/jit/decode` | `rkyv-js/jit.decode` |
| `rkyv-js/jit/encode` | `rkyv-js/jit.encode` |

The same applies to `lib/uuid`, `lib/bytes`, `lib/btreemap`, and `lib/indexmap`. The old specifiers are gone, not deprecated.

Migrate imports in one pass with `s|rkyv-js/(lib/[a-z]+\|jit)/(decode\|encode)|rkyv-js/$1.$2|`.

In codegen, `set_direction` emits the new specifiers, so bindings generated with this version require the matching `rkyv-js` release.
