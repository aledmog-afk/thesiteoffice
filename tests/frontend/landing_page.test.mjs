// The public pages at the site root (index.html, 404.html, privacy.html,
// terms.html) and the root _headers rules that cover them. These pages have
// no script, so they are checked as static markup under jsdom.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { parseHeaders, resolveHeaders, parseRedirects, matchRedirect, readRootFile } from "../lib/pages_rules.mjs";

const ROOT = new URL("../../", import.meta.url);
const PAGES = ["index.html", "404.html", "privacy.html", "terms.html"];
const load = (f) => new JSDOM(fs.readFileSync(new URL(f, ROOT), "utf8"), { url: "https://thesiteoffice.uk/" }).window.document;

// Resolves a root-relative link the way Cloudflare Pages serves it:
// pretty URLs (/privacy -> privacy.html), directory index, query/hash ignored.
function servedFile(href) {
  const u = new URL(href, "https://thesiteoffice.uk/");
  if (u.origin !== "https://thesiteoffice.uk") return null;
  let p = decodeURIComponent(u.pathname).replace(/^\//, "");
  if (p === "" || p.endsWith("/")) p += "index.html";
  if (fs.existsSync(new URL(p, ROOT))) return p;
  if (fs.existsSync(new URL(`${p}.html`, ROOT))) return `${p}.html`;
  return undefined;
}

test("landing: a plain The Site Office front page whose sign-in and sign-up links reach the real login page", () => {
  const doc = load("index.html");
  assert.match(doc.title, /The Site Office/);
  assert.equal(doc.getElementById("signInLink").getAttribute("href"), "/tracker/login.html");
  assert.equal(doc.getElementById("signUpLink").getAttribute("href"), "/tracker/login.html?mode=signup");
  assert.equal(doc.querySelector('link[rel="canonical"]').getAttribute("href"), "https://thesiteoffice.uk/");
  assert.ok(doc.querySelector('link[rel="stylesheet"][href="/tracker/css/app.css"]'), "uses the app's shared stylesheet");
});

test("landing: no personal branding, no shop and no contact email on the public pages", () => {
  for (const f of PAGES) {
    const html = fs.readFileSync(new URL(f, ROOT), "utf8");
    assert.doesNotMatch(html, /Aled|Mogford|aledmog/i, `${f} carries personal branding`);
    assert.doesNotMatch(html, /gumroad|stripe|basket|£/i, `${f} still refers to the shop`);
    assert.doesNotMatch(html, /mailto:|@thesiteoffice\.uk/i, `${f} shows an email address that has no mailbox`);
  }
});

test("landing: the shop-closed notice is hidden unless a redirected visitor lands on #shop-closed", () => {
  const html = fs.readFileSync(new URL("index.html", ROOT), "utf8");
  const doc = load("index.html");
  const notice = doc.getElementById("shop-closed");
  assert.ok(notice);
  assert.match(html, /\.notice \{ display: none;/);
  assert.match(html, /\.notice:target \{ display: block; \}/);
});

test("public pages: no scripts at all, so the strict root CSP (script-src 'self') can never block them", () => {
  for (const f of PAGES) {
    const doc = load(f);
    assert.equal(doc.querySelectorAll("script").length, 0, `${f} has a script`);
    assert.equal(doc.querySelectorAll("[onclick],[onload],[onerror]").length, 0, `${f} has an inline handler`);
  }
});

test("public pages: every local link and asset resolves to a real file (or a redirect rule), with absolute paths so 404.html works at any depth", () => {
  const rules = parseRedirects(readRootFile("_redirects"));
  for (const f of PAGES) {
    const doc = load(f);
    const refs = [...doc.querySelectorAll("a[href], link[href]")].map((el) => el.getAttribute("href"));
    for (const href of refs) {
      if (/^https?:/.test(href) && !href.startsWith("https://thesiteoffice.uk")) continue;
      if (href.startsWith("#")) continue;
      if (!/^https?:/.test(href)) assert.ok(href.startsWith("/"), `${f}: ${href} must be root-absolute`);
      const path = new URL(href, "https://thesiteoffice.uk/").pathname;
      const file = servedFile(href);
      assert.ok(file || matchRedirect(rules, path), `${f}: ${href} goes nowhere`);
    }
  }
});

test("404 page: says the page was not found and offers sign-in and home, and is not indexed", () => {
  const doc = load("404.html");
  assert.match(doc.body.textContent, /Page not found/);
  assert.ok(doc.querySelector('a[href="/tracker/login.html"]'));
  assert.ok(doc.querySelector('a[href="/"]'));
  assert.equal(doc.querySelector('meta[name="robots"]').getAttribute("content"), "noindex");
});

test("privacy and terms: clearly marked DRAFT, placeholders in brackets, not indexed, linked from the front page footer", () => {
  for (const f of ["privacy.html", "terms.html"]) {
    const doc = load(f);
    assert.match(doc.title, /^DRAFT /);
    assert.match(doc.getElementById("draftBanner").textContent, /DRAFT – not yet approved/);
    assert.match(doc.body.textContent, /\[[^\]]+\]/, "uses bracketed placeholders");
    assert.equal(doc.querySelector('meta[name="robots"]').getAttribute("content"), "noindex");
  }
  const home = load("index.html");
  assert.ok(home.querySelector('footer a[href="/privacy"]'));
  assert.ok(home.querySelector('footer a[href="/terms"]'));
  for (const a of home.querySelectorAll("a")) assert.notEqual(a.getAttribute("href"), "#", "no dead # links");
});

test("privacy draft: lists the topics a UK GDPR privacy notice has to cover", () => {
  const text = load("privacy.html").body.textContent;
  for (const topic of [/controller/i, /lawful basis/i, /how long/i, /rights/i, /withdraw consent/i, /Information Commissioner/i, /outside the UK/i, /automated decision/i, /Who receives/i]) {
    assert.match(text, topic);
  }
});

const SECURITY = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000",
};

