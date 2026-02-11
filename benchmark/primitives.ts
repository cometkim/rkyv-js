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

// Integer encode benchmarks
group('primitives encode', () => {
  bench('u8', () => {
    do_not_optimize(r.encode(r.u8, testU8));
  }).gc('inner');

  bench('i8', () => {
    do_not_optimize(r.encode(r.i8, testI8));
  }).gc('inner');

  bench('u16', () => {
    do_not_optimize(r.encode(r.u16, testU16));
  }).gc('inner');

  bench('i16', () => {
    do_not_optimize(r.encode(r.i16, testI16));
  }).gc('inner');

  bench('u32', () => {
    do_not_optimize(r.encode(r.u32, testU32));
  }).gc('inner');

  bench('i32', () => {
    do_not_optimize(r.encode(r.i32, testI32));
  }).gc('inner');

  bench('u64', () => {
    do_not_optimize(r.encode(r.u64, testU64));
  }).gc('inner');

  bench('i64', () => {
    do_not_optimize(r.encode(r.i64, testI64));
  }).gc('inner');

  bench('f32', () => {
    do_not_optimize(r.encode(r.f32, testF32));
  }).gc('inner');

  bench('f64', () => {
    do_not_optimize(r.encode(r.f64, testF64));
  }).gc('inner');

  bench('bool', () => {
    do_not_optimize(r.encode(r.bool, testBool));
  }).gc('inner');

  bench('char', () => {
    do_not_optimize(r.encode(r.char, testChar));
  }).gc('inner');

  bench('string (short, inline)', () => {
    do_not_optimize(r.encode(r.string, testStringShort));
  }).gc('inner').baseline();

  bench('string (long, out-of-line)', () => {
    do_not_optimize(r.encode(r.string, testStringLong));
  }).gc('inner');
});

// Integer decode benchmarks
group('primitives decode', () => {
  bench('u8', () => {
    do_not_optimize(r.decode(r.u8, u8Bytes));
  }).gc('inner');

  bench('i8', () => {
    do_not_optimize(r.decode(r.i8, i8Bytes));
  }).gc('inner');

  bench('u16', () => {
    do_not_optimize(r.decode(r.u16, u16Bytes));
  }).gc('inner');

  bench('i16', () => {
    do_not_optimize(r.decode(r.i16, i16Bytes));
  }).gc('inner');

  bench('u32', () => {
    do_not_optimize(r.decode(r.u32, u32Bytes));
  }).gc('inner');

  bench('i32', () => {
    do_not_optimize(r.decode(r.i32, i32Bytes));
  }).gc('inner');

  bench('u64', () => {
    do_not_optimize(r.decode(r.u64, u64Bytes));
  }).gc('inner');

  bench('i64', () => {
    do_not_optimize(r.decode(r.i64, i64Bytes));
  }).gc('inner');

  bench('f32', () => {
    do_not_optimize(r.decode(r.f32, f32Bytes));
  }).gc('inner');

  bench('f64', () => {
    do_not_optimize(r.decode(r.f64, f64Bytes));
  }).gc('inner');

  bench('bool', () => {
    do_not_optimize(r.decode(r.bool, boolBytes));
  }).gc('inner');

  bench('char', () => {
    do_not_optimize(r.decode(r.char, charBytes));
  }).gc('inner');

  bench('string (short, inline)', () => {
    do_not_optimize(r.decode(r.string, stringShortBytes));
  }).gc('inner');

  bench('string (long, out-of-line)', () => {
    do_not_optimize(r.decode(r.string, stringLongBytes));
  }).gc('inner');
});

// Combined encode/decode roundtrip benchmarks
group('Roundtrip (encode + decode)', () => {
  bench('u32', () => {
    const bytes = r.encode(r.u32, testU32);
    do_not_optimize(r.decode(r.u32, bytes));
  }).gc('inner');

  bench('u64', () => {
    const bytes = r.encode(r.u64, testU64);
    do_not_optimize(r.decode(r.u64, bytes));
  }).gc('inner');

  bench('f64', () => {
    const bytes = r.encode(r.f64, testF64);
    do_not_optimize(r.decode(r.f64, bytes));
  }).gc('inner');

  bench('string (inline)', () => {
    const bytes = r.encode(r.string, testStringShort);
    do_not_optimize(r.decode(r.string, bytes));
  }).gc('inner');

  bench('string (out-of-line)', () => {
    const bytes = r.encode(r.string, testStringLong);
    do_not_optimize(r.decode(r.string, bytes));
  }).gc('inner');
});

await run();
