/**
 * Generated TypeScript bindings for rkyv-js-example
 * These types match the Rust structs in src/lib.rs
 */

import { r } from 'rkyv-js';
import { uuid } from 'rkyv-js/lib/uuid';
import { bytes } from 'rkyv-js/lib/bytes';
import { indexMap, indexSet } from 'rkyv-js/lib/indexmap';

export const ArchivedUuidRecord = r.struct({
  id: uuid,
  name: r.string,
  active: r.bool,
});

export type UuidRecord = r.infer<typeof ArchivedUuidRecord>;

export const ArchivedArcShared = r.struct({
  shared_data: r.arc(r.string),
  local_data: r.u32,
});

export type ArcShared = r.infer<typeof ArchivedArcShared>;

export const ArchivedArrayVecBuffer = r.struct({
  data: r.vec(r.u32),
  name: r.string,
});

export type ArrayVecBuffer = r.infer<typeof ArchivedArrayVecBuffer>;

export const ArchivedBytesMessage = r.struct({
  payload: bytes,
  checksum: r.u32,
});

export type BytesMessage = r.infer<typeof ArchivedBytesMessage>;

export const ArchivedIndexMapConfig = r.struct({
  settings: indexMap(r.string, r.u32),
  version: r.u32,
});

export type IndexMapConfig = r.infer<typeof ArchivedIndexMapConfig>;

export const ArchivedIndexSetTags = r.struct({
  tags: indexSet(r.string),
  count: r.u32,
});

export type IndexSetTags = r.infer<typeof ArchivedIndexSetTags>;

export const ArchivedMessage = r.taggedEnum({
  Quit: r.unit,
  Move: r.struct({ x: r.i32, y: r.i32 }),
  Write: r.struct({ _0: r.string }),
  ChangeColor: r.struct({ _0: r.u8, _1: r.u8, _2: r.u8 }),
});

export type Message = r.infer<typeof ArchivedMessage>;

export const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.optional(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
});

export type Person = r.infer<typeof ArchivedPerson>;

export const ArchivedPoint = r.struct({
  x: r.f64,
  y: r.f64,
});

export type Point = r.infer<typeof ArchivedPoint>;

export const ArchivedGameState = r.struct({
  player_position: ArchivedPoint,
  health: r.u32,
  inventory: r.vec(r.string),
  current_message: r.optional(ArchivedMessage),
});

export type GameState = r.infer<typeof ArchivedGameState>;

export const ArchivedSmallVecData = r.struct({
  items: r.vec(r.u32),
  tags: r.vec(r.string),
});

export type SmallVecData = r.infer<typeof ArchivedSmallVecData>;

export const ArchivedSmolStrConfig = r.struct({
  key: r.string,
  value: r.string,
  priority: r.u32,
});

export type SmolStrConfig = r.infer<typeof ArchivedSmolStrConfig>;

export const ArchivedThinVecData = r.struct({
  items: r.vec(r.u32),
  labels: r.vec(r.string),
});

export type ThinVecData = r.infer<typeof ArchivedThinVecData>;

export const ArchivedTinyVecData = r.struct({
  values: r.vec(r.u32),
  enabled: r.bool,
});

export type TinyVecData = r.infer<typeof ArchivedTinyVecData>;