test("_headers: every root page, the 404 page at any unknown path, and the app get each security header exactly once", () => {
  const rules = parseHeaders(readRootFile("_headers"));
  const rootPaths = ["/", "/index.html", "/404", "/404.html", "/privacy", "/privacy.html", "/terms", "/terms.html", "/robots.txt", "/sitemap.xml", "/no-such-page", "/old/deep/link"];
  const appPaths = ["/tracker/", "/tracker/login.html", "/tracker/login", "/tracker/commercial-approval.html", "/tracker/js/app.js", "/tracker/no-such-page"];
  for (const p of [...rootPaths, ...appPaths]) {
    const h = resolveHeaders(rules, p);
    for (const [k, v] of Object.entries(SECURITY)) assert.equal(h[k], v, `${p}: ${k}`);
    assert.ok(h["Content-Security-Policy"] && !h["Content-Security-Policy"].includes(", default-src"), `${p}: exactly one CSP`);
    assert.match(h["Content-Security-Policy"], /frame-ancestors 'none'/, p);
  }
  for (const p of rootPaths) assert.match(resolveHeaders(rules, p)["Content-Security-Policy"], /script-src 'self';/, `${p}: root pages allow no inline script`);
});

test("_headers: the app's own CSP (inline module scripts, esm.sh, Supabase, and worker-src 'self' for the v74 drawing-pins PDF rasteriser)", () => {
  const rules = parseHeaders(readRootFile("_headers"));
  const csp = resolveHeaders(rules, "/tracker/login.html")["Content-Security-Policy"];
  assert.equal(csp, "default-src 'self'; script-src 'self' 'unsafe-inline' https://esm.sh; worker-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https://*.supabase.co; connect-src 'self' https://*.supabase.co https://api.postcodes.io https://api.open-meteo.com https://esm.sh; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
});

test("_headers: /contents-inventory is left exactly as before (Aled's decision) - no headers from this file", () => {
  const rules = parseHeaders(readRootFile("_headers"));
  for (const p of ["/contents-inventory", "/contents-inventory.html"]) assert.deepEqual(resolveHeaders(rules, p), {}, p);
});

test("_headers: the app's own JS and CSS always revalidate (no-cache), so a stale cached copy can never outlive a deploy", () => {
  const rules = parseHeaders(readRootFile("_headers"));
  for (const p of ["/tracker/js/app.js", "/tracker/js/theme-init.js", "/tracker/js/supabase-client.js", "/tracker/css/app.css"]) {
    assert.equal(resolveHeaders(rules, p)["Cache-Control"], "no-cache", p);
  }
});

test("_headers: Cache-Control is scoped to the app's JS/CSS only - HTML pages and root pages don't get it from this file", () => {
  const rules = parseHeaders(readRootFile("_headers"));
  for (const p of ["/", "/privacy.html", "/tracker/login.html", "/tracker/plot-detail.html", "/tracker/favicon.svg"]) {
    assert.equal(resolveHeaders(rules, p)["Cache-Control"], undefined, p);
  }
});

test("robots and sitemap: the front page is listed, the app itself is kept out of search", () => {
  const robots = readRootFile("robots.txt");
  assert.match(robots, /^Disallow: \/tracker\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/thesiteoffice\.uk\/sitemap\.xml$/m);
  const sitemap = readRootFile("sitemap.xml");
  assert.match(sitemap, /<loc>https:\/\/thesiteoffice\.uk\/<\/loc>/);
  assert.doesNotMatch(sitemap, /tracker|privacy|terms/);
});
