/**
 * A small Markdown renderer for METHOD.md: headings, paragraphs, lists, tables,
 * fenced code, **bold**, *italic*, `code` and bare links. All text is escaped
 * first, so the output contains only the tags made here.
 */

function escape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function inline(text: string): string {
  const codes: string[] = [];
  let out = escape(text).replace(/`([^`]+)`/g, (_m, c: string) => {
    codes.push(`<code>${c}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });
  out = out
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/(https?:\/\/[^\s<),]*[^\s<),.])/g, '<a href="$1" rel="noopener">$1</a>');
  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => codes[Number(i)]);
}

function slug(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

export function renderMarkdown(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let i = 0;

  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
  const cells = (l: string) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const listItem = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

  while (i < lines.length) {
    const line = lines[i];

    if (/^```/.test(line)) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) code.push(lines[i++]);
      i++;
      html.push(`<pre><code>${escape(code.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level} id="${slug(heading[2])}">${inline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (isTableRow(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const head = cells(line);
      const align = cells(lines[i + 1]).map((c) => (c.endsWith(':') ? 'right' : 'left'));
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i])) rows.push(cells(lines[i++]));
      const th = head.map((c, j) => `<th style="text-align:${align[j]}">${inline(c)}</th>`).join('');
      const body = rows.map((r) => `<tr>${r.map((c, j) => `<td style="text-align:${align[j] ?? 'left'}">${inline(c)}</td>`).join('')}</tr>`).join('');
      html.push(`<div class="table-scroll"><table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table></div>`);
      continue;
    }

    if (listItem.test(line)) {
      // One level of nesting is enough for METHOD.md.
      const ordered = /^\s*\d+\./.test(line);
      const items: string[] = [];
      while (i < lines.length && (listItem.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        const m = listItem.exec(lines[i]);
        if (m && m[1].length === 0) {
          items.push(inline(m[3]));
        } else if (m) {
          const sub: string[] = [];
          const subOrdered = /\d+\./.test(m[2]);
          while (i < lines.length) {
            const s = listItem.exec(lines[i]);
            if (!s || s[1].length === 0) break;
            sub.push(`<li>${inline(s[3])}</li>`);
            i++;
          }
          items[items.length - 1] += subOrdered ? `<ol>${sub.join('')}</ol>` : `<ul>${sub.join('')}</ul>`;
          continue;
        } else {
          items[items.length - 1] += ` ${inline(lines[i].trim())}`;
        }
        i++;
      }
      const tag = ordered ? 'ol' : 'ul';
      html.push(`<${tag}>${items.map((it) => `<li>${it}</li>`).join('')}</${tag}>`);
      continue;
    }

    if (line.trim() === '') {
      i++;
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,4}\s|```)/.test(lines[i]) &&
      !listItem.test(lines[i]) &&
      !isTableRow(lines[i])
    ) {
      para.push(lines[i++].trim());
    }
    html.push(`<p>${inline(para.join(' '))}</p>`);
  }
  return html.join('\n');
}
