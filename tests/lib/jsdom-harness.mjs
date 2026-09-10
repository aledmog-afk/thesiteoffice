// Shared harness for testing a tracker/*.html page's real inline
// <script type="module"> body under jsdom — never a reimplementation of
// the page's logic. Extracts the exact script text, drops its `import`
// line (the test supplies those bindings directly, e.g. a mock
// `supabase`), and runs it inside a vm context standing in for `window`.
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

// Extracts a page's module script body, with its `import { ... } from`
// line(s) removed — the caller provides equivalent bindings via `context`.
export function extractScript(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`No <script type="module"> found in ${htmlPath}`);
  return match[1]
    .split("\n")
    .filter((line) => !/^\s*import\s.*from\s/.test(line))
    .join("\n");
}

export function bodyWithoutScript(htmlPath) {
  return fs.readFileSync(htmlPath, "utf8").replace(/<script type="module">[\s\S]*?<\/script>/, "");
}

// Runs `scriptSrc` (from extractScript) against a fresh JSDOM built from
// `htmlPath`'s markup (minus its own script tag), inside a vm context
// pre-wired with the platform globals a vm.createContext() does NOT
// provide by default (URL, setTimeout/clearTimeout) plus whatever the
// caller passes in `context` (mocked supabase, app.js helpers, etc).
// Waits for the script's own top-level async IIFE to finish, then
// returns { document, window } for the test to interact with further.
export async function runPage(htmlPath, scriptSrc, context = {}) {
  const dom = new JSDOM(bodyWithoutScript(htmlPath), { url: context.__url || "https://example.com/", runScripts: "outside-only" });
  const { window } = dom;
  const document = window.document;

  const fullContext = {
    window,
    document,
    console,
    URL,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    ...context,
  };
  const ctx = vm.createContext(fullContext);
  const wrapped = `(async () => {\n${scriptSrc}\n})().then(() => { window.__done = true; }).catch((e) => { window.__err = e; });`;
  vm.runInContext(wrapped, ctx);

  for (let i = 0; i < 100 && !window.__done && !window.__err; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (window.__err) throw window.__err;
  await new Promise((r) => setTimeout(r, 20));
  return { document, window };
}

export function fireEvent(el, type, opts = {}) {
  const win = el.ownerDocument.defaultView;
  el.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true, ...opts }));
}

export async function wait(ms) {
  await new Promise((r) => setTimeout(r, ms));
}
