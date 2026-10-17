// Module Permissions (project.html) — lets a project owner grant/revoke
// per-project module roles (Toolbox Talks, Commercial, any future module)
// to project members. Before this card existed, `project_module_roles`
// had no UI anywhere in the app — the only way to grant access to a
// permission-gated module was a direct database insert. The card is
// driven generically off whatever module_roles catalog rows the caller
// returns, so a future module needs zero new frontend code here.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { progressHelpers } from "../lib/progress_helpers.mjs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/project.html", import.meta.url).pathname;
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const RAG_LABEL = extractConst("RAG_LABEL");
const CONTROL_LEVEL_BADGE = extractConst("CONTROL_LEVEL_BADGE");
const ACTION_PRIORITY_LABEL = extractConst("ACTION_PRIORITY_LABEL");
const ACTION_PRIORITY_BADGE = extractConst("ACTION_PRIORITY_BADGE");
const ACTION_STATUS_LABEL = extractConst("ACTION_STATUS_LABEL");
const ACTION_STATUS_BADGE = extractConst("ACTION_STATUS_BADGE");
const ACTION_DUE_LABEL = extractConst("ACTION_DUE_LABEL");
const ACTION_DUE_BADGE = extractConst("ACTION_DUE_BADGE");
const EXTERNAL_WORKS_TAG = extractConst("EXTERNAL_WORKS_TAG");

const PROJECT = { id: "p1", name: "Elm Grove", status: "active", rag_status: "green", baseline_progress_pct: 10, actual_progress_pct: 12, total_plots: 0 };

const MODULE_CATALOG = [
  { module: "commercial", role: "viewer", sort_order: 1 },
  { module: "commercial", role: "contributor", sort_order: 2 },
  { module: "toolbox_talks", role: "viewer", sort_order: 1 },
  { module: "toolbox_talks", role: "contributor", sort_order: 2 },
];

const OWNER = { member_id: "m1", user_id: "owner-1", email: "owner@example.com", role: "owner", joined_at: "2026-01-01T00:00:00Z" };
const COLLAB = { member_id: "m2", user_id: "collab-1", email: "collab@example.com", role: "collaborator", joined_at: "2026-01-02T00:00:00Z" };
const SNAG = { member_id: "m3", user_id: "snag-1", email: "snag@example.com", role: "snagging", joined_at: "2026-01-03T00:00:00Z" };

function emptySupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "owner-1" } } }) },
    rpc: async (name) => {
      if (name === "get_my_role") return { data: "owner", error: null };
      if (name === "get_project_members") return { data: [OWNER, COLLAB], error: null };
      return { data: null, error: null };
    },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        single: async () => (table === "projects" ? { data: PROJECT, error: null } : { data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
        then(resolve) { resolve({ data: [], error: null, count: 0 }); },
      };
      return api;
    },
  };
}

