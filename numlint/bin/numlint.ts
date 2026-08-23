#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { lint, ruleIds } from '../src/index.js';
import type { Finding } from '../src/types.js';

const HELP = `numlint — a linter for the arithmetic inside prose

usage:
  numlint [options] <file>...
  cat report.md | numlint [options]

options:
  --json                 machine-readable output
  --sarif                SARIF 2.1.0 output (for CI annotations)
  --min-confidence <n>   report findings at or above n (default 0.75)
  --rule <id>            only run these rules (repeatable)
  --disable <id>         skip these rules (repeatable)
  --slack <n>            widen every tolerance by a factor of n (default 1)
  --today <YYYY-MM-DD>   reference date for relative-date checks
  --quiet                only print findings, no summary
  --no-color             plain output
  --list-rules           print the available rules
  -h, --help             this text

exit codes: 0 clean, 1 findings of severity "error", 2 bad usage
`;

interface Args {
  files: string[];
  json: boolean;
  sarif: boolean;
  quiet: boolean;
  color: boolean;
  minConfidence?: number;
  rules: string[];
  disable: string[];
  slack?: number;
  today?: string;
}

function parseArgs(argv: string[]): Args | 'help' | 'list' {
  const a: Args = { files: [], json: false, sarif: false, quiet: false, color: process.stdout.isTTY === true, rules: [], disable: [] };
  for (let i = 0; i < argv.length; i++) {
    const v = argv[i]!;
    switch (v) {
      case '-h': case '--help': return 'help';
      case '--list-rules': return 'list';
      case '--json': a.json = true; break;
      case '--sarif': a.sarif = true; break;
      case '--quiet': a.quiet = true; break;
      case '--no-color': a.color = false; break;
      case '--color': a.color = true; break;
      case '--min-confidence': a.minConfidence = parseFloat(argv[++i] ?? ''); break;
      case '--slack': a.slack = parseFloat(argv[++i] ?? ''); break;
      case '--today': a.today = argv[++i]; break;
      case '--rule': a.rules.push(argv[++i] ?? ''); break;
      case '--disable': a.disable.push(argv[++i] ?? ''); break;
      default:
        if (v.startsWith('-')) { console.error(`unknown option: ${v}`); process.exit(2); }
        a.files.push(v);
    }
  }
  return a;
}

const C = {
  red: (s: string, on: boolean) => (on ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string, on: boolean) => (on ? `\x1b[33m${s}\x1b[0m` : s),
  blue: (s: string, on: boolean) => (on ? `\x1b[34m${s}\x1b[0m` : s),
  dim: (s: string, on: boolean) => (on ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s: string, on: boolean) => (on ? `\x1b[1m${s}\x1b[0m` : s),
};

function excerpt(text: string, f: Finding, color: boolean): string {
  const lineStart = text.lastIndexOf('\n', f.span.start - 1) + 1;
  let lineEnd = text.indexOf('\n', f.span.start);
  if (lineEnd === -1) lineEnd = text.length;
  let line = text.slice(lineStart, lineEnd);
  let col = f.span.start - lineStart;
  const MAX = 100;
  if (line.length > MAX) {
    const from = Math.max(0, col - 40);
    line = (from > 0 ? '…' : '') + line.slice(from, from + MAX) + (from + MAX < line.length ? '…' : '');
    col = col - from + (from > 0 ? 1 : 0);
  }
  const caret = ' '.repeat(Math.max(0, col)) + C.red('^'.repeat(Math.max(1, Math.min(f.span.text.length, 40))), color);
  return `  ${C.dim(line, color)}\n  ${caret}`;
}

function render(file: string, text: string, findings: Finding[], color: boolean): string {
  const out: string[] = [];
  for (const f of findings) {
    const sev = f.severity === 'error' ? C.red('error', color) : f.severity === 'warning' ? C.yellow('warning', color) : C.blue('info', color);
    out.push(`${C.bold(`${file}:${f.line}:${f.column}`, color)} ${sev} ${f.message} ${C.dim(`[${f.rule}]`, color)}`);
    out.push(excerpt(text, f, color));
    out.push(`  ${C.dim(f.workings, color)}`);
    if (f.fix) out.push(`  ${C.dim(`suggested: ${f.fix}`, color)}`);
    out.push('');
  }
  return out.join('\n');
}

function toSarif(results: Array<{ file: string; findings: Finding[] }>) {
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'numlint', informationUri: 'https://github.com/numlint/numlint', rules: ruleIds().map((id) => ({ id })) } },
      results: results.flatMap(({ file, findings }) =>
        findings.map((f) => ({
          ruleId: f.rule,
          level: f.severity === 'error' ? 'error' : f.severity === 'warning' ? 'warning' : 'note',
          message: { text: `${f.message} (${f.workings})` },
          locations: [{
            physicalLocation: {
              artifactLocation: { uri: file },
              region: { startLine: f.line, startColumn: f.column, endColumn: f.column + f.span.text.length },
            },
          }],
        })),
      ),
    }],
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === 'help') { process.stdout.write(HELP); return; }
  if (parsed === 'list') { process.stdout.write(ruleIds().join('\n') + '\n'); return; }
  const args = parsed;

  const inputs: Array<{ file: string; text: string }> = [];
  if (args.files.length) {
    for (const f of args.files) {
      try { inputs.push({ file: f, text: readFileSync(f, 'utf8') }); }
      catch { console.error(`numlint: cannot read ${f}`); process.exit(2); }
    }
  } else {
    if (process.stdin.isTTY) { process.stdout.write(HELP); process.exit(2); }
    inputs.push({ file: '<stdin>', text: await readStdin() });
  }

  const options = {
    minConfidence: args.minConfidence,
    rules: args.rules.length ? args.rules : undefined,
    disable: args.disable.length ? args.disable : undefined,
    slack: args.slack,
    today: args.today,
  };

  const results = inputs.map(({ file, text }) => ({ file, text, ...lint(text, options) }));
  const all = results.flatMap((r) => r.findings);

  if (args.json) {
    process.stdout.write(JSON.stringify(results.map(({ file, findings, stats }) => ({ file, findings, stats })), null, 2) + '\n');
  } else if (args.sarif) {
    process.stdout.write(JSON.stringify(toSarif(results), null, 2) + '\n');
  } else {
    for (const r of results) if (r.findings.length) process.stdout.write(render(r.file, r.text, r.findings, args.color));
    if (!args.quiet) {
      const errors = all.filter((f) => f.severity === 'error').length;
      const warnings = all.filter((f) => f.severity === 'warning').length;
      const q = results.reduce((a, r) => a + r.stats.quantities, 0);
      process.stdout.write(
        all.length
          ? `${all.length} finding${all.length === 1 ? '' : 's'} (${errors} error, ${warnings} warning) across ${q} quantities in ${inputs.length} file${inputs.length === 1 ? '' : 's'}\n`
          : `no inconsistencies found in ${q} quantities across ${inputs.length} file${inputs.length === 1 ? '' : 's'}\n`,
      );
    }
  }
  process.exit(all.some((f) => f.severity === 'error') ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
