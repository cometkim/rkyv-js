/**
 * Generated TypeScript bindings for rkyv-js-example
 * These types match the Rust structs in src/lib.rs
 */

import * as r from 'rkyv-js';
import { btreeMap, btreeSet } from 'rkyv-js/lib/btreemap';
import { bytes } from 'rkyv-js/lib/bytes';
import { hashMap, hashSet } from 'rkyv-js/lib/hashmap';
import { indexMap, indexSet } from 'rkyv-js/lib/indexmap';
import { uuid } from 'rkyv-js/lib/uuid';

export const ArchivedVecDequeData = r.struct({
  items: r.vec(r.u32),
  name: r.string,
});

export type VecDequeData = r.Infer<typeof ArchivedVecDequeData>;

export const ArchivedArcShared = r.struct({
  shared_data: r.rc(r.string),
  local_data: r.u32,
});

export type ArcShared = r.Infer<typeof ArchivedArcShared>;

export const ArchivedArrayVecBuffer = r.struct({
  data: r.vec(r.u32),
  name: r.string,
});

export type ArrayVecBuffer = r.Infer<typeof ArchivedArrayVecBuffer>;

export const ArchivedBTreeMapConfig = r.struct({
  settings: btreeMap(r.string, r.u32),
  version: r.u32,
});

export type BTreeMapConfig = r.Infer<typeof ArchivedBTreeMapConfig>;

export const ArchivedBTreeSetData = r.struct({
  values: btreeSet(r.i64),
  label: r.string,
});

export type BTreeSetData = r.Infer<typeof ArchivedBTreeSetData>;

export const ArchivedBytesMessage = r.struct({
  payload: bytes,
  checksum: r.u32,
});

export type BytesMessage = r.Infer<typeof ArchivedBytesMessage>;

export const ArchivedHashMapData = r.struct({
  entries: hashMap(r.string, r.u32),
  name: r.string,
});

export type HashMapData = r.Infer<typeof ArchivedHashMapData>;

export const ArchivedHashSetData = r.struct({
  ids: hashSet(r.string),
  count: r.u32,
});

export type HashSetData = r.Infer<typeof ArchivedHashSetData>;

export const ArchivedIndexMapConfig = r.struct({
  settings: indexMap(r.string, r.u32),
  version: r.u32,
});

export type IndexMapConfig = r.Infer<typeof ArchivedIndexMapConfig>;

export const ArchivedIndexSetTags = r.struct({
  tags: indexSet(r.string),
  count: r.u32,
});

export type IndexSetTags = r.Infer<typeof ArchivedIndexSetTags>;

export const ArchivedMessage = r.taggedEnum({
  Quit: r.unit,
  Move: r.struct({ x: r.i32, y: r.i32 }),
  Write: r.struct({ _0: r.string }),
  ChangeColor: r.struct({ _0: r.u8, _1: r.u8, _2: r.u8 }),
});

export type Message = r.Infer<typeof ArchivedMessage>;

export const ArchivedPerson = r.struct({
  name: r.string,
  age: r.u32,
  email: r.option(r.string),
  scores: r.vec(r.u32),
  active: r.bool,
});

export type Person = r.Infer<typeof ArchivedPerson>;

export const ArchivedPoint = r.struct({
  x: r.f64,
  y: r.f64,
});

export type Point = r.Infer<typeof ArchivedPoint>;

export const ArchivedGameState = r.struct({
  player_position: ArchivedPoint,
  health: r.u32,
  inventory: r.vec(r.string),
  current_message: r.option(ArchivedMessage),
});

export type GameState = r.Infer<typeof ArchivedGameState>;

export const ArchivedRemoteEvent = r.struct({
  name: r.string,
  location: ArchivedCoord,
  priority: r.u32,
});

export type RemoteEvent = r.Infer<typeof ArchivedRemoteEvent>;

export const ArchivedSmallVecData = r.struct({
  items: r.vec(r.u32),
  tags: r.vec(r.string),
});

export type SmallVecData = r.Infer<typeof ArchivedSmallVecData>;

export const ArchivedSmolStrConfig = r.struct({
  key: r.string,
  value: r.string,
  priority: r.u32,
});

export type SmolStrConfig = r.Infer<typeof ArchivedSmolStrConfig>;

export const ArchivedThinVecData = r.struct({
  items: r.vec(r.u32),
  labels: r.vec(r.string),
});

export type ThinVecData = r.Infer<typeof ArchivedThinVecData>;

export const ArchivedTinyVecData = r.struct({
  values: r.vec(r.u32),
  enabled: r.bool,
});

export type TinyVecData = r.Infer<typeof ArchivedTinyVecData>;

export const ArchivedUuidRecord = r.struct({
  id: uuid,
  name: r.string,
  active: r.bool,
});

export type UuidRecord = r.Infer<typeof ArchivedUuidRecord>;
