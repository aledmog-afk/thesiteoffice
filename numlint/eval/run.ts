import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lint } from '../src/index.js';

const dir = process.argv[2] ?? 'eval/corpus/real';
const outPath = process.argv[3];
const minConfidence = process.argv[4] ? parseFloat(process.argv[4]) : undefined;

const files = readdirSync(dir).filter((f) => /\.(txt|md)$/.test(f));
const byRule = new Map<string, number>();
const rows: Array<Record<string, unknown>> = [];
let quantities = 0;
let chars = 0;
const t0 = Date.now();

for (const f of files) {
  const text = readFileSync(join(dir, f), 'utf8');
  chars += text.length;
  const res = lint(text, { minConfidence });
  quantities += res.stats.quantities;
  for (const fd of res.findings) {
    byRule.set(fd.rule, (byRule.get(fd.rule) ?? 0) + 1);
    const ls = Math.max(0, text.lastIndexOf('\n', fd.span.start - 1) + 1);
    let le = text.indexOf('\n', fd.span.start);
    if (le === -1) le = text.length;
    rows.push({
      file: f, rule: fd.rule, severity: fd.severity, confidence: +fd.confidence.toFixed(2),
      message: fd.message, workings: fd.workings,
      context: text.slice(Math.max(0, fd.span.start - 160), Math.min(text.length, fd.span.end + 120)).replace(/\s+/g, ' '),
      line: text.slice(ls, le).trim().slice(0, 240),
    });
  }
}

const ms = Date.now() - t0;
const total = rows.length;
console.log(`corpus:      ${files.length} documents, ${(chars / 1e6).toFixed(2)} MB, ${quantities.toLocaleString()} quantities`);
console.log(`throughput:  ${ms} ms total, ${(chars / 1024 / (ms / 1000) / 1024).toFixed(1)} MB/s`);
console.log(`findings:    ${total} (${(total / files.length * 100).toFixed(1)} per 100 documents, ${(total / quantities * 1000).toFixed(2)} per 1,000 quantities)`);
console.log('\nby rule:');
for (const [rule, n] of [...byRule].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rule.padEnd(28)} ${String(n).padStart(5)}`);
}
if (outPath) {
  writeFileSync(outPath, rows.map((r) => JSON.stringify(r)).join('\n'));
  console.log(`\nwrote ${rows.length} findings to ${outPath}`);
}
