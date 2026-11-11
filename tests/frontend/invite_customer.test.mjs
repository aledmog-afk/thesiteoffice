// v91: invite-customer.html — the platform-admin-only page for
// sending a real account-invite email to a brand-new company.
// isPlatformAdmin()/inviteCustomer()/getRecentInterestSignups() are
// already proven against real RLS/SECURITY DEFINER behaviour in
// tests/security/v91_platform_admin_authz.test.mjs — mocked here so
// this file can focus purely on what the PAGE does: it bounces a
// non-admin straight to the dashboard without ever rendering the
// admin content, it lists recent interest signups, invite submission
// calls inviteCustomer with the right email/company, "already
// registered" renders as a normal non-fatal result (not an error),
// and the per-signup Invite button fires its own independent send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/invite-customer.html", import.meta.url).pathname;

async function run(overrides = {}) {
  const inviteCustomerCalls = [];
  const result = await runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/invite-customer.html",
    supabase: { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } },
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    isPlatformAdmin: overrides.isPlatformAdmin || (async () => true),
    getRecentInterestSignups: overrides.getRecentInterestSignups || (async () => []),
    inviteCustomer: overrides.inviteCustomer || (async (email, company) => { inviteCustomerCalls.push({ email, company }); return { sent: true }; }),
  });
  return { ...result, inviteCustomerCalls };
}

// jsdom doesn't implement real cross-document navigation, so
// window.location.href after the redirect assignment can't be
// asserted here (same limitation/convention as
// tests/frontend/daywork_workflow.test.mjs and invite_password.test.mjs)
// — the redirect target ("dashboard.html") is a one-line, directly-
// readable statement in the page's own script, and "adminContent
// never becomes visible" is what actually proves the redirect branch
// ran instead of the real-admin branch.
test("invite-customer.html: a non-platform-admin never sees the admin content — the redirect branch ran, not the real-admin one", async () => {
  const { document } = await run({ isPlatformAdmin: async () => false });
  await wait(30);
  assert.equal(document.getElementById("adminContent").style.display, "none", "admin-only content must stay hidden for a non-admin");
});

test("invite-customer.html: a failed admin check (e.g. network error) also keeps the admin content hidden, never throws", async () => {
  const { document } = await run({ isPlatformAdmin: async () => { throw new Error("boom"); } });
  await wait(30);
  assert.equal(document.getElementById("adminContent").style.display, "none");
});

test("invite-customer.html: the real platform admin sees the admin content", async () => {
  const { document } = await run();
  await wait(30);
  assert.equal(document.getElementById("adminContent").style.display, "block");
});

test("invite-customer.html: submitting the invite form calls inviteCustomer with the entered email and company", async () => {
  const { document, inviteCustomerCalls } = await run();
  await wait(30);

  document.getElementById("inviteEmail").value = "newcustomer@example.com";
  document.getElementById("inviteCompany").value = "Acme Builders";
  fireEvent(document.getElementById("inviteForm"), "submit");
  await wait(30);

  assert.equal(inviteCustomerCalls.length, 1);
  assert.equal(inviteCustomerCalls[0].email, "newcustomer@example.com");
  assert.equal(inviteCustomerCalls[0].company, "Acme Builders");
});

test("invite-customer.html: an omitted company is sent as null, not an empty string", async () => {
  const { document, inviteCustomerCalls } = await run();
  await wait(30);

  document.getElementById("inviteEmail").value = "nocompany@example.com";
  fireEvent(document.getElementById("inviteForm"), "submit");
  await wait(30);

  assert.equal(inviteCustomerCalls[0].company, null);
});

test("invite-customer.html: a successful invite shows a clear 'sent' message, not an error", async () => {
  const { document } = await run();
  await wait(30);

  document.getElementById("inviteEmail").value = "newcustomer@example.com";
  fireEvent(document.getElementById("inviteForm"), "submit");
  await wait(30);

  assert.equal(document.getElementById("errorBox").textContent, "");
  assert.match(document.getElementById("inviteResult").textContent, /Invite sent/);
  assert.equal(document.getElementById("inviteResult").style.display, "block");
});

