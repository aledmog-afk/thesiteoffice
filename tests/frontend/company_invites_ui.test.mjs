// v61 screens under jsdom (real page scripts): invite.html (accepting a
// company invite), companies.html ("Companies on this job"), and the
// retired join.html. Server rules are proven in
// tests/security/project_parties.test.mjs; these prove what the PAGES do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const INVITE = new URL("../../tracker/invite.html", import.meta.url).pathname;
const COMPANIES = new URL("../../tracker/companies.html", import.meta.url).pathname;
const JOIN = new URL("../../tracker/join.html", import.meta.url).pathname;
const TOKEN = "a".repeat(64);
const PARTY_ROLES = [
  { value: "main_contractor", label: "Main Contractor" }, { value: "subcontractor", label: "Subcontractor" },
  { value: "clerk_of_works", label: "Clerk of Works" }, { value: "client", label: "Client" }, { value: "consultant", label: "Consultant" },
];
const LABEL = Object.fromEntries(PARTY_ROLES.map((r) => [r.value, r.label]));
const common = {
  renderHeader: () => {},
  escapeHtml: (s) => String(s ?? "").replace(/</g, "&lt;"),
  formatDate: (d) => d || "",
  showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
  clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
  partyRoleText: (r, t) => (t ? `${LABEL[r]} (${t})` : LABEL[r]),
  isMissingRpcError: (e) => e?.code === "PGRST202",
};

function inviteCtx(invite, extra = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      ...common,
      __url: `https://example.com/invite.html#t=${TOKEN}`,
      supabase: { auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } },
      requireAuth: async () => ({ id: "u1" }),
      ORGANISATION_TYPES: [{ value: "main_contractor", label: "Main Contractor" }, { value: "subcontractor", label: "Subcontractor" }, { value: "other", label: "Other" }],
      getPartyInvite: async (t) => { calls.push(["get", t]); if (invite instanceof Error) throw invite; return invite; },
      createOrganisation: async (name, type) => { calls.push(["create", name, type]); return "org-new"; },
      acceptPartyInvite: async (t, org) => { calls.push(["accept", t, org]); return "proj-1"; },
      searchOrganisations: async () => [{ id: "org-almo", name: "Almo Carpentry" }],
      requestOrganisationMembership: async (id) => { calls.push(["request", id]); return "req-1"; },
      getMyOrganisations: async () => [],
      ...extra,
    },
  };
}
const VALID = { invite_id: "i1", project_name: "County Flats", inviting_company: "Tai Tarian", party_role: "subcontractor", trade: "Carpentry", status: "pending", expires_at: "2026-10-27T00:00:00Z", email_matches: true, parent_company: null };

test("invite.html: a valid invite shows who invited you, to what, as what, and when it expires", async () => {
  const { ctx, calls } = inviteCtx(VALID);
  const { document } = await runPage(INVITE, extractScript(INVITE), ctx);
  await wait(20);
  assert.deepEqual(calls[0], ["get", TOKEN], "the token comes from the URL fragment");
  assert.equal(document.getElementById("inviteView").style.display, "block");
  assert.match(document.getElementById("inviteSummary").textContent, /Tai Tarian has invited your company to County Flats as Subcontractor \(Carpentry\)/);
  assert.match(document.getElementById("inviteExpiry").textContent, /2026-10-27/);
  assert.equal(document.getElementById("orgType").value, "subcontractor", "company type pre-selected from the invite role");
});

for (const [status, re] of [["expired", /expired/], ["cancelled", /cancelled/], ["accepted", /already been accepted/]]) {
  test(`invite.html: a ${status} invite explains itself and offers nothing to accept`, async () => {
    const { ctx } = inviteCtx({ ...VALID, status });
    const { document } = await runPage(INVITE, extractScript(INVITE), ctx);
    await wait(20);
    assert.match(document.getElementById("statusText").textContent, re);
    assert.equal(document.getElementById("inviteView").style.display, "none");
  });
}

test("invite.html: a wrong-email invite tells you to sign in with the invited address", async () => {
  const { ctx, calls } = inviteCtx({ ...VALID, email_matches: false });
  const { document } = await runPage(INVITE, extractScript(INVITE), ctx);
  await wait(20);
  assert.match(document.getElementById("statusText").textContent, /different email/);
  assert.equal(calls.some((c) => c[0] === "accept"), false);
});

