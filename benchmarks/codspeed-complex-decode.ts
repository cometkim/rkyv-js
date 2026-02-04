import { Bench } from 'tinybench';
import { withCodSpeed } from '@codspeed/tinybench-plugin';
import * as r from 'rkyv-js';

import { specs } from './_specs.ts';

const bench = withCodSpeed(new Bench());

for (const spec of specs) {
  for (const [description, test] of spec.tests) {
    bench.add(`complex/decode - ${description}`, () => {
      r.decode(spec.codec, test.expected);
    });
  }
}

await bench.run();
console.table(bench.table());
