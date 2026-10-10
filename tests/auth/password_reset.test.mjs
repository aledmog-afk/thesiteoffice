// Password reset (Priority 2) — the real login.html "forgot password"
// branch and the real reset-password.html page script.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const LOGIN_HTML = new URL("../../tracker/login.html", import.meta.url).pathname;
const RESET_HTML = new URL("../../tracker/reset-password.html", import.meta.url).pathname;

function baseAuthContext(overrides = {}) {
  return {
    __url: "https://example.com/login.html",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getParam: () => null,
    ...overrides,
  };
}

test("Requesting a reset calls resetPasswordForEmail with a same-origin redirect", async () => {
  const calls = [];
  const supabase = {
    auth: {
      getSession: async () => ({ data: { session: null } }),
      resetPasswordForEmail: async (email, opts) => { calls.push({ email, opts }); return { error: null }; },
    },
  };
  const { document, window } = await runPage(LOGIN_HTML, extractScript(LOGIN_HTML), baseAuthContext({ supabase }));

  fireEvent(document.getElementById("forgotBtn"), "click");
  document.getElementById("email").value = "user@example.com";
  fireEvent(document.getElementById("authForm"), "submit");
  await wait(30);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].email, "user@example.com");
  const redirect = new URL(calls[0].opts.redirectTo);
  assert.equal(redirect.origin, "https://example.com", "the redirect must stay on this app's own origin");
  assert.equal(redirect.pathname, "/reset-password.html");
});

test("The same generic message shows whether or not the email actually has an account", async () => {
  for (const email of ["realuser@example.com", "totally-made-up@nowhere.example"]) {
    const supabase = {
      auth: {
        getSession: async () => ({ data: { session: null } }),
        // Supabase's own API never distinguishes — always { error: null } —
        // this test proves the UI doesn't add a distinguishing branch of
        // its own on top of that.
        resetPasswordForEmail: async () => ({ error: null }),
      },
    };
    const { document } = await runPage(LOGIN_HTML, extractScript(LOGIN_HTML), baseAuthContext({ supabase }));
    fireEvent(document.getElementById("forgotBtn"), "click");
    document.getElementById("email").value = email;
    fireEvent(document.getElementById("authForm"), "submit");
    await wait(30);
    const infoBox = document.getElementById("infoBox");
    assert.ok(infoBox.textContent.includes("If that email has an account"), `expected the generic message for ${email}`);
  }
});

test("reset-password.html: no recovery session -> shows an invalid/expired state, never the password form", async () => {
  const supabase = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  };
  const { document } = await runPage(RESET_HTML, extractScript(RESET_HTML), {
    __url: "https://example.com/reset-password.html",
    supabase,
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
  });
  await wait(2200); // the page's own fallback timer before declaring the link invalid
  assert.notEqual(document.getElementById("resetForm").style.display, "block");
  assert.equal(document.getElementById("invalidRow").style.display, "block");
  assert.ok(document.getElementById("subText").textContent.includes("invalid or has expired"));
});

test("reset-password.html: a real PASSWORD_RECOVERY session activates the form and calls updateUser", async () => {
  let updatedPassword = null;
  const supabase = {
    auth: {
      onAuthStateChange: (cb) => { setTimeout(() => cb("PASSWORD_RECOVERY"), 5); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      updateUser: async ({ password }) => { updatedPassword = password; return { error: null }; },
    },
  };
  const { document, window } = await runPage(RESET_HTML, extractScript(RESET_HTML), {
    __url: "https://example.com/reset-password.html",
    supabase,
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
  });
  await wait(100);
  assert.equal(document.getElementById("resetForm").style.display, "block", "the PASSWORD_RECOVERY event should reveal the set-new-password form");

  document.getElementById("password").value = "correctNewPass1";
  document.getElementById("confirmPassword").value = "correctNewPass1";
  fireEvent(document.getElementById("resetForm"), "submit");
  await wait(30);

  assert.equal(updatedPassword, "correctNewPass1", "expected updateUser to be called with the entered password");
  assert.ok(document.getElementById("infoBox").textContent.includes("Password updated"));
});

test("reset-password.html: mismatched password/confirm is rejected before calling updateUser", async () => {
  let updateCalled = false;
  const supabase = {
    auth: {
      onAuthStateChange: (cb) => { setTimeout(() => cb("PASSWORD_RECOVERY"), 5); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      updateUser: async () => { updateCalled = true; return { error: null }; },
    },
  };
  const { document } = await runPage(RESET_HTML, extractScript(RESET_HTML), {
    __url: "https://example.com/reset-password.html",
    supabase,
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
  });
  await wait(100);

  document.getElementById("password").value = "passwordOne";
  document.getElementById("confirmPassword").value = "passwordTwo";
  fireEvent(document.getElementById("resetForm"), "submit");
  await wait(30);

  assert.equal(updateCalled, false, "updateUser must never be called when the two fields disagree");
  assert.ok(document.getElementById("errorBox").textContent.toLowerCase().includes("match"));
});
