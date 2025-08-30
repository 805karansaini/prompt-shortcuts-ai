import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

const out = 'dist/content/index.js';
await mkdir(dirname(out), { recursive: true });

await build({
  entryPoints: ['src/content/index.ts'],
  bundle: true,
  outfile: out,
  format: 'iife',
  target: ['chrome114'],
  platform: 'browser',
  sourcemap: true,
  minify: true,
  legalComments: 'none',
  treeShaking: true,
});

console.log('bundled content ->', out);
