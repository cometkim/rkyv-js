import { run, bench, do_not_optimize } from 'mitata';
import * as r from 'rkyv-js';

import { specs } from './_specs.ts';

for (const spec of specs) {
  for (const [description, test] of spec.tests) {
    bench(`codec/decode - ${description}`, () => {
      do_not_optimize(spec.codec.decode(test.expected));
    }).gc('inner');
  }
}

await run({
  ...(process.env.NO_COLOR ? { colors: false } : {}),
  ...(process.env.MITATA_FORMAT ? { format: process.env.MITATA_FORMAT as 'json' } : {}),
});
