// Plot Control / Handover Readiness (Priority 12, Phase 1) — the
// PAGE-level wiring on plot-detail.html and plot-handovers.html. Real
// inline scripts under jsdom, following the same conventions as
// programme_workflow.test.mjs. getPlotHandoverReadiness()/
// getProjectPlotReadiness() are mocked here with canned readiness
// objects — the pure computePlotHandoverReadiness() logic itself is
// exercised for real in plot_handover_readiness.test.mjs, and the real
// RLS/query-shape isolation in tests/security/plot_handover_readiness.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const PLOT_DETAIL_HTML = new URL("../../tracker/plot-detail.html", import.meta.url).pathname;
const PLOT_HANDOVERS_HTML = new URL("../../tracker/plot-handovers.html", import.meta.url).pathname;

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const PLOT_READINESS_LABEL = extractConst("PLOT_READINESS_LABEL");
const PLOT_READINESS_BADGE = extractConst("PLOT_READINESS_BADGE");
const PLOT_READINESS_ORDER = extractConst("PLOT_READINESS_ORDER");

function escapeHtml(str) { return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function formatDate(d) { return d || ""; }
function showError(el, err) { el.textContent = err?.message || String(err); }
function clearError(el) { el.textContent = ""; }
function comparePlotNumbers(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true }); }

function readiness(overrides = {}) {
  return {
    status: "ready", asOfDate: "2026-06-15", editorDataVisible: true, handedOverAt: null,
    programme: { hasActivities: false, total: 0, overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, forecastLateProgrammeActivities: 0, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0, completedLateProgrammeActivities: 0, upcomingProgrammeActivities: 0 },
    snags: { total: 0, open: 0, blocking: 0, warning: 0 },
    actions: { total: 0, open: 0, blocking: 0, warning: 0 },
    findings: { total: 0, open: 0, blocking: 0, warning: 0 },
    qualityGates: { total: 4, approved: 4, outstanding: 0 },
    handoverDocuments: { total: 5, approved: 5, outstanding: 0 },
    blockers: [], warnings: [],
    ...overrides,
  };
}

const SAMPLE_PLOT = { id: "plot1", project_id: "p1", plot_number: "Plot 5", block_id: null, progress_pct: 40, handed_over_at: null, projects: { id: "p1", name: "Test Site" }, blocks: null };

function plotDetailSupabaseMock({ snagListId = "list1" } = {}) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        single: async () => (table === "plots" ? { data: SAMPLE_PLOT, error: null } : { data: null, error: null }),
        maybeSingle: async () => (table === "snag_lists" ? { data: { id: snagListId }, error: null } : { data: null, error: null }),
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runPlotDetail({ readinessResult = readiness(), getPlotHandoverReadinessImpl } = {}) {
  const supabase = plotDetailSupabaseMock();
  return runPage(PLOT_DETAIL_HTML, extractScript(PLOT_DETAIL_HTML), {
    __url: "https://example.com/plot-detail.html?id=plot1",
    supabase,
    getParam: () => "plot1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml, showError, clearError,
    uploadImage: async () => "https://example.com/file.pdf",
    suggestPlotProgress: async () => 50,
    recalculateActualProgress: async () => {},
    checkAndMarkPlotHandedOver: async () => false,
    getPlotHandoverReadiness: getPlotHandoverReadinessImpl || (async () => ({ plot: SAMPLE_PLOT, readiness: readinessResult })),
    PLOT_READINESS_LABEL, PLOT_READINESS_BADGE,
  });
}

test("plot-detail.html: a Ready plot shows the Ready badge and no blockers/warnings", async () => {
  const { document } = await runPlotDetail({ readinessResult: readiness({ status: "ready" }) });
  await wait(40);
  const wrap = document.getElementById("plotControlWrap");
  assert.match(wrap.innerHTML, /System Handover Readiness/);
  assert.match(wrap.innerHTML, /Ready/);
  assert.doesNotMatch(wrap.innerHTML, /Blockers/);
  assert.doesNotMatch(wrap.innerHTML, /Warnings/);
});

