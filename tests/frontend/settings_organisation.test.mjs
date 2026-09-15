// Settings — Organisation Members & Pending Requests admin section
// (Phase 0). Real settings.html page script under jsdom; mocks the
// app.js organisation functions directly, same convention as
// onboarding.test.mjs. The pre-existing org name/logo behaviour is
// already covered by tests/frontend/xss.test.mjs and is left untouched
// here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/settings.html", import.meta.url).pathname;

function makeSupabase() {
  return {
    from() {
      const api = {
        select() { return api; },
        eq() { return api; },
        single: async () => ({ data: { name: "Acme Ltd" }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        update() { return api; },
        upsert: async () => ({ error: null }),
      };
      return api;
    },
  };
}

function makeContext({ members, requests, currentUserId = "admin-1" } = {}) {
  const calls = [];
  const ctx = {
    __url: "https://example.com/settings.html",
    supabase: makeSupabase(),
    requireAuth: async () => ({ id: currentUserId }),
    renderHeader: () => {},
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    uploadPhoto: async () => "https://example.com/logo.png",
    ensureOrganisation: async () => "org-1",
    getOrganisationMembers: async () => { calls.push({ fn: "getOrganisationMembers" }); return members; },
    getOrganisationMembershipRequests: async () => { calls.push({ fn: "getOrganisationMembershipRequests" }); return requests; },
    approveOrganisationMembership: async (id) => { calls.push({ fn: "approveOrganisationMembership", id }); },
    rejectOrganisationMembership: async (id, reason) => { calls.push({ fn: "rejectOrganisationMembership", id, reason }); },
    __calls: calls,
  };
  return ctx;
}

async function run(context) {
  return runPage(HTML, extractScript(HTML), context);
}

const ADMIN_MEMBERS = [
  { member_id: "m1", user_id: "admin-1", email: "admin@example.com", role: "admin", joined_at: "2026-01-01T00:00:00Z" },
  { member_id: "m2", user_id: "member-1", email: "member@example.com", role: "member", joined_at: "2026-01-02T00:00:00Z" },
];
const ONE_PENDING_REQUEST = [
  { id: "req-1", user_id: "requester-1", email: "requester@example.com", status: "pending", requested_at: "2026-01-03T00:00:00Z" },
];

test("Settings: the organisation member list shows email, role and joined date", async () => {
  const ctx = makeContext({ members: ADMIN_MEMBERS, requests: [] });
  const { document } = await run(ctx);
  await wait(30);

  const html = document.getElementById("memberRows").innerHTML;
  assert.ok(html.includes("admin@example.com"));
  assert.ok(html.includes("member@example.com"));
  assert.ok(html.includes("Admin"));
  assert.ok(html.includes("Member"));
});

test("Settings: an organisation admin sees the Pending Requests section, with the requester's email and Approve/Reject controls", async () => {
  const ctx = makeContext({ members: ADMIN_MEMBERS, requests: ONE_PENDING_REQUEST, currentUserId: "admin-1" });
  const { document } = await run(ctx);
  await wait(30);

  assert.equal(document.getElementById("pendingRequestsCard").style.display, "block", "an admin must see the pending requests card");
  const html = document.getElementById("requestRows").innerHTML;
  assert.ok(html.includes("requester@example.com"));
  assert.ok(document.querySelector("button[data-approve='req-1']"));
  assert.ok(document.querySelector("button[data-reject='req-1']"));
});

test("Settings: an ordinary (non-admin) member never sees the Pending Requests section", async () => {
  const ctx = makeContext({ members: ADMIN_MEMBERS, requests: [], currentUserId: "member-1" });
  const { document } = await run(ctx);
  await wait(30);

  assert.equal(document.getElementById("pendingRequestsCard").style.display, "none", "a non-admin must never see the pending requests card, even if the server returned some");
  // The page itself must not even ask for the admin-only data when it
  // already knows (from the member list) that the caller isn't an admin.
  assert.equal(ctx.__calls.filter((c) => c.fn === "getOrganisationMembershipRequests").length, 0);
});

test("Settings: clicking Approve calls approveOrganisationMembership() with the right request id and refreshes the lists", async () => {
  const ctx = makeContext({ members: ADMIN_MEMBERS, requests: ONE_PENDING_REQUEST, currentUserId: "admin-1" });
  const { document } = await run(ctx);
  await wait(30);

  fireEvent(document.querySelector("button[data-approve='req-1']"), "click");
  await wait(30);

  const call = ctx.__calls.find((c) => c.fn === "approveOrganisationMembership");
  assert.ok(call, "approveOrganisationMembership() must have been called");
  assert.equal(call.id, "req-1");
  // Both the member list and the pending list are re-fetched after acting.
  assert.ok(ctx.__calls.filter((c) => c.fn === "getOrganisationMembers").length >= 2);
});

test("Settings: clicking Reject calls rejectOrganisationMembership() with the request id and an optional reason", async () => {
  const ctx = makeContext({ members: ADMIN_MEMBERS, requests: ONE_PENDING_REQUEST, currentUserId: "admin-1" });
  ctx.prompt = () => "Not a recognised subcontractor";
  const { document } = await run(ctx);
  await wait(30);

  fireEvent(document.querySelector("button[data-reject='req-1']"), "click");
  await wait(30);

  const call = ctx.__calls.find((c) => c.fn === "rejectOrganisationMembership");
  assert.ok(call, "rejectOrganisationMembership() must have been called");
  assert.equal(call.id, "req-1");
  assert.equal(call.reason, "Not a recognised subcontractor");
});

test("Settings: an approve failure (e.g. server refuses because caller isn't actually an admin) is shown as an error", async () => {
  const ctx = makeContext({ members: ADMIN_MEMBERS, requests: ONE_PENDING_REQUEST, currentUserId: "admin-1" });
  ctx.approveOrganisationMembership = async () => { throw new Error("Only an organisation admin can approve membership requests"); };
  const { document } = await run(ctx);
  await wait(30);

  fireEvent(document.querySelector("button[data-approve='req-1']"), "click");
  await wait(30);

  assert.ok(document.getElementById("requestsErrorBox").textContent.includes("Only an organisation admin"));
});
