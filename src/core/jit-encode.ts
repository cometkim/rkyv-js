/**
 * The JIT encode emitter: walks an encoder's `meta` descriptors and builds
 * the specialized `archive`/`resolve` pair source. Value-imports no reader
 * machinery, so `rkyv-js/jit/encode` bundles stay reader-free.
 */

import type { AnyEncoder } from './encoder.ts';
import type { RkyvFormat } from './format.ts';
import {
  EmitCtx,
  NODE_BUDGET,
  addOffset,
  unsafeName,
  type ArchiveFn,
  type EmittedSource,
  type ResolveFn,
} from './jit.ts';
import { Kind } from './meta.ts';
import { elementStride } from './layout.ts';

interface FieldSlot {
  /** JS expression for the field value, given the parent value expression. */
  value: string;
  codec: AnyEncoder;
  offset: number;
}

function slotsOf(ctx: EmitCtx<AnyEncoder>, codec: AnyEncoder, base: string): FieldSlot[] | null {
  const meta = codec.meta;
  if (meta.kind === Kind.struct) {
    const fields = meta.fields;
    if (fields.some((f) => unsafeName(f.name))) return null;
    const layout = meta.layout(ctx.fmt);
    return fields.map((f, i) => ({
      value: `${base}[${JSON.stringify(f.name)}]`,
      codec: f.codec,
      offset: layout.offsets[i],
    }));
  }
  if (meta.kind === Kind.tuple) {
    const layout = meta.layout(ctx.fmt);
    return meta.elements.map((e, i) => ({
      value: `${base}[${i}]`,
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
 * Emit a direct `DataView` store for a primitive slot inside a batched run —
 * the reserve-once form of {@link emitPrimitiveWrite}: no per-field capacity
 * check, no position bump. `off` is a constant offset expression from the
 * node's base position.
 */
function emitPrimitiveStore(codec: AnyEncoder, off: string, value: string, le: boolean): string | null {
  switch (codec.meta.kind) {
    case Kind.u8:
      return `dv.setUint8(${off}, ${value})`;
    case Kind.i8:
      return `dv.setInt8(${off}, ${value})`;
    case Kind.u16:
      return `dv.setUint16(${off}, ${value}, ${le})`;
    case Kind.i16:
      return `dv.setInt16(${off}, ${value}, ${le})`;
    case Kind.u32:
      return `dv.setUint32(${off}, ${value}, ${le})`;
    case Kind.i32:
      return `dv.setInt32(${off}, ${value}, ${le})`;
    case Kind.u64:
      return `dv.setBigUint64(${off}, ${value}, ${le})`;
    case Kind.i64:
      return `dv.setBigInt64(${off}, ${value}, ${le})`;
    case Kind.f32:
      return `dv.setFloat32(${off}, ${value}, ${le})`;
    case Kind.f64:
      return `dv.setFloat64(${off}, ${value}, ${le})`;
    case Kind.bool:
      return `dv.setUint8(${off}, ${value} ? 1 : 0)`;
    default:
      return null;
  }
}

/**
 * A resolve-phase leaf after flattening inline struct/tuple subtrees.
 * `resolver` is the expression for the leaf's positional resolver: top-level
 * non-inline slots index the node's resolver array; leaves lifted out of an
 * inline subtree get `void 0`, exactly what the interpreter passes them.
 */
interface ResolveLeaf {
  value: string;
  codec: AnyEncoder;
  offset: number;
  resolver: string;
}

/**
 * Flatten a node's slots for the resolve phase: inline struct/tuple slots
 * (fixed-size by construction, so the nesting is always finite) expand into
 * their own slots at accumulated offsets, turning nested single-field-at-a-
 * time dep calls into leaves the run batcher below can fuse. Offsets stay
 * strictly increasing — layouts assign fields in order.
 */
function flattenResolveSlots(
  ctx: EmitCtx<AnyEncoder>,
  slots: FieldSlot[],
  resolver: string,
): ResolveLeaf[] {
  const out: ResolveLeaf[] = [];
  const walk = (slot: FieldSlot, base: number, sub: string): void => {
    const offset = base + slot.offset;
    const meta = slot.codec.meta;
    if (
      slot.codec.inline &&
      (meta.kind === Kind.struct || meta.kind === Kind.tuple) &&
      emitPrimitiveWrite(slot.codec, slot.value) === null
    ) {
      const inner = slotsOf(ctx, slot.codec, slot.value);
      if (inner !== null) {
        // Children of an inline node never have resolvers.
        for (const child of inner) walk(child, offset, 'void 0');
        return;
      }
    }
    out.push({ value: slot.value, codec: slot.codec, offset, resolver: sub });
  };
  for (let i = 0; i < slots.length; i++) {
    walk(slots[i], 0, `${resolver} === void 0 ? void 0 : ${resolver}[${i}]`);
  }
  return out;
}

/**
 * Compile a vec slot's archive phase; the element write loop, when the element is a struct/tuple the slot machinery can emit.
 *
 * Fully-primitive elements (after flattening) get a single reservation for the whole payload
 * and a strided constant-offset store loop; mixed elements reuse the slot emitters per element
 * (monomorphic call sites, batched scalar runs).
 *
 * Returns null to stay a dep call: primitive elements (the interpreter's bulk typed-array paths already win), opaque/unsafe shapes, and recursion via `ancestors`.
 *
 * The vec's `resolve` (header) stays a dep call either way, the helper returns the interpreter-shaped `{ pos, len }` resolver.
 */
function vecWriteHelper(ctx: EmitCtx<AnyEncoder>, codec: AnyEncoder): string | null {
  const cached = ctx.vecWriteHelpers.get(codec);
  if (cached !== undefined) return cached;
  let name: string | null = null;
  const meta = codec.meta;
  if (meta.kind === Kind.vec) {
    const kind = meta.element.meta.kind;
    if (
      (kind === Kind.struct || kind === Kind.tuple) &&
      ctx.nodes++ <= NODE_BUDGET &&
      !ctx.ancestors.has(codec)
    ) {
      ctx.ancestors.add(codec);
      name = emitVecWriteHelper(ctx, meta.element);
      ctx.ancestors.delete(codec);
    }
  }
  ctx.vecWriteHelpers.set(codec, name);
  return name;
}

function emitVecWriteHelper(ctx: EmitCtx<AnyEncoder>, element: AnyEncoder): string | null {
  const slots = slotsOf(ctx, element, 'v');
  if (slots === null) return null;
  const el = element.layout(ctx.fmt);
  const stride = elementStride(ctx.fmt, element);
  const le = ctx.fmt.endian === 'little';
  const name = ctx.helperName();

  // Fully-primitive element: one reservation, strided stores, alignment gaps zero-filled in a single pass
  // (identical bytes to the interpreter's per-element padTo zeroing).
  const leaves = flattenResolveSlots(ctx, slots, 'void 0');
  if (leaves.every((leaf) => emitPrimitiveWrite(leaf.codec, leaf.value) !== null)) {
    let payload = 0;
    for (const leaf of leaves) payload += leaf.codec.layout(ctx.fmt).size;
    const stores = leaves
      .map((leaf) => `    ${emitPrimitiveStore(leaf.codec, addOffset('p', leaf.offset), leaf.value, le)};`)
      .join('\n');
    ctx.helpers.push(
      `function ${name}(w, a) {\n` +
        `  var n = a.length;\n` +
        `  w.align(${el.align});\n` +
        `  var pos = w.pos;\n` +
        `  w.reserve(n * ${stride});\n` +
        `  var dv = w.view;\n` +
        (payload !== stride ? `  w.buffer.fill(0, pos, pos + n * ${stride});\n` : '') +
        `  for (var i = 0, p = pos; i < n; i++, p += ${stride}) {\n` +
        `    var v = a[i];\n` +
        `${stores}\n` +
        `  }\n` +
        `  return { pos: pos, len: n };\n` +
        `}`,
    );
    return name;
  }

  // Mixed element: the interpreter's two-phase order, archive every element's deps first, then resolve at stride intervals,
  // with the slot emitters supplying the per-element bodies.
  const archive = element.inline
    ? ''
    : `  var rs = new Array(n);\n` +
      `  for (var i = 0; i < n; i++) {\n` +
      `    var v = a[i];\n` +
      `    rs[i] = [${emitArchiveSlots(ctx, slots).join(', ')}];\n` +
      `  }\n`;
  const resolveStmts = emitResolveSlots(ctx, slots, 'p', element.inline ? 'void 0' : 'x')
    .map((stmt) => `    ${stmt}`)
    .join('\n');
  ctx.helpers.push(
    `function ${name}(w, a) {\n` +
      `  var n = a.length;\n` +
      archive +
      `  w.align(${el.align});\n` +
      `  var pos = w.pos;\n` +
      `  for (var i = 0; i < n; i++) {\n` +
      `    var v = a[i];\n` +
      (element.inline ? '' : `    var x = rs[i];\n`) +
      `    var p = w.pos;\n` +
      `${resolveStmts}\n` +
      `    w.padTo(pos + (i + 1) * ${stride});\n` +
      `  }\n` +
      `  return { pos: pos, len: n };\n` +
      `}`,
  );
  return name;
}

/**
 * Emit the archive-phase expressions for a struct/tuple's slots.
 *
 * Returns one resolver-array-element expression per slot
 * (`void 0` for inline children, matching the interpreter's positional resolver arrays).
 *
 * Eligible vec slots archive through a compiled element write loop.
 */
function emitArchiveSlots(ctx: EmitCtx<AnyEncoder>, slots: FieldSlot[]): string[] {
  return slots.map((slot) => {
    if (slot.codec.inline) return 'void 0';
    if (slot.codec.meta.kind === Kind.vec) {
      const helper = vecWriteHelper(ctx, slot.codec);
      if (helper !== null) return `${helper}(w, ${slot.value})`;
    }
    return `d[${ctx.dep(slot.codec)}].archive(w, ${slot.value})`;
  });
}

/**
 * Emit resolve statements for slots relative to base position variable `base` (writer.pos at entry).
 *
 * `resolver` is the expression holding this node's positional resolver array (or `void 0` when the node is inline).
 *
 * Slots are flattened first, then maximal runs of 2+ primitive leaves fuse into a single `w.reserve(span)`
 * followed by direct constant-offset `DataView` stores, one capacity check and one position bump per run instead of one of each per field.
 *
 * A run whose span has alignment gaps is zero-filled in one pass first, so the emitted bytes stay identical to the interpreter's `padTo` zeroing.
 *
 * `dv` is re-read from the writer after every reserve: growth (and any dep call in between) may swap the buffer.
 */
function emitResolveSlots(
  ctx: EmitCtx<AnyEncoder>,
  slots: FieldSlot[],
  base: string,
  resolver: string,
): string[] {
  const leaves = flattenResolveSlots(ctx, slots, resolver);
  const le = ctx.fmt.endian === 'little';
  const sizeOf = (codec: AnyEncoder): number => codec.layout(ctx.fmt).size;
  const out: string[] = [];
  let dvDeclared = false;
  let i = 0;
  while (i < leaves.length) {
    const leaf = leaves[i];
    const primitive = emitPrimitiveWrite(leaf.codec, leaf.value);
    if (primitive === null) {
      if (leaf.offset > 0) out.push(`w.padTo(${base} + ${leaf.offset});`);
      out.push(`d[${ctx.dep(leaf.codec)}].resolve(w, ${leaf.value}, ${leaf.resolver});`);
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < leaves.length && emitPrimitiveWrite(leaves[j].codec, leaves[j].value) !== null) {
      j += 1;
    }
    if (j - i === 1) {
      // A lone primitive: the writer call is cheaper than reserve + view read.
      if (leaf.offset > 0) out.push(`w.padTo(${base} + ${leaf.offset});`);
      out.push(`${primitive};`);
      i = j;
      continue;
    }
    const start = leaf.offset;
    const last = leaves[j - 1];
    const end = last.offset + sizeOf(last.codec);
    let payload = 0;
    for (let k = i; k < j; k++) payload += sizeOf(leaves[k].codec);
    if (start > 0) out.push(`w.padTo(${base} + ${start});`);
    out.push(`w.reserve(${end - start});`);
    out.push(`${dvDeclared ? '' : 'var '}dv = w.view;`);
    dvDeclared = true;
    if (payload !== end - start) {
      out.push(`w.buffer.fill(0, ${addOffset(base, start)}, ${base} + ${end});`);
    }
    for (let k = i; k < j; k++) {
      const l = leaves[k];
      const store = emitPrimitiveStore(l.codec, addOffset(base, l.offset), l.value, le);
      out.push(`${store};`);
    }
    i = j;
  }
  return out;
}

/**
 * Build the write pair source, evaluating to `{ archive, resolve }` —
 * `archive` is null for inline roots (single-pass encode never calls it).
 * Returns null when the root shape is not write-compiled (dep-call territory).
 */
export function buildEncoderSource(target: AnyEncoder, fmt: RkyvFormat): EmittedSource<AnyEncoder> | null {
  const ctx = new EmitCtx<AnyEncoder>(fmt);
  const slots = slotsOf(ctx, target, 'v');
  if (slots === null) return null;
  const layout = target.layout(fmt);
  const archive = target.inline
    ? 'var archive = null;'
    : `var archive = function archive(w, v) { return [${emitArchiveSlots(ctx, slots).join(', ')}]; };`;
  const resolveParts = emitResolveSlots(ctx, slots, 'p', target.inline ? 'void 0' : 'x');
  const helpers = ctx.helpers.length > 0 ? `${ctx.helpers.join('\n')}\n` : '';
  const src =
    `"use strict";\n` +
    `${helpers}` +
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

/** The compiled write pair; `archive` is null for inline roots. */
export interface WritePair {
  archive: ArchiveFn | null;
  resolve: ResolveFn;
}

/**
 * Compile the specialized `archive`/`resolve` pair for a format, or null
 * when the root shape stays on the interpreter.
 */
export function compileWritePair(target: AnyEncoder, fmt: RkyvFormat): WritePair | null {
  const unit = buildEncoderSource(target, fmt);
  if (unit === null) return null;
  return new Function('d', unit.src)(unit.deps) as WritePair;
}
