import { Bench } from 'tinybench';
import { withCodSpeed } from '@codspeed/tinybench-plugin';
import * as r from 'rkyv-js';

const bench = withCodSpeed(new Bench({
  warmup: true,
  warmupIterations: 20,
}));

const testU8 = 255;
const testI8 = -128;
const testU16 = 65535;
const testI16 = -32768;
const testU32 = 4294967295;
const testI32 = -2147483648;
const testU64 = 18446744073709551615n;
const testI64 = -9223372036854775808n;
const testF32 = 3.14159;
const testF64 = 3.141592653589793;
const testBool = true;
const testChar = '🦀';
const testStringShort = 'Hello';
const testStringLong = 'Hello, World! This is a longer string that exceeds inline storage.';

const u8Bytes = r.encode(r.u8, testU8);
const i8Bytes = r.encode(r.i8, testI8);
const u16Bytes = r.encode(r.u16, testU16);
const i16Bytes = r.encode(r.i16, testI16);
const u32Bytes = r.encode(r.u32, testU32);
const i32Bytes = r.encode(r.i32, testI32);
const u64Bytes = r.encode(r.u64, testU64);
const i64Bytes = r.encode(r.i64, testI64);
const f32Bytes = r.encode(r.f32, testF32);
const f64Bytes = r.encode(r.f64, testF64);
const boolBytes = r.encode(r.bool, testBool);
const charBytes = r.encode(r.char, testChar);
const stringShortBytes = r.encode(r.string, testStringShort);
const stringLongBytes = r.encode(r.string, testStringLong);

bench.add('primitives/decode - u8', () => {
  r.decode(r.u8, u8Bytes);
});

bench.add('primitives/decode - i8', () => {
  r.decode(r.i8, i8Bytes);
});

bench.add('primitives/decode - u16', () => {
  r.decode(r.u16, u16Bytes);
});

bench.add('primitives/decode - i16', () => {
  r.decode(r.i16, i16Bytes);
});

bench.add('primitives/decode - u32', () => {
  r.decode(r.u32, u32Bytes);
});

bench.add('primitives/decode - i32', () => {
  r.decode(r.i32, i32Bytes);
});

bench.add('primitives/decode - u64', () => {
  r.decode(r.u64, u64Bytes);
});

bench.add('primitives/decode - i64', () => {
  r.decode(r.i64, i64Bytes);
});

bench.add('primitives/decode - f32', () => {
  r.decode(r.f32, f32Bytes);
});

bench.add('primitives/decode - f64', () => {
  r.decode(r.f64, f64Bytes);
});

bench.add('primitives/decode - bool', () => {
  r.decode(r.bool, boolBytes);
});

bench.add('primitives/decode - char', () => {
  r.decode(r.char, charBytes);
});

bench.add('primitives/decode - string (short)', () => {
  r.decode(r.string, stringShortBytes);
});

bench.add('primitives/decode - string (long)', () => {
  r.decode(r.string, stringLongBytes);
});

await bench.run();
console.table(bench.table());
