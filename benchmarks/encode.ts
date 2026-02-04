import { run, bench, group, summary } from 'mitata';
import * as r from 'rkyv-js';

import { specs } from './_specs.ts';

for (const spec of specs) {
  for (const [description, test] of spec.tests) {
    bench(`${spec.description} - ${description}`, () => {
      r.encode(spec.codec, test.input);
    }).gc('inner');
  }
}

await run();
