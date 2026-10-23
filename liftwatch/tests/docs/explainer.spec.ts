import { describe, expect, it } from 'vitest';
import stamp from '../../docs/explainer/stamp.json';
import { METHOD_VERSION } from '../../src/wind';

/**
 * docs/LiftWatch-platform-explained.pdf must be rebuilt whenever the platform
 * changes. The build (npm run docs:explainer) records a hash of the source files in
 * docs/explainer/stamp.json; this test recomputes it. The file list and the hashing
 * must match source_files() and source_hash() in docs/explainer/build.py.
 */
const sources = {
  ...import.meta.glob('../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../worker/src/*.ts', { query: '?raw', import: 'default', eager: true }),
  ...import.meta.glob('../../METHOD.md', { query: '?raw', import: 'default', eager: true }),
} as Record<string, string>;

async function sourceHash(): Promise<string> {
  const entries = Object.entries(sources)
    .map(([path, text]) => [path.replace(/^\.\.\/\.\.\//, ''), text] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const joined = entries.map(([path, text]) => `${path}\n${text}\n`).join('');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(joined));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

describe('platform explainer PDF', () => {
  it('was rebuilt after the latest change to the platform', async () => {
    expect(stamp.methodVersion).toBe(METHOD_VERSION);
    expect(
      stamp.sourceHash,
      'The platform changed since docs/LiftWatch-platform-explained.pdf was built. Update docs/explainer/build.py if the change affects what the document says, then run: npm run docs:explainer',
    ).toBe(await sourceHash());
  });
});