function makeContext({ members, moduleCatalog = MODULE_CATALOG, moduleGrants = [], currentUserId = "owner-1", myRole = "owner", setProjectModuleRoleImpl, supabase, ownerSideUserIds = [] } = {}) {
  const calls = [];
  const sb = supabase || emptySupabase();
  const origRpc = sb.rpc.bind(sb);
  sb.rpc = async (name, args) => {
    if (name === "get_my_role") return { data: myRole, error: null };
    if (name === "get_project_members") return { data: members, error: null };
    return origRpc(name, args);
  };
  sb.auth.getUser = async () => ({ data: { user: { id: currentUserId } } });

  const ctx = {
    ...progressHelpers,
    __url: "https://example.com/project.html?id=p1",
    supabase: sb,
    requireAuth: async () => ({ id: currentUserId }),
    renderHeader: () => {},
    getParam: () => "p1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    RAG_LABEL,
    renderProgressBlock: () => "",
    geocodePostcode: async () => null,
    recalculateActualProgress: async () => PROJECT.actual_progress_pct,
    generateMissingPlots: async () => 0,
    suggestPlotProgress: async () => 0,
    EXTERNAL_WORKS_TAG,
    monthStartISO: () => "2026-09-01",
    getProjectControlSummary: async () => ({ status: { level: "on_track", label: "On Track", reason: "" }, counts: { openActions: 0, overdue: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0 } }),
    getAttentionActions: async () => [],
    getMemberEmailMap: async () => ({}),
    CONTROL_LEVEL_BADGE, ACTION_PRIORITY_LABEL, ACTION_PRIORITY_BADGE, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE, ACTION_DUE_LABEL, ACTION_DUE_BADGE,
    isFindingOutstanding: () => false,
    categoriseSnag: () => ({ overdue: false }),
    getProjectPlotReadiness: async () => [],
    getMyCommercialRole: async () => null,
    commercialCapabilities: () => ({ canView: false }),
    getMyToolboxTalkRole: async () => null,
    toolboxTalkCapabilities: () => ({ canView: false }),
    getModuleRolesCatalog: async () => { calls.push({ fn: "getModuleRolesCatalog" }); return moduleCatalog; },
    getProjectModuleRoles: async () => { calls.push({ fn: "getProjectModuleRoles" }); return moduleGrants; },
    setProjectModuleRole: setProjectModuleRoleImpl || (async (projectId, userId, moduleName, role) => {
      calls.push({ fn: "setProjectModuleRole", projectId, userId, moduleName, role });
    }),
    // Stands in for the database's answer (is_owner_side_user per owner-role
    // member — the real helper is unit-tested in commercial_v67_fallbacks).
    // Mirrors it: only members whose role is 'owner' AND who are in the
    // project's company come back.
    getCommercialOwnerAccessUserIds: async (projectId, ms) => {
      calls.push({ fn: "getCommercialOwnerAccessUserIds", projectId });
      return new Set((ms || []).filter((m) => m.role === "owner" && ownerSideUserIds.includes(m.user_id)).map((m) => m.user_id));
    },
    __calls: calls,
  };
  return ctx;
}

async function run(context) {
  return runPage(HTML, extractScript(HTML), context);
}

test("Module Permissions: an owner sees the card, with one column per catalog module and one row per member", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB] });
  const { document } = await run(ctx);
  await wait(30);

  assert.equal(document.getElementById("modulePermissionsCard").style.display, "block", "an owner must see the Module Permissions card");
  const head = document.getElementById("modulePermissionsHead").innerHTML;
  assert.ok(head.includes("Dayworks &amp; Variations"));
  assert.ok(head.includes("Toolbox Talks"));

  const rows = document.getElementById("modulePermissionsRows").innerHTML;
  assert.ok(rows.includes("owner@example.com"));
  assert.ok(rows.includes("collab@example.com"));
  assert.equal(document.querySelectorAll("#modulePermissionsRows select[data-user]").length, 4, "2 members x 2 modules = 4 selects");
});

test("Module Permissions: a non-owner collaborator never sees the card, and the catalog/grants are never even fetched", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB], currentUserId: "collab-1", myRole: "collaborator" });
  const { document } = await run(ctx);
  await wait(30);

  assert.equal(document.getElementById("modulePermissionsCard").style.display, "none", "a non-owner must never see the card");
  assert.equal(ctx.__calls.filter((c) => c.fn === "getModuleRolesCatalog").length, 0);
  assert.equal(ctx.__calls.filter((c) => c.fn === "getProjectModuleRoles").length, 0);
});

test("Module Permissions: an existing grant is pre-selected in that member/module's dropdown", async () => {
  const ctx = makeContext({
    members: [OWNER, COLLAB],
    moduleGrants: [{ id: "g1", user_id: "collab-1", module: "toolbox_talks", role: "contributor" }],
  });
  const { document } = await run(ctx);
  await wait(30);

  const select = document.querySelector(`select[data-user="collab-1"][data-module="toolbox_talks"]`);
  assert.ok(select, "the toolbox_talks select for collab-1 must exist");
  assert.equal(select.value, "contributor");

  const noGrantSelect = document.querySelector(`select[data-user="collab-1"][data-module="commercial"]`);
  assert.equal(noGrantSelect.value, "", "a member with no grant for a module defaults to the empty/no-access option");
});

test("Module Permissions: choosing a role calls setProjectModuleRole() with the project, user, module and role", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB] });
  const { document } = await run(ctx);
  await wait(30);

  const select = document.querySelector(`select[data-user="collab-1"][data-module="toolbox_talks"]`);
  select.value = "contributor";
  fireEvent(select, "change");
  await wait(30);

  const call = ctx.__calls.find((c) => c.fn === "setProjectModuleRole");
  assert.ok(call, "setProjectModuleRole() must have been called");
  assert.equal(call.projectId, "p1");
  assert.equal(call.userId, "collab-1");
  assert.equal(call.moduleName, "toolbox_talks");
  assert.equal(call.role, "contributor");
});

