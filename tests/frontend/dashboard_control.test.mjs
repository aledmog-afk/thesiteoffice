// Project Control Dashboard (Priority 6) — dashboard.html's real inline
// script. getPortfolioControlSummary()/getAttentionActions()/
// getMemberEmailMap() are mocked here (they're thin wrappers already
// exercised for real, against the actual RLS boundary, in
// tests/security/dashboard.test.mjs); this file proves the PAGE wires
// them up correctly — rendering, filters, navigation, and the empty vs.
// error distinction a control dashboard must never blur.
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
const CONTROL_LEVEL_BADGE = extractConst("CONTROL_LEVEL_BADGE");
const ACTION_PRIORITY_LABEL = extractConst("ACTION_PRIORITY_LABEL");
const ACTION_PRIORITY_BADGE = extractConst("ACTION_PRIORITY_BADGE");
const ACTION_STATUS_LABEL = extractConst("ACTION_STATUS_LABEL");
const ACTION_STATUS_BADGE = extractConst("ACTION_STATUS_BADGE");
const ACTION_DUE_LABEL = extractConst("ACTION_DUE_LABEL");
const ACTION_DUE_BADGE = extractConst("ACTION_DUE_BADGE");

function emptySupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async () => ({ data: null, error: null }),
    from() {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; },
        single: async () => ({ data: null, error: null }),
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

const PROJECT_ATTENTION = { id: "p1", name: "Elm Grove" };
const PROJECT_ON_TRACK = { id: "p2", name: "Oak Close" };

function makeSummary({ throwError = false } = {}) {
  return {
    calls: 0,
    async get() {
      this.calls++;
      if (throwError) throw new Error("network error loading control summary");
      return {
        rows: [
          { project: PROJECT_ATTENTION, counts: { openActions: 4, overdue: 2, overdueCritical: 1, dueToday: 0, dueSoon: 1, blocked: 1, highCritical: 1 }, status: { level: "attention", label: "Attention", reason: "Attention — 2 overdue actions (1 critical), 1 blocked." } },
          { project: PROJECT_ON_TRACK, counts: { openActions: 1, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0 }, status: { level: "on_track", label: "On Track", reason: "On track — 1 open action, no exceptions." } },
        ],
        totals: { openActions: 5, overdue: 2, dueToday: 0, blocked: 1, highCritical: 1 },
        projectsRequiringAttention: 1,
      };
    },
  };
}

const ATTENTION_ACTIONS = [
  { id: "a1", project_id: "p1", title: "Chase Building Control", status: "open", priority: "critical", assigned_to: "u-collab", due_date: "2026-09-01", projects: { name: "Elm Grove" }, categories: { overdue: true, dueToday: false, dueSoon: false, blocked: false, highCritical: true } },
  { id: "a2", project_id: "p1", title: "Resolve access dispute", status: "blocked", priority: "medium", assigned_to: null, due_date: null, projects: { name: "Elm Grove" }, categories: { overdue: false, dueToday: false, dueSoon: false, blocked: true, highCritical: false } },
];

async function run({ summary, attentionActions = ATTENTION_ACTIONS, attentionThrows = false } = {}) {
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/dashboard.html",
    supabase: emptySupabase(),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    RAG_LABEL: { red: "Red", amber: "Amber", green: "Green" },
    renderProgressBlock: () => "",
    ensureOrganisation: async () => "org-1",
    getPortfolioControlSummary: () => summary.get(),
    getAttentionActions: async () => {
      if (attentionThrows) throw new Error("attention query failed");
      return attentionActions;
    },
    getMemberEmailMap: async () => ({ "u-collab": "collab@example.com" }),
    CONTROL_LEVEL_BADGE, ACTION_PRIORITY_LABEL, ACTION_PRIORITY_BADGE, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE, ACTION_DUE_LABEL, ACTION_DUE_BADGE,
  });
}

