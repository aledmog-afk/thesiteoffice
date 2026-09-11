// Project Control Dashboard: Programme totals bar (Priority 11,
// Phase 4) — dashboard.html's portfolio totals bar and project.html's
// per-project totals bar, both real inline scripts under jsdom,
// proving the two new cards (Overdue Programme, Programme Forecast
// Late) render from getPortfolioControlSummary()/
// getProjectControlSummary()'s real counts shape — no new dashboard
// page, just two more boxes in the existing bar.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

function permissiveFrom() {
  const api = {
    select() { return api; },
    eq() { return api; },
    order() { return api; },
    single: async () => ({ data: { name: "Test Site" }, error: null }),
    then(resolve) { resolve({ data: [], error: null }); },
  };
  return api;
}

// ─── dashboard.html ─────────────────────────────────────────────────

const DASHBOARD_HTML = new URL("../../tracker/dashboard.html", import.meta.url).pathname;

async function runDashboard(controlSummary) {
  return runPage(DASHBOARD_HTML, extractScript(DASHBOARD_HTML), {
    __url: "https://example.com/dashboard.html",
    supabase: { auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) }, rpc: () => Promise.resolve({ data: null, error: null }), from: permissiveFrom },
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); },
    clearError: (el) => { el.textContent = ""; },
    RAG_LABEL: { red: "Red", amber: "Amber", green: "Green" },
    renderProgressBlock: () => "",
    ensureOrganisation: async () => "org-1",
    getPortfolioControlSummary: async () => controlSummary,
    getAttentionActions: async () => [],
    getMemberEmailMap: async () => ({}),
    CONTROL_LEVEL_BADGE: { attention: "badge-red", watch: "badge-amber", on_track: "badge-green", restricted: "badge-grey" },
    ACTION_PRIORITY_LABEL: {}, ACTION_PRIORITY_BADGE: {}, ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {}, ACTION_DUE_LABEL: {}, ACTION_DUE_BADGE: {},
  });
}

function zeroTotals(overrides = {}) {
  return { openActions: 0, overdue: 0, dueToday: 0, blocked: 0, highCritical: 0, overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0, ...overrides };
}

test("dashboard.html: the portfolio totals bar shows 'Overdue Programme' and 'Programme Forecast Late', summed correctly across activities and milestones", async () => {
  const { document } = await runDashboard({
    rows: [],
    totals: zeroTotals({ overdueProgrammeActivities: 2, overdueProgrammeMilestones: 1, materialForecastLateProgrammeActivities: 1, forecastLateProgrammeMilestones: 1 }),
    projectsRequiringAttention: 0,
  });
  await wait(30);
  const text = document.getElementById("totalsBar").textContent.replace(/\s+/g, " ").trim();
  assert.match(text, /Overdue Programme 3/, "2 activities + 1 milestone = 3");
  assert.match(text, /Programme Forecast Late 2/, "1 material activity + 1 milestone = 2");
});

test("dashboard.html: zero programme exceptions still renders the cards, showing 0 rather than omitting them", async () => {
  const { document } = await runDashboard({ rows: [], totals: zeroTotals(), projectsRequiringAttention: 0 });
  await wait(30);
  const text = document.getElementById("totalsBar").textContent.replace(/\s+/g, " ").trim();
  assert.match(text, /Overdue Programme 0/);
  assert.match(text, /Programme Forecast Late 0/);
});

// ─── project.html ───────────────────────────────────────────────────

const PROJECT_HTML = new URL("../../tracker/project.html", import.meta.url).pathname;

function progCounts(overrides = {}) {
  return {
    openActions: 0, overdue: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0,
    overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0,
    ...overrides,
  };
}

