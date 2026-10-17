// functions/_middleware.js + _routes.json: repository files that aren't part
// of the website answer 404 on Cloudflare Pages, and nothing the app needs
// is caught. Loads the real middleware source as an ES module (it is not
// reimplemented here) and checks _routes.json invokes it on exactly the
// blocked paths.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../../", import.meta.url);
const SRC = fs.readFileSync(new URL("functions/_middleware.js", ROOT), "utf8");
const mw = await import(`data:text/javascript,${encodeURIComponent(SRC)}`);
const routes = JSON.parse(fs.readFileSync(new URL("_routes.json", ROOT), "utf8"));

// _routes.json wildcard semantics: "*" matches any number of segments.
const routeMatches = (rule, p) => (rule.endsWith("/*") ? p.startsWith(rule.slice(0, -1)) : rule === p);
const routed = (p) => routes.include.some((r) => routeMatches(r, p)) && !routes.exclude.some((r) => routeMatches(r, p));

const MUST_BLOCK = [
  "/sql", "/sql/", "/sql/schema.sql", "/sql/rollback/v69_site_progress_rollback.sql",
  "/tests", "/tests/", "/tests/README.md", "/tests/lib/db.mjs",
  "/supabase", "/supabase/", "/supabase/functions/commercial-approval-evidence/index.ts",
  "/.github", "/.github/workflows/test.yml",
  "/tracker/docs", "/tracker/docs/", "/tracker/docs/SITE_PROGRESS_SPEC.md",
  "/scripts", "/scripts/", "/scripts/toolbox-talks/source-docs/TBT-01-WorkingAtHeight.docx",
  "/tools", "/tools/gumroad-bulk-upload/products.csv",
  "/node_modules", "/node_modules/jsdom/package.json",
  "/functions/_middleware.js",
  "/package.json", "/package-lock.json", "/README.md", "/netlify.toml", "/_routes.json",
];

// Every file the deployed app serves under /tracker/ (except docs/), plus
// the pretty-URL forms Pages serves them at.
function appPaths() {
  const out = ["/tracker", "/tracker/"];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      const rel = "/" + path.relative(new URL(ROOT).pathname, full).split(path.sep).join("/");
      out.push(rel);
      if (rel.endsWith(".html")) out.push(rel.slice(0, -5));
    }
  };
  walk(new URL("tracker/", ROOT).pathname);
  return out.filter((p) => !p.startsWith("/tracker/docs/"));
}

test("blocked repo paths: the middleware answers 404 (with no-store and a deny-all CSP) for each, bare paths included", async () => {
  for (const p of MUST_BLOCK) {
    let nextCalled = false;
    const res = await mw.onRequest({ request: new Request(`https://thesiteoffice.uk${p}`), next: () => { nextCalled = true; return new Response("asset"); } });
    assert.equal(res.status, 404, p);
    assert.equal(nextCalled, false, `${p} reached the static file`);
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.match(res.headers.get("Content-Security-Policy"), /default-src 'none'/);
  }
});

test("blocked repo paths: _routes.json invokes the Function for every one of them (otherwise Pages serves the file directly)", () => {
  for (const p of MUST_BLOCK) assert.ok(routed(p), `${p} is not routed to the Function`);
  assert.ok(routes.include.length + routes.exclude.length <= 100, "Pages allows at most 100 route rules");
  for (const r of [...routes.include, ...routes.exclude]) assert.ok(r.length <= 100);
});

test("blocked repo paths: _routes.json and the middleware lists cover the same paths", () => {
  const expected = new Set([...mw.BLOCKED_PREFIXES.flatMap((p) => [p, `${p}/*`]), ...mw.BLOCKED_FILES]);
  assert.deepEqual(new Set(routes.include), expected);
});

test("blocked repo paths: encoded and doubled-slash variants are still blocked once they reach the Function", () => {
  for (const p of ["/%73ql/schema.sql", "/sql%2Fschema.sql", "/%2573ql/schema.sql", "//sql/schema.sql", "/sql//schema.sql", "/package%2Ejson", "/%E0%A4%A"]) {
    assert.equal(mw.isBlockedPath(p), true, p);
  }
});

test("blocked repo paths: no /tracker/ app page or asset (anything outside /tracker/docs/) is caught, by the routes or the middleware", async () => {
  const paths = appPaths();
  assert.ok(paths.some((p) => p === "/tracker/login.html") && paths.some((p) => p === "/tracker/js/app.js") && paths.some((p) => p === "/tracker/css/app.css"));
  for (const p of paths) {
    assert.equal(routed(p), false, `${p} would invoke the Function`);
    assert.equal(mw.isBlockedPath(p), false, `${p} would be blocked`);
  }
  for (const p of ["/", "/index.html", "/tracker/documents.html", "/tracker/drawings", "/tracker/docs-like.html", "/sqlite", "/testsuite", "/scripts.html", "/toolsbox", "/README", "/contents-inventory"]) {
    assert.equal(mw.isBlockedPath(p), false, p);
    assert.equal(routed(p), false, p);
  }
});

test("blocked repo paths: anything else passes straight through to the static file", async () => {
  const res = await mw.onRequest({ request: new Request("https://thesiteoffice.uk/tracker/login.html"), next: () => new Response("asset", { status: 200 }) });
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "asset");
});