test("plot-detail.html: a Not Ready plot shows its blockers, each as a distinct reason", async () => {
  const r = readiness({
    status: "not_ready",
    qualityGates: { total: 4, approved: 3, outstanding: 1 },
    blockers: [
      { code: "gates_outstanding", label: "1 of 4 Quality Gates not yet approved" },
      { code: "snags_blocking", label: "1 open high-priority snag overdue" },
    ],
  });
  const { document } = await runPlotDetail({ readinessResult: r });
  await wait(40);
  const wrap = document.getElementById("plotControlWrap");
  assert.match(wrap.innerHTML, /Not Ready/);
  assert.match(wrap.innerHTML, /Blockers/);
  assert.match(wrap.innerHTML, /Quality Gates not yet approved/);
  assert.match(wrap.innerHTML, /open high-priority snag overdue/);
  assert.equal(wrap.querySelectorAll("li").length, 2);
});

test("plot-detail.html: a gates_outstanding blocker links to the on-page #gatesSection anchor, not an external page", async () => {
  const r = readiness({ status: "not_ready", blockers: [{ code: "gates_outstanding", label: "Outstanding gate" }] });
  const { document } = await runPlotDetail({ readinessResult: r });
  await wait(40);
  const link = document.querySelector('#plotControlWrap a[href="#gatesSection"]');
  assert.ok(link, "expected a same-page anchor link for a gates_outstanding blocker");
});

test("plot-detail.html: an At Risk plot shows its warnings, distinct from blockers", async () => {
  const r = readiness({
    status: "at_risk",
    warnings: [{ code: "programme_forecast_late_milestone", label: "1 programme milestone forecast late" }],
  });
  const { document } = await runPlotDetail({ readinessResult: r });
  await wait(40);
  const wrap = document.getElementById("plotControlWrap");
  assert.match(wrap.innerHTML, /At Risk/);
  assert.match(wrap.innerHTML, /Warnings/);
  assert.match(wrap.innerHTML, /programme milestone forecast late/);
  assert.doesNotMatch(wrap.innerHTML, /Blockers/);
});

test("plot-detail.html: a Restricted (snagging-only) position shows the explanatory note, not a false Ready/Not Ready", async () => {
  const r = readiness({ status: "restricted", editorDataVisible: false, qualityGates: { total: 0, approved: 0, outstanding: 0 }, handoverDocuments: { total: 0, approved: 0, outstanding: 0 } });
  const { document } = await runPlotDetail({ readinessResult: r });
  await wait(40);
  const wrap = document.getElementById("plotControlWrap");
  assert.match(wrap.innerHTML, /Restricted/);
  assert.match(wrap.innerHTML, /aren't visible at your access level/);
});

test("plot-detail.html: a Handed Over plot with residual items shows the 'raised since handover' note", async () => {
  const r = readiness({ status: "handed_over", handedOverAt: "2026-01-01T00:00:00Z", blockers: [{ code: "snags_blocking", label: "1 open high-priority snag overdue" }] });
  const { document } = await runPlotDetail({ readinessResult: r });
  await wait(40);
  const wrap = document.getElementById("plotControlWrap");
  assert.match(wrap.innerHTML, /Handed Over/);
  assert.match(wrap.innerHTML, /raised since this plot was marked handed over/);
});

test("plot-detail.html: a failed readiness fetch shows an error, not a silent blank/false-Ready section", async () => {
  const { document } = await runPlotDetail({ getPlotHandoverReadinessImpl: async () => { throw new Error("network down"); } });
  await wait(40);
  const wrap = document.getElementById("plotControlWrap");
  assert.match(wrap.innerHTML, /Couldn't load plot control position/);
  assert.match(wrap.innerHTML, /network down/);
});

// ─── plot-handovers.html ─────────────────────────────────────────

function plotHandoversSupabaseMock({ plots = [], blocks = [] } = {}) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        then(resolve) {
          if (table === "plots") return resolve({ data: plots, error: null });
          if (table === "blocks") return resolve({ data: blocks, error: null });
          resolve({ data: [], error: null });
        },
        single: async () => (table === "projects" ? { data: { name: "Test Site" }, error: null } : { data: null, error: null }),
      };
      return api;
    },
  };
}

function plotRow(overrides = {}) { return { id: `p${Math.random()}`, project_id: "p1", plot_number: "1", block_id: null, progress_pct: 50, created_at: "2026-01-01T00:00:00Z", ...overrides }; }

