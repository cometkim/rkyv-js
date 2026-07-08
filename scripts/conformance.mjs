// Orchestrate the JS↔Rust conformance loop.
//
//   node scripts/conformance.mjs generate   # write goldens (main + profiles)
//   node scripts/conformance.mjs verify     # verify js.bin outputs in Rust
//
// The full loop is: generate → `node --test` (writes js.bin) → verify.

import { execFileSync } from 'node:child_process';
import * as path from 'node:path';

const mode = process.argv[2];
if (mode !== 'generate' && mode !== 'verify') {
  console.error('usage: node scripts/conformance.mjs <generate|verify>');
  process.exit(2);
}

const root = path.join(import.meta.dirname, '..');
const profiles = ['be', 'pw16', 'pw64', 'unaligned'];

function run(args) {
  console.log(`$ cargo ${args.join(' ')}`);
  execFileSync('cargo', args, { cwd: root, stdio: 'inherit' });
}

run(['run', '--quiet', '-p', 'conformance', '--bin', mode]);

for (const profile of profiles) {
  run([
    'run',
    '--quiet',
    '--manifest-path',
    `conformance/formats/${profile}/Cargo.toml`,
    '--',
    mode,
  ]);
}
