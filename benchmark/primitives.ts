import { run, bench, group, do_not_optimize } from 'mitata';
import * as r from 'rkyv-js';

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
const testStringShort = 'Hello'; // inline (≤ 8 bytes)
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

// Integer encode benchmarks
group('primitives encode', () => {
  bench('u8', () => {
    do_not_optimize(r.u8.encode(testU8));
  }).gc('inner');

  bench('i8', () => {
    do_not_optimize(r.i8.encode(testI8));
  }).gc('inner');

  bench('u16', () => {
    do_not_optimize(r.u16.encode(testU16));
  }).gc('inner');

  bench('i16', () => {
    do_not_optimize(r.i16.encode(testI16));
  }).gc('inner');

  bench('u32', () => {
    do_not_optimize(r.u32.encode(testU32));
  }).gc('inner');

  bench('i32', () => {
    do_not_optimize(r.i32.encode(testI32));
  }).gc('inner');

  bench('u64', () => {
    do_not_optimize(r.u64.encode(testU64));
  }).gc('inner');

  bench('i64', () => {
    do_not_optimize(r.i64.encode(testI64));
  }).gc('inner');

  bench('f32', () => {
    do_not_optimize(r.f32.encode(testF32));
  }).gc('inner');

  bench('f64', () => {
    do_not_optimize(r.f64.encode(testF64));
  }).gc('inner');

  bench('bool', () => {
    do_not_optimize(r.bool.encode(testBool));
  }).gc('inner');

  bench('char', () => {
    do_not_optimize(r.char.encode(testChar));
  }).gc('inner');

  bench('string (short, inline)', () => {
    do_not_optimize(r.string.encode(testStringShort));
  }).gc('inner').baseline();

  bench('string (long, out-of-line)', () => {
    do_not_optimize(r.string.encode(testStringLong));
  }).gc('inner');
});

// Integer decode benchmarks
group('primitives decode', () => {
  bench('u8', () => {
    do_not_optimize(r.u8.decode(u8Bytes));
  }).gc('inner');

  bench('i8', () => {
    do_not_optimize(r.i8.decode(i8Bytes));
  }).gc('inner');

  bench('u16', () => {
    do_not_optimize(r.u16.decode(u16Bytes));
  }).gc('inner');

  bench('i16', () => {
    do_not_optimize(r.i16.decode(i16Bytes));
  }).gc('inner');

  bench('u32', () => {
    do_not_optimize(r.u32.decode(u32Bytes));
  }).gc('inner');

  bench('i32', () => {
    do_not_optimize(r.i32.decode(i32Bytes));
  }).gc('inner');

  bench('u64', () => {
    do_not_optimize(r.u64.decode(u64Bytes));
  }).gc('inner');

  bench('i64', () => {
    do_not_optimize(r.i64.decode(i64Bytes));
  }).gc('inner');

  bench('f32', () => {
    do_not_optimize(r.f32.decode(f32Bytes));
  }).gc('inner');

  bench('f64', () => {
    do_not_optimize(r.f64.decode(f64Bytes));
  }).gc('inner');

  bench('bool', () => {
    do_not_optimize(r.bool.decode(boolBytes));
  }).gc('inner');

  bench('char', () => {
    do_not_optimize(r.char.decode(charBytes));
  }).gc('inner');

  bench('string (short, inline)', () => {
    do_not_optimize(r.string.decode(stringShortBytes));
  }).gc('inner');

  bench('string (long, out-of-line)', () => {
    do_not_optimize(r.string.decode(stringLongBytes));
  }).gc('inner');
});

// Combined encode/decode roundtrip benchmarks
group('Roundtrip (encode + decode)', () => {
  bench('u32', () => {
    const bytes = r.u32.encode(testU32);
    do_not_optimize(r.u32.decode(bytes));
  }).gc('inner');

  bench('u64', () => {
    const bytes = r.u64.encode(testU64);
    do_not_optimize(r.u64.decode(bytes));
  }).gc('inner');

  bench('f64', () => {
    const bytes = r.f64.encode(testF64);
    do_not_optimize(r.f64.decode(bytes));
  }).gc('inner');

  bench('string (inline)', () => {
    const bytes = r.string.encode(testStringShort);
    do_not_optimize(r.string.decode(bytes));
  }).gc('inner');

  bench('string (out-of-line)', () => {
    const bytes = r.string.encode(testStringLong);
    do_not_optimize(r.string.decode(bytes));
  }).gc('inner');
});

await run({
  ...(process.env.NO_COLOR ? { colors: false } : {}),
  ...(process.env.MITATA_FORMAT ? { format: process.env.MITATA_FORMAT as 'json' } : {}),
});
