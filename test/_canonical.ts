/**
 * Shared helpers for conformance tests: revive canonical JSON (see
 * conformance/src/canonical_json.rs) and deep-compare decoded values
 * against revived ones.
 */

/** Revive canonical JSON into JS values matching decoded shapes. */
export function revive(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(revive);
  }
  if (value !== null && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    if (typeof obj.$bigint === 'string') {
      return BigInt(obj.$bigint);
    }
    if (typeof obj.$base64 === 'string') {
      return Uint8Array.from(Buffer.from(obj.$base64, 'base64'));
    }
    if (typeof obj.$bits32 === 'string') {
      const view = new DataView(new ArrayBuffer(4));
      view.setUint32(0, parseInt(obj.$bits32, 16));
      return view.getFloat32(0);
    }
    if (typeof obj.$bits64 === 'string') {
      const view = new DataView(new ArrayBuffer(8));
      view.setBigUint64(0, BigInt(`0x${obj.$bits64}`));
      return view.getFloat64(0);
    }
    if (Array.isArray(obj.$map)) {
      return new Map(
        (obj.$map as [unknown, unknown][]).map(([k, v]) => [revive(k), revive(v)]),
      );
    }
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = revive(v);
    }
    return out;
  }
  return value;
}

/**
 * Deep equality between a decoded value and a revived canonical value.
 * `ordered` controls whether Map/Set entry sequences must match (index and
 * btree containers) or only contents (hash containers).
 */
function deepEqual(a: unknown, b: unknown, ordered: boolean): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Object.is(a, b) || (Number.isNaN(a) && Number.isNaN(b));
  }
  if (typeof a !== typeof b) return false;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return a === b;
  }
  if (a instanceof Uint8Array || b instanceof Uint8Array) {
    if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map) || !(b instanceof Map)) return false;
    if (a.size !== b.size) return false;
    if (ordered) {
      const ae = [...a.entries()];
      const be = [...b.entries()];
      return ae.every(([k, v], i) => deepEqual(k, be[i][0], ordered) && deepEqual(v, be[i][1], ordered));
    }
    return unorderedEntriesEqual([...a.entries()], [...b.entries()], ordered);
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set) || !(b instanceof Set)) return false;
    if (a.size !== b.size) return false;
    const ae = [...a].map((v) => [v, null] as [unknown, null]);
    const be = [...b].map((v) => [v, null] as [unknown, null]);
    if (ordered) {
      return ae.every(([v], i) => deepEqual(v, be[i][0], ordered));
    }
    return unorderedEntriesEqual(ae, be, ordered);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i], ordered));
  }
  const ak = Object.keys(a as Record<string, unknown>).sort();
  const bk = Object.keys(b as Record<string, unknown>).sort();
  if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) return false;
  return ak.every((k) =>
    deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], ordered),
  );
}

/** A Set decodes from canonical JSON as a plain array; normalize. */
function setLikeEqual(decoded: Set<unknown>, revived: unknown, ordered: boolean): boolean {
  if (!Array.isArray(revived)) return false;
  if (ordered) {
    return deepEqual([...decoded], revived, ordered);
  }
  return unorderedEntriesEqual(
    [...decoded].map((v) => [v, null]),
    revived.map((v) => [v, null]),
    ordered,
  );
}

function unorderedEntriesEqual(
  a: [unknown, unknown][],
  b: [unknown, unknown][],
  ordered: boolean,
): boolean {
  if (a.length !== b.length) return false;
  const remaining = [...b];
  for (const [ak, av] of a) {
    const idx = remaining.findIndex(([bk, bv]) => deepEqual(ak, bk, ordered) && deepEqual(av, bv, ordered));
    if (idx < 0) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

/**
 * Compare decoded against revived, tolerating the one representational
 * mismatch: decoded Sets appear as plain arrays in canonical JSON.
 */
export function conformanceEqual(decoded: unknown, revived: unknown, ordered: boolean): boolean {
  if (decoded instanceof Set) {
    return setLikeEqual(decoded, revived, ordered);
  }
  if (decoded instanceof Map && Array.isArray(revived)) {
    return false;
  }
  if (
    decoded !== null &&
    revived !== null &&
    typeof decoded === 'object' &&
    typeof revived === 'object' &&
    !(decoded instanceof Map) &&
    !(decoded instanceof Set) &&
    !(decoded instanceof Uint8Array) &&
    !Array.isArray(decoded)
  ) {
    const dk = Object.keys(decoded as Record<string, unknown>).sort();
    const rk = Object.keys(revived as Record<string, unknown>).sort();
    if (dk.length !== rk.length || dk.some((k, i) => k !== rk[i])) return false;
    return dk.every((k) =>
      conformanceEqual(
        (decoded as Record<string, unknown>)[k],
        (revived as Record<string, unknown>)[k],
        ordered,
      ),
    );
  }
  if (Array.isArray(decoded) && Array.isArray(revived)) {
    return (
      decoded.length === revived.length &&
      decoded.every((v, i) => conformanceEqual(v, revived[i], ordered))
    );
  }
  return deepEqual(decoded, revived, ordered);
}

export function inspect(value: unknown): string {
  return (
    JSON.stringify(
      value,
      (_k, v: unknown) => {
        if (typeof v === 'bigint') return `${v}n`;
        if (v instanceof Map) return { $map: [...v.entries()] };
        if (v instanceof Set) return { $set: [...v] };
        if (v instanceof Uint8Array) return { $bytes: [...v] };
        return v;
      },
      1,
    ) ?? 'undefined'
  ).slice(0, 2000);
}
