/**
 * Opt-in JIT pre-compilation for rkyv-js codecs.
 *
 * `compileCodec(codec)` returns a drop-in replacement whose `read` (and for
 * full codecs `archive`/`resolve`) are specialized functions generated with
 * `new Function`: field offsets become integer constants, primitive fields
 * become direct reader/writer calls, and every remaining child-codec call
 * gets its own monomorphic call site — the property that makes per-message
 * codegen (protobufjs-style) fast and immune to the cross-codec megamorphism
 * that destabilizes shared interpreter loops under V8 tiering.
 *
 * Unidirectional codecs compile through the direction-split twins:
 * `compileDecoder` (`rkyv-js/jit/decode`) and `compileEncoder`
 * (`rkyv-js/jit/encode`), each value-importing only its half of the emitter
 * so decode-only bundles stay writer-free (and vice versa). Both are
 * re-exported here for full-surface consumers.
 *
 * The default rkyv-js path never imports this module, so eval-free (CSP)
 * deployments are unaffected; in an environment where `new Function` is
 * blocked, `compileCodec` returns the interpreter codec unchanged (or throws
 * with `onUnsupported: 'throw'`).
 *
 * Generated source receives untrusted content only through
 * `JSON.stringify`-quoted property names; offsets and sizes are integers
 * from the codec's own layout.
 */

import type { Layout } from './core/base.ts';
import { Codec, FormatBoundCodec, withFormat } from './core/codec.ts';
import type { Decoder } from './core/decoder.ts';
import type { Encoder } from './core/encoder.ts';
import { DEFAULT_FORMAT, type RkyvFormat } from './core/format.ts';
import type { RkyvHasher } from './core/hasher.ts';
import { canEval, type ArchiveFn, type CompileOptions, type ReadFn, type ResolveFn } from './core/jit.ts';
import { compileReadFn } from './core/jit-decode.ts';
import { compileWritePair } from './core/jit-encode.ts';
import type { RkyvReader } from './core/reader.ts';
import type { RkyvTextEncoder, RkyvWriter } from './core/writer.ts';

export type { CompileOptions } from './core/jit.ts';
export { compileDecoder, emitDecoderSource } from './jit.decode.ts';
export { compileEncoder, emitEncoderSource } from './jit.encode.ts';

/**
 * What the JIT compiles: a codec satisfying both direction contracts.
 *
 * `compileCodec` wraps the whole surface, so it needs the whole surface.
 *
 * The emitters themselves are direction-typed: source emission walks the
 * `meta` descriptors of `Decoder`s resp. `Encoder`s.
 */
export type CompilableCodec<T> = Decoder<T, any> & Encoder<T, any, any>;

// ============================================================================
// Compilation units
// ============================================================================

interface CompiledUnit {
  read: ReadFn;
  archive: ArchiveFn | null;
  resolve: ResolveFn | null;
}

function compileForFormat(target: CompilableCodec<unknown>, fmt: RkyvFormat): CompiledUnit {
  const read = compileReadFn(target, fmt);
  // archive/resolve compile only when the emitter recognizes the root shape.
  const pair = compileWritePair(target, fmt);
  return { read, archive: pair?.archive ?? null, resolve: pair?.resolve ?? null };
}

// ============================================================================
// The compiled wrapper
// ============================================================================

class CompiledCodec<T> extends Codec<T> {
  /** The interpreter codec this wrapper compiles (introspection surface). */
  readonly target: CompilableCodec<T>;
  #format: RkyvFormat | null = null;
  #unit: CompiledUnit | null = null;
  #units: Map<RkyvFormat, CompiledUnit> | null = null;

  constructor(target: CompilableCodec<T>) {
    super({ inline: target.inline, hashable: target.hashable });
    this.target = target;
  }

  #unitFor(fmt: RkyvFormat): CompiledUnit {
    if (fmt === this.#format) return this.#unit as CompiledUnit;
    let unit = this.#units?.get(fmt);
    if (unit === undefined) {
      unit = compileForFormat(this.target, fmt);
      (this.#units ??= new Map()).set(fmt, unit);
    }
    this.#format = fmt;
    this.#unit = unit;
    return unit;
  }

  /** Compile eagerly for `fmt` so the first hot-path call pays nothing. */
  prewarm(fmt: RkyvFormat): this {
    this.#unitFor(fmt);
    return this;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.target.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#unitFor(reader.format).read(reader, offset) as T;
  }

  // Lazy access views are already per-field monomorphic — delegate.
  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.target.readLazy(reader, offset);
  }

  archive(writer: RkyvWriter, value: T): any {
    const unit = this.#unitFor(writer.format);
    return unit.archive !== null
      ? unit.archive(writer, value)
      : this.target.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: any): number {
    const unit = this.#unitFor(writer.format);
    return unit.resolve !== null
      ? unit.resolve(writer, value, resolver)
      : this.target.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.target.hash(hasher, value, encoder);
  }
}

// ============================================================================
// Entry point
// ============================================================================

/**
 * Compile a codec into a specialized drop-in replacement.
 *
 * The returned codec has the identical surface (`encode`/`decode`/`access`/ `read`/`resolve`/etc),
 * so it can replace the interpreter codec at a single boundary.
 *
 * Opaque children (maps, custom codecs, recursion) stay as interpreter dep calls with per-site monomorphic dispatch.
 */
export function compileCodec<T>(
  codec: CompilableCodec<T>,
  options: CompileOptions = {},
): CompilableCodec<T> {
  // Fail fast on a unidirectional codec: compilation itself would succeed (it only walks `meta`) 
  // and the missing direction would then throw — or
  // silently work for dep-free shapes — deep inside generated source.
  if (typeof codec.read !== 'function') {
    throw new TypeError(
      "compileCodec requires a full codec: missing read, for encoder-only codecs use compileEncoder from 'rkyv-js/jit/encode'",
    );
  }
  if (typeof codec.resolve !== 'function') {
    throw new TypeError(
      "compileCodec requires a full codec: missing resolve, for decoder-only codecs use compileDecoder from 'rkyv-js/jit/decode'",
    );
  }
  if (!canEval()) {
    if (options.onUnsupported === 'throw') {
      throw new Error('compileCodec requires new Function (blocked by CSP in this environment)');
    }
    return codec;
  }
  // Format-bound codecs compile for their pinned format and re-wrap.
  if (codec.constructor === FormatBoundCodec) {
    const bound = codec as unknown as FormatBoundCodec<T>;
    const compiled = new CompiledCodec<T>(bound.inner).prewarm(bound.format);
    return withFormat(compiled, bound.format);
  }
  const compiled = new CompiledCodec(codec);
  // Compile eagerly for the requested (or default) format so first use is hot.
  return compiled.prewarm(options.format ?? DEFAULT_FORMAT);
}
