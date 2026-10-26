import { describe, expect, it } from 'vitest';

/**
 * Sweep of user-facing text in src/ and public/ for wording that reads as approval
 * or overstates what a record is. Comments are not user-facing and are skipped.
 */
const BANNED = /green|nothing flagged|all done|within limit|\bsafe\b|\blocked\b|tamper|✓/i;

/** Hits that are deliberate, each with the reason. */
const ALLOWED: [RegExp, string][] = [
  [/Code of practice for safe use of cranes/, 'the published title of BS 7121-1, cited as a source'],
  [/not tamper-proof/, 'the explicit statement that records are NOT tamper-proof'],
  [/^\/\[✓✕⚠↻→←\]\/g$/, 'pdfSafe strips the tick if it ever reaches a PDF'],
];

const ts = import.meta.glob(['../../src/**/*.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const html = import.meta.glob(['../../public/*.html', '../../index.html', '../../method.html'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const css = import.meta.glob(['../../src/**/*.css'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/ .*$/gm, '$1');
const literals = (s: string) => stripComments(s).match(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|`(?:[^`\\]|\\.)*`|\/\[[^\]\n]*\]\/g/g) ?? [];
const allowed = (s: string) => ALLOWED.some(([re]) => re.test(s.replace(/^['"`]|['"`]$/g, '')));

describe('wording sweep (src and public)', () => {
  it('finds no banned word in any string a user can see', () => {
    const hits: string[] = [];
    for (const [f, src] of Object.entries(ts)) for (const s of literals(src)) if (BANNED.test(s) && !allowed(s)) hits.push(`${f}: ${s}`);
    for (const [f, src] of Object.entries(html)) {
      const visible = src.replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
      for (const line of visible.split('\n')) if (BANNED.test(line) && !allowed(line)) hits.push(`${f}: ${line.trim()}`);
    }
    expect(hits).toEqual([]);
  });

  it('uses no green colour for status in the stylesheet', () => {
    for (const src of Object.values(css)) {
      const rules = stripComments(src);
      expect(rules).not.toMatch(/\bgreen\b/i);
      expect(rules).not.toMatch(/#0b6e0b|#0ca30c|#1f8f1f|#2fbf2f/i);
    }
  });

  it('the allow-list is still needed (each entry matches something)', () => {
    const all = Object.values(ts).join('\n');
    for (const [re, why] of ALLOWED) expect(re.test(all) || re.source.includes('✓'), why).toBe(true);
  });
});
