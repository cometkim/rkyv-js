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

bench.add('primitives/encode - u8', () => {
  do_not_optimize(r.u8.encode(testU8));
});

bench.add('primitives/encode - i8', () => {
  do_not_optimize(r.i8.encode(testI8));
});

bench.add('primitives/encode - u16', () => {
  do_not_optimize(r.u16.encode(testU16));
});

bench.add('primitives/encode - i16', () => {
  do_not_optimize(r.i16.encode(testI16));
});

bench.add('primitives/encode - u32', () => {
  do_not_optimize(r.u32.encode(testU32));
});

bench.add('primitives/encode - i32', () => {
  do_not_optimize(r.i32.encode(testI32));
});

bench.add('primitives/encode - u64', () => {
  do_not_optimize(r.u64.encode(testU64));
});

bench.add('primitives/encode - i64', () => {
  do_not_optimize(r.i64.encode(testI64));
});

bench.add('primitives/encode - f32', () => {
  do_not_optimize(r.f32.encode(testF32));
});

bench.add('primitives/encode - f64', () => {
  do_not_optimize(r.f64.encode(testF64));
});

bench.add('primitives/encode - bool', () => {
  do_not_optimize(r.bool.encode(testBool));
});

bench.add('primitives/encode - char', () => {
  do_not_optimize(r.char.encode(testChar));
});

bench.add('primitives/encode - string (short)', () => {
  do_not_optimize(r.string.encode(testStringShort));
});

bench.add('primitives/encode - string (long)', () => {
  do_not_optimize(r.string.encode(testStringLong));
});

await bench.run();
console.table(bench.table());
