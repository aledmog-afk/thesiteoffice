// Small, strict readers for the two Cloudflare Pages rule files at the repo
// root (_redirects and _headers), written to the published format
// (developers.cloudflare.com/pages/configuration/redirects/ and /headers/).
// They throw on any line Pages would silently ignore, so a typo fails a
// test instead of quietly dropping a redirect in production.
import fs from "node:fs";

export const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);

export function parseRedirects(text) {
  const rules = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("#")) return;
    const parts = line.split(/\s+/);
    if (parts.length < 2 || parts.length > 3) throw new Error(`_redirects line ${i + 1}: expected "<source> <destination> [code]", got "${raw}"`);
    const [source, destination, codeText = "302"] = parts;
    const code = Number(codeText);
    if (!REDIRECT_CODES.has(code) && code !== 200) throw new Error(`_redirects line ${i + 1}: unsupported status ${codeText}`);
    if (!source.startsWith("/")) throw new Error(`_redirects line ${i + 1}: source must be a path, got "${source}" (domain-level redirects are not supported)`);
    if (source.includes("#")) throw new Error(`_redirects line ${i + 1}: a #fragment in the source never reaches the server`);
    if (line.length > 1000) throw new Error(`_redirects line ${i + 1}: over the 1,000-character limit`);
    const dynamic = source.includes("*") || /:[A-Za-z]/.test(source);
    rules.push({ line: i + 1, source, destination, code, dynamic });
  });
  return rules;
}

// First matching rule wins, as on Pages. Static sources match the path
// exactly; a trailing "*" splat matches any remainder.
export function matchRedirect(rules, path) {
  for (const r of rules) {
    if (r.source.endsWith("*")) {
      const prefix = r.source.slice(0, -1);
      if (path.startsWith(prefix)) return { ...r, splat: path.slice(prefix.length) };
    } else if (r.source === path) {
      return r;
    }
  }
  return null;
}

export function parseHeaders(text) {
  const rules = [];
  let current = null;
  text.split("\n").forEach((raw, i) => {
    if (!raw.trim() || raw.trim().startsWith("#")) return;
    if (!/^\s/.test(raw)) {
      current = { path: raw.trim(), line: i + 1, headers: {} };
      rules.push(current);
      return;
    }
    if (!current) throw new Error(`_headers line ${i + 1}: header before any path`);
    const m = raw.trim().match(/^([A-Za-z0-9-]+):\s*(.+)$/);
    if (!m) throw new Error(`_headers line ${i + 1}: expected "Name: value", got "${raw}"`);
    current.headers[m[1]] = m[2];
  });
  return rules;
}

export function headerRulePathMatches(rulePath, path) {
  if (rulePath.endsWith("*")) return path.startsWith(rulePath.slice(0, -1));
  return rulePath === path;
}

export function readRootFile(name) {
  return fs.readFileSync(new URL(`../../${name}`, import.meta.url), "utf8");
}
