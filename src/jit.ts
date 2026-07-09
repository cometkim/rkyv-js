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
import type { AnyDecoder, Decoder } from './core/decoder.ts';
import type { AnyEncoder, Encoder } from './core/encoder.ts';
import { DEFAULT_FORMAT, type RkyvFormat } from './core/format.ts';
import type { RkyvHasher } from './core/hasher.ts';
import type { StringLayout } from './core/layout.ts';
import { Kind, primitiveKindOf } from './core/meta.ts';
import type { RkyvReader } from './core/reader.ts';
import type { RkyvTextEncoder, RkyvWriter } from './core/writer.ts';
import { elementStride } from './layout.ts';

/**
 * What the JIT compiles: a codec satisfying both direction contracts —
 * `compileCodec` wraps the whole surface, so it needs the whole surface.
 * The emitters themselves are direction-typed: source emission walks the
 * `meta` descriptors of `Decoder`s resp. `Encoder`s.
 */
export type CompilableCodec<T> = Decoder<T, any> & Encoder<T, any, any>;

export interface CompileOptions {
  /** Format to compile for eagerly. Other formats compile on first use. */
  format?: RkyvFormat;
  /**
   * Behavior when `new Function` is unavailable (CSP) — `'fallback'`
   * (default) returns the interpreter codec unchanged, `'throw'` raises.
   */
  onUnsupported?: 'fallback' | 'throw';
}

// Emitted-source budget: a subtree that would exceed this many nodes is left
// as an interpreter dep call instead of being inlined.
const NODE_BUDGET = 400;

// ============================================================================
// Recognition
// ============================================================================
// Shape dispatch switches on the public numeric `meta.kind` tag — the
// codec's own behavioral promise that its read/resolve implement the
// standard algorithm for the declared shape. Codecs without a declared
// shape (maps, transforms, custom codecs, subclasses that reset `meta` to
// opaque) stay interpreter dep calls, never mis-inlined.

/** A field name whose emitted object-literal semantics would diverge. */
function unsafeName(name: string): boolean {
  return name === '__proto__';
}

// ============================================================================
// Emit context
// ============================================================================

