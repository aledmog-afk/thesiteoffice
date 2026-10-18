// Accountability & Work Queue (Priority 16) — computeAgeing(),
// getPortfolioWorkItems(), filterMyWorkItems(), filterUnassignedWorkItems(),
// summariseOwnerAccountability() exercised against the REAL app.js
// source (regex-extracted, never reimplemented). Ageing is proven
// against exact boundary dates (today/tomorrow/yesterday/1/7/8 days
// overdue/month & year boundaries/a leap day) since the brief is
// explicit ageing must never be calculated differently in different
// places — this file is the one place its exact calendar arithmetic
// is pinned down.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConstSrc(name) {
  const m = APP_JS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
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
function extractPrivateConst(name) {
  const m = APP_JS.match(new RegExp(`const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0];
}

function buildAgeingScope() {
  const SCOPE = `
    function todayISO() { return "2099-01-01"; }
    ${extractPrivateFn("diffCalendarDays")}
    ${extractFn("computeAgeing")}
    ${extractConstSrc("AGEING_LABEL")}
    ${extractFn("ageingLabel")}
    return { computeAgeing, ageingLabel };
  `;
  return new Function(SCOPE)();
}
const { computeAgeing, ageingLabel } = buildAgeingScope();

// ─── Ageing: due-date boundaries ──────────────────────────────────────

test("Ageing: due today -> state due_today, 0 days", () => {
  const a = computeAgeing("2026-06-15", null, "2026-06-15");
  assert.deepEqual(a, { state: "due_today", days: 0 });
  assert.equal(ageingLabel(a), "Due today");
});

test("Ageing: due tomorrow -> state due_future, 1 day", () => {
  const a = computeAgeing("2026-06-16", null, "2026-06-15");
  assert.deepEqual(a, { state: "due_future", days: 1 });
  assert.equal(ageingLabel(a), "Due in 1 day");
});

test("Ageing: due yesterday -> state overdue, 1 day", () => {
  const a = computeAgeing("2026-06-14", null, "2026-06-15");
  assert.deepEqual(a, { state: "overdue", days: 1 });
  assert.equal(ageingLabel(a), "1 day overdue");
});

test("Ageing: exactly 1 day overdue", () => {
  const a = computeAgeing("2026-06-14", null, "2026-06-15");
  assert.equal(a.days, 1);
});

test("Ageing: exactly 7 days overdue", () => {
  const a = computeAgeing("2026-06-08", null, "2026-06-15");
  assert.deepEqual(a, { state: "overdue", days: 7 });
  assert.equal(ageingLabel(a), "7 days overdue");
});

test("Ageing: exactly 8 days overdue (one past the DUE_SOON_DAYS-shaped boundary)", () => {
  const a = computeAgeing("2026-06-07", null, "2026-06-15");
  assert.deepEqual(a, { state: "overdue", days: 8 });
});

test("Ageing: month boundary — due 31 Jan, as of 1 Feb -> 1 day overdue", () => {
  const a = computeAgeing("2026-01-31", null, "2026-02-01");
  assert.deepEqual(a, { state: "overdue", days: 1 });
});

test("Ageing: year boundary — due 31 Dec 2025, as of 1 Jan 2026 -> 1 day overdue", () => {
  const a = computeAgeing("2025-12-31", null, "2026-01-01");
  assert.deepEqual(a, { state: "overdue", days: 1 });
});

test("Ageing: leap day — due 28 Feb 2028 (leap year), as of 1 Mar 2028 -> 2 days overdue (29 Feb counted)", () => {
  const a = computeAgeing("2028-02-28", null, "2028-03-01");
  assert.deepEqual(a, { state: "overdue", days: 2 });
});

test("Ageing: leap day — due 29 Feb 2028, as of 1 Mar 2028 -> exactly 1 day overdue", () => {
  const a = computeAgeing("2028-02-29", null, "2028-03-01");
  assert.deepEqual(a, { state: "overdue", days: 1 });
});

// ─── Ageing: no due date, falls back to sinceDate ─────────────────────

test("Ageing: no due date, has a since-date -> state outstanding, correct day count", () => {
  const a = computeAgeing(null, "2026-05-01", "2026-06-15");
  assert.deepEqual(a, { state: "outstanding", days: 45 });
  assert.equal(ageingLabel(a), "45 days outstanding");
});

test("Ageing: no due date, since-date is today -> 0 days outstanding, never overdue", () => {
  const a = computeAgeing(null, "2026-06-15", "2026-06-15");
  assert.deepEqual(a, { state: "outstanding", days: 0 });
});

test("Ageing: neither due date nor since date -> state unknown, no fabricated number", () => {
  const a = computeAgeing(null, null, "2026-06-15");
  assert.deepEqual(a, { state: "unknown", days: null });
  assert.equal(ageingLabel(a), "No due date");
});

test("Ageing: never poisoned by a live Date.now() — anchored strictly to the injected asOfDate", () => {
  const a = computeAgeing("2026-06-15", null, "2026-06-15");
  assert.equal(a.state, "due_today");
});

// ─── Full work-queue scope (network wrapper + derivations) ───────────

function buildScope() {
  const SCOPE = `
    function todayISO() { return "2026-06-15"; }
    ${extractConstSrc("DUE_SOON_DAYS")}
    ${extractConstSrc("PROGRAMME_MATERIAL_DELAY_DAYS")}
    ${extractPrivateFn("diffCalendarDays")}
    ${extractFn("categoriseAction")}
    ${extractFn("isSnagOutstanding")}
    ${extractFn("categoriseSnag")}
    ${extractFn("categoriseProgrammeActivity")}
    ${extractFn("computeAgeing")}
    ${extractConstSrc("AGEING_LABEL")}
    ${extractFn("ageingLabel")}
    ${extractConstSrc("WORK_ITEM_TYPE_LABEL")}

    let __projectsWithRole = [];
    async function getProjectsWithRole() { return __projectsWithRole; }

    let __tableData = {};
    function makeQuery(table) {
      const q = { not() { return q; }, eq() { return q; }, then(resolve) { resolve({ data: __tableData[table] || [], error: null }); } };
      return q;
    }
    const supabase = { from(table) { return { select() { return makeQuery(table); } }; } };

    ${extractPrivateConst("WORK_ITEM_EXCLUDED_ACTION_STATUSES")}
    ${extractPrivateConst("WORK_ITEM_EXCLUDED_PROGRAMME_STATUSES")}
    ${extractFn("getPortfolioWorkItems")}
    ${extractFn("filterMyWorkItems")}
    ${extractFn("filterUnassignedWorkItems")}
    ${extractFn("summariseOwnerAccountability")}

    return {
      getPortfolioWorkItems, filterMyWorkItems, filterUnassignedWorkItems, summariseOwnerAccountability,
      setProjectsWithRole: (rows) => { __projectsWithRole = rows; },
      setTableData: (data) => { __tableData = data; },
    };
  `;
  return new Function(SCOPE)();
}

const P1 = "proj-1";
const OWNER_A = "user-a";
const OWNER_B = "user-b";

function baseFixture() {
  return {
    projects: [{ id: P1, name: "Project One", myRole: "owner" }],
    plots: [{ id: "plot-1", project_id: P1, plot_number: "Plot 1" }],
    actions: [],
    snag_items: [],
    snag_lists: [],
    programme_activities: [],
  };
}

test("Work queue: completed and cancelled Actions are excluded", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [
    { id: "a1", project_id: P1, plot_id: null, title: "Done", status: "completed", priority: "low", assigned_to: OWNER_A, due_date: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "a2", project_id: P1, plot_id: null, title: "Dropped", status: "cancelled", priority: "low", assigned_to: OWNER_A, due_date: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "a3", project_id: P1, plot_id: null, title: "Live", status: "open", priority: "low", assigned_to: OWNER_A, due_date: null, created_at: "2026-01-01T00:00:00Z" },
  ];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(items.map((i) => i.id), ["a3"]);
});

test("Work queue: closed and rejected Snags are excluded, only 'open' remains", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.snag_items = [
    { id: "s1", project_id: P1, plot_id: null, snag_list_id: "l1", description: "Closed", status: "closed", priority: "high", assigned_to: OWNER_A, due_date: null, raised_date: "2026-01-01" },
    { id: "s2", project_id: P1, plot_id: null, snag_list_id: "l1", description: "Rejected", status: "rejected", priority: "high", assigned_to: OWNER_A, due_date: null, raised_date: "2026-01-01" },
    { id: "s3", project_id: P1, plot_id: null, snag_list_id: "l1", description: "Open", status: "open", priority: "high", assigned_to: OWNER_A, due_date: null, raised_date: "2026-01-01" },
  ];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(items.map((i) => i.id), ["s3"]);
});

test("Work queue: complete/cancelled Programme Activities are excluded, and only the ACTIVE programme's activities count", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.programme_activities = [
    { id: "p1", project_id: P1, plot_id: null, title: "Done", status: "complete", assigned_to: OWNER_A, planned_finish: null, created_at: "2026-01-01T00:00:00Z", programmes: { status: "active" } },
    { id: "p2", project_id: P1, plot_id: null, title: "Dropped", status: "cancelled", assigned_to: OWNER_A, planned_finish: null, created_at: "2026-01-01T00:00:00Z", programmes: { status: "active" } },
    { id: "p3", project_id: P1, plot_id: null, title: "Draft programme", status: "in_progress", assigned_to: OWNER_A, planned_finish: null, created_at: "2026-01-01T00:00:00Z", programmes: { status: "draft" } },
    { id: "p4", project_id: P1, plot_id: null, title: "Live", status: "in_progress", assigned_to: OWNER_A, planned_finish: null, created_at: "2026-01-01T00:00:00Z", programmes: { status: "active" } },
  ];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(items.map((i) => i.id), ["p4"]);
});

test("Work queue: a snag with no direct plot_id resolves its plot through snag_lists (the established fallback)", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.snag_lists = [{ id: "l1", plot_id: "plot-1" }];
  fx.snag_items = [
    { id: "s1", project_id: P1, plot_id: null, snag_list_id: "l1", description: "Via list", status: "open", priority: "high", assigned_to: null, due_date: null, raised_date: "2026-01-01" },
  ];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.equal(items[0].plot_id, "plot-1");
  assert.equal(items[0].plot_number, "Plot 1");
});

test("Work queue: dueDate and ageing are wired from the correct per-type field (due_date/due_date/planned_finish)", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [{ id: "a1", project_id: P1, plot_id: null, title: "A", status: "open", priority: "low", assigned_to: null, due_date: "2026-06-10", created_at: "2026-01-01T00:00:00Z" }];
  fx.snag_items = [{ id: "s1", project_id: P1, plot_id: null, snag_list_id: null, description: "S", status: "open", priority: "low", assigned_to: null, due_date: "2026-06-20", raised_date: "2026-01-01" }];
  fx.programme_activities = [{ id: "p1", project_id: P1, plot_id: null, title: "P", status: "in_progress", assigned_to: null, planned_finish: "2026-06-01", created_at: "2026-01-01T00:00:00Z", programmes: { status: "active" } }];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.a1.dueDate, "2026-06-10");
  assert.equal(byId.a1.ageing.state, "overdue"); // 2026-06-10 < 2026-06-15
  assert.equal(byId.s1.dueDate, "2026-06-20");
  assert.equal(byId.s1.ageing.state, "due_future");
  assert.equal(byId.p1.dueDate, "2026-06-01");
  assert.equal(byId.p1.ageing.state, "overdue");
});

test("Work queue: an Action/Snag/Programme Activity with no due date ages from its own correct since-date (created_at/created_at/raised_date)", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [{ id: "a1", project_id: P1, plot_id: null, title: "A", status: "open", priority: "low", assigned_to: null, due_date: null, created_at: "2026-05-01T00:00:00Z" }];
  fx.snag_items = [{ id: "s1", project_id: P1, plot_id: null, snag_list_id: null, description: "S", status: "open", priority: "low", assigned_to: null, due_date: null, raised_date: "2026-05-15" }];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  const byId = Object.fromEntries(items.map((i) => [i.id, i]));
  assert.equal(byId.a1.ageing.state, "outstanding");
  assert.equal(byId.a1.ageing.days, 45); // 1 May -> 15 June
  assert.equal(byId.s1.ageing.state, "outstanding");
  assert.equal(byId.s1.ageing.days, 31); // 15 May -> 15 June
});

// ─── My Work ───────────────────────────────────────────────────────────

test("filterMyWorkItems: only items assigned to the given user are returned", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [
    { id: "a1", project_id: P1, plot_id: null, title: "Mine", status: "open", priority: "low", assigned_to: OWNER_A, due_date: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "a2", project_id: P1, plot_id: null, title: "Theirs", status: "open", priority: "low", assigned_to: OWNER_B, due_date: null, created_at: "2026-01-01T00:00:00Z" },
    { id: "a3", project_id: P1, plot_id: null, title: "Nobody's", status: "open", priority: "low", assigned_to: null, due_date: null, created_at: "2026-01-01T00:00:00Z" },
  ];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(scope.filterMyWorkItems(items, OWNER_A).map((i) => i.id), ["a1"]);
});

// ─── Unassigned Work ───────────────────────────────────────────────────

test("filterUnassignedWorkItems: EVERY unassigned open Action/Snag is actionable, regardless of urgency", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [{ id: "a1", project_id: P1, plot_id: null, title: "Low priority, far future", status: "open", priority: "low", assigned_to: null, due_date: "2099-01-01", created_at: "2026-01-01T00:00:00Z" }];
  fx.snag_items = [{ id: "s1", project_id: P1, plot_id: null, snag_list_id: null, description: "Low priority", status: "open", priority: "low", assigned_to: null, due_date: null, raised_date: "2026-06-14" }];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  const unassigned = scope.filterUnassignedWorkItems(items).map((i) => i.id).sort();
  assert.deepEqual(unassigned, ["a1", "s1"]);
});

test("filterUnassignedWorkItems: an unassigned Programme Activity that is NOT overdue/materially late is NOT surfaced (most activities are just the plan, not yet a problem)", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.programme_activities = [{ id: "p1", project_id: P1, plot_id: null, title: "On track", status: "in_progress", assigned_to: null, planned_finish: "2099-01-01", created_at: "2026-01-01T00:00:00Z", programmes: { status: "active" } }];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(scope.filterUnassignedWorkItems(items), []);
});

test("filterUnassignedWorkItems: an unassigned OVERDUE Programme Activity IS surfaced — it is already a real exception, not just the plan", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.programme_activities = [{ id: "p1", project_id: P1, plot_id: null, title: "Slipped", status: "in_progress", assigned_to: null, planned_finish: "2026-01-01", created_at: "2026-01-01T00:00:00Z", programmes: { status: "active" } }];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(scope.filterUnassignedWorkItems(items).map((i) => i.id), ["p1"]);
});

test("filterUnassignedWorkItems: an unassigned MATERIALLY FORECAST-LATE Programme Activity IS surfaced even if not yet overdue against plan", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.programme_activities = [{
    id: "p1", project_id: P1, plot_id: null, title: "Forecast slipping", status: "in_progress", assigned_to: null,
    planned_finish: "2099-01-01", created_at: "2026-01-01T00:00:00Z", programmes: { status: "active" },
  }];
  // categoriseProgrammeActivity needs forecast_finish to compute materialForecastDelay — add it via a raw override,
  // since getPortfolioWorkItems() only selects the columns it needs; simulate directly through categoriseProgrammeActivity's inputs.
  fx.programme_activities[0].forecast_finish = "2099-02-01"; // 31 days later than a 5-day-material threshold, on a non-milestone
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(scope.filterUnassignedWorkItems(items).map((i) => i.id), ["p1"]);
});

test("filterUnassignedWorkItems: an assigned item, however overdue, never appears here — that's a chasing problem, not an ownership gap", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [{ id: "a1", project_id: P1, plot_id: null, title: "Overdue but owned", status: "open", priority: "critical", assigned_to: OWNER_A, due_date: "2020-01-01", created_at: "2026-01-01T00:00:00Z" }];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(scope.filterUnassignedWorkItems(items), []);
});

// ─── Who Needs Chasing (owner accountability) ─────────────────────────

test("summariseOwnerAccountability: counts reconcile exactly (open/overdue/dueToday/highCritical), oldest age, and projects affected", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [
    { id: "a1", project_id: P1, plot_id: null, title: "Overdue high", status: "open", priority: "high", assigned_to: OWNER_A, due_date: "2020-01-01", created_at: "2026-01-01T00:00:00Z" },
    { id: "a2", project_id: P1, plot_id: null, title: "Due today", status: "open", priority: "low", assigned_to: OWNER_A, due_date: "2026-06-15", created_at: "2026-01-01T00:00:00Z" },
  ];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  const summary = scope.summariseOwnerAccountability(items);
  assert.equal(summary.length, 1);
  const [o] = summary;
  assert.equal(o.userId, OWNER_A);
  assert.equal(o.open, 2);
  assert.equal(o.overdue, 1);
  assert.equal(o.dueToday, 1);
  assert.equal(o.highCritical, 1);
  assert.ok(o.oldestDays > 2000); // 2020-01-01 to 2026-06-15 is thousands of days
  assert.deepEqual(o.projectIds, [P1]);
});

test("summariseOwnerAccountability: sorted worst-first — most overdue, then most open", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [
    { id: "a1", project_id: P1, plot_id: null, title: "A", status: "open", priority: "low", assigned_to: OWNER_A, due_date: "2020-01-01", created_at: "2026-01-01T00:00:00Z" },
    { id: "a2", project_id: P1, plot_id: null, title: "B", status: "open", priority: "low", assigned_to: OWNER_B, due_date: null, created_at: "2026-01-01T00:00:00Z" },
  ];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  const summary = scope.summariseOwnerAccountability(items);
  assert.equal(summary[0].userId, OWNER_A); // has the overdue item
});

test("summariseOwnerAccountability: unassigned items never contribute to any owner's totals", async () => {
  const scope = buildScope();
  const fx = baseFixture();
  fx.actions = [{ id: "a1", project_id: P1, plot_id: null, title: "Nobody's", status: "open", priority: "critical", assigned_to: null, due_date: "2020-01-01", created_at: "2026-01-01T00:00:00Z" }];
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  const items = await scope.getPortfolioWorkItems();
  assert.deepEqual(scope.summariseOwnerAccountability(items), []);
});
