import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';

const out = await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'iife',
  globalName: 'numlint',
  target: ['es2020'],
  minify: true,
  write: false,
  define: { 'process.env.NUMLINT_DEBUG': 'undefined' },
});
const code = out.outputFiles[0].text;
writeFileSync('web/numlint.js', code);
console.log(`web/numlint.js — ${(code.length / 1024).toFixed(1)} kB minified`);

// a single self-contained page, for hosting anywhere at all
const html = readFileSync('web/index.html', 'utf8');
writeFileSync(
  'web/standalone.html',
  html.replace('<script src="numlint.js"></script>', `<script>${code}</script>`),
);
console.log('web/standalone.html — one file, no network');
