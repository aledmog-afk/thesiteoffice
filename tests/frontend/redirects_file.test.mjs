// The root _redirects file that Cloudflare Pages applies on thesiteoffice.uk.
// Read with the strict parser in tests/lib/pages_rules.mjs, so a line Pages
// would ignore fails here instead of silently in production.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { parseRedirects, matchRedirect, readRootFile } from "../lib/pages_rules.mjs";

const rules = parseRedirects(readRootFile("_redirects"));
const ROOT = new URL("../../", import.meta.url);
const exists = (rel) => fs.existsSync(new URL(rel.replace(/^\//, ""), ROOT));

// Every Site Office page that was live on thesiteoffice.uk (main @ 06d47a7),
// in both the pretty form Pages served and the .html form it 308-redirected.
const OLD_SHOP_PAGES = ["Rams", "rams", "cdm", "commercial", "contracts", "health-safety", "hr", "quality", "site-management", "free-starter-pack"];

test("_redirects: every line parses, uses a supported status and stays well inside the Pages limits", () => {
  assert.ok(rules.length > 0);
  const staticCount = rules.filter((r) => !r.dynamic).length;
  const dynamicCount = rules.filter((r) => r.dynamic).length;
  assert.ok(staticCount <= 2000 && dynamicCount <= 100);
  for (const r of rules) assert.ok(r.code !== 200, `line ${r.line}: proxy (200) rules are not used on this site`);
});

test("_redirects: no source is listed twice (Pages would silently use only the first)", () => {
  const seen = new Map();
  for (const r of rules) {
    assert.ok(!seen.has(r.source), `${r.source} on line ${r.line} duplicates line ${seen.get(r.source)}`);
    seen.set(r.source, r.line);
  }
});

test("_redirects: static rules come before any dynamic rule (the Pages ordering rule)", () => {
  const firstDynamic = rules.findIndex((r) => r.dynamic);
  if (firstDynamic === -1) return;
  assert.ok(rules.slice(firstDynamic).every((r) => r.dynamic));
});

test("_redirects: nothing under /tracker is redirected, so approval links, invites and bookmarks keep working unchanged", () => {
  for (const r of rules) {
    assert.ok(!r.source.startsWith("/tracker"), `line ${r.line} redirects ${r.source}`);
    assert.ok(r.source !== "/*" && r.source !== "/", `line ${r.line} would catch the whole site`);
  }
  for (const p of ["/tracker/", "/tracker/login.html", "/tracker/invite.html", "/tracker/commercial-approval.html", "/tracker/commercial-approval", "/tracker/reset-password.html", "/tracker/join.html"]) {
    assert.equal(matchRedirect(rules, p), null, `${p} must reach the app file`);
  }
});

test("_redirects: every old shop page, pretty and .html, is a permanent 301 to the home page's shop-closed notice", () => {
  for (const page of OLD_SHOP_PAGES) {
    for (const path of [`/${page}`, `/${page}.html`]) {
      const r = matchRedirect(rules, path);
      assert.ok(r, `${path} has no redirect`);
      assert.equal(r.code, 301, `${path} should be permanent`);
      assert.equal(r.destination, "/#shop-closed");
    }
  }
  const home = fs.readFileSync(new URL("index.html", ROOT), "utf8");
  assert.match(home, /id="shop-closed"/, "the redirect target's notice must exist on the home page");
});

test("_redirects: the removed shop files are really gone (a redirect would hide them anyway, but they should not linger)", () => {
  for (const f of ["Rams.html", "cdm.html", "commercial.html", "contracts.html", "health-safety.html", "hr.html", "quality.html", "site-management.html"]) {
    assert.equal(exists(f), false, `${f} should be removed`);
  }
});

test("_redirects: every local destination exists in the repo, and no destination is itself redirected (no chains or loops)", () => {
  for (const r of rules) {
    if (/^https?:/.test(r.destination)) continue;
    const path = r.destination.split("#")[0].split("?")[0];
    const file = path === "/" ? "index.html" : path.endsWith("/") ? `${path}index.html` : path;
    assert.ok(exists(file), `line ${r.line}: ${r.destination} points at a missing file (${file})`);
    assert.equal(matchRedirect(rules, path), null, `line ${r.line}: ${r.destination} is itself redirected`);
  }
});

test("_redirects: short sign-in addresses are temporary (302) and land on the real sign-in page", () => {
  for (const p of ["/login", "/signin"]) {
    const r = matchRedirect(rules, p);
    assert.equal(r.code, 302);
    assert.equal(r.destination, "/tracker/login.html");
  }
});

test("_redirects: the parser itself rejects lines Pages would ignore", () => {
  assert.throws(() => parseRedirects("/a /b 410"), /unsupported status/);
  assert.throws(() => parseRedirects("example.com/a /b 301"), /must be a path/);
  assert.throws(() => parseRedirects("/a"), /expected/);
  assert.throws(() => parseRedirects("/a#x /b 301"), /fragment/);
});
