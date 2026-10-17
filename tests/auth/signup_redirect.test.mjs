// login.html: the sign-up confirmation email returns to this deployment's
// own sign-in page (emailRedirectTo), and ?mode=signup (the front page's
// "Create one" link) opens the form in sign-up mode. Runs the real page
// script, same approach as login_logout.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { JSDOM } from "jsdom";
import { extractScript, bodyWithoutScript } from "../lib/jsdom-harness.mjs";

async function runLogin(supabase, { href, params = {} }) {
  const htmlPath = new URL("../../tracker/login.html", import.meta.url).pathname;
  const dom = new JSDOM(bodyWithoutScript(htmlPath), { url: "https://example.com/tracker/login.html", runScripts: "outside-only" });
  const jsdomWindow = dom.window;
  const document = jsdomWindow.document;
  const window = { location: { href, search: "" } };
  const state = { done: false, err: null };
  const ctx = vm.createContext({
    window, document, console, URL, setTimeout, clearTimeout, supabase, state,
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getParam: (k) => (k in params ? params[k] : null),
  });
  vm.runInContext(`(async () => {\n${extractScript(htmlPath)}\n})().then(()=>{ state.done = true; }).catch(e => { state.err = e; });`, ctx);
  for (let i = 0; i < 100 && !state.done && !state.err; i++) await new Promise((r) => setTimeout(r, 10));
  if (state.err) throw state.err;
  await new Promise((r) => setTimeout(r, 20));
  return { document, window, jsdomWindow };
}

async function signUpOn(href) {
  const calls = [];
  const supabase = { auth: { getSession: async () => ({ data: { session: null } }), signUp: async (args) => { calls.push(args); return { data: { session: null }, error: null }; } } };
  const { document, jsdomWindow } = await runLogin(supabase, { href });
  document.getElementById("toggleBtn").dispatchEvent(new jsdomWindow.Event("click"));
  document.getElementById("email").value = "new@example.com";
  document.getElementById("password").value = "correct-horse";
  document.getElementById("authForm").dispatchEvent(new jsdomWindow.Event("submit", { cancelable: true }));
  await new Promise((r) => setTimeout(r, 20));
  return { calls, document };
}

test("sign-up on thesiteoffice.uk: the confirmation email returns to https://thesiteoffice.uk/tracker/login.html", async () => {
  const { calls, document } = await signUpOn("https://thesiteoffice.uk/tracker/login.html");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "new@example.com");
  assert.equal(calls[0].options.emailRedirectTo, "https://thesiteoffice.uk/tracker/login.html");
  assert.ok(document.getElementById("infoBox").textContent.includes("Check your email"));
});

test("sign-up on the old pages.dev address (or via a pretty URL with a query): it returns to that same address's sign-in page, so nothing depends on one domain", async () => {
  const { calls } = await signUpOn("https://claude-construction-tracking.thesiteoffice.pages.dev/tracker/login?next=invite.html");
  assert.equal(calls[0].options.emailRedirectTo, "https://claude-construction-tracking.thesiteoffice.pages.dev/tracker/login.html");
});

test("?mode=signup opens the form in sign-up mode; no mode keeps sign-in", async () => {
  const supabase = { auth: { getSession: async () => ({ data: { session: null } }) } };
  const signup = await runLogin(supabase, { href: "https://thesiteoffice.uk/tracker/login.html?mode=signup", params: { mode: "signup" } });
  assert.equal(signup.document.getElementById("submitBtn").textContent, "Create Account");
  assert.equal(signup.document.getElementById("toggleBtn").textContent, "Sign in");
  const plain = await runLogin(supabase, { href: "https://thesiteoffice.uk/tracker/login.html" });
  assert.equal(plain.document.getElementById("submitBtn").textContent, "Sign In");
  const odd = await runLogin(supabase, { href: "https://thesiteoffice.uk/tracker/login.html?mode=forgot", params: { mode: "forgot" } });
  assert.equal(odd.document.getElementById("submitBtn").textContent, "Sign In", "only 'signup' is accepted from the URL");
});
