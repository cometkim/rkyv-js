import { do_not_optimize } from 'mitata';
import { Bench } from 'tinybench';
import { withCodSpeed } from '@codspeed/tinybench-plugin';
import { compileCodec } from 'rkyv-js/jit';

import { specs } from './_specs.ts';

const bench = withCodSpeed(new Bench({
  warmup: true,
  warmupIterations: 20,
}));

for (const spec of specs) {
  for (const [description, test] of spec.tests) {
    bench.add(`complex/encode - ${description}`, () => {
      do_not_optimize(spec.codec.encode(test.input));
    });

    const compiled = compileCodec(spec.codec);
    bench.add(`complex/encode/jit - ${description}`, () => {
      do_not_optimize(compiled.encode(test.input));
    });
  }
}

await bench.run();
console.table(bench.table());
