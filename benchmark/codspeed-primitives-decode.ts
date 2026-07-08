import { do_not_optimize } from 'mitata';
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

const u8Bytes = r.u8.encode(testU8);
const i8Bytes = r.i8.encode(testI8);
const u16Bytes = r.u16.encode(testU16);
const i16Bytes = r.i16.encode(testI16);
const u32Bytes = r.u32.encode(testU32);
const i32Bytes = r.i32.encode(testI32);
const u64Bytes = r.u64.encode(testU64);
const i64Bytes = r.i64.encode(testI64);
const f32Bytes = r.f32.encode(testF32);
const f64Bytes = r.f64.encode(testF64);
const boolBytes = r.bool.encode(testBool);
const charBytes = r.char.encode(testChar);
const stringShortBytes = r.string.encode(testStringShort);
const stringLongBytes = r.string.encode(testStringLong);

bench.add('primitives/decode - u8', () => {
  do_not_optimize(r.u8.decode(u8Bytes));
});

bench.add('primitives/decode - i8', () => {
  do_not_optimize(r.i8.decode(i8Bytes));
});

bench.add('primitives/decode - u16', () => {
  do_not_optimize(r.u16.decode(u16Bytes));
});

bench.add('primitives/decode - i16', () => {
  do_not_optimize(r.i16.decode(i16Bytes));
});

bench.add('primitives/decode - u32', () => {
  do_not_optimize(r.u32.decode(u32Bytes));
});

bench.add('primitives/decode - i32', () => {
  do_not_optimize(r.i32.decode(i32Bytes));
});

bench.add('primitives/decode - u64', () => {
  do_not_optimize(r.u64.decode(u64Bytes));
});

bench.add('primitives/decode - i64', () => {
  do_not_optimize(r.i64.decode(i64Bytes));
});

bench.add('primitives/decode - f32', () => {
  do_not_optimize(r.f32.decode(f32Bytes));
});

bench.add('primitives/decode - f64', () => {
  do_not_optimize(r.f64.decode(f64Bytes));
});

bench.add('primitives/decode - bool', () => {
  do_not_optimize(r.bool.decode(boolBytes));
});

bench.add('primitives/decode - char', () => {
  do_not_optimize(r.char.decode(charBytes));
});

bench.add('primitives/decode - string (short)', () => {
  do_not_optimize(r.string.decode(stringShortBytes));
});

bench.add('primitives/decode - string (long)', () => {
  do_not_optimize(r.string.decode(stringLongBytes));
});

await bench.run();
console.table(bench.table());