test("Module Permissions: choosing '— No access —' calls setProjectModuleRole() with a null role (revoking it)", async () => {
  const ctx = makeContext({
    members: [OWNER, COLLAB],
    moduleGrants: [{ id: "g1", user_id: "collab-1", module: "toolbox_talks", role: "contributor" }],
  });
  const { document } = await run(ctx);
  await wait(30);

  const select = document.querySelector(`select[data-user="collab-1"][data-module="toolbox_talks"]`);
  select.value = "";
  fireEvent(select, "change");
  await wait(30);

  const call = ctx.__calls.find((c) => c.fn === "setProjectModuleRole");
  assert.ok(call, "setProjectModuleRole() must have been called");
  assert.equal(call.role, null);
});

test("Module Permissions: v46 auto-access — owner/collaborator toolbox_talks cells say so instead of implying no access, while snagging-only and every commercial cell still say 'No access'", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB, SNAG] });
  const { document } = await run(ctx);
  await wait(30);

  const ownerTT = document.querySelector(`select[data-user="owner-1"][data-module="toolbox_talks"]`);
  const collabTT = document.querySelector(`select[data-user="collab-1"][data-module="toolbox_talks"]`);
  const snagTT = document.querySelector(`select[data-user="snag-1"][data-module="toolbox_talks"]`);
  const ownerCommercial = document.querySelector(`select[data-user="owner-1"][data-module="commercial"]`);

  assert.equal(ownerTT.options[0].textContent, "Default (Contributor — automatic)");
  assert.equal(ownerTT.value, "", "the empty option (automatic default) is selected when there's no explicit override");
  assert.equal(collabTT.options[0].textContent, "Default (Contributor — automatic)");
  assert.equal(snagTT.options[0].textContent, "— No access —", "snagging-only members get no automatic default");
  assert.equal(ownerCommercial.options[0].textContent, "— No access —", "Commercial has no automatic default for anyone");
});

test("Module Permissions: a failed grant/revoke shows an error and reverts the dropdown to its previous value", async () => {
  const ctx = makeContext({
    members: [OWNER, COLLAB],
    moduleGrants: [{ id: "g1", user_id: "collab-1", module: "toolbox_talks", role: "contributor" }],
    setProjectModuleRoleImpl: async () => { throw new Error("Only a project owner can manage module permissions"); },
  });
  const { document } = await run(ctx);
  await wait(30);

  const select = document.querySelector(`select[data-user="collab-1"][data-module="toolbox_talks"]`);
  select.value = "viewer";
  fireEvent(select, "change");
  await wait(30);

  assert.ok(document.getElementById("modulePermissionsErrorBox").textContent.includes("Only a project owner"));
  const revertedSelect = document.querySelector(`select[data-user="collab-1"][data-module="toolbox_talks"]`);
  assert.equal(revertedSelect.value, "contributor", "on failure the dropdown must revert to the last known-good grant, not stay on the rejected choice");
});

test("Module Permissions: a caller who is snagging-only never sees the card at all (applySnaggingOnlyView short-circuits before loadMembers)", async () => {
  const ctx = makeContext({ members: [OWNER], currentUserId: "owner-1", myRole: "snagging" });
  const { document } = await run(ctx);
  await wait(30);

  assert.equal(document.getElementById("modulePermissionsCard").style.display, "none");
  assert.equal(ctx.__calls.filter((c) => c.fn === "getModuleRolesCatalog").length, 0);
});

// ─── v66: the Dayworks & Variations 'approver' role is gone ─────────
test("Module Permissions (v66): Approver is never offered for Dayworks & Variations, even if the database catalog still lists it (before v66 is applied)", async () => {
  const legacyCatalog = [...MODULE_CATALOG, { module: "commercial", role: "approver", sort_order: 3 }];
  const ctx = makeContext({ members: [OWNER, COLLAB], moduleCatalog: legacyCatalog });
  const { document } = await run(ctx);
  await wait(30);
  const select = document.querySelector(`select[data-user="collab-1"][data-module="commercial"]`);
  const values = [...select.options].map((o) => o.value);
  assert.deepEqual(values, ["", "viewer", "contributor"]);
  assert.ok(![...select.options].some((o) => /approver/i.test(o.textContent)), "no option may say Approver");
  assert.ok(!/Approver/.test(document.getElementById("modulePermissionsCard").textContent), "the card's hint must not mention Approver");
});

