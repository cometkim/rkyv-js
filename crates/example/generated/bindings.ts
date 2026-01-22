/**
 * Generated TypeScript bindings for rkyv-js-example
 * These types match the Rust structs in src/lib.rs
 */

import { r } from 'rkyv-js';

export const Point = r.object({
  x: r.f64,
  y: r.f64,
});

export type Point = r.infer<typeof Point>;

export const Message = r.taggedEnum({
  Quit: r.unit,
  Move: r.object({ x: r.i32, y: r.i32 }),
  Write: r.object({ _0: r.string }),
  ChangeColor: r.object({ _0: r.u8, _1: r.u8, _2: r.u8 }),
});

export type Message = r.infer<typeof Message>;

export const GameState = r.object({
  player_position: Point,
  health: r.u32,
  inventory: r.vec(r.string),
  current_message: r.optional(Message),
});

export type GameState = r.infer<typeof GameState>;

export const Person = r.object({
  name: r.string,
  age: r.u32,
  email: r.optional(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
});

export type Person = r.infer<typeof Person>;
