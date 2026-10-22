import { describe, expect, it } from 'vitest';
import method from '../../METHOD.md?raw';
import { inline, renderMarkdown } from '../../src/ui/markdown';

describe('renderMarkdown', () => {
  it('escapes HTML in the source', () => {
    expect(renderMarkdown('a <script>x</script> b')).toBe('<p>a &lt;script&gt;x&lt;/script&gt; b</p>');
  });

  it('renders headings, tables, lists and code', () => {
    const html = renderMarkdown(
      ['# Title', '', '| A | B |', '|---|--:|', '| 1 | 2 |', '', '- one', '  - sub', '- two', '', '```', 'r = Aw / m', '```'].join('\n'),
    );
    expect(html).toContain('<h1 id="title">Title</h1>');
    expect(html).toContain('<td style="text-align:right">2</td>');
    expect(html).toContain('<li>one<ul><li>sub</li></ul></li><li>two</li>');
    expect(html).toContain('<pre><code>r = Aw / m</code></pre>');
  });

  it('formats inline text', () => {
    expect(inline('**bold** and `x*y*z` and https://open-meteo.com/en/docs.')).toBe(
      '<strong>bold</strong> and <code>x*y*z</code> and <a href="https://open-meteo.com/en/docs" rel="noopener">https://open-meteo.com/en/docs</a>.',
    );
  });

  it('renders the real METHOD.md with every factor in it', () => {
    const html = renderMarkdown(method);
    for (const value of ['1.181', '1.272', '1.329', '1.653', '1.78', '1.861', '6.59 m/s']) expect(html).toContain(value);
    expect(html).not.toContain('<script');
  });
});