test("dashboard.html: loads and renders totals, the project control list, and attention actions", async () => {
  const summary = makeSummary();
  const { document } = await run({ summary });
  await wait(30);

  const totalsText = document.getElementById("totalsBar").textContent;
  assert.ok(totalsText.includes("5"), "total open actions should render");
  assert.ok(totalsText.includes("2"), "total overdue should render");

  const controlHtml = document.getElementById("controlRows").innerHTML;
  assert.ok(controlHtml.includes("Elm Grove"));
  assert.ok(controlHtml.includes("Oak Close"));
  assert.ok(controlHtml.includes("Attention"));
  assert.ok(controlHtml.includes("On Track"));

  const attentionHtml = document.getElementById("attentionRows").innerHTML;
  assert.ok(attentionHtml.includes("Chase Building Control"));
  assert.ok(attentionHtml.includes("collab@example.com"), "the assignee's resolved email should render");
  assert.ok(attentionHtml.includes("Unassigned"), "an action with no assigned_to should say Unassigned, not blank");
});

test("dashboard.html: project navigation and action navigation links point to the right pages", async () => {
  const { document } = await run({ summary: makeSummary() });
  await wait(30);

  const controlLink = document.querySelector('#controlRows a[href="project.html?id=p1"]');
  assert.ok(controlLink, "the project control row should link to project.html for that project");

  const attentionActionLink = document.querySelector('#attentionRows a[href="actions.html?project=p1"]');
  assert.ok(attentionActionLink, "an attention action should link into that project's Actions page");
  const attentionProjectLink = document.querySelector('#attentionRows a[href="project.html?id=p1"]');
  assert.ok(attentionProjectLink, "an attention action's project name should also link to the project");
});

test("dashboard.html: the project-level Attention filter narrows the control list", async () => {
  const { document } = await run({ summary: makeSummary() });
  await wait(30);

  const attentionBtn = document.querySelector('#projectFilterGroup button[data-filter="attention"]');
  fireEvent(attentionBtn, "click");

  const html = document.getElementById("controlRows").innerHTML;
  assert.ok(html.includes("Elm Grove"));
  assert.ok(!html.includes("Oak Close"), "On Track projects must be excluded once the Attention filter is active");
});

test("dashboard.html: the Actions attention-category filter (e.g. Blocked) narrows the attention list", async () => {
  const { document } = await run({ summary: makeSummary() });
  await wait(30);

  const select = document.getElementById("attentionFilter");
  select.value = "blocked";
  fireEvent(select, "change");

  const html = document.getElementById("attentionRows").innerHTML;
  assert.ok(html.includes("Resolve access dispute"));
  assert.ok(!html.includes("Chase Building Control"), "only the blocked action should remain once filtered to Blocked");
});

test("dashboard.html: an empty attention list is shown explicitly, not as a blank table", async () => {
  const { document } = await run({ summary: makeSummary(), attentionActions: [] });
  await wait(30);

  assert.equal(document.getElementById("attentionEmpty").style.display, "block");
  assert.ok(document.getElementById("attentionEmpty").textContent.includes("No actions currently require attention"));
});

test("dashboard.html: a failed control-summary query shows a real error with a retry option, never silent zeros", async () => {
  const { document } = await run({ summary: makeSummary({ throwError: true }) });
  await wait(30);

  assert.equal(document.getElementById("controlSection").style.display, "none", "the control section must not render as if it had real (zeroed) data");
  assert.ok(document.getElementById("controlErrorBox").textContent.includes("network error loading control summary"));
  assert.equal(document.getElementById("controlErrorRetryWrap").style.display, "block");
});

test("dashboard.html: Retry re-runs the control summary query and recovers on success", async () => {
  let shouldThrow = true;
  const summary = { calls: 0, async get() { this.calls++; if (shouldThrow) throw new Error("boom"); return makeSummary().get(); } };
  const { document } = await run({ summary });
  await wait(30);
  assert.equal(document.getElementById("controlSection").style.display, "none");

  shouldThrow = false;
  fireEvent(document.getElementById("controlRetryBtn"), "click");
  await wait(30);

  assert.equal(document.getElementById("controlSection").style.display, "block", "a successful retry should show the control section again");
  assert.equal(summary.calls, 2, "retry should re-run the query, not reuse the failed result");
});

test("dashboard.html: the Refresh button re-runs the control summary query", async () => {
  const summary = makeSummary();
  const { document } = await run({ summary });
  await wait(30);
  assert.equal(summary.calls, 1);

  fireEvent(document.getElementById("refreshBtn"), "click");
  await wait(30);

  assert.ok(summary.calls >= 2, "refresh should trigger at least one more control-summary query");
});