test("Module Permissions (v66): an old 'approver' grant (before v66 is applied) shows as Contributor, not as No access", async () => {
  const legacyCatalog = [...MODULE_CATALOG, { module: "commercial", role: "approver", sort_order: 3 }];
  const ctx = makeContext({
    members: [OWNER, COLLAB],
    moduleCatalog: legacyCatalog,
    moduleGrants: [{ id: "g1", user_id: "collab-1", module: "commercial", role: "approver" }],
  });
  const { document } = await run(ctx);
  await wait(30);
  const select = document.querySelector(`select[data-user="collab-1"][data-module="commercial"]`);
  assert.equal(select.value, "contributor");
});

const OWNER_ROW_NOT_IN_ORG = { member_id: "m4", user_id: "owner-outside", email: "outside@sub.example.com", role: "owner", joined_at: "2026-01-04T00:00:00Z" };

test("Module Permissions: an owner who is in the project's company (the database confirms owner access) shows 'Owner — full access' instead of a dropdown; other members keep theirs", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB], ownerSideUserIds: ["owner-1"] });
  const { document } = await run(ctx);
  await wait(30);
  assert.equal(document.querySelector(`select[data-user="owner-1"][data-module="commercial"]`), null, "no dropdown for the owner's commercial cell");
  const label = document.querySelector(`[data-owner-full-access="owner-1"]`);
  assert.ok(label, "the owner's cell shows the automatic full-access label");
  assert.match(label.textContent, /Owner — full access/);
  assert.ok(document.querySelector(`select[data-user="collab-1"][data-module="commercial"]`), "a collaborator still gets a dropdown");
  assert.ok(document.querySelector(`select[data-user="owner-1"][data-module="toolbox_talks"]`), "other modules are unchanged for the owner");
  assert.ok(ctx.__calls.some((c) => c.fn === "getCommercialOwnerAccessUserIds" && c.projectId === "p1"), "the page asks the database");
});

test("Module Permissions: a member whose project role is 'owner' but who is NOT in the project's company gets no owner label — the normal grant dropdown, showing their real grant", async () => {
  const ctx = makeContext({ members: [OWNER, OWNER_ROW_NOT_IN_ORG, COLLAB], ownerSideUserIds: ["owner-1"], moduleGrants: [{ user_id: "owner-outside", module: "commercial", role: "viewer" }] });
  const { document } = await run(ctx);
  await wait(30);
  assert.equal(document.querySelector(`[data-owner-full-access="owner-outside"]`), null, "no owner label for an owner row outside the company");
  const select = document.querySelector(`select[data-user="owner-outside"][data-module="commercial"]`);
  assert.ok(select, "they get the normal dropdown");
  assert.equal(select.value, "viewer", "showing their actual grant");
  assert.ok(document.querySelector(`[data-owner-full-access="owner-1"]`), "the in-company owner still gets the label");
});

test("Module Permissions: a non-owner never gets the owner label, even if the database check were (wrongly) to say they're in the company", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB], ownerSideUserIds: ["owner-1", "collab-1"] });
  const { document } = await run(ctx);
  await wait(30);
  assert.equal(document.querySelector(`[data-owner-full-access="collab-1"]`), null);
  assert.ok(document.querySelector(`select[data-user="collab-1"][data-module="commercial"]`));
});

test("Module Permissions: if the database check fails, nobody gets the owner label (fails closed to the normal dropdown)", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB], ownerSideUserIds: ["owner-1"] });
  ctx.getCommercialOwnerAccessUserIds = async () => { throw new Error("network"); };
  const { document } = await run(ctx);
  await wait(30);
  assert.equal(document.querySelector(`[data-owner-full-access]`), null);
  assert.ok(document.querySelector(`select[data-user="owner-1"][data-module="commercial"]`));
  assert.equal(document.getElementById("modulePermissionsErrorBox").textContent, "", "and the card still loads without an error");
});

