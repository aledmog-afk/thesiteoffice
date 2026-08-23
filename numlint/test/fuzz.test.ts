import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lint } from '../src/index.js';

/** Deterministic PRNG so a failure can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

const PIECES = [
  'about', 'roughly', 'more than', 'up to', 'nearly', '', '', '',
  '5', '0.5', '1,234,567', '12%', '£4.2m', '$3bn', '8.5 km', '72F', 'two-thirds',
  '1990', '2015', 'one in five', '3-1/2', '½', '-7', '1e9', '0', '100%', '999,999,999',
  'of the', 'from', 'to', 'a total of', 'an average of', 'per', 'each', 'and', ',', '(', ')',
  'respondents', 'tonnes', 'per cent', 'percentage points', 'Tuesday, 5 March 2026',
  '|', '---', '\n', '\n\n', '. ', '; ', '—', 'mln dlrs', 'vs', 'n = 20',
  '\u{1f642}', 'ñ', ' ', '\t', '<script>', '{{}}', '[3]', 'https://x.co/1', '2026-01-01',
];

function randomDoc(rand: () => number, maxPieces: number): string {
  const n = 1 + Math.floor(rand() * maxPieces);
  let doc = '';
  for (let k = 0; k < n; k++) doc += PIECES[Math.floor(rand() * PIECES.length)] + ' ';
  return doc;
}

test('never throws, whatever the input', () => {
  const rand = rng(20260823);
  for (let i = 0; i < 4000; i++) {
    const doc = randomDoc(rand, 40);
    assert.doesNotThrow(() => lint(doc), `input: ${JSON.stringify(doc)}`);
  }
});

test('findings always point at real text', () => {
  const rand = rng(7);
  for (let i = 0; i < 1500; i++) {
    const doc = randomDoc(rand, 30);
    for (const f of lint(doc, { minConfidence: 0 }).findings) {
      assert.equal(doc.slice(f.span.start, f.span.end), f.span.text, `bad span for ${JSON.stringify(doc)}`);
      assert.ok(f.span.start >= 0 && f.span.end <= doc.length);
      assert.ok(f.span.end > f.span.start, 'spans are non-empty');
      for (const r of f.relatedSpans) assert.ok(r.start >= 0 && r.end <= doc.length);
    }
  }
});

test('large documents stay fast and bounded', () => {
  const para =
    'The council spent £4.2m across 12 boroughs, an average of £350,000 each. ' +
    'Of the 200 residents surveyed, 45 (22.5%) agreed, while support ran at 41%, 33% and 26%.\n\n';
  const doc = para.repeat(2000);
  const t0 = Date.now();
  const res = lint(doc);
  const ms = Date.now() - t0;
  assert.ok(res.stats.quantities > 15000, 'quantities were found');
  assert.equal(res.findings.length, 0, 'a clean document stays clean at scale');
  assert.ok(ms < 15000, `linted ${(doc.length / 1024).toFixed(0)} kB in ${ms} ms`);
});

test('pathological shapes do not blow up', () => {
  const cases = [
    '1'.repeat(50000),
    '1 '.repeat(20000),
    '('.repeat(5000) + '5 miles (8.5 km)' + ')'.repeat(5000),
    '|'.repeat(2000),
    '%'.repeat(10000),
    '\n'.repeat(10000),
    'a'.repeat(100000),
    '1.'.repeat(10000),
    '£'.repeat(10000),
    'one '.repeat(10000),
    ' ��',
  ];
  for (const c of cases) {
    const t0 = Date.now();
    assert.doesNotThrow(() => lint(c), `input shape: ${c.slice(0, 20)}`);
    assert.ok(Date.now() - t0 < 10000, `slow on ${c.slice(0, 20)} (${Date.now() - t0} ms)`);
  }
});
