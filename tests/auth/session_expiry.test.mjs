// v59 — expired / lost sessions. Since v59 the `anon` role can no longer
// EXECUTE the RLS helper functions (is_project_member() & co.), so a
// request that goes out WITHOUT a user session (supabase-js silently
// falls back to the public anon key when getSession() has nothing
// usable) fails with a raw "permission denied for function ..." instead
// of quietly returning nothing. These tests exercise the REAL showError()
// / commercialErrorMessage() from tracker/js/app.js (extracted verbatim,
// same convention as tests/auth/login_logout.test.mjs) and check that
// such an error turns into a sign-in prompt + redirect, never a raw
// database message — while a genuine error for a signed-in user is
// still shown exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");

function section(startMarker, endMarker) {
  const start = APP_JS.indexOf(startMarker);
  assert.ok(start !== -1, `${startMarker} not found in app.js`);
  const end = APP_JS.indexOf(endMarker, start);
  assert.ok(end !== -1, `${endMarker} not found in app.js`);
  return APP_JS.slice(start, end).replace(/^export /gm, "");
}

const SHOW_ERROR_SRC = section("const SESSION_LOST_ERROR_RE", "export function clearError");
const COMMERCIAL_MSG_SRC = section("export function commercialErrorMessage", "export function showCommercialError");

function loadShowError(window, supabase) {
  return new Function("window", "supabase", `${SHOW_ERROR_SRC}\nreturn showError;`)(window, supabase);
}

const fakeEl = () => ({ textContent: "", style: { display: "none" } });
const settle = () => new Promise((r) => setTimeout(r, 10));

const ANON_RPC_ERROR = { code: "42501", message: "permission denied for function is_project_member" };

test("showError(): 'permission denied for function' with NO session -> friendly sign-in message, then redirect to login.html", async () => {
  const window = { location: { href: "" } };
  const supabase = { auth: { getSession: async () => ({ data: { session: null } }) } };
  const el = fakeEl();
  loadShowError(window, supabase)(el, ANON_RPC_ERROR);
  assert.equal(el.style.display, "block");
  assert.doesNotMatch(el.textContent, /permission denied/i, "the raw database error must never be shown");
  assert.match(el.textContent, /session has expired/i);
  await settle();
  assert.equal(window.location.href, "login.html");
});

test("showError(): an expired-JWT 401 from PostgREST (PGRST301 / 'JWT expired') with no session also redirects", async () => {
  const window = { location: { href: "" } };
  const supabase = { auth: { getSession: async () => ({ data: { session: null } }) } };
  const el = fakeEl();
  loadShowError(window, supabase)(el, { code: "PGRST301", message: "JWT expired" });
  await settle();
  assert.equal(window.location.href, "login.html");
});

test("showError(): the same error while still genuinely signed in is shown as-is and does NOT redirect", async () => {
  const window = { location: { href: "" } };
  const supabase = { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } };
  const el = fakeEl();
  loadShowError(window, supabase)(el, ANON_RPC_ERROR);
  await settle();
  assert.equal(window.location.href, "");
  assert.equal(el.textContent, ANON_RPC_ERROR.message);
});

test("showError(): ordinary errors are unchanged (no session lookup, no redirect)", async () => {
  const window = { location: { href: "" } };
  let looked = false;
  const supabase = { auth: { getSession: async () => { looked = true; return { data: { session: null } }; } } };
  const el = fakeEl();
  const showError = loadShowError(window, supabase);
  showError(el, { message: "new row violates row-level security policy for table \"snag_items\"" });
  showError(el, "Those passwords don't match.");
  await settle();
  assert.equal(looked, false);
  assert.equal(window.location.href, "");
  assert.equal(el.textContent, "Those passwords don't match.");
  assert.equal(el.style.display, "block");
});

test("commercialErrorMessage(): 'permission denied for function' becomes a session-expired message, not raw SQL", () => {
  const fn = new Function("console", `${COMMERCIAL_MSG_SRC}\nreturn commercialErrorMessage;`)({ error() {} });
  assert.match(fn({ message: "permission denied for function can_view_commercial" }), /session has expired/i);
  assert.equal(fn({ message: "permission denied for table commercial_events" }), "You don't have permission to do that.");
});

test("every protected page awaits requireAuth() before its own queries (so requireAuth()'s never-resolving no-session path really halts the page)", () => {
  const dir = new URL("../../tracker/", import.meta.url);
  const pages = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
  const PUBLIC_PAGES = new Set(["index.html", "login.html", "join.html", "reset-password.html", "commercial-approval.html"]);
  for (const page of pages) {
    if (PUBLIC_PAGES.has(page)) continue;
    const html = fs.readFileSync(new URL(page, dir), "utf8");
    const script = (html.match(/<script type="module">([\s\S]*?)<\/script>/) || [])[1] || "";
    const body = script.split("\n").filter((l) => !/^\s*import\s/.test(l)).join("\n");
    const authAt = body.search(/await requireAuth\(\)/);
    assert.ok(authAt !== -1, `${page} must await requireAuth()`);
    const firstQuery = body.search(/supabase\s*\.\s*(rpc|from|storage)\b/);
    assert.ok(firstQuery === -1 || firstQuery > authAt, `${page} queries Supabase before requireAuth() has run`);
  }
});
