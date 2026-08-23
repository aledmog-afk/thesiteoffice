/**
 * Builds the browser demo. `web/page.html` holds the page itself; this script
 * bundles the engine and wraps the page in a document twice — once linking the
 * bundle, once with it inlined so the demo is a single portable file.
 */
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
const engine = out.outputFiles[0].text;
writeFileSync('web/numlint.js', engine);

const page = readFileSync('web/page.html', 'utf8');
const [head, body] = splitHead(page);

const doc = (script) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="A linter for the arithmetic inside prose. Paste a document; numlint finds the numbers that contradict each other. Runs entirely in your browser.">
${head}
</head>
<body>
${body.replace('<script>/*ENGINE*/</script>', () => script)}
</body>
</html>
`;

writeFileSync('web/index.html', doc('<script src="numlint.js"></script>'));
writeFileSync('web/standalone.html', doc(`<script>${engine}</script>`));

console.log(`web/numlint.js       ${(engine.length / 1024).toFixed(1)} kB minified`);
console.log('web/index.html       page + linked bundle');
console.log('web/standalone.html  one file, no network');

/** everything up to the end of the <style> block belongs in <head> */
function splitHead(src) {
  const end = src.indexOf('</style>') + '</style>'.length;
  return [src.slice(0, end).trim(), src.slice(end).trim()];
}
