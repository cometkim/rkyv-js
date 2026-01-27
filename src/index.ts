export { r } from './codec.ts';
export type { RkyvCodec, Infer } from './codec.ts';

// Re-export codec primitives and combinators at top level for convenience
export {
  // Primitives
  u8,
  i8,
  u16,
  i16,
  u32,
  i32,
  u64,
  i64,
  f32,
  f64,
  bool,
  unit,
  char,
  string,

  // Containers
  vec,
  optional,
  box,
  array,
  tuple,

  // Structs & Enums
  struct,
  taggedEnum,
  union,

  // Utilities
  transform,
  newtype,
  lazy,
  hashMap,

  // Top-level functions
  access,
  decode,
  encode,

  // Helper
  alignOffset,
} from './codec.ts';

export { RkyvReader, DEFAULT_CONFIG } from './reader.ts';
export type { RkyvConfig } from './reader.ts';

export { RkyvWriter } from './writer.ts';
export type { Resolver, StringResolver, VecResolver } from './writer.ts';
