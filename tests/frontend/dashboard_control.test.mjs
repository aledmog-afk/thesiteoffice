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
const ACTION_PRIORITIES = extractConst("ACTION_PRIORITIES");
const ACTION_PRIORITY_LABEL = extractConst("ACTION_PRIORITY_LABEL");
const ACTION_PRIORITY_BADGE = extractConst("ACTION_PRIORITY_BADGE");
const ACTION_STATUS_LABEL = extractConst("ACTION_STATUS_LABEL");
const ACTION_STATUS_BADGE = extractConst("ACTION_STATUS_BADGE");
const ACTION_DUE_LABEL = extractConst("ACTION_DUE_LABEL");
const ACTION_DUE_BADGE = extractConst("ACTION_DUE_BADGE");

// categoriseProgrammeActivity() (v94 tile drill-down) — the REAL
// function from app.js, extracted with a FIXED todayISO so the
// Overdue Programme / Programme Forecast Late fixtures below stay
// correct regardless of what day the suite actually runs on. The
// jsdom harness's own default binding for this (see
// loadCategoriseProgrammeActivity() in tests/lib/jsdom-harness.mjs)
// uses the real current date instead — fine for every pre-existing
// test here (none of them open a programme tile), but these new tests
// need a pinned "today" to assert exact fixture dates.
function extractFn(name) {
  const m = APP_JS.match(new RegExp(`export (?:async )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
function extractPrivateFn(name) {
  const m = APP_JS.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0];
}
const CATEGORISE_SCOPE = `
  function todayISO() { return "2026-06-15"; }
  const DUE_SOON_DAYS = ${extractConst("DUE_SOON_DAYS")};
  const PROGRAMME_MATERIAL_DELAY_DAYS = ${extractConst("PROGRAMME_MATERIAL_DELAY_DAYS")};
  ${extractPrivateFn("diffCalendarDays")}
  ${extractFn("categoriseProgrammeActivity")}
  return { categoriseProgrammeActivity };
`;
const { categoriseProgrammeActivity } = new Function(CATEGORISE_SCOPE)();

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

async function run({ summary, attentionActions = ATTENTION_ACTIONS, attentionThrows = false, extra = {} } = {}) {
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
    CONTROL_LEVEL_BADGE, ACTION_PRIORITIES, ACTION_PRIORITY_LABEL, ACTION_PRIORITY_BADGE, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE, ACTION_DUE_LABEL, ACTION_DUE_BADGE,
    createAction: async () => ({}),
    isPlatformAdmin: async () => false,
    // v94: fixed-date categoriseProgrammeActivity by default (see the
    // CATEGORISE_SCOPE comment above) — tile-drilldown tests override
    // it further only when they need a DIFFERENT fixture; most don't
    // call it at all.
    categoriseProgrammeActivity,
    ...extra,
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

// ─── Tile drill-down (v94) ───────────────────────────────────────
// Every fixture below is built so each tile's drill-down list is
// DELIBERATELY exactly as long as that tile's own number — including
// decoy rows that must be EXCLUDED (a non-material forecast-late task,
// a second project's open action) — to prove the parity requirement
// holds for real, not just by accident. Dates are relative to this
// file's fixed categoriseProgrammeActivity (today = 2026-06-15).
const DRILLDOWN_PROJECT_ATTENTION = { id: "p1", name: "Elm Grove" };
const DRILLDOWN_PROJECT_ON_TRACK = { id: "p2", name: "Oak Close" };

const OVERDUE_TASK = { id: "pa1", project_id: "p1", title: "Groundworks", is_milestone: false, status: "in_progress", planned_start: "2026-04-01", planned_finish: "2026-05-01", forecast_start: "2026-04-01", forecast_finish: "2026-05-01", actual_finish: null, projects: { name: "Elm Grove" } };
const MATERIAL_LATE_TASK = { id: "pa2", project_id: "p1", title: "Roof Covering", is_milestone: false, status: "in_progress", planned_start: "2026-07-01", planned_finish: "2026-07-01", forecast_start: "2026-07-01", forecast_finish: "2026-07-10", actual_finish: null, projects: { name: "Elm Grove" } }; // 9 days late, > PROGRAMME_MATERIAL_DELAY_DAYS(5)
const LATE_MILESTONE = { id: "pa3", project_id: "p1", title: "Practical Completion", is_milestone: true, status: "not_started", planned_start: "2026-08-01", planned_finish: "2026-08-01", forecast_start: "2026-08-01", forecast_finish: "2026-08-03", actual_finish: null, projects: { name: "Elm Grove" } }; // any delay counts for a milestone
const MINOR_LATE_TASK_DECOY = { id: "pa4", project_id: "p1", title: "Snagging Walk", is_milestone: false, status: "in_progress", planned_start: "2026-09-01", planned_finish: "2026-09-01", forecast_start: "2026-09-01", forecast_finish: "2026-09-04", actual_finish: null, projects: { name: "Elm Grove" } }; // only 3 days late — routine, must be EXCLUDED from Programme Forecast Late
const ON_PLAN_TASK_DECOY = { id: "pa5", project_id: "p1", title: "Landscaping", is_milestone: false, status: "not_started", planned_start: "2026-10-01", planned_finish: "2026-10-10", forecast_start: "2026-10-01", forecast_finish: "2026-10-10", actual_finish: null, projects: { name: "Elm Grove" } };

const OVERDUE_ACTION_1 = { id: "a1", project_id: "p1", title: "Chase Building Control", status: "open", priority: "critical", due_date: "2026-06-01", projects: { name: "Elm Grove" }, categories: { overdue: true, dueToday: false, dueSoon: false, blocked: false, highCritical: true } };
const OVERDUE_ACTION_2 = { id: "a2", project_id: "p1", title: "Chase warranty inspector", status: "open", priority: "medium", due_date: "2026-06-02", projects: { name: "Elm Grove" }, categories: { overdue: true, dueToday: false, dueSoon: false, blocked: false, highCritical: false } };
const BLOCKED_ACTION_DECOY = { id: "a3", project_id: "p1", title: "Resolve access dispute", status: "blocked", priority: "low", due_date: null, projects: { name: "Elm Grove" }, categories: { overdue: false, dueToday: false, dueSoon: false, blocked: true, highCritical: false } };

const OPEN_ACTIONS_LIST = [
  { id: "a1", project_id: "p1", title: "Chase Building Control", status: "open", priority: "critical", due_date: "2026-06-01", projects: { name: "Elm Grove" } },
  { id: "a2", project_id: "p1", title: "Chase warranty inspector", status: "open", priority: "medium", due_date: "2026-06-02", projects: { name: "Elm Grove" } },
  { id: "a3", project_id: "p1", title: "Resolve access dispute", status: "blocked", priority: "low", due_date: null, projects: { name: "Elm Grove" } },
  { id: "a4", project_id: "p1", title: "Order windows", status: "in_progress", priority: "low", due_date: "2026-12-01", projects: { name: "Elm Grove" } }, // not overdue/blocked/high-critical — pure "open", nothing else
];

function makeDrilldownSummary() {
  return {
    calls: 0,
    async get() {
      this.calls++;
      return {
        rows: [
          { project: DRILLDOWN_PROJECT_ATTENTION, counts: { openActions: 4, overdue: 2, overdueCritical: 1, dueToday: 0, dueSoon: 0, blocked: 1, highCritical: 1 }, status: { level: "attention", label: "Attention", reason: "Attention — 2 overdue actions (1 critical), 1 blocked." } },
          { project: DRILLDOWN_PROJECT_ON_TRACK, counts: { openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0 }, status: { level: "on_track", label: "On Track", reason: "On track — no open actions." } },
        ],
        totals: { openActions: 4, overdue: 2, dueToday: 0, blocked: 1, highCritical: 1, overdueProgrammeActivities: 1, overdueProgrammeMilestones: 0, materialForecastLateProgrammeActivities: 1, forecastLateProgrammeMilestones: 1 },
        projectsRequiringAttention: 1,
        openActionsList: OPEN_ACTIONS_LIST,
        activeProgrammeActivities: [OVERDUE_TASK, MATERIAL_LATE_TASK, LATE_MILESTONE, MINOR_LATE_TASK_DECOY, ON_PLAN_TASK_DECOY],
      };
    },
  };
}
const DRILLDOWN_ATTENTION_ACTIONS = [OVERDUE_ACTION_1, OVERDUE_ACTION_2, BLOCKED_ACTION_DECOY];

function tileButton(document, label) {
  return Array.from(document.querySelectorAll("#totalsBar button[data-tile]")).find((b) => b.textContent.includes(label));
}
function tileBox(document, label) {
  return Array.from(document.querySelectorAll("#totalsBar .totals-box")).find((b) => b.textContent.includes(label));
}

test("dashboard.html: a non-zero tile renders as a real <button> (keyboard-reachable); a zero-count tile renders as a plain, non-clickable box", async () => {
  const { document } = await run({ summary: makeDrilldownSummary(), attentionActions: DRILLDOWN_ATTENTION_ACTIONS });
  await wait(30);

  assert.ok(tileButton(document, "Overdue Programme"), "Overdue Programme (1) must be a clickable button");
  assert.ok(tileButton(document, "Programme Forecast Late"), "Programme Forecast Late (2) must be a clickable button");
  assert.ok(tileButton(document, "Overdue"), "Overdue (2) must be a clickable button");
  const dueTodayBox = tileBox(document, "Due Today");
  assert.ok(dueTodayBox, "Due Today (0) must still render");
  assert.equal(dueTodayBox.tagName, "DIV", "a zero-count tile must not be a clickable button");
});

test("dashboard.html: clicking the Overdue Programme tile opens a list whose length exactly equals the tile's own number, excluding a routine (non-material) forecast-late decoy", async () => {
  const { document } = await run({ summary: makeDrilldownSummary(), attentionActions: DRILLDOWN_ATTENTION_ACTIONS });
  await wait(30);

  const tileValue = Number(tileButton(document, "Overdue Programme").querySelector(".totals-value").textContent);
  fireEvent(tileButton(document, "Overdue Programme"), "click");

  assert.equal(document.getElementById("tileDrilldownModal").style.display, "flex");
  const rows = document.querySelectorAll("#tileDrilldownRows tr");
  assert.equal(rows.length, tileValue, "the drill-down list length must equal the tile's own number");
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Groundworks/);
  assert.ok(!document.getElementById("tileDrilldownRows").textContent.includes("Roof Covering"), "a forecast-late (not overdue) activity must not appear under Overdue");
  const link = rows[0].querySelector("a");
  assert.equal(link.getAttribute("href"), "programme.html?project=p1#activity-pa1");
});

test("dashboard.html: clicking the Programme Forecast Late tile lists only the material task delay and the late milestone, excluding the routine 3-day decoy and the on-plan activity", async () => {
  const { document } = await run({ summary: makeDrilldownSummary(), attentionActions: DRILLDOWN_ATTENTION_ACTIONS });
  await wait(30);

  const tileValue = Number(tileButton(document, "Programme Forecast Late").querySelector(".totals-value").textContent);
  fireEvent(tileButton(document, "Programme Forecast Late"), "click");

  const rows = document.querySelectorAll("#tileDrilldownRows tr");
  assert.equal(rows.length, tileValue, "the drill-down list length must equal the tile's own number");
  assert.equal(rows.length, 2);
  const text = document.getElementById("tileDrilldownRows").textContent;
  assert.match(text, /Roof Covering/);
  assert.match(text, /Practical Completion/);
  assert.ok(!text.includes("Snagging Walk"), "a 3-day (routine, non-material) delay must be excluded");
  assert.ok(!text.includes("Landscaping"), "an on-plan activity must never appear here");
});

test("dashboard.html: clicking the Overdue action tile lists exactly the overdue actions, each linking to that project's Actions page", async () => {
  const { document } = await run({ summary: makeDrilldownSummary(), attentionActions: DRILLDOWN_ATTENTION_ACTIONS });
  await wait(30);

  const tileValue = Number(tileButton(document, "Overdue").querySelector(".totals-value").textContent);
  fireEvent(tileButton(document, "Overdue"), "click");

  const rows = document.querySelectorAll("#tileDrilldownRows tr");
  assert.equal(rows.length, tileValue, "the drill-down list length must equal the tile's own number");
  assert.equal(rows.length, 2);
  const text = document.getElementById("tileDrilldownRows").textContent;
  assert.match(text, /Chase Building Control/);
  assert.match(text, /Chase warranty inspector/);
  assert.ok(!text.includes("Resolve access dispute"), "a merely-blocked (not overdue) action must not appear under Overdue");
  assert.ok(document.querySelector('#tileDrilldownRows a[href="actions.html?project=p1"]'), "each overdue action must link to that project's Actions page");
});

test("dashboard.html: clicking the Open Actions tile lists every open action, including ones that are neither overdue, blocked nor high/critical", async () => {
  const { document } = await run({ summary: makeDrilldownSummary(), attentionActions: DRILLDOWN_ATTENTION_ACTIONS });
  await wait(30);

  const tileValue = Number(tileButton(document, "Open Actions").querySelector(".totals-value").textContent);
  fireEvent(tileButton(document, "Open Actions"), "click");

  const rows = document.querySelectorAll("#tileDrilldownRows tr");
  assert.equal(rows.length, tileValue);
  assert.equal(rows.length, 4);
  assert.match(document.getElementById("tileDrilldownRows").textContent, /Order windows/, "a plain open action with no exception category must still appear here");
});

test("dashboard.html: clicking Projects Requiring Attention shows each attention project with the same reason text as its status badge tooltip", async () => {
  const { document } = await run({ summary: makeDrilldownSummary(), attentionActions: DRILLDOWN_ATTENTION_ACTIONS });
  await wait(30);

  fireEvent(tileButton(document, "Projects Requiring Attention"), "click");

  const rows = document.querySelectorAll("#tileDrilldownRows tr");
  assert.equal(rows.length, 1, "exactly the one attention-level project, matching projectsRequiringAttention");
  assert.match(rows[0].textContent, /Elm Grove/);
  assert.match(rows[0].textContent, /Attention — 2 overdue actions \(1 critical\), 1 blocked\./);
  const controlRowBadge = document.querySelector('#controlRows a[href="project.html?id=p1"]').closest("tr").querySelector(".badge");
  assert.equal(controlRowBadge.getAttribute("title"), "Attention — 2 overdue actions (1 critical), 1 blocked.", "must be the exact same text as the status badge's own tooltip");
});

test("dashboard.html: the drill-down modal is closable by its Close button, by Escape, and by clicking the backdrop — each restoring focus to the tile that opened it", async () => {
  const { document, window } = await run({ summary: makeDrilldownSummary(), attentionActions: DRILLDOWN_ATTENTION_ACTIONS });
  await wait(30);
  const modal = document.getElementById("tileDrilldownModal");

  const overdueBtn = tileButton(document, "Overdue");
  fireEvent(overdueBtn, "click");
  assert.equal(modal.style.display, "flex");
  fireEvent(document.getElementById("tileDrilldownCloseBtn"), "click");
  assert.equal(modal.style.display, "none");

  fireEvent(overdueBtn, "click");
  assert.equal(modal.style.display, "flex");
  // fireEvent()'s plain Event constructor can't carry `.key`, so a real
  // KeyboardEvent is dispatched directly here.
  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(modal.style.display, "none", "Escape must close the modal");

  fireEvent(overdueBtn, "click");
  assert.equal(modal.style.display, "flex");
  fireEvent(modal, "click", { target: modal });
  assert.equal(modal.style.display, "none", "clicking the backdrop itself (not the box inside it) must close the modal");
});

test("dashboard.html: with no drill-down fields on the control summary (a pre-existing/older mock), tiles still render without throwing and simply have nothing to drill into", async () => {
  const { document } = await run({ summary: makeSummary() });
  await wait(30);
  // makeSummary()'s totals have no overdueProgrammeActivities/etc at
  // all — the programme tiles must default to 0, not throw.
  const programmeTileBox = tileBox(document, "Overdue Programme");
  assert.ok(programmeTileBox);
  assert.equal(programmeTileBox.querySelector(".totals-value").textContent, "0");
});
