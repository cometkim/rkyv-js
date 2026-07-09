import { BaseCodec, type Layout } from './base.ts';
import { DEFAULT_FORMAT, type RkyvFormat } from './format.ts';
import type { RkyvHasher } from './hasher.ts';
import type { CodecMeta } from './meta.ts';
import { RkyvWriter, type RkyvTextEncoder } from './writer.ts';

/**
 * The encoder contract — the public type API for anything that can archive
 * values: rkyv's two-phase `archive`/`resolve` write protocol, key hashing,
 * and the root `encode` operations. Full codecs satisfy it (containers
 * accept full codecs and encode-only codecs interchangeably as children);
 * {@link BaseEncoder} is the standard implementation base.
 */
export interface Encoder<T, R = any, L extends Layout = Layout> {
  readonly inline: boolean;
  readonly hashable: boolean;
  /** Shape descriptor; children are encoders. See {@link CodecMeta}. */
  readonly meta: CodecMeta<AnyEncoder>;
  layout(fmt: RkyvFormat): L;
  archive(writer: RkyvWriter, value: T): R;
  resolve(writer: RkyvWriter, value: T, resolver: R): number;
  hash(hasher: RkyvHasher, value: T, encoder: RkyvTextEncoder): void;
  /** Encode a value into a fresh buffer. */
  encode(value: T, format?: RkyvFormat): Uint8Array;
  /** Encode using an existing writer (reusable via `writer.reset()`). */
  encodeInto(writer: RkyvWriter, value: T): Uint8Array;
}

/**
 * An encoder of any value type (for generic containers of encoders).
 */
export type AnyEncoder = Encoder<any, any, any>;

/**
 * Encode a value with an existing writer (reusable via `writer.reset()`).
 * Shared by the full and encode-only chains.
 */
export function encodeIntoWriter<T, R>(
  codec: Encoder<T, R>,
  writer: RkyvWriter,
  value: T,
): Uint8Array {
  const resolver = codec.inline ? (undefined as R) : codec.archive(writer, value);
  writer.align(codec.layout(writer.format).align);
  codec.resolve(writer, value, resolver);
  return writer.finish();
}

/**
 * Encode a value into a fresh buffer using the shared per-format writer
 * pool (falling back to a fresh writer on re-entrancy). The returned
 * buffer is always an independent copy.
 */
export function encodePooled<T>(codec: Encoder<T>, value: T, format: RkyvFormat): Uint8Array {
  if (pooledBusy || pooledFormat !== format) {
    if (pooledBusy) {
      // Re-entrant encode (e.g. inside a transform): use a fresh writer.
      return encodeIntoWriter(codec, new RkyvWriter({ format }), value);
    }
    pooledWriter = new RkyvWriter({ format });
    pooledFormat = format;
  }
  const writer = pooledWriter as RkyvWriter;
  pooledBusy = true;
  try {
    writer.reset();
    return encodeIntoWriter(codec, writer, value).slice();
  } finally {
    pooledBusy = false;
  }
}

// Single-slot writer pool for root `encode()` calls, keyed by format
// identity. `encodePooled` copies the result out, so reuse is safe.
let pooledWriter: RkyvWriter | null = null;
let pooledFormat: RkyvFormat | null = null;
let pooledBusy = false;

/**
 * The encode half of a codec — implementation base for {@link Encoder}.
 * Value-imports only the writer: an encode-only bundle never pulls in the
 * reader or lazy-view machinery.
 */
export class BaseEncoder<T, R = any, L extends Layout = Layout>
  extends BaseCodec<L>
  implements Encoder<T, R, L>
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

  /** Encode a value into a fresh buffer. */
  encode(value: T, format: RkyvFormat = DEFAULT_FORMAT): Uint8Array {
    return encodePooled(this, value, format);
  }

  /** Encode using an existing writer (reusable via `writer.reset()`). */
  encodeInto(writer: RkyvWriter, value: T): Uint8Array {
    return encodeIntoWriter(this, writer, value);
  }
}