async function runPlotHandovers({ plots, readinessRows }) {
  const supabase = plotHandoversSupabaseMock({ plots });
  return runPage(PLOT_HANDOVERS_HTML, extractScript(PLOT_HANDOVERS_HTML), {
    __url: "https://example.com/plot-handovers.html?project=p1",
    supabase,
    getParam: () => "p1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml, formatDate, comparePlotNumbers,
    generateFlatsFromSpec: async () => {},
    getProjectPlotReadiness: async () => readinessRows,
    PLOT_READINESS_LABEL, PLOT_READINESS_BADGE, PLOT_READINESS_ORDER,
  });
}

test("plot-handovers.html: renders a Readiness column with the right label per plot", async () => {
  const plots = [plotRow({ id: "pA", plot_number: "1" }), plotRow({ id: "pB", plot_number: "2" })];
  const readinessRows = [
    { plot: plots[0], readiness: readiness({ status: "not_ready", blockers: [{ code: "gates_outstanding", label: "x" }] }) },
    { plot: plots[1], readiness: readiness({ status: "ready" }) },
  ];
  const { document } = await runPlotHandovers({ plots, readinessRows });
  await wait(40);
  const rows = [...document.querySelectorAll("#plotRows tr")];
  assert.equal(rows.length, 2);
  // Worst-first sort: Not Ready (Plot 1) must render before Ready (Plot 2).
  assert.match(rows[0].textContent, /Not Ready/);
  assert.match(rows[1].textContent, /Ready/);
});

test("plot-handovers.html: the readiness filter buttons narrow the visible rows", async () => {
  const plots = [plotRow({ id: "pA", plot_number: "1" }), plotRow({ id: "pB", plot_number: "2" }), plotRow({ id: "pC", plot_number: "3" })];
  const readinessRows = [
    { plot: plots[0], readiness: readiness({ status: "not_ready", blockers: [{ code: "x", label: "x" }] }) },
    { plot: plots[1], readiness: readiness({ status: "at_risk", warnings: [{ code: "x", label: "x" }] }) },
    { plot: plots[2], readiness: readiness({ status: "ready" }) },
  ];
  const { document } = await runPlotHandovers({ plots, readinessRows });
  await wait(40);
  assert.equal(document.querySelectorAll("#plotRows tr").length, 3);

  fireEvent(document.querySelector('[data-readiness-filter="not_ready"]'), "click");
  await wait(20);
  const filtered = [...document.querySelectorAll("#plotRows tr")];
  assert.equal(filtered.length, 1);
  assert.match(filtered[0].textContent, /Not Ready/);
});

test("plot-handovers.html: the readiness filter row is hidden when there are no plots, and shown once plots exist", async () => {
  const { document: empty } = await runPlotHandovers({ plots: [], readinessRows: [] });
  await wait(40);
  assert.equal(empty.getElementById("readinessFilterWrap").style.display, "none");

  const plots = [plotRow()];
  const { document: withPlots } = await runPlotHandovers({ plots, readinessRows: [{ plot: plots[0], readiness: readiness() }] });
  await wait(40);
  assert.equal(withPlots.getElementById("readinessFilterWrap").style.display, "flex");
});

test("plot-handovers.html: a failed readiness fetch degrades gracefully — the page still renders plots with existing gate/document columns, just without the new readiness column populated", async () => {
  const plots = [plotRow()];
  const supabase = plotHandoversSupabaseMock({ plots });
  const { document } = await runPage(PLOT_HANDOVERS_HTML, extractScript(PLOT_HANDOVERS_HTML), {
    __url: "https://example.com/plot-handovers.html?project=p1",
    supabase,
    getParam: () => "p1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml, formatDate, comparePlotNumbers,
    generateFlatsFromSpec: async () => {},
    getProjectPlotReadiness: async () => { throw new Error("down"); },
    PLOT_READINESS_LABEL, PLOT_READINESS_BADGE, PLOT_READINESS_ORDER,
  });
  await wait(40);
  const rows = [...document.querySelectorAll("#plotRows tr")];
  assert.equal(rows.length, 1, "the plot itself must still render even though readiness failed");
});
