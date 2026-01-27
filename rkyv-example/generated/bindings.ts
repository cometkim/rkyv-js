/**
 * Generated TypeScript bindings for rkyv-js-example
 * These types match the Rust structs in src/lib.rs
 */

import { r } from 'rkyv-js';

export const ArchivedPoint = r.struct({
  x: r.f64,
  y: r.f64,
});

export type Point = r.infer<typeof ArchivedPoint>;

export const ArchivedMessage = r.taggedEnum({
  Quit: r.unit,
  Move: r.struct({ x: r.i32, y: r.i32 }),
  Write: r.struct({ _0: r.string }),
  ChangeColor: r.struct({ _0: r.u8, _1: r.u8, _2: r.u8 }),
});

export type Message = r.infer<typeof ArchivedMessage>;

export const ArchivedGameState = r.struct({
  player_position: ArchivedPoint,
  health: r.u32,
  inventory: r.vec(r.string),
  current_message: r.optional(ArchivedMessage),
});

export type GameState = r.infer<typeof ArchivedGameState>;

export const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.optional(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
});

export type Person = r.infer<typeof ArchivedPerson>;
