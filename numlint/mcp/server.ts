#!/usr/bin/env node
/**
 * numlint MCP server (stdio, zero dependencies).
 *
 * Exposes the linter as a tool so a model can check its own arithmetic before
 * it hands a document to anyone. Language models are markedly worse at
 * arithmetic embedded in prose than at arithmetic in isolation, and they
 * cannot reliably audit their own numbers by reading them back — an external,
 * deterministic checker is the cheap fix.
 */
import { createInterface } from 'node:readline';
import { lint, ruleIds, RULES } from '../src/index.js';
import type { Finding } from '../src/types.js';

const NAME = 'numlint';
const VERSION = '0.1.0';
const DEFAULT_PROTOCOL = '2024-11-05';

interface Request {
  jsonrpc: '2.0';
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'check_numbers',
    description:
      'Check whether the numbers in a document agree with each other. Finds wrong unit ' +
      'conversions, percentages that do not match the figures beside them, totals that do ' +
      'not add up, percentage changes computed wrongly, percent/percentage-point confusion, ' +
      'per-unit averages that do not divide, impossible percentages for the sample size, ' +
      'date and age arithmetic, table totals, and figures restated at the wrong scale. ' +
      'Deterministic and offline: it checks the document against itself, never against the ' +
      'outside world, so it reports arithmetic that is impossible rather than facts it doubts. ' +
      'Call it on any draft that contains numbers before presenting that draft to a user.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The document to check: prose, markdown, or a mix.' },
        min_confidence: {
          type: 'number',
          description: 'Report findings at or above this confidence (0-1). Default 0.75. Lower it to see marginal cases.',
        },
        rules: {
          type: 'array',
          items: { type: 'string' },
          description: `Restrict the run to these rules. Available: ${ruleIds().join(', ')}.`,
        },
        slack: {
          type: 'number',
          description: 'Multiply every rounding tolerance by this factor (>=1) to be more forgiving. Default 1.',
        },
      },
      required: ['text'],
    },
  },
  {
    name: 'list_rules',
    description: 'List the checks numlint can apply, with a one-line description of each.',
    inputSchema: { type: 'object', properties: {} },
  },
] as const;

function renderFindings(findings: Finding[], stats: { quantities: number }): string {
  if (!findings.length) {
    return `No inconsistencies found across ${stats.quantities} quantities. Note that numlint only checks the document against itself; it cannot tell you whether a figure is true, only whether it contradicts the other figures present.`;
  }
  const lines = findings.map((f) => {
    const bits = [
      `${f.severity.toUpperCase()} line ${f.line}, column ${f.column} [${f.rule}, confidence ${f.confidence.toFixed(2)}]`,
      `  ${f.message}`,
      `  written: ${f.stated}`,
      `  implied: ${f.expected}`,
      `  working: ${f.workings}`,
    ];
    if (f.fix) bits.push(`  suggested replacement: ${f.fix}`);
    return bits.join('\n');
  });
  return `${findings.length} inconsistenc${findings.length === 1 ? 'y' : 'ies'} found across ${stats.quantities} quantities:\n\n${lines.join('\n\n')}\n\nEach one is arithmetic that cannot be right as written. Fix the figures or, where a figure came from a source, re-check the source before publishing.`;
}

function callTool(name: string, args: Record<string, unknown>): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  if (name === 'list_rules') {
    const text = RULES.map((r) => `${r.id}: ${r.description}`).join('\n');
    return { content: [{ type: 'text', text }] };
  }
  if (name === 'check_numbers') {
    const text = typeof args.text === 'string' ? args.text : '';
    if (!text.trim()) {
      return { content: [{ type: 'text', text: 'No text supplied.' }], isError: true };
    }
    const result = lint(text, {
      minConfidence: typeof args.min_confidence === 'number' ? args.min_confidence : undefined,
      rules: Array.isArray(args.rules) ? (args.rules as string[]) : undefined,
      slack: typeof args.slack === 'number' ? args.slack : undefined,
    });
    return { content: [{ type: 'text', text: renderFindings(result.findings, result.stats) }] };
  }
  return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
}

function handle(req: Request): object | undefined {
  const reply = (result: object) => ({ jsonrpc: '2.0' as const, id: req.id ?? null, result });
  switch (req.method) {
    case 'initialize': {
      const requested = (req.params?.protocolVersion as string) || DEFAULT_PROTOCOL;
      return reply({
        protocolVersion: requested,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: NAME, version: VERSION },
      });
    }
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return undefined;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS });
    case 'tools/call': {
      const name = req.params?.name as string;
      const args = (req.params?.arguments as Record<string, unknown>) ?? {};
      try {
        return reply(callTool(name, args));
      } catch (err) {
        return reply({
          content: [{ type: 'text', text: `numlint failed: ${(err as Error).message}` }],
          isError: true,
        });
      }
    }
    default:
      return {
        jsonrpc: '2.0' as const,
        id: req.id ?? null,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req: Request;
  try {
    req = JSON.parse(trimmed) as Request;
  } catch {
    process.stdout.write(
      JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n',
    );
    return;
  }
  const res = handle(req);
  if (res) process.stdout.write(JSON.stringify(res) + '\n');
});
