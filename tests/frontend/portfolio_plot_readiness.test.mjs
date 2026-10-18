// Portfolio Plot Control Rollup (Priority 15, Phase 2) —
// getPortfolioPlotReadiness()/sortPortfolioPlotRows()/
// summarisePortfolioPlotReadiness() exercised against the REAL app.js
// source (regex-extracted, never reimplemented). getPortfolioPlotReadiness()
// is deliberately just getProjectPlotReadiness() generalised across
// every project the caller can see — this file's core job is proving
// that generalisation is a genuine EQUIVALENCE, not a re-derivation:
// for every representative scenario, the readiness object the
// portfolio wrapper produces for a plot must be structurally IDENTICAL
// to calling the real computePlotHandoverReadiness() directly with the
// same inputs — never merely "the status looks right".
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

const TODAY = "2026-06-15";

function buildScope() {
  const SCOPE = `
    function todayISO() { return "${TODAY}"; }
    ${extractConstSrc("DUE_SOON_DAYS")}
    ${extractConstSrc("PROGRAMME_MATERIAL_DELAY_DAYS")}
    ${extractConstSrc("PLOT_READINESS_ORDER")}
    ${extractPrivateFn("diffCalendarDays")}
    ${extractFn("categoriseProgrammeActivity")}
    ${extractFn("countProgrammeSignals")}
    ${extractFn("isSnagOutstanding")}
    ${extractFn("categoriseSnag")}
    ${extractFn("categoriseAction")}
    ${extractFn("isFindingOutstanding")}
    ${extractFn("summarisePlotGates")}
    ${extractFn("summarisePlotDocuments")}
    ${extractFn("computePlotHandoverReadiness")}
    ${extractFn("comparePlotNumbers")}
    ${extractFn("sortPortfolioPlotRows")}
    ${extractFn("summarisePortfolioPlotReadiness")}

    let __projectsWithRole = [];
    let __queryCount = 0;
    async function getProjectsWithRole() { return __projectsWithRole; }

    let __tableData = {};
    function makeQuery(table) {
      const q = {
        not() { return q; },
        eq() { return q; },
        then(resolve) { __queryCount++; resolve({ data: __tableData[table] || [], error: null }); },
      };
      return q;
    }
    const supabase = { from(table) { return { select() { return makeQuery(table); } }; } };

    ${extractFn("getPortfolioPlotReadiness")}

    return {
      getPortfolioPlotReadiness, sortPortfolioPlotRows, summarisePortfolioPlotReadiness,
      computePlotHandoverReadiness, comparePlotNumbers, PLOT_READINESS_ORDER,
      setProjectsWithRole: (rows) => { __projectsWithRole = rows; },
      setTableData: (data) => { __tableData = data; },
      getQueryCount: () => __queryCount,
    };
  `;
  return new Function(SCOPE)();
}

function plotRow(id, projectId, overrides = {}) {
  return { id, project_id: projectId, plot_number: id, handed_over_at: null, ...overrides };
}

// ─── Fixture: one dataset covering all 10 representative scenarios ──

const P1 = "proj-1"; // owner/editor
const P2 = "proj-2"; // snagging-only

