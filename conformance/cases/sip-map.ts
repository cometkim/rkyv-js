/**
 * Hand-written codec for the `SipKeyedMap` conformance type: a
 * `HashMap<String, u32>` archived with `H = SipHasher13` instead of rkyv's
 * default `FxHasher64` (see `conformance/src/types.rs`). The generated
 * bindings import this via the `register_external` mapping in
 * `src/bin/generate.rs`.
 */

import * as r from 'rkyv-js';
import type { Codec } from 'rkyv-js/core';
import { hashMap } from 'rkyv-js/lib/hashmap';

import { SipHasher13 } from './sip-hasher.ts';

export const SipKeyedMap: Codec<Map<string, number>> = hashMap(r.string, r.u32, {
  hasher: { create: () => new SipHasher13() },
});