test("invite.html: an unknown token, or a database without v61, fails safely", async () => {
  let r = inviteCtx(null);
  let page = await runPage(INVITE, extractScript(INVITE), r.ctx);
  await wait(20);
  assert.match(page.document.getElementById("statusText").textContent, /isn't valid/);
  r = inviteCtx(Object.assign(new Error("Could not find the function"), { code: "PGRST202" }));
  page = await runPage(INVITE, extractScript(INVITE), r.ctx);
  await wait(20);
  assert.match(page.document.getElementById("statusText").textContent, /invite couldn't be loaded/);
});

test("invite.html: 'Set up my company' creates the company with name and type, then accepts for it", async () => {
  const { ctx, calls } = inviteCtx(VALID);
  const { document } = await runPage(INVITE, extractScript(INVITE), ctx);
  await wait(20);
  fireEvent(document.getElementById("createAcceptBtn"), "click");
  await wait(20);
  assert.match(document.getElementById("errorBox").textContent, /Company name is required/);
  document.getElementById("orgName").value = "Almo Carpentry";
  fireEvent(document.getElementById("createAcceptBtn"), "click");
  await wait(30);
  assert.deepEqual(calls.filter((c) => c[0] !== "get"), [["create", "Almo Carpentry", "subcontractor"], ["accept", TOKEN, "org-new"]]);
});

test("invite.html: 'already on Site Tracker' sends a membership request — it never accepts on the spot", async () => {
  const { ctx, calls } = inviteCtx(VALID);
  const { document } = await runPage(INVITE, extractScript(INVITE), ctx);
  await wait(20);
  document.getElementById("orgSearch").value = "Almo";
  fireEvent(document.getElementById("searchBtn"), "click");
  await wait(20);
  document.querySelector("[data-join]").click();
  await wait(20);
  assert.deepEqual(calls.filter((c) => c[0] === "request"), [["request", "org-almo"]]);
  assert.equal(calls.some((c) => c[0] === "accept"), false);
  assert.ok(document.getElementById("joinPending"));
});

test("invite.html: someone already in a company can accept for it", async () => {
  const { ctx, calls } = inviteCtx(VALID, { getMyOrganisations: async () => [{ id: "org-almo", name: "Almo Carpentry" }] });
  const { document } = await runPage(INVITE, extractScript(INVITE), ctx);
  await wait(20);
  assert.equal(document.getElementById("useMyCompanyCard").style.display, "block");
  fireEvent(document.getElementById("acceptMineBtn"), "click");
  await wait(20);
  assert.deepEqual(calls.find((c) => c[0] === "accept"), ["accept", TOKEN, "org-almo"]);
});

test("invite.html: when signed out, it sends you to sign in and keeps the token for afterwards", async () => {
  const { ctx, calls } = inviteCtx(VALID, { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } });
  const page = runPage(INVITE, extractScript(INVITE), ctx).catch(() => {});
  await wait(60);
  void page;
  assert.equal(calls.length, 0, "never looks the invite up before sign-in");
});

test("login.html: next=invite.html always returns to the invite, even for a user with no company yet", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../tracker/login.html", import.meta.url).pathname, "utf8");
  assert.match(src, /if \(next === "invite\.html"\) return next;/);
  assert.match(src, /next === "invite\.html" \? "invite\.html" : "onboarding\.html"/);
});

test("invite.html: no token in the link → a clear message, no sign-in loop", async () => {
  const { ctx, calls } = inviteCtx(VALID, { __url: "https://example.com/invite.html" });
  const { document } = await runPage(INVITE, extractScript(INVITE), ctx);
  await wait(20);
  assert.match(document.getElementById("statusText").textContent, /incomplete/);
  assert.equal(calls.length, 0);
});

