import { readFileSync } from 'node:fs';
import { lint } from '../src/index.js';

interface Case { id: string; expect: string[]; text: string }
const bench = JSON.parse(readFileSync(new URL('../../eval/benchmark.json', import.meta.url), 'utf8')) as
  { cases: Case[] };

let tp = 0, fp = 0, fn = 0, tn = 0;
const failures: string[] = [];

for (const c of bench.cases) {
  const found = lint(c.text).findings;
  const foundRules = new Set(found.map((f) => f.rule));
  if (c.expect.length === 0) {
    if (found.length === 0) tn++;
    else {
      fp += found.length;
      failures.push(`  ✗ ${c.id.padEnd(24)} expected silence, got: ${found.map((f) => `${f.rule} — ${f.message}`).join(' | ')}`);
    }
    continue;
  }
  const alternatives = c.expect.map((e) => e.split('|'));
  for (const alts of alternatives) {
    if (alts.some((r) => foundRules.has(r))) tp++;
    else {
      fn++;
      failures.push(`  ✗ ${c.id.padEnd(24)} expected ${alts.join(' or ')}, got: ${found.length ? found.map((f) => f.rule).join(', ') : 'nothing'}`);
    }
  }
  const accepted = new Set(alternatives.flat());
  for (const f of found) {
    if (!accepted.has(f.rule)) {
      fp++;
      failures.push(`  ✗ ${c.id.padEnd(24)} unexpected ${f.rule}: ${f.message}`);
    }
  }
}

const precision = tp / (tp + fp || 1);
const recall = tp / (tp + fn || 1);
const f1 = (2 * precision * recall) / (precision + recall || 1);
console.log(`cases:      ${bench.cases.length} (${bench.cases.filter((c) => c.expect.length).length} with planted errors, ${bench.cases.filter((c) => !c.expect.length).length} that must stay silent)`);
console.log(`true pos:   ${tp}`);
console.log(`false pos:  ${fp}`);
console.log(`false neg:  ${fn}`);
console.log(`clean docs: ${tn}/${bench.cases.filter((c) => !c.expect.length).length} silent`);
console.log(`precision:  ${(precision * 100).toFixed(1)}%`);
console.log(`recall:     ${(recall * 100).toFixed(1)}%`);
console.log(`F1:         ${(f1 * 100).toFixed(1)}%`);
if (failures.length) {
  console.log('\nfailures:');
  console.log(failures.join('\n'));
}
process.exit(failures.length ? 1 : 0);
