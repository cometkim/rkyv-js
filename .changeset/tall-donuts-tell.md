---
"rkyv-js": patch
---

Fix broken entry points in the published package. Publishing now goes through `yarn npm publish`, which applies the `publishConfig` overrides.