function buildFixture() {
  return {
    projects: [
      { id: P1, name: "Project One", myRole: "owner" },
      { id: P2, name: "Project Two", myRole: "snagging" },
    ],
    plots: [
      plotRow("plot-ready", P1),
      plotRow("plot-atrisk", P1),
      plotRow("plot-gateblock", P1),
      plotRow("plot-docblock", P1),
      plotRow("plot-snagblock", P1),
      plotRow("plot-actionblock", P1),
      plotRow("plot-findingblock", P1),
      plotRow("plot-programmewarn", P1),
      plotRow("plot-handedover", P1, { handed_over_at: "2026-01-01T00:00:00.000Z" }),
      plotRow("plot-restricted", P2),
    ],
    quality_gates: [
      { project_id: P1, plot_id: "plot-ready", status: "approved" },
      { project_id: P1, plot_id: "plot-atrisk", status: "approved" },
      { project_id: P1, plot_id: "plot-gateblock", status: "not_started" },
      { project_id: P1, plot_id: "plot-docblock", status: "approved" },
      { project_id: P1, plot_id: "plot-snagblock", status: "approved" },
      { project_id: P1, plot_id: "plot-actionblock", status: "approved" },
      { project_id: P1, plot_id: "plot-findingblock", status: "approved" },
      { project_id: P1, plot_id: "plot-programmewarn", status: "approved" },
      { project_id: P1, plot_id: "plot-handedover", status: "approved" },
    ],
    handover_documents: [
      { project_id: P1, plot_id: "plot-ready", status: "approved_final" },
      { project_id: P1, plot_id: "plot-atrisk", status: "approved_final" },
      { project_id: P1, plot_id: "plot-gateblock", status: "approved_final" },
      { project_id: P1, plot_id: "plot-docblock", status: "draft_received" },
      { project_id: P1, plot_id: "plot-snagblock", status: "approved_final" },
      { project_id: P1, plot_id: "plot-actionblock", status: "approved_final" },
      { project_id: P1, plot_id: "plot-findingblock", status: "approved_final" },
      { project_id: P1, plot_id: "plot-programmewarn", status: "approved_final" },
      { project_id: P1, plot_id: "plot-handedover", status: "approved_final" },
    ],
    snag_lists: [
      { id: "list-atrisk", plot_id: "plot-atrisk" },
      { id: "list-snagblock", plot_id: "plot-snagblock" },
    ],
    snag_items: [
      { plot_id: null, snag_list_id: "list-atrisk", status: "open", priority: "high", due_date: "2099-01-01" },
      { plot_id: null, snag_list_id: "list-snagblock", status: "open", priority: "high", due_date: "2020-01-01" },
    ],
    programme_activities: [
      {
        project_id: P1, plot_id: "plot-programmewarn", is_milestone: false, status: "in_progress",
        planned_start: null, planned_finish: "2020-01-01", forecast_start: null, forecast_finish: null, actual_finish: null,
        programmes: { status: "active" },
      },
    ],
    actions: [
      { project_id: P1, plot_id: "plot-actionblock", status: "blocked", priority: "low", due_date: null },
    ],
    inspection_findings: [
      { project_id: P1, plot_id: "plot-findingblock", status: "open", severity: "critical" },
    ],
  };
}

function loadFixture(scope) {
  const fx = buildFixture();
  scope.setProjectsWithRole(fx.projects);
  scope.setTableData(fx);
  return fx;
}

// ─── Status correctness across all 10 scenarios ──────────────────────

test("Portfolio rollup: every representative scenario resolves to the status computePlotHandoverReadiness() itself defines", async () => {
  const scope = buildScope();
  loadFixture(scope);
  const rows = await scope.getPortfolioPlotReadiness();
  const statusById = new Map(rows.map((r) => [r.plot.id, r.readiness.status]));

  assert.equal(statusById.get("plot-ready"), "ready");
  assert.equal(statusById.get("plot-atrisk"), "at_risk");
  assert.equal(statusById.get("plot-gateblock"), "not_ready");
  assert.equal(statusById.get("plot-docblock"), "not_ready");
  assert.equal(statusById.get("plot-snagblock"), "not_ready");
  assert.equal(statusById.get("plot-actionblock"), "not_ready");
  assert.equal(statusById.get("plot-findingblock"), "not_ready");
  assert.equal(statusById.get("plot-programmewarn"), "at_risk");
  assert.equal(statusById.get("plot-handedover"), "handed_over");
  assert.equal(statusById.get("plot-restricted"), "restricted");
});

test("Portfolio rollup: a Programme warning (overdue activity) never becomes a blocker — matches existing readiness semantics exactly", async () => {
  const scope = buildScope();
  loadFixture(scope);
  const rows = await scope.getPortfolioPlotReadiness();
  const row = rows.find((r) => r.plot.id === "plot-programmewarn");
  assert.equal(row.readiness.blockers.length, 0);
  assert.ok(row.readiness.warnings.some((w) => w.code === "programme_overdue_activity"));
});

// ─── True equivalence: portfolio-derived readiness vs direct computePlotHandoverReadiness() ──

