import type { Layout } from './base.ts';
import { DEFAULT_FORMAT, type RkyvFormat } from './format.ts';
import type { RkyvHasher } from './hasher.ts';
import { BaseDecoder, type Decoder, type Lazy } from './decoder.ts';
import type { CodecMeta } from './meta.ts';
import type { RkyvReader } from './reader.ts';
import { encodeIntoWriter, encodePooled, type Encoder } from './encoder.ts';
import type { RkyvWriter, RkyvTextEncoder } from './writer.ts';

// codec.ts is the aggregation point for the codec class family: the
// direction contracts (`Decoder`/`Encoder` interfaces) and their
// implementation bases live in their own modules (so unidirectional bundles
// can import exactly one side) and are re-exported here for the full surface.
export { BaseCodec, alignOffset, type Infer, type Layout } from './base.ts';
export type {
  ArrayLayout,
  EnumLayout,
  OptionLayout,
  StringLayout,
  StructLayout,
  VariantLayout,
  VecLayout,
} from './layout.ts';
export {
  BaseDecoder,
  FormatBoundDecoder,
  type AnyDecoder,
  type Decoder,
  type Lazy,
  type LazyList,
} from './decoder.ts';
export {
  BaseEncoder,
  encodeIntoWriter,
  encodePooled,
  type AnyEncoder,
  type Encoder,
} from './encoder.ts';
export {
  Kind,
  OPAQUE_META,
  primitiveKindOf,
  type PrimitiveKindTag,
  type ArrayMeta,
  type CodecMeta,
  type CodecMetaField,
  type CodecMetaVariant,
  type CodecMetaVariantField,
  type EnumMeta,
  type OpaqueMeta,
  type OptionMeta,
  type PrimitiveMeta,
  type StringMeta,
  type StructMeta,
  type TupleMeta,
  type VecMeta,
} from './meta.ts';

/**
 * A rkyv codec: the value type `T`, the private resolver type `R` produced
 * by `archive` and consumed by `resolve`, and the (possibly extended) layout
 * type `L`.
 *
 * Codecs mirror rkyv's two-phase serialization model: `archive` writes
 * out-of-line dependencies and remembers their positions in a resolver;
 * `resolve` then writes the value itself in place.
 *
 * Subclasses must implement `computeLayout`, `read`, and `resolve`; the base
 * implementations throw. Contracts for implementors:
 *
 * - `resolve` is called with `writer.pos` already aligned to
 *   `layout(writer.format).align` and must write exactly
 *   `layout(writer.format).size` bytes (including internal padding).
 * - Codecs whose archived form contains no relative pointers pass
 *   `inline: true`; root encoding then skips `archive` entirely, and parent
 *   codecs may skip a child's `archive` when the child is inline.
 * - `hash` must feed the value to the hasher exactly like Rust's `Hash`
 *   implementation for the corresponding type; pass `hashable: true` only
 *   when that holds. Only hashable codecs can be hash map/set keys.
 *
 * Root operations (`encode`/`decode`/`access`) live on the codec itself, so
 * generated bindings are self-contained:
 *
 * ```ts
 * const bytes = ArchivedPerson.encode(person);
 * const person = ArchivedPerson.decode(bytes);
 * const lazy = ArchivedPerson.access(bytes);
 * ```
 *
 * A codec is a decoder combined with an encoder: the read half is inherited
 * from {@link BaseDecoder}, and the write half declared here — the class
 * satisfies both the {@link Decoder} and {@link Encoder} contracts (concrete
 * codecs implement the write half directly or delegate to a contained
 * encoder). One-direction consumers import from `rkyv-js/decode` /
 * `rkyv-js/encode` instead.
 */
