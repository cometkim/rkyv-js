import { DEFAULT_FORMAT, type RkyvFormat } from './format.ts';
import type { RkyvHasher } from './hasher.ts';
import { RkyvReader } from './reader.ts';
import { RkyvWriter, type RkyvTextEncoder } from './writer.ts';

/**
 * Size and alignment of a codec's archived representation under a specific
 * wire format.
 */
export interface Layout {
  readonly size: number;
  readonly align: number;
}

/**
 * Lazily-decoded shape of `T`, as returned by `Codec.access()`:
 * composite objects become memoized getter views, arrays become
 * {@link LazyList}, everything else decodes on demand.
 */
export type Lazy<T> = T extends
  | string
  | number
  | bigint
  | boolean
  | null
  | undefined
  | Uint8Array
  ? T
  : T extends Map<infer K, infer V>
    ? Map<K, V>
    : T extends Set<infer E>
      ? Set<E>
      : T extends readonly (infer E)[]
        ? LazyList<E>
        : T extends object
          ? { readonly [K in keyof T]: Lazy<T[K]> }
          : T;

/**
 * Lazy view over an archived sequence. Elements decode on first access.
 * For full traversals of plain data, use `Codec.decode()` instead — it is
 * faster than walking a lazy view.
 */
export interface LazyList<E> extends Iterable<Lazy<E>> {
  readonly length: number;
  at(index: number): Lazy<E> | undefined;
  /** Eagerly decode the whole sequence into a plain array. */
  toArray(): E[];
}

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
 */
export class Codec<T, R = any, L extends Layout = Layout> {
  /** True when the archived form holds no relative pointers anywhere. */
  readonly inline: boolean;
  /** True when `hash` implements Rust-compatible key hashing. */
  readonly hashable: boolean;

  #lastFormat: RkyvFormat | null = null;
  #lastLayout: L | null = null;

  constructor(options: { inline: boolean; hashable: boolean }) {
    this.inline = options.inline;
    this.hashable = options.hashable;
  }

  /**
   * Layout under `fmt`, memoized by format object identity (a single
   * pointer compare on hot paths — one format per app in practice).
   */
  layout(fmt: RkyvFormat): L {
    if (fmt !== this.#lastFormat) {
      this.#lastLayout = this.computeLayout(fmt);
      this.#lastFormat = fmt;
    }
    return this.#lastLayout as L;
  }

  /** Compute the layout for a format. Implemented by every codec. */
  computeLayout(_fmt: RkyvFormat): L {
    throw new Error(`${this.constructor.name} must implement computeLayout()`);
  }

  /** Eagerly decode the value at `offset`. Implemented by every codec. */
  read(_reader: RkyvReader, _offset: number): T {
    throw new Error(`${this.constructor.name} must implement read()`);
  }

  /**
   * Lazily decode at `offset` — composite codecs return views. The base
   * implementation decodes eagerly.
   */
  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.read(reader, offset);
  }

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
   * `encoder` is the writer-configured `TextEncoder` (string keys must be
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
    if (pooledBusy || pooledFormat !== format) {
      if (pooledBusy) {
        // Re-entrant encode (e.g. inside a transform): use a fresh writer.
        return this.encodeInto(new RkyvWriter({ format }), value);
      }
      pooledWriter = new RkyvWriter({ format });
      pooledFormat = format;
    }
    const writer = pooledWriter as RkyvWriter;
    pooledBusy = true;
    try {
      writer.reset();
      return this.encodeInto(writer, value).slice();
    } finally {
      pooledBusy = false;
    }
  }

  /** Encode using an existing writer (reusable via `writer.reset()`). */
  encodeInto(writer: RkyvWriter, value: T): Uint8Array {
    const resolver = this.inline ? (undefined as R) : this.archive(writer, value);
    writer.align(this.layout(writer.format).align);
    this.resolve(writer, value, resolver);
    return writer.finish();
  }

  /** Decode the root value into plain data. */
  decode(bytes: Uint8Array | ArrayBuffer, format: RkyvFormat = DEFAULT_FORMAT): T {
    const reader = new RkyvReader(bytes, { format });
    return this.read(reader, reader.getRootPosition(this.layout(format).size));
  }

  /** Lazily access the root value; fields decode on first read. */
  access(bytes: Uint8Array | ArrayBuffer, format: RkyvFormat = DEFAULT_FORMAT): Lazy<T> {
    const reader = new RkyvReader(bytes, { format });
    return this.readLazy(reader, reader.getRootPosition(this.layout(format).size)) as Lazy<T>;
  }
}

// Single-slot writer pool for root `encode()` calls, keyed by format
// identity. `encode` copies the result out, so reuse is safe.
let pooledWriter: RkyvWriter | null = null;
let pooledFormat: RkyvFormat | null = null;
let pooledBusy = false;

/**
 * Infer the TypeScript value type from a codec.
 *
 * Anchored on `read`'s return type (which is exactly `T`) rather than the
 * `Codec<infer T, …>` parent: inferring through the class collects
 * candidates from every position `T` appears in — including the deferred
 * `Lazy<T>` in `access` — which can leak view types into the result
 * depending on checker order.
 */
export type Infer<C> = C extends { read(reader: RkyvReader, offset: number): infer T }
  ? T
  : never;

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
}

class SpecCodec<T, R> extends Codec<T, R> {
  #spec: CodecSpec<T, R>;

  constructor(spec: CodecSpec<T, R>) {
    super({ inline: spec.archive === undefined, hashable: spec.hash !== undefined });
    this.#spec = spec;
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

class FormatBoundCodec<T> extends Codec<T> {
  #inner: Codec<T>;
  #format: RkyvFormat;

  constructor(inner: Codec<T>, format: RkyvFormat) {
    super({ inline: inner.inline, hashable: inner.hashable });
    this.#inner = inner;
    this.#format = format;
  }

  computeLayout(fmt: RkyvFormat): Layout {
    return this.#inner.layout(fmt);
  }

  read(reader: RkyvReader, offset: number): T {
    return this.#inner.read(reader, offset);
  }

  readLazy(reader: RkyvReader, offset: number): unknown {
    return this.#inner.readLazy(reader, offset);
  }

  archive(writer: RkyvWriter, value: T): any {
    return this.#inner.archive(writer, value);
  }

  resolve(writer: RkyvWriter, value: T, resolver: any): number {
    return this.#inner.resolve(writer, value, resolver);
  }

  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void {
    this.#inner.hash(hasher, value, encoder);
  }

  encode(value: T, format: RkyvFormat = this.#format): Uint8Array {
    return super.encode(value, format);
  }

  decode(bytes: Uint8Array | ArrayBuffer, format: RkyvFormat = this.#format): T {
    return super.decode(bytes, format);
  }

  access(bytes: Uint8Array | ArrayBuffer, format: RkyvFormat = this.#format): Lazy<T> {
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

/**
 * Align an offset upward to the given alignment (a power of two).
 */
export function alignOffset(offset: number, align: number): number {
  return (offset + align - 1) & -align;
}
