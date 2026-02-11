import { do_not_optimize } from 'mitata';
import { Bench } from 'tinybench';
import { withCodSpeed } from '@codspeed/tinybench-plugin';
import * as r from 'rkyv-js';

import { specs } from './_specs.ts';

const bench = withCodSpeed(new Bench({
  warmup: true,
  warmupIterations: 20,
}));

for (const spec of specs) {
  for (const [description, test] of spec.tests) {
    bench.add(`complex/encode - ${description}`, () => {
      do_not_optimize(r.encode(spec.codec, test.input));
    });
  }
}

await bench.run();
console.table(bench.table());
