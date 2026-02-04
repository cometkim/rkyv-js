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
  r.encode(r.u8, testU8);
});

bench.add('primitives/encode - i8', () => {
  r.encode(r.i8, testI8);
});

bench.add('primitives/encode - u16', () => {
  r.encode(r.u16, testU16);
});

bench.add('primitives/encode - i16', () => {
  r.encode(r.i16, testI16);
});

bench.add('primitives/encode - u32', () => {
  r.encode(r.u32, testU32);
});

bench.add('primitives/encode - i32', () => {
  r.encode(r.i32, testI32);
});

bench.add('primitives/encode - u64', () => {
  r.encode(r.u64, testU64);
});

bench.add('primitives/encode - i64', () => {
  r.encode(r.i64, testI64);
});

bench.add('primitives/encode - f32', () => {
  r.encode(r.f32, testF32);
});

bench.add('primitives/encode - f64', () => {
  r.encode(r.f64, testF64);
});

bench.add('primitives/encode - bool', () => {
  r.encode(r.bool, testBool);
});

bench.add('primitives/encode - char', () => {
  r.encode(r.char, testChar);
});

bench.add('primitives/encode - string (short)', () => {
  r.encode(r.string, testStringShort);
});

bench.add('primitives/encode - string (long)', () => {
  r.encode(r.string, testStringLong);
});

await bench.run();
console.table(bench.table());
