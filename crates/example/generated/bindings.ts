/**
 * Generated TypeScript bindings for rkyv-js-example
 * These types match the Rust structs in src/lib.rs
 */

import { r } from 'rkyv-js';

export const PointCodec = r.object({
  x: r.f64,
  y: r.f64,
});

export type Point = r.infer<typeof PointCodec>;

export const MessageCodec = r.taggedEnum({
  Quit: r.unit,
  Move: r.object({ x: r.i32, y: r.i32 }),
  Write: r.object({ _0: r.string }),
  ChangeColor: r.object({ _0: r.u8, _1: r.u8, _2: r.u8 }),
});

export type Message = r.infer<typeof MessageCodec>;

export const GameStateCodec = r.object({
  player_position: PointCodec,
  health: r.u32,
  inventory: r.vec(r.string),
  current_message: r.optional(MessageCodec),
});

export type GameState = r.infer<typeof GameStateCodec>;

export const PersonCodec = r.object({
  name: r.string,
  age: r.u32,
  email: r.optional(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
});

export type Person = r.infer<typeof PersonCodec>;
