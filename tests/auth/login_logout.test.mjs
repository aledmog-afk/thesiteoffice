// Login / logout / unauthenticated-state — the real requireAuth()/signOut()
// bodies from tracker/js/app.js (extracted, never reimplemented), plus the
// real login.html page script for the sign-in form itself.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { extractScript, bodyWithoutScript } from "../lib/jsdom-harness.mjs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");

function extractFunction(name) {
  const re = new RegExp(`export async function ${name}\\(\\)[\\s\\S]*?\\n\\}`);
  const match = APP_JS.match(re);
  assert.ok(match, `${name} not found in app.js`);
  const body = match[0].replace(new RegExp(`^export async function ${name}\\(\\)\\s*\\{`), "").replace(/\}$/, "");
  return new Function(`return async function ${name}(window, supabase) {\n${body}\n}`)();
}

const requireAuth = extractFunction("requireAuth");
const signOut = extractFunction("signOut");

test("requireAuth(): no session -> redirects to login.html and returns null", async () => {
  const window = { location: { href: "" } };
  const supabase = { auth: { getSession: async () => ({ data: { session: null } }) } };
  const result = await requireAuth(window, supabase);
  assert.equal(result, null);
  assert.equal(window.location.href, "login.html", "an unauthenticated visitor must be sent to the sign-in page");
});

test("requireAuth(): a real session -> returns the user, no redirect", async () => {
  const window = { location: { href: "" } };
  const user = { id: "u1", email: "user@example.com" };
  const supabase = { auth: { getSession: async () => ({ data: { session: { user } } }) } };
  const result = await requireAuth(window, supabase);
  assert.deepEqual(result, user);
  assert.equal(window.location.href, "", "an authenticated visitor must not be redirected anywhere");
});

test("signOut(): clears the Supabase session and redirects to login.html", async () => {
  const window = { location: { href: "" } };
  let signOutCalled = false;
  const supabase = { auth: { signOut: async () => { signOutCalled = true; } } };
  await signOut(window, supabase);
  assert.ok(signOutCalled, "expected supabase.auth.signOut() to actually be called");
  assert.equal(window.location.href, "login.html", "logging out must send the user back to sign-in, ending any authenticated app state");
});

// ─── login.html: the real page script, DOM included ──────────────────
async function runLogin(supabase) {
  const htmlPath = new URL("../../tracker/login.html", import.meta.url).pathname;
  const scriptSrc = extractScript(htmlPath);
  const dom = new JSDOM(bodyWithoutScript(htmlPath), { url: "https://example.com/login.html", runScripts: "outside-only" });
  const jsdomWindow = dom.window;
  const document = jsdomWindow.document;
  // login.html's script only ever touches window.location (read/write) —
  // never any other window API — so a plain mock object stands in for
  // `window` inside the vm context instead of jsdom's real one. jsdom's
  // real Location is non-configurable (can't be overridden) and throws
  // "not implemented" on navigation without ever updating .href, which
  // would make a real login-success redirect untestable; DOM manipulation
  // still goes through the real jsdom `document`, provided separately.
  const window = { location: { href: "", search: "" } };

  const state = { done: false, err: null };
  const context = {
    window, document, console, URL, setTimeout, clearTimeout,
    supabase, state,
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getParam: () => null,
  };
  const ctx = vm.createContext(context);
  const wrapped = `(async () => {\n${scriptSrc}\n})().then(()=>{ state.done = true; }).catch(e => { state.err = e; });`;
  vm.runInContext(wrapped, ctx);
  for (let i = 0; i < 100 && !state.done && !state.err; i++) await new Promise((r) => setTimeout(r, 10));
  if (state.err) throw state.err;
  await new Promise((r) => setTimeout(r, 20));
  return { document, window, jsdomWindow };
}

test("login.html: a valid login calls signInWithPassword and navigates away on success", async () => {
  const calls = [];
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: async (creds) => { calls.push(creds); return { error: null }; },
    },
  };
  const { document, window, jsdomWindow } = await runLogin(supabase);
  document.getElementById("email").value = "user@example.com";
  document.getElementById("password").value = "correct-horse";
  document.getElementById("authForm").dispatchEvent(new jsdomWindow.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));

  assert.equal(calls.length, 1);
  // Individual properties, not a whole-object deepEqual: `creds` was
  // created inside the vm context, a different realm with its own
  // Object.prototype, which deepStrictEqual (correctly) treats as unequal
  // to an outer-realm object even when every enumerable property matches.
  assert.equal(calls[0].email, "user@example.com");
  assert.equal(calls[0].password, "correct-horse");
  assert.equal(window.location.href, "dashboard.html", "a successful login should navigate to the dashboard by default");
});

test("login.html: a failed login shows an error and does NOT navigate", async () => {
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      signInWithPassword: async () => ({ error: { message: "Invalid login credentials" } }),
    },
  };
  const { document, window, jsdomWindow } = await runLogin(supabase);
  document.getElementById("email").value = "user@example.com";
  document.getElementById("password").value = "wrong-password";
  document.getElementById("authForm").dispatchEvent(new jsdomWindow.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));

  const errBox = document.getElementById("errorBox");
  assert.ok(errBox.textContent.includes("Invalid login credentials"));
  assert.equal(window.location.href, "", "a failed login must never navigate anywhere");
});

test("login.html: already having a session redirects straight past the sign-in form", async () => {
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
      signInWithPassword: async () => ({ error: null }),
    },
  };
  const { window } = await runLogin(supabase);
  assert.equal(window.location.href, "dashboard.html", "an already-authenticated visitor should be sent straight to the dashboard");
});
