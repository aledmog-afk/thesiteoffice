// v62 screens under jsdom: the owner's main-contractor access switch on
// companies.html and the "My company's work" view on my-work.html.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const COMPANIES = new URL("../../tracker/companies.html", import.meta.url).pathname;
const MYWORK = new URL("../../tracker/my-work.html", import.meta.url).pathname;
const ACCESS = (r, m) => (r === "main_contractor" ? (m === "narrow" ? "NARROW TEXT" : "FULL TEXT") : `${r} text`);
const common = {
  renderHeader: () => {},
  escapeHtml: (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;"),
  formatDate: (d) => d || "",
  showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
  clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
  partyRoleText: (r, t) => (t ? `${r} (${t})` : r),
  partyRoleAccessText: ACCESS,
  isMissingRpcError: (e) => e?.code === "PGRST202",
  requireAuth: async () => ({ id: "u1" }),
};

function companiesCtx({ role = "owner", mode = "full" } = {}) {
  const calls = [];
  const supabase = {
    rpc: async (name) => (name === "get_my_role" ? { data: role, error: null } : { data: [], error: null }),
    from() {
      const api = { select() { return api; }, eq() { return api; },
        single: async () => ({ data: { id: "p1", name: "County Flats", org_id: "o1", main_contractor_access: mode }, error: null }),
        then(res) { res({ data: [], error: null }); } };
      return api;
    },
  };
  return { calls, ctx: { ...common, supabase, __url: "https://example.com/companies.html?project=p1", getParam: () => "p1",
    PARTY_ROLES: [{ value: "main_contractor", label: "MC" }], partyInviteLink: (t) => t,
    getProjectParties: async () => [], getPendingPartyInvites: async () => [], getOrganisationMembers: async () => [],
    createPartyInvite: async () => ({}), resendPartyInvite: async () => ({}), cancelPartyInvite: async () => {}, setPartyRole: async () => {},
    removeParty: async () => {}, addPartyMember: async () => {}, removePartyMember: async () => {}, addOrgMemberToProject: async () => {},
    setMainContractorAccess: async (...a) => { calls.push(a); } } };
}

test("companies.html: the owner sees the main contractor access switch, with what each mode means, and can change it", async () => {
  const { ctx, calls } = companiesCtx({ mode: "full" });
  const { document } = await runPage(COMPANIES, extractScript(COMPANIES), ctx);
  await wait(30);
  assert.equal(document.getElementById("mcAccessCard").style.display, "block");
  assert.equal(document.getElementById("mcAccessSelect").value, "full");
  assert.equal(document.getElementById("mcAccessText").textContent, "FULL TEXT");
  document.getElementById("mcAccessSelect").value = "narrow";
  document.getElementById("mcAccessSaveBtn").click();
  await wait(30);
  assert.deepEqual(calls[0], ["p1", "narrow"]);
});

test("companies.html: no switch for non-owners, or on a database without v62", async () => {
  let r = companiesCtx({ role: "snagging" });
  let { document } = await runPage(COMPANIES, extractScript(COMPANIES), r.ctx);
  await wait(30);
  assert.equal(document.getElementById("mcAccessCard").style.display, "none");
  r = companiesCtx({ mode: null });
  ({ document } = await runPage(COMPANIES, extractScript(COMPANIES), r.ctx));
  await wait(30);
  assert.equal(document.getElementById("mcAccessCard").style.display, "none");
});

const ITEMS = [
  { type: "snag", id: "s1", title: "Mine", status: "open", project_id: "j1", project_name: "County Flats", assigned_to: "u1", ageing: { state: "outstanding" }, flags: {}, href: "#" },
  { type: "snag", id: "s2", title: "Colleague's", status: "open", project_id: "j1", project_name: "County Flats", assigned_to: "u5", ageing: { state: "outstanding" }, flags: {}, href: "#" },
  { type: "action", id: "a1", title: "Other job", status: "open", project_id: "j2", project_name: "Own Job", assigned_to: "u7", ageing: { state: "outstanding" }, flags: {}, href: "#" },
];
function myWorkCtx(jobRoles) {
  return { ...common, __url: "https://example.com/my-work.html",
    supabase: { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } },
    getPortfolioWorkItems: async () => ITEMS,
    filterMyWorkItems: (items, u) => items.filter((i) => i.assigned_to === u),
    filterUnassignedWorkItems: (items) => items.filter((i) => !i.assigned_to),
    filterCompanyWorkItems: (items, roles) => items.filter((i) => roles.some((r) => r.project_id === i.project_id)),
    summariseOwnerAccountability: () => [], ageingLabel: () => "—", getMemberEmailMap: async () => ({}),
    WORK_ITEM_TYPE_LABEL: { snag: "Snag", action: "Action", programme: "Programme" }, ACTION_PRIORITY_LABEL: {}, ACTION_PRIORITY_BADGE: {},
    getMyJobRoles: async () => { if (jobRoles instanceof Error) throw jobRoles; return jobRoles; } };
}

test("my-work.html: a company user sees their company and role per job, and can switch to their company's work", async () => {
  const roles = [{ project_id: "j1", project_name: "County Flats", company: "Almo", party_role: "subcontractor", trade: "Carpentry", main_contractor_access: "full" }];
  const { document } = await runPage(MYWORK, extractScript(MYWORK), myWorkCtx(roles));
  await wait(40);
  const banner = document.getElementById("jobRolesBanner");
  assert.equal(banner.style.display, "block");
  assert.match(banner.textContent, /County Flats — you work for Almo as subcontractor \(Carpentry\)\. subcontractor text/);
  assert.match(document.getElementById("mineRows").textContent, /Mine/);
  assert.doesNotMatch(document.getElementById("mineRows").textContent, /Colleague/);
  const scope = document.getElementById("mineScope");
  assert.notEqual(scope.style.display, "none");
  scope.value = "company";
  fireEvent(scope, "change");
  await wait(20);
  const rows = document.getElementById("mineRows").textContent;
  assert.match(rows, /Mine/); assert.match(rows, /Colleague's/);
  assert.doesNotMatch(rows, /Other job/, "only jobs where you work through a company");
});

test("my-work.html: owner-side users (no company roles) or a pre-v62 database see the page exactly as before", async () => {
  for (const roles of [[], new Error("boom")]) {
    const { document } = await runPage(MYWORK, extractScript(MYWORK), myWorkCtx(roles));
    await wait(40);
    assert.equal(document.getElementById("jobRolesBanner").style.display, "none");
    assert.equal(document.getElementById("mineScope").style.display, "none");
    assert.match(document.getElementById("mineRows").textContent, /Mine/);
    assert.equal(document.getElementById("errorBox").style.display, "none");
  }
});
