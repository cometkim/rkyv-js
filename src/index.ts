import * as intrinsics from './intrinsics.ts';
import { access, decode, encode } from './codec.ts';

export type { RkyvCodec, Infer, Resolver } from './codec.ts';
export { RkyvReader } from './reader.ts';
export { RkyvWriter } from './writer.ts';

/**
 * The `r` namespace provides rkyv-js' core APIs.
 *
 * @example
 * ```typescript
 * import { r } from 'rkyv-js';
 *
 * const Person = r.struct({
 *   name: r.string,
 *   age: r.u32,
 * });
 *
 * type Person = r.infer<typeof Person>;
 *
 * const bytes = r.encode(Person, { name: 'Alice', age: 30 });
 * const person = r.decode(Person, bytes);
 * ```
 */
export const r = {
  ...intrinsics,
  access,
  decode,
  encode,
};

export declare namespace r {
  /** Infer the TypeScript type from a codec */
  export type infer<C> = import('./codec.ts').Infer<C>;
}
