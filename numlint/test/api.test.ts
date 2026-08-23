import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lint } from '../src/index.js';

const DOC = 'The bridge is 5 miles (8.5 km) long.\nSome 45 of the 200 respondents (25%) agreed.';

test('findings carry usable spans, positions and workings', () => {
  const { findings } = lint(DOC);
  assert.ok(findings.length >= 2);
  for (const f of findings) {
    assert.equal(DOC.slice(f.span.start, f.span.end), f.span.text, 'span offsets match the text');
    assert.ok(f.line >= 1 && f.column >= 1);
    assert.ok(f.workings.length > 0);
    assert.ok(f.confidence > 0 && f.confidence <= 1);
    assert.ok(['error', 'warning', 'info'].includes(f.severity));
  }
});

test('options filter the run', () => {
  assert.equal(lint(DOC, { rules: ['unit-conversion'] }).findings.length, 1);
  assert.equal(lint(DOC, { disable: ['unit-conversion'] }).findings.every((f) => f.rule !== 'unit-conversion'), true);
  assert.equal(lint(DOC, { minConfidence: 0.999 }).findings.length, 0);
});

test('slack widens every tolerance', () => {
  const tight = lint('The bridge is 5 miles (8.5 km) long.').findings.length;
  const loose = lint('The bridge is 5 miles (8.5 km) long.', { slack: 10 }).findings.length;
  assert.equal(tight, 1);
  assert.equal(loose, 0);
});

test('stats are reported', () => {
  const { stats } = lint(DOC);
  assert.ok(stats.quantities >= 5);
  assert.ok(stats.rulesRun.length > 10);
  assert.ok(stats.ms >= 0);
});

test('empty and pathological input is safe', () => {
  assert.equal(lint('').findings.length, 0);
  assert.equal(lint('no numbers here at all').findings.length, 0);
  assert.equal(lint('1 '.repeat(5000)).findings.length >= 0, true);
  assert.equal(lint('%%%'.repeat(1000)).findings.length, 0);
});

test('cli reports findings and exit codes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'numlint-'));
  const file = join(dir, 'doc.md');
  writeFileSync(file, DOC);
  const bin = new URL('../bin/numlint.js', import.meta.url).pathname;
  let code = 0;
  let out = '';
  try {
    out = execFileSync(process.execPath, [bin, '--no-color', file], { encoding: 'utf8' });
  } catch (e) {
    const err = e as { status: number; stdout: string };
    code = err.status;
    out = err.stdout;
  }
  assert.equal(code, 1, 'errors exit non-zero');
  assert.match(out, /unit-conversion/);
  assert.match(out, /percent-of-base/);

  let json = '';
  try {
    json = execFileSync(process.execPath, [bin, '--json', file], { encoding: 'utf8' }).toString();
  } catch (e) {
    json = (e as { stdout: string }).stdout;
  }
  const parsed = JSON.parse(json) as Array<{ findings: unknown[] }>;
  assert.ok(Array.isArray(parsed) && parsed[0]!.findings.length >= 2);

  writeFileSync(file, 'Everything here adds up: 2 plus 2 is 4.');
  const clean = execFileSync(process.execPath, [bin, '--no-color', file], { encoding: 'utf8' }).toString();
  assert.match(clean, /no inconsistencies/);
});
