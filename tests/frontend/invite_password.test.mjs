// v84: tracker/invite-password.html — the page an invite-party-user
// email's link lands a brand-new recipient on: set a password, then go
// straight on to invite.html to accept the job (the party-invite token
// travels as ?t=, read back out in sessionStorage the same way a
// directly-opened invite.html#t=... link already works). Mirrors
// tests/auth/password_reset.test.mjs's structure for reset-password.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const PAGE = new URL("../../tracker/invite-password.html", import.meta.url).pathname;

function ctx(overrides = {}) {
  return {
    __url: "https://example.com/invite-password.html?t=" + "a".repeat(64),
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getParam: (n) => (n === "t" ? "a".repeat(64) : null),
    ...overrides,
  };
}

test("invite-password.html: no session at all -> shows an invalid/expired state, never the password form", async () => {
  const supabase = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: null } }),
    },
  };
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx({ supabase }));
  await wait(2200); // the page's own fallback timer before declaring the link invalid
  assert.notEqual(document.getElementById("setPasswordForm").style.display, "block");
  assert.equal(document.getElementById("invalidRow").style.display, "block");
  assert.ok(document.getElementById("subText").textContent.includes("invalid or has expired"));
});

test("invite-password.html: a real SIGNED_IN session (from the invite email link) reveals the form", async () => {
  const supabase = {
    auth: {
      onAuthStateChange: (cb) => { setTimeout(() => cb("SIGNED_IN"), 5); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      updateUser: async () => ({ error: null }),
    },
  };
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx({ supabase }));
  await wait(100);
  assert.equal(document.getElementById("setPasswordForm").style.display, "block");
});

test("invite-password.html: setting a password calls updateUser and stashes the party-invite token for invite.html to pick up", async () => {
  let updatedPassword = null;
  const supabase = {
    auth: {
      onAuthStateChange: (cb) => { setTimeout(() => cb("SIGNED_IN"), 5); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      updateUser: async ({ password }) => { updatedPassword = password; return { error: null }; },
    },
  };
  const { document, window } = await runPage(PAGE, extractScript(PAGE), ctx({ supabase }));
  await wait(100);

  document.getElementById("password").value = "correctNewPass1";
  document.getElementById("confirmPassword").value = "correctNewPass1";
  fireEvent(document.getElementById("setPasswordForm"), "submit");
  await wait(30);

  assert.equal(updatedPassword, "correctNewPass1");
  assert.equal(window.sessionStorage.getItem("partyInviteToken"), "a".repeat(64), "the party-invite token must be handed to invite.html via sessionStorage");
  // jsdom doesn't implement real cross-document navigation, so
  // window.location.href after the assignment can't be asserted here
  // (same limitation/convention as tests/frontend/daywork_workflow.test.mjs)
  // — the redirect target itself ("invite.html") is a one-line,
  // directly-readable statement in the page's own submit handler, and
  // the sessionStorage assertion above is what actually proves the
  // right branch ran.
});

test("invite-password.html: opened with no ?t= at all (shouldn't normally happen) never stashes a token for invite.html", async () => {
  const supabase = {
    auth: {
      onAuthStateChange: (cb) => { setTimeout(() => cb("SIGNED_IN"), 5); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      updateUser: async () => ({ error: null }),
    },
  };
  const { document, window } = await runPage(PAGE, extractScript(PAGE), ctx({ supabase, getParam: () => null, __url: "https://example.com/invite-password.html" }));
  await wait(100);
  document.getElementById("password").value = "correctNewPass1";
  document.getElementById("confirmPassword").value = "correctNewPass1";
  fireEvent(document.getElementById("setPasswordForm"), "submit");
  await wait(30);
  assert.equal(window.sessionStorage.getItem("partyInviteToken"), null, "with no ?t= there is nothing to stash — the page falls back to the dashboard instead of a broken invite.html");
});

test("invite-password.html: mismatched password/confirm is rejected before calling updateUser", async () => {
  let updateCalled = false;
  const supabase = {
    auth: {
      onAuthStateChange: (cb) => { setTimeout(() => cb("SIGNED_IN"), 5); return { data: { subscription: { unsubscribe() {} } } }; },
      getSession: async () => ({ data: { session: null } }),
      updateUser: async () => { updateCalled = true; return { error: null }; },
    },
  };
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx({ supabase }));
  await wait(100);

  document.getElementById("password").value = "passwordOne";
  document.getElementById("confirmPassword").value = "passwordTwo";
  fireEvent(document.getElementById("setPasswordForm"), "submit");
  await wait(30);

  assert.equal(updateCalled, false);
  assert.ok(document.getElementById("errorBox").textContent.toLowerCase().includes("match"));
});

test("invite-password.html: an already-existing session (no fresh event, e.g. a slow browser) still reveals the form via the getSession() fallback", async () => {
  const supabase = {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: async () => ({ data: { session: { user: { id: "u1" } } } }),
      updateUser: async () => ({ error: null }),
    },
  };
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx({ supabase }));
  await wait(50);
  assert.equal(document.getElementById("setPasswordForm").style.display, "block");
});
