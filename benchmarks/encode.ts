import { run, bench } from 'mitata';
import * as r from 'rkyv-js';

import { specs } from './_specs.ts';

for (const spec of specs) {
  for (const [description, test] of spec.tests) {
    bench(`codec/encode - ${description}`, () => {
      r.encode(spec.codec, test.input);
    }).gc('inner');
  }
}

await run();