// ─── Item 11: People on this job, grouped by company ────────────────
const BENNETT = { party_id: "pb", org_id: "org-b", company: "Bennett Groundworks Ltd", party_role: "subcontractor", trade: "Groundworks", parent_party_id: null, lead_user_id: "sub-1", lead_email: "site@bennett.test", member_count: 2, status: "active", i_admin: false };
const DAVIES = { party_id: "pd", org_id: "org-d", company: "Davies Scaffolding", party_role: "subcontractor", trade: "Scaffolding", parent_party_id: "pb", lead_user_id: null, lead_email: null, member_count: 1, status: "active", i_admin: false };
const SUB1 = { member_id: "m4", user_id: "sub-1", email: "site@bennett.test", role: "snagging", joined_at: "2026-01-04T00:00:00Z" };
const SUB2 = { member_id: "m5", user_id: "sub-2", email: "dean@bennett.test", role: "snagging", joined_at: "2026-01-05T00:00:00Z" };
const SCAF = { member_id: "m6", user_id: "scaf-1", email: "ops@davies.test", role: "snagging", joined_at: "2026-01-06T00:00:00Z" };
const PARTY_LINKS = [{ party_id: "pb", user_id: "sub-1" }, { party_id: "pb", user_id: "sub-2" }, { party_id: "pd", user_id: "scaf-1" }];

function partySupabase(parties = [BENNETT, DAVIES], links = PARTY_LINKS) {
  const sb = emptySupabase();
  const baseRpc = sb.rpc;
  sb.rpc = async (name, args) => (name === "get_project_parties" ? { data: parties, error: null } : baseRpc(name, args));
  const baseFrom = sb.from.bind(sb);
  sb.from = (table) => {
    if (table !== "project_party_members") return baseFrom(table);
    let ids = null;
    const api = {
      select() { return api; }, eq() { return api; },
      in(_c, v) { ids = v; return api; },
      then(resolve) { resolve({ data: links.filter((l) => !ids || ids.includes(l.party_id)), error: null }); },
    };
    return api;
  };
  return sb;
}
const groupHeaders = (doc, sel) => [...doc.querySelectorAll(`${sel} tr.people-group`)].map((r) => r.dataset.group);

test("People on this job (item 11): the card is renamed, people are grouped by company (own team first, sub-sub after its parent), with role and trade", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB, SUB1, SUB2, SCAF], supabase: partySupabase() });
  const { document } = await run(ctx);
  await wait(30);
  const card = document.getElementById("collaboratorsCard");
  assert.match(card.querySelector(".card-heading").textContent, /^People on this job$/);
  assert.ok(!/Collaborators/.test(card.textContent));
  assert.deepEqual(groupHeaders(document, "#memberRows"), ["own", "pb", "pd"]);
  const rows = document.getElementById("memberRows").textContent;
  assert.match(rows, /Your company \(your team\)/);
  assert.match(rows, /Bennett Groundworks Ltd[\s\S]*Subcontractor \(Groundworks\)/);
  assert.match(rows, /Davies Scaffolding[\s\S]*brought in by Bennett Groundworks Ltd/);
  const bennettRow = document.querySelector('#memberRows tr[data-group="pb"]');
  const after = [];
  for (let r = bennettRow.nextElementSibling; r && !r.classList.contains("people-group"); r = r.nextElementSibling) after.push(r.textContent);
  assert.equal(after.length, 2);
  assert.ok(after.some((t) => t.includes("site@bennett.test")) && after.some((t) => t.includes("dean@bennett.test")));
});

test("People on this job (item 11): access uses the same words as the Companies page — Owner, Full access, Snagging only", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB, SNAG], supabase: partySupabase([], []) });
  const { document } = await run(ctx);
  await wait(30);
  const badges = [...document.querySelectorAll("#memberRows .badge")].map((b) => b.textContent);
  assert.deepEqual(badges, ["Owner", "Full access", "Snagging only"]);
  assert.ok(!/Collaborator\b|\bSnagging\b(?! only)/.test(badges.join(" ")));
  assert.deepEqual(groupHeaders(document, "#memberRows"), ["own"], "no companies: everyone in one group");
});

