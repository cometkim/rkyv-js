/**
 * The JIT decode emitter: walks a decoder's `meta` descriptors and builds the
 * specialized `read` source. Value-imports no writer machinery, so
 * `rkyv-js/jit/decode` bundles stay writer-free.
 */

import type { AnyDecoder } from './decoder.ts';
import type { RkyvFormat } from './format.ts';
import { EmitCtx, NODE_BUDGET, addOffset, unsafeName, type EmittedSource, type ReadFn } from './jit.ts';
import { Kind, primitiveKindOf } from './meta.ts';
import { elementStride } from './layout.ts';

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

// The source builders are shared by compilation and the emit* introspection
// exports, so snapshot tests pin exactly the source that runs.
export function buildDecoderSource(target: AnyDecoder, fmt: RkyvFormat): EmittedSource<AnyDecoder> {
  const ctx = new EmitCtx<AnyDecoder>(fmt);
  const expr = emitRead(ctx, target, 'o');
  const helpers = ctx.helpers.length > 0 ? `${ctx.helpers.join('\n')}\n` : '';
  const src = `"use strict";\n${helpers}return function read(r, o) { return ${expr}; };`;
  return { src, deps: ctx.deps };
}

/** Compile the specialized `read` for a format. */
export function compileReadFn(target: AnyDecoder, fmt: RkyvFormat): ReadFn {
  const unit = buildDecoderSource(target, fmt);
  return new Function('d', unit.src)(unit.deps) as ReadFn;
}
