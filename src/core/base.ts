import type { RkyvFormat } from './format.ts';
import type { Layout } from './layout.ts';
import { OPAQUE_META, type CodecMeta } from './meta.ts';
import type { RkyvReader } from './reader.ts';

export type { Layout } from './layout.ts';

/**
 * Direction-neutral codec base: the `inline`/`hashable` flags and the
 * format-keyed layout memo. Imports neither the reader nor the writer, so
 * both unidirectional chains can build on it without dragging the other
 * direction's machinery into a bundle.
 */
export class BaseCodec<L extends Layout = Layout> {
  /** True when the archived form holds no relative pointers anywhere. */
  readonly inline: boolean;
  /** True when `hash` implements Rust-compatible key hashing. */
  readonly hashable: boolean;

  /**
   * Shape descriptor for reflection and JIT compilation; see
   * {@link CodecMeta}. Defaults to opaque — intrinsic codecs assign their
   * shape once in the constructor (after `super()`), which is also why the
   * field is not `readonly`. A non-opaque meta is a behavioral promise:
   * consumers (e.g. `rkyv-js/jit`) may bypass this codec's own methods
   * based on it, so a subclass that overrides behavior must reset it to
   * {@link OPAQUE_META}.
   */
  meta: CodecMeta<any> = OPAQUE_META;

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
}

/**
 * Infer the TypeScript value type from a codec.
 *
 * Anchored on `read`'s return type (which is exactly `T`) rather than the
 * `Codec<infer T, …>` parent: inferring through the class collects
 * candidates from every position `T` appears in — including the deferred
 * `Lazy<T>` in `access` — which can leak view types into the result
 * depending on checker order. Encode-only codecs have no `read`; for them
 * the value type is inferred from `resolve`'s value parameter.
 */
export type Infer<C> = C extends { read(reader: RkyvReader, offset: number): infer T }
  ? T
  : C extends { resolve(writer: any, value: infer T, resolver: any): number }
    ? T
    : never;

/**
 * Align an offset upward to the given alignment (a power of two).
 */
export function alignOffset(offset: number, align: number): number {
  return (offset + align - 1) & -align;
}