class EmitCtx<D> {
  readonly fmt: RkyvFormat;
  readonly deps: D[] = [];
  readonly helpers: string[] = [];
  nodes = 0;
  #helperId = 0;
  #stringHelper: string | null = null;
  readonly ancestors: Set<object> = new Set();

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
// Decode emitter
// ============================================================================

/**
 * Compose an offset expression, constant-folding `base + a + b` chains so
 * emitted (and snapshotted) source stays readable.
 */
function addOffset(off: string, add: number): string {
  if (add === 0) return off;
  const m = /^([A-Za-z_]\w*)(?: \+ (\d+))?$/.exec(off);
  if (m !== null) return `${m[1]} + ${Number(m[2] ?? 0) + add}`;
  return `${off} + ${add}`;
}

function depRead(ctx: EmitCtx<AnyDecoder>, codec: AnyDecoder, off: string): string {
  return `d[${ctx.dep(codec)}].read(r, ${off})`;
}

/**
 * Emit an expression decoding `codec` at offset expression `off` (relative
 * to reader positions; always of the form `o + N` or a variable).
 */
function emitRead(ctx: EmitCtx<AnyDecoder>, codec: AnyDecoder, off: string): string {
  if (ctx.nodes++ > NODE_BUDGET || ctx.ancestors.has(codec)) {
    return depRead(ctx, codec, off);
  }
  const meta = codec.meta;

  switch (meta.kind) {
    case Kind.u8:
      return `r.readU8(${off})`;
    case Kind.i8:
      return `r.readI8(${off})`;
    case Kind.u16:
      return `r.readU16(${off})`;
    case Kind.i16:
      return `r.readI16(${off})`;
    case Kind.u32:
      return `r.readU32(${off})`;
    case Kind.i32:
      return `r.readI32(${off})`;
    case Kind.u64:
      return `r.readU64(${off})`;
    case Kind.i64:
      return `r.readI64(${off})`;
    case Kind.f32:
      return `r.readF32(${off})`;
    case Kind.f64:
      return `r.readF64(${off})`;
    case Kind.bool:
      return `r.readBool(${off})`;

    case Kind.string: {
      const helper = ctx.stringHelper(meta.layout(ctx.fmt));
      return `${helper}(r, ${off}, ${ctx.dep(codec)})`;
    }

    case Kind.struct: {
      const fields = meta.fields;
      if (fields.some((f) => unsafeName(f.name))) {
        return depRead(ctx, codec, off);
      }
      const layout = meta.layout(ctx.fmt);
      ctx.ancestors.add(codec);
      const parts = fields.map(
        (f, i) =>
          `${JSON.stringify(f.name)}: ${emitRead(ctx, f.codec, addOffset(off, layout.offsets[i]))}`,
      );
      ctx.ancestors.delete(codec);
      return `{ ${parts.join(', ')} }`;
    }

    case Kind.option: {
      const layout = meta.layout(ctx.fmt);
      ctx.ancestors.add(codec);
      const value = emitRead(ctx, meta.inner, addOffset(off, layout.valueOffset));
      ctx.ancestors.delete(codec);
      return `(r.readU8(${off}) === 0 ? null : ${value})`;
    }

    case Kind.tuple: {
      const layout = meta.layout(ctx.fmt);
      ctx.ancestors.add(codec);
      const parts = meta.elements.map((e, i) =>
        emitRead(ctx, e, addOffset(off, layout.offsets[i])),
      );
      ctx.ancestors.delete(codec);
      return `[${parts.join(', ')}]`;
    }

    case Kind.array: {
      const layout = meta.layout(ctx.fmt);
      ctx.ancestors.add(codec);
      // Short arrays unroll; longer ones get a hoisted loop.
      if (meta.length <= 8) {
        const parts: string[] = [];
        for (let i = 0; i < meta.length; i++) {
          parts.push(emitRead(ctx, meta.element, addOffset(off, i * layout.stride)));
        }
        ctx.ancestors.delete(codec);
        return `[${parts.join(', ')}]`;
      }
      const name = ctx.helperName();
      const elem = emitRead(ctx, meta.element, 'p');
      ctx.ancestors.delete(codec);
      ctx.helpers.push(
        `function ${name}(r, o) {\n` +
          `  var a = new Array(${meta.length});\n` +
          `  for (var i = 0, p = o; i < ${meta.length}; i++, p += ${layout.stride}) a[i] = ${elem};\n` +
          `  return a;\n` +
          `}`,
      );
      return `${name}(r, ${off})`;
    }

    case Kind.vec: {
      const element = meta.element;
      // Primitive elements: the interpreter's monomorphic bulk loops (byte
      // math small / DataView >=16) are already optimal — dep call.
      if (primitiveKindOf(element.meta) !== Kind.other) {
        return depRead(ctx, codec, off);
      }
      const layout = meta.layout(ctx.fmt);
      const stride = elementStride(ctx.fmt, element);
      ctx.ancestors.add(codec);
      const elem = emitRead(ctx, element, 'p');
      ctx.ancestors.delete(codec);
      const name = ctx.helperName();
      ctx.helpers.push(
        `function ${name}(r, o) {\n` +
          `  var q = r.readRelPtr(o);\n` +
          `  var n = r.readUsize(o + ${layout.pb});\n` +
          `  var a = new Array(n);\n` +
          `  for (var i = 0, p = q; i < n; i++, p += ${stride}) a[i] = ${elem};\n` +
          `  return a;\n` +
          `}`,
      );
      return `${name}(r, ${off})`;
    }

    case Kind.enum: {
      const variants = meta.variants;
      if (variants.some((v) => v.fields.some((f) => f.name !== null && unsafeName(f.name)))) {
        return depRead(ctx, codec, off);
      }
      const layout = meta.layout(ctx.fmt);
      const name = ctx.helperName();
      ctx.ancestors.add(codec);
      const cases = variants.map((v, disc) => {
        const tag = JSON.stringify(v.name);
        if (v.fields.length === 0) {
          return `    case ${disc}: return { tag: ${tag}, value: null };`;
        }
        const offsets = layout.variants[disc].fieldOffsets;
        if (v.fields.length === 1 && v.fields[0].name === null) {
          const value = emitRead(ctx, v.fields[0].codec, addOffset('o', offsets[0]));
          return `    case ${disc}: return { tag: ${tag}, value: ${value} };`;
        }
        if (v.fields[0].name === null) {
          // Tuple variant: positional fields decode into an array.
          const parts = v.fields.map((f, i) => emitRead(ctx, f.codec, addOffset('o', offsets[i])));
          return `    case ${disc}: return { tag: ${tag}, value: [${parts.join(', ')}] };`;
        }
        const parts = v.fields.map(
          (f, i) =>
            `${JSON.stringify(f.name)}: ${emitRead(ctx, f.codec, addOffset('o', offsets[i]))}`,
        );
        return `    case ${disc}: return { tag: ${tag}, value: { ${parts.join(', ')} } };`;
      });
      ctx.ancestors.delete(codec);
      const disc = layout.discSize === 1 ? 'r.readU8(o)' : 'r.readU16(o)';
      ctx.helpers.push(
        `function ${name}(r, o) {\n` +
          `  switch (${disc}) {\n` +
          `${cases.join('\n')}\n` +
          `    default: throw new Error('invalid enum discriminant');\n` +
          `  }\n` +
          `}`,
      );
      return `${name}(r, ${off})`;
    }

    // Kind.other (char/unit) and Kind.opaque (box/rc/weak/union/transform/
    // lazy/maps/custom): dep call — still a monomorphic call site inside
    // this compiled function.
    default:
      return depRead(ctx, codec, off);
  }
}

// ============================================================================
// Encode emitter (archive + resolve pair). Walks the encoder-side `meta`
// descriptors, so encode-only chains emit exactly like full codecs.
// ============================================================================

interface FieldSlot {
  /** JS expression for the field value, given `v` (the parent value). */
  value: string;
  codec: AnyEncoder;
  offset: number;
}

function slotsOf(ctx: EmitCtx<AnyEncoder>, codec: AnyEncoder): FieldSlot[] | null {
  const meta = codec.meta;
  if (meta.kind === Kind.struct) {
    const fields = meta.fields;
    if (fields.some((f) => unsafeName(f.name))) return null;
    const layout = meta.layout(ctx.fmt);
    return fields.map((f, i) => ({
      value: `v[${JSON.stringify(f.name)}]`,
      codec: f.codec,
      offset: layout.offsets[i],
    }));
  }
  if (meta.kind === Kind.tuple) {
    const layout = meta.layout(ctx.fmt);
    return meta.elements.map((e, i) => ({
      value: `v[${i}]`,
      codec: e,
      offset: layout.offsets[i],
    }));
  }
  return null;
}

function emitPrimitiveWrite(codec: AnyEncoder, value: string): string | null {
  switch (codec.meta.kind) {
    case Kind.u8:
      return `w.writeU8(${value})`;
    case Kind.i8:
      return `w.writeI8(${value})`;
    case Kind.u16:
      return `w.writeU16(${value})`;
    case Kind.i16:
      return `w.writeI16(${value})`;
    case Kind.u32:
      return `w.writeU32(${value})`;
    case Kind.i32:
      return `w.writeI32(${value})`;
    case Kind.u64:
      return `w.writeU64(${value})`;
    case Kind.i64:
      return `w.writeI64(${value})`;
    case Kind.f32:
      return `w.writeF32(${value})`;
    case Kind.f64:
      return `w.writeF64(${value})`;
    case Kind.bool:
      return `w.writeBool(${value})`;
    default:
      return null;
  }
}

/**
 * Emit the archive-phase expressions for a struct/tuple's slots. Returns
 * one resolver-array-element expression per slot (`void 0` for inline
 * children, matching the interpreter's positional resolver arrays).
 */
function emitArchiveSlots(ctx: EmitCtx<AnyEncoder>, slots: FieldSlot[]): string[] {
  return slots.map((slot) => {
    if (slot.codec.inline) return 'void 0';
    return `d[${ctx.dep(slot.codec)}].archive(w, ${slot.value})`;
  });
}

/**
 * Emit resolve statements for slots relative to base position variable
 * `base` (writer.pos at entry). `resolver` is the expression holding this
 * node's positional resolver array (or `void 0` when the node is inline).
 */
function emitResolveSlots(
  ctx: EmitCtx<AnyEncoder>,
  slots: FieldSlot[],
  base: string,
  resolver: string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (slot.offset > 0) out.push(`w.padTo(${base} + ${slot.offset});`);
    const primitive = emitPrimitiveWrite(slot.codec, slot.value);
    if (primitive !== null) {
      out.push(`${primitive};`);
      continue;
    }
    const sub = `${resolver} === void 0 ? void 0 : ${resolver}[${i}]`;
    out.push(`d[${ctx.dep(slot.codec)}].resolve(w, ${slot.value}, ${sub});`);
  }
  return out;
}