// ─── companies.html ───────────────────────────────────────────────────
function companiesCtx({ role = "owner", parties = [], invites = [], partiesError = null } = {}) {
  const calls = [];
  const supabase = {
    rpc: async (name) => {
      if (name === "get_my_role") return { data: role, error: null };
      if (name === "get_project_members") return { data: [{ user_id: "u1" }], error: null };
      return { data: null, error: null };
    },
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; },
        single: async () => ({ data: { id: "p1", name: "County Flats", org_id: "org-owner" }, error: null }),
        then(resolve) { resolve({ data: table === "project_party_members" ? [{ user_id: "u1" }] : [], error: null }); },
      };
      return api;
    },
  };
  const ctx = {
    ...common,
    __url: "https://example.com/companies.html?project=p1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    getParam: (n) => (n === "project" ? "p1" : null),
    PARTY_ROLES,
    partyInviteLink: (t) => `https://example.com/invite.html#t=${t}`,
    getProjectParties: async () => { if (partiesError) throw partiesError; return parties; },
    getPendingPartyInvites: async () => invites,
    getOrganisationMembers: async (org) => (org === "org-owner"
      ? [{ user_id: "u1", email: "aled@tai.test" }, { user_id: "u9", email: "staff@tai.test" }]
      : [{ user_id: "u1", email: "dave@almo.test" }, { user_id: "u5", email: "sam@almo.test" }]),
    createPartyInvite: async (...a) => { calls.push(["invite", ...a]); return { invite_id: "i9", token: "b".repeat(64) }; },
    resendPartyInvite: async (id) => { calls.push(["resend", id]); return { token: "c".repeat(64) }; },
    cancelPartyInvite: async (id) => { calls.push(["cancel", id]); },
    setPartyRole: async (...a) => { calls.push(["role", ...a]); },
    removeParty: async (id) => { calls.push(["removeParty", id]); },
    addPartyMember: async (...a) => { calls.push(["addMember", ...a]); },
    removePartyMember: async (...a) => { calls.push(["removeMember", ...a]); },
    addOrgMemberToProject: async (...a) => { calls.push(["addOwn", ...a]); },
  };
  return { ctx, calls };
}
const ALMO = { party_id: "pa", org_id: "org-almo", company: "Almo Carpentry", party_role: "subcontractor", trade: "Carpentry", parent_party_id: null, lead_email: "dave@almo.test", member_count: 2, i_admin: false };

test("companies.html: the owner sees companies, a 'needs a lead' flag, and pending invites with Resend/Cancel", async () => {
  const noLead = { ...ALMO, party_id: "pc", company: "Cee", lead_email: null, parent_party_id: "pa" };
  const { ctx } = companiesCtx({ parties: [ALMO, noLead], invites: [{ id: "i1", invited_email: "bob@bolt.test", party_role: "client", trade: null, expires_at: "2099-01-01T00:00:00Z" }] });
  const { document } = await runPage(COMPANIES, extractScript(COMPANIES), ctx);
  await wait(30);
  assert.equal(document.getElementById("ownerView").style.display, "block");
  const rows = document.getElementById("partyRows").textContent;
  assert.match(rows, /Almo Carpentry/);
  assert.match(rows, /Needs a lead contact/);
  assert.match(rows, /brought in by Almo Carpentry/);
  assert.match(document.getElementById("inviteRows").textContent, /bob@bolt\.test/);
  assert.match(document.getElementById("ownStaffSelect").innerHTML, /staff@tai\.test/);
  assert.doesNotMatch(document.getElementById("ownStaffSelect").innerHTML, /aled@tai\.test/, "people already on the job aren't offered");
});

test("companies.html: creating an invite requires a trade for subcontractors, then shows a copyable link", async () => {
  const { ctx, calls } = companiesCtx();
  const { document } = await runPage(COMPANIES, extractScript(COMPANIES), ctx);
  await wait(30);
  document.getElementById("inviteEmail").value = "dave@almo.test";
  fireEvent(document.getElementById("inviteForm"), "submit");
  await wait(20);
  assert.match(document.getElementById("errorBox").textContent, /trade/);
  assert.equal(calls.length, 0);
  document.getElementById("inviteTrade").value = "Carpentry";
  fireEvent(document.getElementById("inviteForm"), "submit");
  await wait(30);
  assert.deepEqual(calls[0], ["invite", "p1", "dave@almo.test", "subcontractor", "Carpentry"]);
  assert.equal(document.getElementById("newLinkInput").value, `https://example.com/invite.html#t=${"b".repeat(64)}`);
  assert.equal(document.getElementById("newLinkRow").style.display, "flex");
});

