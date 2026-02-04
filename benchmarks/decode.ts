import { run, bench } from 'mitata';
import * as r from 'rkyv-js';

import { specs } from './_specs.ts';

for (const spec of specs) {
  for (const [description, test] of spec.tests) {
    bench(`codec/decode - ${description}`, () => {
      r.decode(spec.codec, test.expected);
    }).gc('inner');
  }
}

await run();
