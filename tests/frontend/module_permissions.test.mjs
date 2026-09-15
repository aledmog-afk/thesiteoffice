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
  { module: "commercial", role: "approver", sort_order: 3 },
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

function makeContext({ members, moduleCatalog = MODULE_CATALOG, moduleGrants = [], currentUserId = "owner-1", myRole = "owner", setProjectModuleRoleImpl, supabase } = {}) {
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
