/**
 * Decode-side JIT entry: `compileDecoder` for decoder-only codecs
 * (`rkyv-js/decode`, `rkyv-js/lib/*\/decode`).
 *
 * The twin of `rkyv-js/jit`'s `compileCodec` for unidirectional bindings —
 * value-imports only the decode emitter, so a decode-only bundle that opts
 * into JIT still never pulls in the writer, the swiss-table builder, or a
 * hasher. Full codecs satisfy the decoder contract too, but compiling one
 * here compiles only its `read`; use `compileCodec` for the whole surface.
 */

import { BaseDecoder, FormatBoundDecoder, type Decoder } from './core/decoder.ts';
import { DEFAULT_FORMAT, type RkyvFormat } from './core/format.ts';
import { canEval, type CompileOptions, type ReadFn } from './core/jit.ts';
import { buildDecoderSource, compileReadFn } from './core/jit-decode.ts';
import type { Layout } from './core/base.ts';
import type { RkyvReader } from './core/reader.ts';

export type { CompileOptions } from './core/jit.ts';

class CompiledDecoder<T> extends BaseDecoder<T> {
  /** The interpreter decoder this wrapper compiles (introspection surface). */
  readonly target: Decoder<T, any>;
  #format: RkyvFormat | null = null;
  #read: ReadFn | null = null;
  #reads: Map<RkyvFormat, ReadFn> | null = null;

  constructor(target: Decoder<T, any>) {
    super({ inline: target.inline, hashable: target.hashable });
    this.target = target;
  }

  #readFor(fmt: RkyvFormat): ReadFn {
    if (fmt === this.#format) return this.#read as ReadFn;
    let read = this.#reads?.get(fmt);
    if (read === undefined) {
      read = compileReadFn(this.target, fmt);
      (this.#reads ??= new Map()).set(fmt, read);
    }
    this.#format = fmt;
    this.#read = read;
    return read;
  }

  /** Compile eagerly for `fmt` so the first hot-path call pays nothing. */
  prewarm(fmt: RkyvFormat): this {
    this.#readFor(fmt);
    return this;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.target.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#readFor(reader.format)(reader, offset) as T;
  }

  // Lazy access views are already per-field monomorphic — delegate.
  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.target.readLazy(reader, offset);
  }
}

/**
 * Compile a decoder into a specialized drop-in replacement.
 *
 * The returned decoder has the identical surface (`decode`/`access`/`read`/
 * `readLazy`/…), so it can replace the interpreter decoder at a single
 * boundary. Opaque children (maps, custom codecs, recursion) stay as
 * interpreter dep calls with per-site monomorphic dispatch.
 */
export function compileDecoder<T>(
  decoder: Decoder<T, any>,
  options: CompileOptions = {},
): Decoder<T, any> {
  // Fail fast on a non-decoder: compilation itself would succeed (it only
  // walks `meta`) and reads would then throw — or silently work for
  // dep-free shapes — deep inside generated source.
  if (typeof decoder.read !== 'function') {
    throw new TypeError(
      "compileDecoder requires a decoder: missing read, for encoder-only codecs use compileEncoder from 'rkyv-js/jit/encode'",
    );
  }
  if (!canEval()) {
    if (options.onUnsupported === 'throw') {
      throw new Error('compileDecoder requires new Function (blocked by CSP in this environment)');
    }
    return decoder;
  }
  // Format-bound decoders compile for their pinned format and re-wrap.
  if (decoder.constructor === FormatBoundDecoder) {
    const bound = decoder as FormatBoundDecoder<T>;
    const compiled = new CompiledDecoder<T>(bound.inner).prewarm(bound.format);
    return new FormatBoundDecoder(compiled, bound.format);
  }
  const compiled = new CompiledDecoder(decoder);
  // Compile eagerly for the requested (or default) format so first use is hot.
  return compiled.prewarm(options.format ?? DEFAULT_FORMAT);
}

/**
 * Emit the generated decoder (read) source for a decoder — exactly the
 * source `compileDecoder` evaluates. Full codecs are decoders.
 */
export function emitDecoderSource(
  decoder: Decoder<unknown, any>,
  format: RkyvFormat = DEFAULT_FORMAT,
): string {
  return buildDecoderSource(decoder, format).src;
}
