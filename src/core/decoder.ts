import { BaseCodec, type Layout } from './base.ts';
import { DEFAULT_FORMAT, type RkyvFormat } from './format.ts';
import type { CodecMeta } from './meta.ts';
import { RkyvReader } from './reader.ts';

/**
 * Lazily-decoded shape of `T`, as returned by `access()`:
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
 * For full traversals of plain data, use `decode()` instead — it is
 * faster than walking a lazy view.
 */
export interface LazyList<E> extends Iterable<Lazy<E>> {
  readonly length: number;
  at(index: number): Lazy<E> | undefined;
  /** Eagerly decode the whole sequence into a plain array. */
  toArray(): E[];
}

/**
 * The decoder contract — the public type API for anything that can read
 * archived bytes: the read protocol (`read`/`readLazy`), the memoized
 * `layout`, and the root operations `decode`/`access`. Full codecs satisfy
 * it; {@link BaseDecoder} is the standard implementation base.
 */
export interface Decoder<T, L extends Layout = Layout> {
  /** True when the archived form holds no relative pointers anywhere. */
  readonly inline: boolean;
  /** True when the codec implements Rust-compatible key hashing. */
  readonly hashable: boolean;
  /** Shape descriptor; children are decoders. See {@link CodecMeta}. */
  readonly meta: CodecMeta<AnyDecoder>;
  layout(fmt: RkyvFormat): L;
  /** Eagerly decode the value at `offset`. */
  read(reader: RkyvReader, offset: number): T;
  /** Lazily decode at `offset` — composite codecs return views. */
  readLazy(reader: RkyvReader, offset: number): unknown;
  /** Decode the root value into plain data. */
  decode(bytes: Uint8Array | ArrayBuffer, format?: RkyvFormat): T;
  /** Lazily access the root value; fields decode on first read. */
  access(bytes: Uint8Array | ArrayBuffer, format?: RkyvFormat): Lazy<T>;
}

/**
 * The decode half of a codec — implementation base for {@link Decoder}.
 * Value-imports only the reader: a decode-only bundle never pulls in the
 * writer, the swiss-table builder, or a hasher.
 */
export class BaseDecoder<T, L extends Layout = Layout>
  extends BaseCodec<L>
  implements Decoder<T, L>
{
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

/**
 * A decoder of any value type (for generic containers of decoders).
 */
export type AnyDecoder = Decoder<any, any>;

/**
 * Read-side twin of `withFormat`: pins `decode`/`access` to a format.
 */
export class FormatBoundDecoder<T> extends BaseDecoder<T> {
  readonly inner: Decoder<T, any>;
  readonly format: RkyvFormat;

  constructor(inner: Decoder<T, any>, format: RkyvFormat) {
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

  decode(bytes: Uint8Array | ArrayBuffer, format: RkyvFormat = this.format): T {
    return super.decode(bytes, format);
  }

  access(bytes: Uint8Array | ArrayBuffer, format: RkyvFormat = this.format): Lazy<T> {
    return super.access(bytes, format);
  }
}