async function runProjectPage({ counts, plotReadinessRows = [] }) {
  return runPage(PROJECT_HTML, extractScript(PROJECT_HTML), {
    __url: "https://example.com/project.html?id=p1",
    supabase: { from: permissiveFrom, rpc: () => Promise.resolve({ data: [], error: null }), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } },
    getParam: () => "p1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); },
    clearError: (el) => { el.textContent = ""; },
    RAG_LABEL: { red: "Red", amber: "Amber", green: "Green" },
    renderProgressBlock: () => "",
    getProjectControlSummary: async () => ({ actions: [], counts, status: { level: "attention", label: "Attention", reason: "test" } }),
    getAttentionActions: async () => [],
    getMemberEmailMap: async () => ({}),
    getProjectPlotReadiness: async () => plotReadinessRows,
    CONTROL_LEVEL_BADGE: { attention: "badge-red", watch: "badge-amber", on_track: "badge-green" },
    ACTION_PRIORITY_LABEL: {}, ACTION_PRIORITY_BADGE: {}, ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {}, ACTION_DUE_LABEL: {}, ACTION_DUE_BADGE: {},
    // Unrelated to the control summary card under test, but referenced
    // elsewhere in project.html's own script — must exist in scope or
    // the page's top-level execution throws before reaching the code
    // this test actually exercises.
    geocodePostcode: async () => null,
    recalculateActualProgress: async () => {},
    generateMissingPlots: async () => {},
    suggestPlotProgress: () => null,
    EXTERNAL_WORKS_TAG: "external-works",
    monthStartISO: () => "2026-06-01",
    isFindingOutstanding: () => false,
    categoriseSnag: () => ({ overdue: false, dueToday: false, dueSoon: false, highPriority: false }),
  });
}

test("project.html: the per-project totals bar shows 'Overdue Programme' and 'Programme Forecast Late', summed correctly", async () => {
  const { document } = await runProjectPage({
    counts: progCounts({ overdueProgrammeActivities: 1, overdueProgrammeMilestones: 2, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 3 }),
  });
  await wait(30);
  const text = document.getElementById("controlTotalsBar").textContent.replace(/\s+/g, " ").trim();
  assert.match(text, /Overdue Programme 3/, "1 activity + 2 milestones = 3");
  assert.match(text, /Programme Forecast Late 3/, "0 material activities + 3 milestones = 3");
});

test("project.html: the totals bar shows 'Plots Not Ready' and 'Plots At Risk', derived from getProjectPlotReadiness() (Priority 12, Phase 1) — informational only, never blocking the rest of the card", async () => {
  const rows = [
    { plot: { id: "pl1" }, readiness: { status: "not_ready" } },
    { plot: { id: "pl2" }, readiness: { status: "not_ready" } },
    { plot: { id: "pl3" }, readiness: { status: "at_risk" } },
    { plot: { id: "pl4" }, readiness: { status: "ready" } },
    { plot: { id: "pl5" }, readiness: { status: "handed_over" } },
  ];
  const { document } = await runProjectPage({ counts: progCounts(), plotReadinessRows: rows });
  await wait(30);
  const text = document.getElementById("controlTotalsBar").textContent.replace(/\s+/g, " ").trim();
  assert.match(text, /Plots Not Ready 2/);
  assert.match(text, /Plots At Risk 1/);
});

test("project.html: a failed plot-readiness fetch degrades gracefully — the rest of the control card still renders with the two new cards reading 0", async () => {
  const supabase = { from: permissiveFrom, rpc: () => Promise.resolve({ data: [], error: null }), auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } };
  const { document } = await runPage(PROJECT_HTML, extractScript(PROJECT_HTML), {
    __url: "https://example.com/project.html?id=p1",
    supabase,
    getParam: () => "p1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); },
    clearError: (el) => { el.textContent = ""; },
    RAG_LABEL: { red: "Red", amber: "Amber", green: "Green" },
    renderProgressBlock: () => "",
    getProjectControlSummary: async () => ({ actions: [], counts: progCounts(), status: { level: "on_track", label: "On Track", reason: "test" } }),
    getAttentionActions: async () => [],
    getMemberEmailMap: async () => ({}),
    getProjectPlotReadiness: async () => { throw new Error("down"); },
    CONTROL_LEVEL_BADGE: { attention: "badge-red", watch: "badge-amber", on_track: "badge-green" },
    ACTION_PRIORITY_LABEL: {}, ACTION_PRIORITY_BADGE: {}, ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {}, ACTION_DUE_LABEL: {}, ACTION_DUE_BADGE: {},
    geocodePostcode: async () => null,
    recalculateActualProgress: async () => {},
    generateMissingPlots: async () => {},
    suggestPlotProgress: () => null,
    EXTERNAL_WORKS_TAG: "external-works",
    monthStartISO: () => "2026-06-01",
    isFindingOutstanding: () => false,
    categoriseSnag: () => ({ overdue: false, dueToday: false, dueSoon: false, highPriority: false }),
  });
  await wait(30);
  const text = document.getElementById("controlTotalsBar").textContent.replace(/\s+/g, " ").trim();
  assert.match(text, /Plots Not Ready 0/);
  assert.match(text, /Plots At Risk 0/);
});