// ============================================================================
// Compilation units
// ============================================================================

type ReadFn = (reader: RkyvReader, offset: number) => unknown;
type ArchiveFn = (writer: RkyvWriter, value: unknown) => unknown;
type ResolveFn = (writer: RkyvWriter, value: unknown, resolver: unknown) => number;

interface CompiledUnit {
  read: ReadFn;
  archive: ArchiveFn | null;
  resolve: ResolveFn | null;
}

interface EmittedSource<D> {
  src: string;
  deps: D[];
}

// The source builders are shared by compilation and the emit* introspection
// exports, so snapshot tests pin exactly the source that runs.
function buildDecoderSource(target: AnyDecoder, fmt: RkyvFormat): EmittedSource<AnyDecoder> {
  const ctx = new EmitCtx<AnyDecoder>(fmt);
  const expr = emitRead(ctx, target, 'o');
  const helpers = ctx.helpers.length > 0 ? `${ctx.helpers.join('\n')}\n` : '';
  const src = `"use strict";\n${helpers}return function read(r, o) { return ${expr}; };`;
  return { src, deps: ctx.deps };
}

/**
 * Build the write pair source, evaluating to `{ archive, resolve }` —
 * `archive` is null for inline roots (single-pass encode never calls it).
 * Returns null when the root shape is not write-compiled (dep-call territory).
 */