test("People on this job (item 11): company people show 'Managed by their company' instead of Remove; own staff keep Remove", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB, SUB1, SUB2, SCAF], supabase: partySupabase() });
  const { document } = await run(ctx);
  await wait(30);
  for (const uid of ["sub-1", "sub-2", "scaf-1"]) assert.ok(document.querySelector(`[data-managed-by-company="${uid}"]`), `${uid} managed by company`);
  const buttons = [...document.querySelectorAll("#memberRows button")].map((b) => b.getAttribute("onclick"));
  assert.equal(buttons.length, 1, "only the owner's own staff member can be removed here");
  assert.match(buttons[0], /'m2'/);
});

test("People on this job (item 11): each company header shows its lead contact (or 'Needs a lead contact') and a 'Manage this company' link to its row on companies.html", async () => {
  const ctx = makeContext({ members: [OWNER, SUB1, SCAF], supabase: partySupabase() });
  const { document } = await run(ctx);
  await wait(30);
  assert.match(document.querySelector('#memberRows [data-lead-for="pb"]').textContent, /Lead contact: site@bennett\.test/);
  assert.match(document.querySelector('#memberRows [data-lead-for="pd"]').textContent, /Needs a lead contact/);
  const link = document.querySelector('#memberRows a[data-manage-party="pb"]');
  assert.equal(link.textContent, "Manage this company");
  assert.equal(link.getAttribute("href"), "companies.html?project=p1#party-pb");
});

test("People on this job (item 11): a non-owner sees the groups but no Manage link and no Remove for company people", async () => {
  const sb = partySupabase();
  const ctx = makeContext({ members: [OWNER, COLLAB, SUB1], currentUserId: "collab-1", myRole: "collaborator", supabase: sb });
  const { document } = await run(ctx);
  await wait(30);
  assert.deepEqual(groupHeaders(document, "#memberRows"), ["own", "pb", "pd"]);
  assert.equal(document.querySelector("#memberRows a[data-manage-party]"), null);
  assert.ok(document.querySelector('[data-managed-by-company="sub-1"]'));
  assert.equal(document.getElementById("companiesTile").style.display, "none");
});

test("Module Permissions (item 11): rows use the same company grouping, and company people keep their dropdowns (the database honours their grants)", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB, SUB1, SCAF], supabase: partySupabase() });
  const { document } = await run(ctx);
  await wait(30);
  assert.deepEqual(groupHeaders(document, "#modulePermissionsRows"), ["own", "pb", "pd"]);
  assert.ok(document.querySelector('#modulePermissionsRows select[data-user="sub-1"][data-module="commercial"]'));
  assert.ok(document.querySelector('#modulePermissionsRows select[data-user="scaf-1"][data-module="toolbox_talks"]'));
  assert.ok(!/Set by their company's access/.test(document.getElementById("modulePermissionsCard").textContent));
});

test("Module Permissions (item 11): the hint says the owner gets Dayworks & Variations automatically, not that it's off for everyone", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB] });
  const { document } = await run(ctx);
  await wait(30);
  const hint = document.querySelector("#modulePermissionsCard p.hint").textContent;
  assert.match(hint, /The project owner gets Dayworks & Variations automatically/);
  assert.match(hint, /for everyone else it's off until you switch it on/);
  assert.ok(!/Dayworks & Variations is off until you switch it on for someone/.test(hint));
  assert.match(hint, /Full access gets Toolbox Talks/);
});

test("Phone layout (item 11): both tables stack on phones like companies.html, with labelled cells", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB, SUB1], supabase: partySupabase() });
  const { document } = await run(ctx);
  await wait(30);
  assert.ok(document.querySelector("#memberRows").closest("table").classList.contains("stack-mobile"));
  assert.ok(document.querySelector("#modulePermissionsRows").closest("table").classList.contains("stack-mobile"));
  assert.ok(document.querySelector('#memberRows td[data-label="Access"]'));
  assert.ok(document.querySelector('#memberRows td[data-label="Joined"]'));
  assert.ok(document.querySelector('#modulePermissionsRows td[data-label="Toolbox Talks"]'));
});

test("Companies tile (item 11): the owner gets a Companies tile on the project page linking to companies.html", async () => {
  const ctx = makeContext({ members: [OWNER, COLLAB] });
  const { document } = await run(ctx);
  await wait(30);
  const tile = document.getElementById("companiesTile");
  assert.notEqual(tile.style.display, "none");
  assert.equal(tile.getAttribute("href"), "companies.html?project=p1");
  assert.equal(document.getElementById("companiesLink").textContent, "Companies on this job →");
});
