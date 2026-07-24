/**
 * Shared JIT emit machinery: the emit context, budget, and eval gate used by
 * both direction emitters. Direction-neutral by construction — everything
 * writer- or reader-specific lives in `jit-decode.ts` / `jit-encode.ts`, so
 * a unidirectional entry pulls in only its half.
 */

import type { RkyvFormat } from './format.ts';
import type { StringLayout } from './layout.ts';
import type { RkyvReader } from './reader.ts';
import type { RkyvWriter } from './writer.ts';

export interface CompileOptions {
  /** Format to compile for eagerly. Other formats compile on first use. */
  format?: RkyvFormat;
  /**
   * Behavior when `new Function` is unavailable (CSP)
   *
   * - `'fallback'` returns the interpreter codec unchanged,
   * - `'throw'` raises.
   *
   * @default 'fallback'
   */
  onUnsupported?: 'fallback' | 'throw';
}

// Emitted-source budget: a subtree that would exceed this many nodes is left
// as an interpreter dep call instead of being inlined.
export const NODE_BUDGET = 400;

// ============================================================================
// Recognition
// ============================================================================
// Shape dispatch switches on the public numeric `meta.kind` tag — the
// codec's own behavioral promise that its read/resolve implement the
// standard algorithm for the declared shape. Codecs without a declared
// shape (maps, transforms, custom codecs, subclasses that reset `meta` to
// opaque) stay interpreter dep calls, never mis-inlined.

/** A field name whose emitted object-literal semantics would diverge. */
export function unsafeName(name: string): boolean {
  return name === '__proto__';
}

/**
 * Compose an offset expression, constant-folding `base + a + b` chains so
 * emitted (and snapshotted) source stays readable.
 */
export function addOffset(off: string, add: number): string {
  if (add === 0) return off;
  const m = /^([A-Za-z_]\w*)(?: \+ (\d+))?$/.exec(off);
  if (m !== null) return `${m[1]} + ${Number(m[2] ?? 0) + add}`;
  return `${off} + ${add}`;
}

// ============================================================================
// Emit context
// ============================================================================

export class EmitCtx<D> {
  readonly fmt: RkyvFormat;
  readonly deps: D[] = [];
  readonly helpers: string[] = [];
  nodes = 0;
  #helperId = 0;
  #stringHelper: string | null = null;
  readonly ancestors: Set<object> = new Set();
  /** Per-vec-codec write-loop helper names (null = stays a dep call). */
  readonly vecWriteHelpers: Map<object, string | null> = new Map();

  constructor(fmt: RkyvFormat) {
    this.fmt = fmt;
  }

  dep(codec: D): number {
    const existing = this.deps.indexOf(codec);
    if (existing >= 0) return existing;
    this.deps.push(codec);
    return this.deps.length - 1;
  }

  helperName(): string {
    return `h${this.#helperId++}`;
  }

  /**
   * Hoisted string reader: inline-repr ASCII fast path, everything else
   * (non-ASCII or out-of-line) delegates to the interpreter string codec —
   * the gnarly out-of-line length decode stays single-source.
   */
  stringHelper(layout: StringLayout): string {
    if (this.#stringHelper === null) {
      this.#stringHelper = this.helperName();
      this.helpers.push(
        `function ${this.#stringHelper}(r, o, k) {\n` +
          `  var b = r.buffer;\n` +
          `  if ((b[o] & 0xc0) !== 0x80) {\n` +
          `    var s = '';\n` +
          `    for (var i = 0; i < ${layout.inlineCapacity}; i++) {\n` +
          `      var c = b[o + i];\n` +
          `      if (c === 0xff) return s;\n` +
          `      if (c > 0x7f) return d[k].read(r, o);\n` +
          `      s += String.fromCharCode(c);\n` +
          `    }\n` +
          `    return s;\n` +
          `  }\n` +
          `  return d[k].read(r, o);\n` +
          `}`,
      );
    }
    return this.#stringHelper;
  }
}

// ============================================================================
// Compilation units
// ============================================================================

export type ReadFn = (reader: RkyvReader, offset: number) => unknown;
export type ArchiveFn = (writer: RkyvWriter, value: unknown) => unknown;
export type ResolveFn = (writer: RkyvWriter, value: unknown, resolver: unknown) => number;

export interface EmittedSource<D> {
  src: string;
  deps: D[];
}

let evalAvailable: boolean | null = null;

export function canEval(): boolean {
  if (evalAvailable === null) {
    try {
      new Function('return 0');
      evalAvailable = true;
    } catch {
      evalAvailable = false;
    }
  }
  return evalAvailable;
}