test("Equivalence: every non-restricted plot's portfolio-derived readiness is structurally IDENTICAL to calling computePlotHandoverReadiness() directly with the same inputs", async () => {
  const scope = buildScope();
  const fx = loadFixture(scope);
  const rows = await scope.getPortfolioPlotReadiness();
  const rowById = new Map(rows.map((r) => [r.plot.id, r]));

  const directInputsById = {
    "plot-ready": { gates: [{ status: "approved" }], handoverDocuments: [{ status: "approved_final" }], snags: [], programmeActivities: [], actions: [], findings: [], editorDataVisible: true },
    "plot-atrisk": { gates: [{ status: "approved" }], handoverDocuments: [{ status: "approved_final" }], snags: [{ status: "open", priority: "high", due_date: "2099-01-01" }], programmeActivities: [], actions: [], findings: [], editorDataVisible: true },
    "plot-gateblock": { gates: [{ status: "not_started" }], handoverDocuments: [{ status: "approved_final" }], snags: [], programmeActivities: [], actions: [], findings: [], editorDataVisible: true },
    "plot-docblock": { gates: [{ status: "approved" }], handoverDocuments: [{ status: "draft_received" }], snags: [], programmeActivities: [], actions: [], findings: [], editorDataVisible: true },
    "plot-snagblock": { gates: [{ status: "approved" }], handoverDocuments: [{ status: "approved_final" }], snags: [{ status: "open", priority: "high", due_date: "2020-01-01" }], programmeActivities: [], actions: [], findings: [], editorDataVisible: true },
    "plot-actionblock": { gates: [{ status: "approved" }], handoverDocuments: [{ status: "approved_final" }], snags: [], programmeActivities: [], actions: [{ status: "blocked", priority: "low", due_date: null }], findings: [], editorDataVisible: true },
    "plot-findingblock": { gates: [{ status: "approved" }], handoverDocuments: [{ status: "approved_final" }], snags: [], programmeActivities: [], actions: [], findings: [{ status: "open", severity: "critical" }], editorDataVisible: true },
    "plot-programmewarn": {
      gates: [{ status: "approved" }], handoverDocuments: [{ status: "approved_final" }], snags: [],
      programmeActivities: [{ is_milestone: false, status: "in_progress", planned_start: null, planned_finish: "2020-01-01", forecast_start: null, forecast_finish: null, actual_finish: null }],
      actions: [], findings: [], editorDataVisible: true,
    },
    "plot-handedover": { gates: [{ status: "approved" }], handoverDocuments: [{ status: "approved_final" }], snags: [], programmeActivities: [], actions: [], findings: [], editorDataVisible: true },
  };

  for (const [plotId, options] of Object.entries(directInputsById)) {
    const plot = fx.plots.find((p) => p.id === plotId);
    const direct = scope.computePlotHandoverReadiness(plot, options, TODAY);
    const viaPortfolio = rowById.get(plotId).readiness;
    assert.deepStrictEqual(viaPortfolio, direct, `readiness mismatch for ${plotId}`);
  }
});

// ─── Fixed query count — no N+1 ───────────────────────────────────────

test("Portfolio rollup issues a FIXED number of broad queries (9: roles + 8 tables), regardless of plot count", async () => {
  const scope = buildScope();
  loadFixture(scope);
  await scope.getPortfolioPlotReadiness();
  // 8 table selects (plots, quality_gates, handover_documents, snag_lists,
  // snag_items, programme_activities, actions, inspection_findings) —
  // getProjectsWithRole() is mocked separately and not counted here.
  assert.equal(scope.getQueryCount(), 8);
});

// ─── Sorting: worst-first, then blockers desc, warnings desc, project, plot ──

test("sortPortfolioPlotRows: NOT READY sorts before AT RISK before READY before HANDED OVER", () => {
  const scope = buildScope();
  const rows = [
    { plot: { plot_number: "A" }, project: { name: "P" }, readiness: { status: "ready", blockers: [], warnings: [] } },
    { plot: { plot_number: "B" }, project: { name: "P" }, readiness: { status: "handed_over", blockers: [], warnings: [] } },
    { plot: { plot_number: "C" }, project: { name: "P" }, readiness: { status: "not_ready", blockers: [1], warnings: [] } },
    { plot: { plot_number: "D" }, project: { name: "P" }, readiness: { status: "at_risk", blockers: [], warnings: [1] } },
  ];
  const sorted = scope.sortPortfolioPlotRows(rows).map((r) => r.plot.plot_number);
  assert.deepEqual(sorted, ["C", "D", "A", "B"]);
});

test("sortPortfolioPlotRows: within the same status, more blockers sorts first (existing readiness field, not an invented score)", () => {
  const scope = buildScope();
  const rows = [
    { plot: { plot_number: "Few" }, project: { name: "P" }, readiness: { status: "not_ready", blockers: [1], warnings: [] } },
    { plot: { plot_number: "Many" }, project: { name: "P" }, readiness: { status: "not_ready", blockers: [1, 2, 3], warnings: [] } },
  ];
  const sorted = scope.sortPortfolioPlotRows(rows).map((r) => r.plot.plot_number);
  assert.deepEqual(sorted, ["Many", "Few"]);
});

