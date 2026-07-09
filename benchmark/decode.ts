import { run, bench, do_not_optimize } from 'mitata';
import { compileCodec } from 'rkyv-js/jit';

import { specs } from './_specs.ts';

for (const spec of specs) {
  for (const [description, test] of spec.tests) {
    bench(`codec/decode - ${description}`, () => {
      do_not_optimize(spec.codec.decode(test.expected));
    }).gc('inner');

    const compiled = compileCodec(spec.codec);
    bench(`codec/decode/jit - ${description}`, () => {
      do_not_optimize(compiled.decode(test.expected));
    }).gc('inner');
  }
}

await run({
  ...(process.env.NO_COLOR ? { colors: false } : {}),
  ...(process.env.MITATA_FORMAT ? { format: process.env.MITATA_FORMAT as 'json' } : {}),
});