test("companies.html: resend gives a new link; remove asks first", async () => {
  const { ctx, calls } = companiesCtx({ parties: [ALMO], invites: [{ id: "i1", invited_email: "x@y.test", party_role: "client", trade: null, expires_at: "2099-01-01T00:00:00Z" }] });
  const { document, window } = await runPage(COMPANIES, extractScript(COMPANIES), ctx);
  await wait(30);
  document.querySelector("[data-resend]").click();
  await wait(30);
  assert.deepEqual(calls[0], ["resend", "i1"]);
  assert.match(document.getElementById("newLinkInput").value, /c{64}/);
  window.confirm = () => false;
  document.querySelector("[data-remove-party]").click();
  await wait(20);
  assert.equal(calls.some((c) => c[0] === "removeParty"), false);
  window.confirm = () => true;
  document.querySelector("[data-remove-party]").click();
  await wait(30);
  assert.deepEqual(calls.find((c) => c[0] === "removeParty"), ["removeParty", "pa"]);
});

test("companies.html: a non-owner never sees the owner controls; a party admin manages only their own team", async () => {
  const { ctx, calls } = companiesCtx({ role: "snagging", parties: [{ ...ALMO, i_admin: true }] });
  const { document } = await runPage(COMPANIES, extractScript(COMPANIES), ctx);
  await wait(30);
  assert.equal(document.getElementById("ownerView").style.display, "none");
  const panel = document.querySelector('[data-admin-party="pa"]');
  assert.ok(panel);
  assert.match(panel.textContent, /sam@almo\.test/);
  assert.ok(panel.querySelector("[data-subsub-form]"), "a subcontractor admin can invite a sub-subcontractor");
  panel.querySelector('[data-team-add="pa"]').click();
  await wait(30);
  assert.deepEqual(calls[0], ["addMember", "pa", "u5"]);
});

test("companies.html: a sub-subcontractor invite is created under the sub's own party", async () => {
  const { ctx, calls } = companiesCtx({ role: "snagging", parties: [{ ...ALMO, i_admin: true }] });
  const { document } = await runPage(COMPANIES, extractScript(COMPANIES), ctx);
  await wait(30);
  const f = document.querySelector('[data-subsub-form="pa"]');
  f.elements.email.value = "cee@cee.test";
  f.elements.trade.value = "Fixings";
  fireEvent(f, "submit");
  await wait(30);
  assert.deepEqual(calls[0], ["invite", "p1", "cee@cee.test", "subcontractor", "Fixings", "pa"]);
  assert.match(f.querySelector("[data-subsub-link] input").value, /invite\.html#t=b{64}/);
});

test("companies.html: on a database without v61 it says so instead of erroring", async () => {
  const { ctx } = companiesCtx({ partiesError: Object.assign(new Error("Could not find the function"), { code: "PGRST202" }) });
  const { document } = await runPage(COMPANIES, extractScript(COMPANIES), ctx);
  await wait(30);
  assert.equal(document.getElementById("notAvailable").style.display, "block");
  assert.equal(document.getElementById("ownerView").style.display, "none");
});

test("companies.html: company names are escaped (no HTML injection)", async () => {
  const { ctx } = companiesCtx({ parties: [{ ...ALMO, company: "<img src=x onerror=alert(1)>" }] });
  const { document } = await runPage(COMPANIES, extractScript(COMPANIES), ctx);
  await wait(30);
  assert.equal(document.querySelector("#partyRows img"), null);
});

// ─── join.html (retired) ─────────────────────────────────────────────
test("join.html: an old invite code link explains it's retired and never calls join_project_by_invite", async () => {
  const calls = [];
  const { document } = await runPage(JOIN, extractScript(JOIN), {
    __url: "https://example.com/join.html?code=abc",
    supabase: { rpc: async (n) => { calls.push(n); return { data: null, error: null }; }, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } },
    getParam: () => "abc",
    showError: () => {},
  });
  await wait(20);
  assert.match(document.getElementById("statusText").textContent, /no longer used.*company invite/);
  assert.equal(document.getElementById("actionsRow").style.display, "flex");
  assert.deepEqual(calls, []);
});