export class Codec<T, R = any, L extends Layout = Layout>
  extends BaseDecoder<T, L>
  implements Decoder<T, L>, Encoder<T, R, L>
{
  /**
   * Serialize out-of-line dependencies and return the resolver for
   * `resolve`. Inline codecs keep the no-op base implementation.
   */
  archive(_writer: RkyvWriter, _value: T): R {
    return undefined as R;
  }

  /** Write the archived value in place. Implemented by every codec. */
  resolve(_writer: RkyvWriter, _value: T, _resolver: R): number {
    throw new Error(`${this.constructor.name} must implement resolve()`);
  }

  /**
   * Feed the value to the hasher the way Rust's `Hash` impl would.
   * Only meaningful when `hashable` is true.
   *
   * `encoder` is the writer-configured text encoder (string keys must be
   * hashed as their UTF-8 bytes); implementations without text content
   * simply ignore it.
   */
  hash(_hasher: RkyvHasher, _value: T, _encoder: RkyvTextEncoder): void {
    throw new Error(`${this.constructor.name} does not support hashing`);
  }

  /**
   * Encode a value into a fresh buffer.
   *
   * Uses a shared pooled writer per format (falling back to a fresh writer
   * on re-entrancy), so the returned buffer is always an independent copy.
   */
  encode(value: T, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  /** Encode using an existing writer (reusable via `writer.reset()`). */
  encodeInto(writer: RkyvWriter, value: T): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}

/**
 * A codec of any value type (for generic containers of codecs).
 */
export type AnyCodec = Codec<any, any, any>;

/**
 * Object-literal codec description for {@link defineCodec} — a lighter
 * option than extending {@link Codec} for simple custom codecs.
 */
export interface CodecSpec<T, R = unknown> {
  layout(fmt: RkyvFormat): Layout;
  read(reader: RkyvReader, offset: number): T;
  readLazy?(reader: RkyvReader, offset: number): unknown;
  archive?(writer: RkyvWriter, value: T): R;
  resolve(writer: RkyvWriter, value: T, resolver: R): number;
  hash?(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void;
  /**
   * Optional shape descriptor — a behavioral promise that opts the codec
   * into meta-driven consumers like JIT inlining (see {@link CodecMeta}).
   * Defaults to opaque.
   */
  meta?: CodecMeta<AnyCodec>;
}

class SpecCodec<T, R> extends Codec<T, R> {
  #spec: CodecSpec<T, R>;

  constructor(spec: CodecSpec<T, R>) {
    super({ inline: spec.archive === undefined, hashable: spec.hash !== undefined });
    this.#spec = spec;
    if (spec.meta !== undefined) this.meta = spec.meta;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#spec.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#spec.read(reader, offset);
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    const readLazy = this.#spec.readLazy;
    return readLazy !== undefined ? readLazy(reader, offset) : this.#spec.read(reader, offset);
  }

  archive(writer: RkyvWriter, value: T): R {
    const archive = this.#spec.archive;
    return archive !== undefined ? archive(writer, value) : (undefined as R);
  }

  resolve(writer: RkyvWriter, value: T, resolver: R): number {
    return this.#spec.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    const hash = this.#spec.hash;
    if (hash === undefined) {
      super.hash(hasher, value, encoder);
      return;
    }
    hash(hasher, value, encoder);
  }
}

/**
 * Create a {@link Codec} from an object-literal spec. Prefer extending
 * {@link Codec} directly for anything stateful or performance-sensitive.
 */
export function defineCodec<T, R = unknown>(spec: CodecSpec<T, R>): Codec<T, R> {
  return new SpecCodec(spec);
}

export class FormatBoundCodec<T> extends Codec<T> {
  readonly inner: Codec<T, any, any>;
  readonly format: RkyvFormat;

  constructor(inner: Codec<T, any, any>, format: RkyvFormat) {
    super({ inline: inner.inline, hashable: inner.hashable });
    this.inner = inner;
    this.format = format;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.inner.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): T {
    return this.inner.read(reader, offset);
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.inner.readLazy(reader, offset);
  }

  archive(writer: RkyvWriter, value: T): any {
    return this.inner.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: any): number {
    return this.inner.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.inner.hash(hasher, value, encoder);
  }

  encode(value: T, format: RkyvFormat = this.format): Uint8Array {
    return super.encode(value, format);
  }

  decode(bytes: Uint8Array | ArrayBuffer, format: RkyvFormat = this.format): T {
    return super.decode(bytes, format);
  }

  access(bytes: Uint8Array | ArrayBuffer, format: RkyvFormat = this.format): Lazy<T> {
    return super.access(bytes, format);
  }
}

/**
 * Pin a codec's root operations to a specific format (as emitted by codegen
 * when the Rust crate uses non-default rkyv format features).
 */
export function withFormat<T>(codec: Codec<T>, format: RkyvFormat): Codec<T> {
  return new FormatBoundCodec(codec, format);
}
