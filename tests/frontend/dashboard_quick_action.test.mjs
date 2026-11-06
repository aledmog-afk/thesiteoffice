// v90: dashboard.html's "+ New Action" quick-create — a task/reminder
// for yourself or someone else, without opening a project first.
// Reuses the existing Actions engine exactly as actions.html does
// (createAction(), the same editor-only get_project_members assignee
// list) — mocked here so this file proves the PAGE wires it up
// correctly: the project picker comes from every project the caller
// can access (not just ones with existing work), the assignee list
// reloads per selected project and defaults to the caller when they're
// one of its editors, the right payload reaches createAction(), and a
// successful create refreshes the dashboard's own attention data so a
// newly-qualifying action (e.g. self-assigned, high priority) shows up
// immediately.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/dashboard.html", import.meta.url).pathname;

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const ACTION_PRIORITIES = extractConst("ACTION_PRIORITIES");
const ACTION_PRIORITY_LABEL = extractConst("ACTION_PRIORITY_LABEL");
const ACTION_PRIORITY_BADGE = extractConst("ACTION_PRIORITY_BADGE");
const ACTION_STATUS_LABEL = extractConst("ACTION_STATUS_LABEL");
const ACTION_STATUS_BADGE = extractConst("ACTION_STATUS_BADGE");
const ACTION_DUE_LABEL = extractConst("ACTION_DUE_LABEL");
const ACTION_DUE_BADGE = extractConst("ACTION_DUE_BADGE");
const CONTROL_LEVEL_BADGE = extractConst("CONTROL_LEVEL_BADGE");

const PROJECTS = [
  { id: "p1", name: "Elm Grove", main_contractor_name: "Acme Ltd", rag_status: "green", status: "active" },
  { id: "p2", name: "Oak Close", main_contractor_name: "Acme Ltd", rag_status: "amber", status: "active" },
];

const MEMBERS_BY_PROJECT = {
  p1: [
    { user_id: "u1", email: "me@example.com", role: "owner" },
    { user_id: "u2", email: "collab@example.com", role: "collaborator" },
    { user_id: "u3", email: "snagger@example.com", role: "snagging" },
  ],
  // The caller isn't an editor on p2 at all — only other people are.
  p2: [{ user_id: "u2", email: "collab@example.com", role: "collaborator" }],
};

function makeSupabase({ memberRpcError = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc(name, args) {
      calls.push({ op: "rpc", name, args });
      if (name === "get_project_members") {
        if (memberRpcError) return Promise.resolve({ data: null, error: memberRpcError });
        return Promise.resolve({ data: MEMBERS_BY_PROJECT[args.p_project_id] || [], error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; },
        single: async () => ({ data: null, error: null }),
        then(resolve) {
          if (table === "projects") return resolve({ data: PROJECTS, error: null });
          resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
}

async function run(overrides = {}) {
  const supabase = overrides.supabase || makeSupabase();
  const createActionCalls = [];
  const controlSummaryCalls = { n: 0 };
  const result = await runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/dashboard.html",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    RAG_LABEL: { red: "Red", amber: "Amber", green: "Green" },
    renderProgressBlock: () => "",
    ensureOrganisation: async () => "org-1",
    getPortfolioControlSummary: async () => {
      controlSummaryCalls.n++;
      return { rows: [], totals: { openActions: 0, overdue: 0, dueToday: 0, blocked: 0, highCritical: 0, overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0 }, projectsRequiringAttention: 0 };
    },
    getAttentionActions: async () => [],
    getMemberEmailMap: async () => ({}),
    CONTROL_LEVEL_BADGE, ACTION_PRIORITIES, ACTION_PRIORITY_LABEL, ACTION_PRIORITY_BADGE, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE, ACTION_DUE_LABEL, ACTION_DUE_BADGE,
    createAction: overrides.createAction || (async (projectId, fields) => { createActionCalls.push({ projectId, fields }); return { id: "newaction1" }; }),
    isSnagOutstanding: () => false,
    externalWorksStale: () => false,
    externalWorksShareSet: () => true,
    EXTERNAL_WORKS_STALE_DAYS: 14,
  });
  return { ...result, supabase, createActionCalls, controlSummaryCalls };
}

test("dashboard.html: + New Action shows the form, populated with every accessible project, priority defaulted to medium", async () => {
  const { document } = await run();
  await wait(30);

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);

  assert.equal(document.getElementById("newActionCard").style.display, "block");
  const projectOptions = [...document.getElementById("actionProject").options].map((o) => o.value).filter(Boolean);
  assert.deepEqual(projectOptions.sort(), ["p1", "p2"], "every project the caller can access must be offered, not just ones with existing work");
  assert.equal(document.getElementById("actionPriority").value, "medium");
});

test("dashboard.html: choosing a project reloads the assignee list to that project's editors only, and defaults to the caller when they're one of them", async () => {
  const { document } = await run();
  await wait(30);

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);
  document.getElementById("actionProject").value = "p1";
  fireEvent(document.getElementById("actionProject"), "change");
  await wait(10);

  const options = [...document.getElementById("actionAssignedTo").options].map((o) => o.value);
  assert.ok(options.includes("u1") && options.includes("u2"), "owner and collaborator must both be offered");
  assert.ok(!options.includes("u3"), "a snagging-only member must never be offered as an Action assignee");
  assert.equal(document.getElementById("actionAssignedTo").value, "u1", "must default to the caller themselves, since they're an editor on this project");
});

test("dashboard.html: switching to a project the caller isn't an editor on falls back to Unassigned, not a stale selection", async () => {
  const { document } = await run();
  await wait(30);

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);
  document.getElementById("actionProject").value = "p2";
  fireEvent(document.getElementById("actionProject"), "change");
  await wait(10);

  assert.equal(document.getElementById("actionAssignedTo").value, "", "the caller isn't an editor on p2, so it must not default to them");
  const options = [...document.getElementById("actionAssignedTo").options].map((o) => o.value);
  assert.ok(!options.includes("u1"), "the caller isn't even offered — they have no editor role on this project");
});