test("invite-customer.html: 'already registered' (sent: false) is shown as a normal, clear, non-fatal message — never routed through the error box", async () => {
  const { document } = await run({
    inviteCustomer: async () => ({ sent: false, reason: "existing_user" }),
  });
  await wait(30);

  document.getElementById("inviteEmail").value = "already@example.com";
  fireEvent(document.getElementById("inviteForm"), "submit");
  await wait(30);

  assert.equal(document.getElementById("errorBox").textContent, "", "an existing account is not an error");
  assert.match(document.getElementById("inviteResult").textContent, /[Aa]lready registered/);
});

test("invite-customer.html: a genuine send failure shows in the error box, not as a false 'sent' message", async () => {
  const { document } = await run({
    inviteCustomer: async () => { throw new Error("Not authorized to invite customers."); },
  });
  await wait(30);

  document.getElementById("inviteEmail").value = "fails@example.com";
  fireEvent(document.getElementById("inviteForm"), "submit");
  await wait(30);

  assert.match(document.getElementById("errorBox").textContent, /Not authorized/);
  assert.equal(document.getElementById("inviteResult").style.display, "none");
});

test("invite-customer.html: lists recent interest signups with name, email and company", async () => {
  const { document } = await run({
    getRecentInterestSignups: async () => [
      { id: "s1", name: "Jo Smith", email: "jo@example.com", company: "Smith Builders", created_at: "2026-11-01" },
    ],
  });
  await wait(30);

  const rows = document.getElementById("signupRows").innerHTML;
  assert.ok(rows.includes("Jo Smith"));
  assert.ok(rows.includes("jo@example.com"));
  assert.ok(rows.includes("Smith Builders"));
  assert.equal(document.getElementById("noSignups").style.display, "none");
});

test("invite-customer.html: an empty signups list shows the explicit empty-state hint, not a blank table", async () => {
  const { document } = await run({ getRecentInterestSignups: async () => [] });
  await wait(30);
  assert.equal(document.getElementById("noSignups").style.display, "block");
});

test("invite-customer.html: clicking a signup's own Invite button sends for that row's email/company independently of the main form", async () => {
  const { document, inviteCustomerCalls } = await run({
    getRecentInterestSignups: async () => [
      { id: "s1", name: "Jo Smith", email: "jo@example.com", company: "Smith Builders", created_at: "2026-11-01" },
    ],
  });
  await wait(30);

  fireEvent(document.querySelector('[data-invite-signup="s1"]'), "click");
  await wait(30);

  assert.equal(inviteCustomerCalls.length, 1);
  assert.equal(inviteCustomerCalls[0].email, "jo@example.com");
  assert.equal(inviteCustomerCalls[0].company, "Smith Builders");
  assert.match(document.querySelector('[data-invite-status="s1"]').textContent, /Invite sent/);
  // The main form must be completely untouched by the per-row action.
  assert.equal(document.getElementById("inviteEmail").value, "");
});

test("invite-customer.html: a per-signup invite failure shows inline next to that row and re-enables its button", async () => {
  const { document } = await run({
    getRecentInterestSignups: async () => [
      { id: "s1", name: "Jo Smith", email: "jo@example.com", company: null, created_at: "2026-11-01" },
    ],
    inviteCustomer: async () => { throw new Error("boom"); },
  });
  await wait(30);

  const btn = document.querySelector('[data-invite-signup="s1"]');
  fireEvent(btn, "click");
  await wait(30);

  assert.match(document.querySelector('[data-invite-status="s1"]').textContent, /Couldn't send/);
  assert.equal(btn.disabled, false, "a failed send must re-enable the button so it can be retried");
});
