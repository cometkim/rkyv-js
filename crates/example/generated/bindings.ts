/**
 * Generated TypeScript bindings for rkyv-js-example
 * These types match the Rust structs in src/lib.rs
 */

import {
  access,
  accessAt,
  createArchive,
  toBytes,
  serialize,
  struct,
  structEncoder,
  u8,
  u32,
  i32,
  f64,
  bool,
  string,
  u8Encoder,
  u32Encoder,
  i32Encoder,
  f64Encoder,
  boolEncoder,
  stringEncoder,
  vec,
  option,
  vecEncoder,
  optionEncoder,
  enumType,
  enumEncoder,
  type RkyvDecoder,
  type RkyvEncoder,
  type Infer,
} from 'rkyv-js';

export interface Point {
  x: number;
  y: number;
}

export const PointDecoder: RkyvDecoder<Point> = struct({
  x: { decoder: f64 },
  y: { decoder: f64 },
});

export const PointEncoder: RkyvEncoder<Point> = structEncoder({
  x: { encoder: f64Encoder },
  y: { encoder: f64Encoder },
});

export type MessageVariants = {
  Quit: undefined;
  Move: { x: number; y: number };
  Write: { _0: string };
  ChangeColor: { _0: number; _1: number; _2: number };
};

export type Message =
  | { tag: 'Quit'; value: undefined }
  | { tag: 'Move'; value: MessageVariants['Move'] }
  | { tag: 'Write'; value: MessageVariants['Write'] }
  | { tag: 'ChangeColor'; value: MessageVariants['ChangeColor'] };

export const MessageDecoder: RkyvDecoder<Message> = enumType<MessageVariants>({
  Quit: {},
  Move: { fields: { x: { decoder: i32 }, y: { decoder: i32 } } },
  Write: { fields: { _0: { decoder: string } } },
  ChangeColor: { fields: { _0: { decoder: u8 }, _1: { decoder: u8 }, _2: { decoder: u8 } } },
});

export const MessageEncoder: RkyvEncoder<Message> = enumEncoder<MessageVariants>({
  Quit: {},
  Move: { fields: { x: { encoder: i32Encoder }, y: { encoder: i32Encoder } } },
  Write: { fields: { _0: { encoder: stringEncoder } } },
  ChangeColor: { fields: { _0: { encoder: u8Encoder }, _1: { encoder: u8Encoder }, _2: { encoder: u8Encoder } } },
});

export interface GameState {
  player_position: Point;
  health: number;
  inventory: string[];
  current_message: Message | null;
}

export const GameStateDecoder: RkyvDecoder<GameState> = struct({
  player_position: { decoder: PointDecoder },
  health: { decoder: u32 },
  inventory: { decoder: vec(string) },
  current_message: { decoder: option(MessageDecoder) },
});

export const GameStateEncoder: RkyvEncoder<GameState> = structEncoder({
  player_position: { encoder: PointEncoder },
  health: { encoder: u32Encoder },
  inventory: { encoder: vecEncoder(stringEncoder) },
  current_message: { encoder: optionEncoder(MessageEncoder) },
});

export interface Person {
  name: string;
  age: number;
  email: string | null;
  scores: number[];
  active: boolean;
}

export const PersonDecoder: RkyvDecoder<Person> = struct({
  name: { decoder: string },
  age: { decoder: u32 },
  email: { decoder: option(string) },
  scores: { decoder: vec(u32) },
  active: { decoder: bool },
});

export const PersonEncoder: RkyvEncoder<Person> = structEncoder({
  name: { encoder: stringEncoder },
  age: { encoder: u32Encoder },
  email: { encoder: optionEncoder(stringEncoder) },
  scores: { encoder: vecEncoder(u32Encoder) },
  active: { encoder: boolEncoder },
});