test("dashboard.html: submitting the quick-create form calls createAction with the right project id and payload", async () => {
  const { document, createActionCalls } = await run();
  await wait(30);

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);
  document.getElementById("actionProject").value = "p1";
  fireEvent(document.getElementById("actionProject"), "change");
  await wait(10);

  document.getElementById("actionTitle").value = "Chase scaffold handover";
  document.getElementById("actionDescription").value = "Need sign-off before next trade moves in";
  document.getElementById("actionPriority").value = "high";
  document.getElementById("actionDueDate").value = "2026-12-01";
  document.getElementById("actionAssignedTo").value = "u2";
  fireEvent(document.getElementById("quickActionForm"), "submit");
  await wait(30);

  assert.equal(createActionCalls.length, 1);
  assert.equal(createActionCalls[0].projectId, "p1");
  // Compared field-by-field, not via assert.deepEqual on the whole
  // object — it's built inside the vm-executed page script, a
  // different realm from this test file, so it's structurally
  // identical but never reference/prototype-equal to a plain object
  // literal written here.
  const fields = createActionCalls[0].fields;
  assert.equal(fields.title, "Chase scaffold handover");
  assert.equal(fields.description, "Need sign-off before next trade moves in");
  assert.equal(fields.priority, "high");
  assert.equal(fields.assignedTo, "u2");
  assert.equal(fields.dueDate, "2026-12-01");
});

test("dashboard.html: a successful quick-create closes the form and refreshes the dashboard's attention data", async () => {
  const { document, controlSummaryCalls } = await run();
  await wait(30);
  const callsBefore = controlSummaryCalls.n;

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);
  document.getElementById("actionProject").value = "p1";
  fireEvent(document.getElementById("actionProject"), "change");
  await wait(10);
  document.getElementById("actionTitle").value = "Quick task";
  fireEvent(document.getElementById("quickActionForm"), "submit");
  await wait(30);

  assert.equal(document.getElementById("newActionCard").style.display, "none", "the form must close on success");
  assert.ok(controlSummaryCalls.n > callsBefore, "the portfolio control summary (attention counts/list) must be re-fetched after a successful create");
});

test("dashboard.html: submitting with no project chosen shows an error and never calls createAction", async () => {
  const { document, createActionCalls } = await run();
  await wait(30);

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);
  document.getElementById("actionTitle").value = "No project picked";
  fireEvent(document.getElementById("quickActionForm"), "submit");
  await wait(30);

  assert.equal(createActionCalls.length, 0);
  assert.notEqual(document.getElementById("actionErrorBox").textContent, "");
  assert.equal(document.getElementById("newActionCard").style.display, "block", "the form must stay open so the user can fix it");
});

test("dashboard.html: a createAction failure is shown in the form's own error box, the form stays open, and the global dashboard error box is untouched", async () => {
  const { document } = await run({
    createAction: async () => { throw new Error("row-level security policy violation"); },
  });
  await wait(30);

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);
  document.getElementById("actionProject").value = "p1";
  fireEvent(document.getElementById("actionProject"), "change");
  await wait(10);
  document.getElementById("actionTitle").value = "Will fail";
  fireEvent(document.getElementById("quickActionForm"), "submit");
  await wait(30);

  assert.match(document.getElementById("actionErrorBox").textContent, /row-level security/);
  assert.equal(document.getElementById("newActionCard").style.display, "block", "the form must stay open on failure, not silently close");
  assert.equal(document.getElementById("errorBox").textContent, "", "the unrelated New Project error box must be untouched");
});

test("dashboard.html: Cancel closes the quick-create form without calling createAction", async () => {
  const { document, createActionCalls } = await run();
  await wait(30);

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);
  fireEvent(document.getElementById("cancelActionBtn"), "click");
  await wait(10);

  assert.equal(document.getElementById("newActionCard").style.display, "none");
  assert.equal(createActionCalls.length, 0);
});

test("dashboard.html: if the assignee RPC fails, the picker falls back to Unassigned instead of erroring the whole form", async () => {
  const supabase = makeSupabase({ memberRpcError: { message: "function not found" } });
  const { document } = await run({ supabase });
  await wait(30);

  fireEvent(document.getElementById("newActionBtn"), "click");
  await wait(10);
  document.getElementById("actionProject").value = "p1";
  fireEvent(document.getElementById("actionProject"), "change");
  await wait(10);

  const options = [...document.getElementById("actionAssignedTo").options].map((o) => o.value);
  assert.deepEqual(options, [""], "must fall back to just Unassigned, never throw or leave stale options");
});
