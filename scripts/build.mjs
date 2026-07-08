// Build dist/ without tsc:
//
//   src/**/*.ts ── amaro (Node's native type stripping) ──► dist/**/*.js
//               └─ oxc-transform isolatedDeclaration()  ──► dist/**/*.d.ts
//
// amaro only blanks out type syntax (no lowering, locations preserved — no
// sourcemaps needed; dist runs byte-shaped like what Node runs from src).
// Neither tool rewrites import specifiers, so relative `./x.ts` specifiers
// are rewritten to `./x.js` here: exactly via es-module-lexer for the JS
// output, and by a conservative regex for the declaration output. Bare
// `rkyv-js/*` self-references pass through untouched and resolve via the
// published exports map.
//
// tsc is typecheck-only (`yarn check`): noEmit + isolatedDeclarations, which
// is what makes oxc's per-file declaration emit valid.

import { transformSync } from 'amaro';
import { init as initLexer, parse as parseModule } from 'es-module-lexer';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { isolatedDeclarationSync } from 'oxc-transform';

const root = path.join(import.meta.dirname, '..');
const srcDir = path.join(root, 'src');
const distDir = path.join(root, 'dist');

await initLexer;
await rm(distDir, { recursive: true, force: true });

/** Rewrite relative `.ts` specifiers to `.js` using exact lexer ranges. */
function rewriteJsSpecifiers(code) {
  const [imports] = parseModule(code);
  let out = code;
  for (let i = imports.length - 1; i >= 0; i--) {
    const spec = imports[i];
    if (spec.d !== -1) continue; // dynamic imports don't occur in src/
    const value = code.slice(spec.s, spec.e);
    if (value.startsWith('.') && value.endsWith('.ts')) {
      out = `${out.slice(0, spec.s)}${value.slice(0, -3)}.js${out.slice(spec.e)}`;
    }
  }
  return out;
}

/** Declaration files: same rewrite, over `from '...'` / `import('...')`. */
function rewriteDtsSpecifiers(code) {
  return code.replace(
    /((?:from\s+|import\s*\(\s*)['"])(\.\.?\/[^'"]+)\.ts(['"])/g,
    '$1$2.js$3',
  );
}

const entries = await readdir(srcDir, { recursive: true, withFileTypes: true });
const files = entries
  .filter((e) => e.isFile() && e.name.endsWith('.ts'))
  .map((e) => path.relative(srcDir, path.join(e.parentPath, e.name)))
  .sort();

let errors = 0;
for (const file of files) {
  const source = await readFile(path.join(srcDir, file), 'utf-8');
  const outBase = path.join(distDir, file.slice(0, -3));
  await mkdir(path.dirname(outBase), { recursive: true });

  const { code } = transformSync(source, { mode: 'strip-only' });
  await writeFile(`${outBase}.js`, rewriteJsSpecifiers(code));

  const dts = isolatedDeclarationSync(file, source);
  for (const error of dts.errors) {
    errors++;
    console.error(`${file}: ${error.message ?? error}`);
  }
  await writeFile(`${outBase}.d.ts`, rewriteDtsSpecifiers(dts.code));
}

if (errors > 0) {
  console.error(`\nbuild failed: ${errors} declaration error(s)`);
  process.exit(1);
}
console.log(`built ${files.length} modules into dist/`);