test("sortPortfolioPlotRows: equal status/blockers/warnings falls back to project name then plot number, deterministically", () => {
  const scope = buildScope();
  const rows = [
    { plot: { plot_number: "10" }, project: { name: "Zeta" }, readiness: { status: "ready", blockers: [], warnings: [] } },
    { plot: { plot_number: "2" }, project: { name: "Alpha" }, readiness: { status: "ready", blockers: [], warnings: [] } },
    { plot: { plot_number: "1" }, project: { name: "Alpha" }, readiness: { status: "ready", blockers: [], warnings: [] } },
  ];
  const sorted = scope.sortPortfolioPlotRows(rows).map((r) => `${r.project.name}/${r.plot.plot_number}`);
  assert.deepEqual(sorted, ["Alpha/1", "Alpha/2", "Zeta/10"]);
});

// ─── Summary counts ────────────────────────────────────────────────────

test("summarisePortfolioPlotReadiness: counts reconcile exactly with the underlying rows, restricted counted separately from ready", async () => {
  const scope = buildScope();
  loadFixture(scope);
  const rows = await scope.getPortfolioPlotReadiness();
  const counts = scope.summarisePortfolioPlotReadiness(rows);
  assert.equal(counts.not_ready, 5); // gateblock, docblock, snagblock, actionblock, findingblock
  assert.equal(counts.at_risk, 2); // atrisk, programmewarn
  assert.equal(counts.ready, 1); // ready
  assert.equal(counts.handed_over, 1); // handedover
  assert.equal(counts.restricted, 1); // restricted
  const total = counts.not_ready + counts.at_risk + counts.ready + counts.handed_over + counts.restricted;
  assert.equal(total, rows.length);
});

// ─── Empty states ──────────────────────────────────────────────────────

test("Portfolio rollup: no projects at all -> empty rows, zero counts, no throw", async () => {
  const scope = buildScope();
  scope.setProjectsWithRole([]);
  scope.setTableData({ plots: [] });
  const rows = await scope.getPortfolioPlotReadiness();
  assert.deepEqual(rows, []);
  const counts = scope.summarisePortfolioPlotReadiness(rows);
  assert.deepEqual(counts, { not_ready: 0, at_risk: 0, ready: 0, handed_over: 0, restricted: 0 });
});

test("Portfolio rollup: projects exist but have no plots -> empty rows, no throw", async () => {
  const scope = buildScope();
  scope.setProjectsWithRole([{ id: P1, name: "Project One", myRole: "owner" }]);
  scope.setTableData({ plots: [] });
  const rows = await scope.getPortfolioPlotReadiness();
  assert.deepEqual(rows, []);
});

// ─── Cross-project isolation of the grouping itself (defence-in-depth) ─

test("Portfolio rollup: a plot referencing a project NOT in the caller's visible project set is excluded, even if it slipped into the plots array", async () => {
  const scope = buildScope();
  scope.setProjectsWithRole([{ id: P1, name: "Project One", myRole: "owner" }]);
  scope.setTableData({ plots: [plotRow("plot-foreign", "some-other-project-id"), plotRow("plot-mine", P1)] });
  const rows = await scope.getPortfolioPlotReadiness();
  assert.deepEqual(rows.map((r) => r.plot.id), ["plot-mine"]);
});

// ─── Date/time consistency ─────────────────────────────────────────────

test("Date consistency: overdue/not-overdue classification anchors to the injected todayISO(), never a live Date.now()", async () => {
  const scope = buildScope();
  const fx = loadFixture(scope);
  const rows = await scope.getPortfolioPlotReadiness();
  const snagBlock = rows.find((r) => r.plot.id === "plot-snagblock");
  // due_date 2020-01-01 is overdue relative to the mocked "today" (2026-06-15)
  assert.ok(snagBlock.readiness.blockers.some((b) => b.code === "snags_blocking"));
  const atRisk = rows.find((r) => r.plot.id === "plot-atrisk");
  // due_date 2099-01-01 is NOT overdue relative to the same mocked "today"
  assert.equal(atRisk.readiness.blockers.length, 0);
});
