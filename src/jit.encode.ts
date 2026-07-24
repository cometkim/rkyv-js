/**
 * Encode-side JIT entry: `compileEncoder` for encoder-only codecs
 * (`rkyv-js/encode`, `rkyv-js/lib/*\/encode`).
 *
 * The twin of `rkyv-js/jit`'s `compileCodec` for unidirectional bindings —
 * value-imports only the encode emitter, so an encode-only bundle that opts
 * into JIT still never pulls in the reader or lazy-view machinery. Full
 * codecs satisfy the encoder contract too, but compiling one here compiles
 * only its `archive`/`resolve`; use `compileCodec` for the whole surface.
 */

import { BaseEncoder, FormatBoundEncoder, type Encoder } from './core/encoder.ts';
import { DEFAULT_FORMAT, type RkyvFormat } from './core/format.ts';
import { canEval, type CompileOptions } from './core/jit.ts';
import { buildEncoderSource, compileWritePair, type WritePair } from './core/jit-encode.ts';
import type { Layout } from './core/base.ts';
import type { RkyvHasher } from './core/hasher.ts';
import type { RkyvTextEncoder, RkyvWriter } from './core/writer.ts';

export type { CompileOptions } from './core/jit.ts';

class CompiledEncoder<T> extends BaseEncoder<T> {
  /** The interpreter encoder this wrapper compiles (introspection surface). */
  readonly target: Encoder<T, any, any>;
  #format: RkyvFormat | null = null;
  #pair: WritePair | null = null;
  #pairs: Map<RkyvFormat, WritePair | null> | null = null;

  constructor(target: Encoder<T, any, any>) {
    super({ inline: target.inline, hashable: target.hashable });
    this.target = target;
  }

  /** Null when the root shape stays on the interpreter (dep-call territory). */
  #pairFor(fmt: RkyvFormat): WritePair | null {
    if (fmt === this.#format) return this.#pair;
    let pair = this.#pairs?.get(fmt);
    if (pair === undefined) {
      pair = compileWritePair(this.target, fmt);
      (this.#pairs ??= new Map()).set(fmt, pair);
    }
    this.#format = fmt;
    this.#pair = pair;
    return pair;
  }

  /** Compile eagerly for `fmt` so the first hot-path call pays nothing. */
  prewarm(fmt: RkyvFormat): this {
    this.#pairFor(fmt);
    return this;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.target.layout(fmt);
  }

  archive(writer: RkyvWriter, value: T): any {
    const pair = this.#pairFor(writer.format);
    return pair !== null && pair.archive !== null
      ? pair.archive(writer, value)
      : this.target.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: any): number {
    const pair = this.#pairFor(writer.format);
    return pair !== null
      ? pair.resolve(writer, value, resolver)
      : this.target.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.target.hash(hasher, value, encoder);
  }
}

/**
 * Compile an encoder into a specialized drop-in replacement.
 *
 * The returned encoder has the identical surface (`encode`/`encodeInto`/
 * `archive`/`resolve`/`hash`/…), so it can replace the interpreter encoder
 * at a single boundary. Opaque children (maps, custom codecs, recursion)
 * stay as interpreter dep calls with per-site monomorphic dispatch.
 */
export function compileEncoder<T>(
  encoder: Encoder<T, any, any>,
  options: CompileOptions = {},
): Encoder<T, any, any> {
  // Fail fast on a non-encoder: compilation itself would succeed (it only
  // walks `meta`) and writes would then throw — or silently work for
  // dep-free shapes — deep inside generated source.
  if (typeof encoder.resolve !== 'function') {
    throw new TypeError(
      "compileEncoder requires an encoder: missing resolve, for decoder-only codecs use compileDecoder from 'rkyv-js/jit/decode'",
    );
  }
  if (!canEval()) {
    if (options.onUnsupported === 'throw') {
      throw new Error('compileEncoder requires new Function (blocked by CSP in this environment)');
    }
    return encoder;
  }
  // Format-bound encoders compile for their pinned format and re-wrap.
  if (encoder.constructor === FormatBoundEncoder) {
    const bound = encoder as FormatBoundEncoder<T>;
    const compiled = new CompiledEncoder<T>(bound.inner).prewarm(bound.format);
    return new FormatBoundEncoder(compiled, bound.format);
  }
  const compiled = new CompiledEncoder(encoder);
  // Compile eagerly for the requested (or default) format so first use is hot.
  return compiled.prewarm(options.format ?? DEFAULT_FORMAT);
}

/**
 * Emit the generated encoder (archive/resolve pair) source for an encoder —
 * exactly the source `compileEncoder` evaluates, or null when the root shape
 * stays on the interpreter (dep-call territory). Full codecs are encoders.
 */
export function emitEncoderSource(
  encoder: Encoder<unknown, any, any>,
  format: RkyvFormat = DEFAULT_FORMAT,
): string | null {
  return buildEncoderSource(encoder, format)?.src ?? null;
}
