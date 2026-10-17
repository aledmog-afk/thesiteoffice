// login.html ?next= must only ever send the browser to a page of this app.
// Runs the real login.html page script (import line stripped, as in
// login_logout.test.mjs) with the real safeNextPage() body taken from
// tracker/js/app.js, so neither is reimplemented here. Before the fix the
// page assigned ?next= straight to window.location.href, so a
// javascript: URL ran on the site's origin and https:// went off-site.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { extractScript, bodyWithoutScript, loadSafeNextPage } from "../lib/jsdom-harness.mjs";

const realSafeNextPage = loadSafeNextPage();
const safeNextPage = realSafeNextPage
  // Old code has no validator: hand the page an identity stand-in so the
  // page-level tests below run, and fail on what the page itself does.
  || ((raw, fallback = "dashboard.html") => raw || fallback);

const fromMock = (rows) => () => ({ select: () => ({ eq: () => ({ limit: async () => ({ data: rows, error: null }) }) }) });

async function runLogin({ next, session = null, supabaseExtra = {} }) {
  const htmlPath = new URL("../../tracker/login.html", import.meta.url).pathname;
  const dom = new JSDOM(bodyWithoutScript(htmlPath), { url: "https://example.com/tracker/login.html", runScripts: "outside-only" });
  const jsdomWindow = dom.window;
  const document = jsdomWindow.document;
  const window = { location: { href: "", search: "" } };
  const supabase = {
    auth: { getSession: async () => ({ data: { session } }), ...supabaseExtra },
    from: fromMock([{ id: "m1" }]),
  };
  const state = { done: false, err: null };
  const ctx = vm.createContext({
    window, document, console, URL, setTimeout, clearTimeout, supabase, state, safeNextPage,
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getParam: (k) => (k === "next" ? next : null),
  });
  vm.runInContext(`(async () => {\n${extractScript(htmlPath)}\n})().then(()=>{ state.done = true; }).catch(e => { state.err = e; });`, ctx);
  for (let i = 0; i < 100 && !state.done && !state.err; i++) await new Promise((r) => setTimeout(r, 10));
  if (state.err) throw state.err;
  await new Promise((r) => setTimeout(r, 30));
  return { window, document, jsdomWindow };
}

// Values exactly as getParam() hands them over (URLSearchParams has
// already decoded the query string once).
const HOSTILE = [
  "javascript:alert(document.domain)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "java\tscript:alert(1)",
  "java\nscript:alert(1)",
  "javascript%3Aalert(1)",
  "javascript%253Aalert(1)",
  "data:text/html,<script>alert(1)</script>",
  "//evil.com",
  "///evil.com",
  "https://evil.com",
  "http://evil.com/dashboard.html",
  "/\\evil.com",
  "\\evil",
  "\\\\evil.com",
  "%2F%2Fevil.com",
  "%252F%252Fevil.com",
  "%25252F%25252Fevil.com",
  "%5C%5Cevil.com",
  "/dashboard.html",
  "../dashboard.html",
  "dashboard.html ",
  "dashboard.html\u0000",
  "evil.com",
  "dashboard.html?x=javascript:alert(1)",
  "%E0%A4%A",
];

test("login.html: a hostile ?next= never reaches window.location (signed-in visitor) - falls back to dashboard.html", async () => {
  for (const next of HOSTILE) {
    const { window } = await runLogin({ next, session: { user: { id: "u1" } } });
    assert.equal(window.location.href, "dashboard.html", `next=${JSON.stringify(next)} was followed: ${JSON.stringify(window.location.href)}`);
  }
});

test("login.html: a hostile ?next= is also ignored after a password sign-in", async () => {
  for (const next of ["javascript:alert(1)", "https://evil.com", "//evil.com", "%2F%2Fevil"]) {
    const { window, document, jsdomWindow } = await runLogin({ next, supabaseExtra: { signInWithPassword: async () => ({ data: { user: { id: "u1" } }, error: null }) } });
    document.getElementById("email").value = "a@example.com";
    document.getElementById("password").value = "correct-horse";
    document.getElementById("authForm").dispatchEvent(new jsdomWindow.Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(window.location.href, "dashboard.html", `next=${next}`);
  }
});

test("login.html: a valid page name is kept, with its query or hash", async () => {
  for (const next of ["project.html?id=1", "dashboard.html", "invite.html", "companies.html?project=p1#party-abc", "weekly-report-view.html?id=8a1c-22"]) {
    const { window } = await runLogin({ next, session: { user: { id: "u1" } } });
    assert.equal(window.location.href, next);
  }
});

test("login.html: no ?next= still lands on the dashboard", async () => {
  const { window } = await runLogin({ next: null, session: { user: { id: "u1" } } });
  assert.equal(window.location.href, "dashboard.html");
});

test("safeNextPage(): the validator itself, including the fallback argument", () => {
  assert.ok(realSafeNextPage, "safeNextPage must exist in tracker/js/app.js");
  for (const v of HOSTILE) assert.equal(safeNextPage(v), "dashboard.html", JSON.stringify(v));
  assert.equal(safeNextPage("https://evil.com", "login.html"), "login.html");
  assert.equal(safeNextPage(undefined), "dashboard.html");
  assert.equal(safeNextPage(42), "dashboard.html");
  assert.equal(safeNextPage("project.html?id=1"), "project.html?id=1");
  assert.equal(safeNextPage("my-work.html#today"), "my-work.html#today");
});