function buildEncoderSource(target: AnyEncoder, fmt: RkyvFormat): EmittedSource<AnyEncoder> | null {
  const ctx = new EmitCtx<AnyEncoder>(fmt);
  const slots = slotsOf(ctx, target);
  if (slots === null) return null;
  const layout = target.layout(fmt);
  const archive = target.inline
    ? 'var archive = null;'
    : `var archive = function archive(w, v) { return [${emitArchiveSlots(ctx, slots).join(', ')}]; };`;
  const resolveParts = emitResolveSlots(ctx, slots, 'p', target.inline ? 'void 0' : 'x');
  const src =
    `"use strict";\n` +
    `${archive}\n` +
    `var resolve = function resolve(w, v, x) {\n` +
    `  var p = w.pos;\n` +
    `  ${resolveParts.join('\n  ')}\n` +
    `  w.padTo(p + ${layout.size});\n` +
    `  return p;\n` +
    `};\n` +
    `return { archive: archive, resolve: resolve };`;
  return { src, deps: ctx.deps };
}

function compileForFormat(target: CompilableCodec<unknown>, fmt: RkyvFormat): CompiledUnit {
  const readUnit = buildDecoderSource(target, fmt);
  const read = new Function('d', readUnit.src)(readUnit.deps) as ReadFn;

  // archive/resolve compile only when the emitter recognizes the root shape.
  let archive: ArchiveFn | null = null;
  let resolve: ResolveFn | null = null;
  const writeUnit = buildEncoderSource(target, fmt);
  if (writeUnit !== null) {
    const pair = new Function('d', writeUnit.src)(writeUnit.deps) as {
      archive: ArchiveFn | null;
      resolve: ResolveFn;
    };
    archive = pair.archive;
    resolve = pair.resolve;
  }

  return { read, archive, resolve };
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

let evalAvailable: boolean | null = null;

function canEval(): boolean {
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

/**
 * Compile a codec into a specialized drop-in replacement.
 *
 * The returned codec has the identical surface (`encode`/`decode`/`access`/
 * `read`/`resolve`/…), so it can replace the interpreter codec at a single
 * boundary. Opaque children (maps, custom codecs, recursion) stay as
 * interpreter dep calls with per-site monomorphic dispatch.
 */
export function compileCodec<T>(
  codec: CompilableCodec<T>,
  options: CompileOptions = {},
): CompilableCodec<T> {
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

/**
 * Emit the generated decoder (read) source for a decoder — exactly the
 * source `compileCodec` evaluates. Full codecs are decoders.
 */
export function emitDecoderSource(
  decoder: Decoder<unknown, any>,
  format: RkyvFormat = DEFAULT_FORMAT,
): string {
  return buildDecoderSource(decoder, format).src;
}

/**
 * Emit the generated encoder (archive/resolve pair) source for an encoder —
 * exactly the source `compileCodec` evaluates, or null when the root shape
 * stays on the interpreter (dep-call territory). Full codecs are encoders.
 */
export function emitEncoderSource(
  encoder: Encoder<unknown, any, any>,
  format: RkyvFormat = DEFAULT_FORMAT,
): string | null {
  return buildEncoderSource(encoder, format)?.src ?? null;
}
