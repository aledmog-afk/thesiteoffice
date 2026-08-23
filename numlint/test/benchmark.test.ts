import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lint } from '../src/index.js';

interface Case { id: string; expect: string[]; text: string }
const bench = JSON.parse(
  readFileSync(new URL('../../eval/benchmark.json', import.meta.url), 'utf8'),
) as { cases: Case[] };

test('benchmark: every planted error is found', () => {
  const missed: string[] = [];
  for (const c of bench.cases) {
    if (!c.expect.length) continue;
    const rules = new Set(lint(c.text).findings.map((f) => f.rule));
    for (const alt of c.expect) {
      if (!alt.split('|').some((r) => rules.has(r))) missed.push(`${c.id} (${alt})`);
    }
  }
  assert.deepEqual(missed, [], 'no planted error may be missed');
});

test('benchmark: every clean document stays silent', () => {
  const noisy: string[] = [];
  for (const c of bench.cases) {
    if (c.expect.length) continue;
    const found = lint(c.text).findings;
    if (found.length) noisy.push(`${c.id}: ${found.map((f) => f.rule).join(', ')}`);
  }
  assert.deepEqual(noisy, [], 'no clean document may produce a finding');
});
