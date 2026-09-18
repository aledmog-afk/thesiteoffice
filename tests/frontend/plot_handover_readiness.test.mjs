// Plot Control / Handover Readiness (Priority 12, Phase 1) —
// computePlotHandoverReadiness(), exercised against the REAL app.js
// source (regex-extracted, never reimplemented). Reuses
// countProgrammeSignals()/categoriseSnag() exactly — this is NOT a
// second definition of programme or snag health, only a plot-scoped
// connection of data that already exists.
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

// "today" is deliberately poisoned to a date far in the future/unused
// — every test proves the calculation is anchored to the explicit
// asOfDate argument, never this default.
const SCOPE = `
  function todayISO() { return "2099-01-01"; }
  ${extractConstSrc("DUE_SOON_DAYS")}
  ${extractConstSrc("PROGRAMME_MATERIAL_DELAY_DAYS")}
  ${extractPrivateFn("diffCalendarDays")}
  ${extractFn("categoriseProgrammeActivity")}
  ${extractFn("countProgrammeSignals")}
  ${extractFn("isSnagOutstanding")}
  ${extractFn("categoriseSnag")}
  ${extractFn("summarisePlotGates")}
  ${extractFn("summarisePlotDocuments")}
  ${extractFn("computePlotHandoverReadiness")}
  return { computePlotHandoverReadiness, summarisePlotGates, summarisePlotDocuments };
`;
const { computePlotHandoverReadiness, summarisePlotGates, summarisePlotDocuments } = new Function(SCOPE)();

function plot(overrides = {}) { return { id: "p1", handed_over_at: null, ...overrides }; }
function gate(status) { return { status }; }
function doc(status) { return { status }; }
function snag(overrides = {}) { return { id: `s${Math.random()}`, status: "open", priority: "medium", due_date: null, ...overrides }; }
function act(overrides = {}) {
  return { title: "Activity", is_milestone: false, status: "in_progress", planned_start: null, planned_finish: null, forecast_start: null, forecast_finish: null, actual_finish: null, ...overrides };
}
const ALL_CLEAR = { gates: [gate("approved"), gate("not_applicable")], handoverDocuments: [doc("approved_final")] };
const ASOF = "2026-06-15";

// ─── Status: Ready ──────────────────────────────────────────────────

test("Ready: all gates approved/N-A, all documents approved_final, no snags, no programme", () => {
  const r = computePlotHandoverReadiness(plot(), ALL_CLEAR, ASOF);
  assert.equal(r.status, "ready");
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.warnings, []);
});

test("Ready: zero-data plot (no gates, no documents, no snags, no programme) is Ready, not Not Ready", () => {
  const r = computePlotHandoverReadiness(plot(), {}, ASOF);
  assert.equal(r.status, "ready");
  assert.equal(r.qualityGates.total, 0);
  assert.equal(r.handoverDocuments.total, 0);
  assert.deepEqual(r.blockers, []);
  assert.deepEqual(r.warnings, []);
});

// ─── Status: Not Ready (hard blockers) ─────────────────────────────

test("Not Ready: an outstanding (not_started) Quality Gate is a hard blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { gates: [gate("approved"), gate("not_started")], handoverDocuments: [doc("approved_final")] }, ASOF);
  assert.equal(r.status, "not_ready");
  assert.ok(r.blockers.some((b) => b.code === "gates_outstanding"));
});

test("Not Ready: an outstanding (in_progress/under_review) Quality Gate is a hard blocker", () => {
  const r1 = computePlotHandoverReadiness(plot(), { gates: [gate("in_progress")], handoverDocuments: [] }, ASOF);
  assert.equal(r1.status, "not_ready");
  const r2 = computePlotHandoverReadiness(plot(), { gates: [gate("under_review")], handoverDocuments: [] }, ASOF);
  assert.equal(r2.status, "not_ready");
});

test("Not Ready: an outstanding (missing/draft_received) Handover Document is a hard blocker", () => {
  const r1 = computePlotHandoverReadiness(plot(), { gates: [], handoverDocuments: [doc("missing")] }, ASOF);
  assert.equal(r1.status, "not_ready");
  assert.ok(r1.blockers.some((b) => b.code === "documents_outstanding"));
  const r2 = computePlotHandoverReadiness(plot(), { gates: [], handoverDocuments: [doc("draft_received")] }, ASOF);
  assert.equal(r2.status, "not_ready");
});

test("Not Ready: an open, high-priority, OVERDUE snag is a hard blocker (the nearest data-model-supported equivalent to 'critical')", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, snags: [snag({ priority: "high", due_date: "2026-06-01" })] }, ASOF);
  assert.equal(r.status, "not_ready");
  assert.ok(r.blockers.some((b) => b.code === "snags_blocking"));
  assert.equal(r.snags.blocking, 1);
});

test("Not Ready: multiple blockers are all reported, not just the first", () => {
  const r = computePlotHandoverReadiness(plot(), {
    gates: [gate("in_progress")], handoverDocuments: [doc("missing")],
    snags: [snag({ priority: "high", due_date: "2026-06-01" })],
  }, ASOF);
  assert.equal(r.status, "not_ready");
  assert.equal(r.blockers.length, 3);
});

// ─── Status: At Risk (warnings only) ───────────────────────────────

test("At Risk: an open high-priority snag that is NOT overdue is a warning, not a blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, snags: [snag({ priority: "high", due_date: "2026-07-01" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.equal(r.blockers.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "snags_warning"));
});

test("At Risk: an overdue snag that is NOT high-priority is a warning, not a blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, snags: [snag({ priority: "medium", due_date: "2026-06-01" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.equal(r.blockers.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "snags_warning"));
});

test("At Risk: a forecast-late (material) programme activity for this plot is a warning", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, programmeActivities: [act({ planned_finish: "2026-07-01", forecast_finish: "2026-07-20" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.ok(r.warnings.some((w) => w.code === "programme_forecast_late_activity"));
});

test("At Risk: a forecast-late programme MILESTONE (any slip, zero tolerance) is a warning", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, programmeActivities: [act({ is_milestone: true, planned_finish: "2026-07-01", forecast_finish: "2026-07-02" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.ok(r.warnings.some((w) => w.code === "programme_forecast_late_milestone"));
});

test("At Risk: an overdue programme activity for this plot is a warning, never a blocker (programme is never a hard blocker in this phase)", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, programmeActivities: [act({ planned_finish: "2026-06-01" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.equal(r.blockers.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "programme_overdue_activity"));
});

test("At Risk: an overdue programme milestone for this plot is a warning, never a blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, programmeActivities: [act({ is_milestone: true, planned_finish: "2026-06-01" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.equal(r.blockers.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "programme_overdue_milestone"));
});

test("At Risk: 'approaching handover with unresolved items' only appears when something is ALREADY outstanding", () => {
  const upcoming = act({ status: "not_started", planned_start: "2026-06-18", planned_finish: "2026-07-01", forecast_finish: "2026-07-01" });
  // Nothing else outstanding — the plot is on schedule, not at risk.
  const clean = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, programmeActivities: [upcoming] }, ASOF);
  assert.equal(clean.status, "ready");
  assert.ok(!clean.warnings.some((w) => w.code === "approaching_with_unresolved"));

  // Something else IS outstanding (a warning snag) — now it should appear.
  const withWarning = computePlotHandoverReadiness(plot(), {
    ...ALL_CLEAR, programmeActivities: [upcoming], snags: [snag({ priority: "high", due_date: "2026-07-01" })],
  }, ASOF);
  assert.equal(withWarning.status, "at_risk");
  assert.ok(withWarning.warnings.some((w) => w.code === "approaching_with_unresolved"));
});

// ─── Historical completed-late must never affect status ────────────

test("A historical completed-late programme activity never makes a currently healthy plot Not Ready or At Risk", () => {
  const r = computePlotHandoverReadiness(plot(), {
    ...ALL_CLEAR,
    programmeActivities: [act({ status: "complete", planned_finish: "2026-05-01", actual_finish: "2026-05-20" })],
  }, ASOF);
  assert.equal(r.status, "ready");
  assert.equal(r.blockers.length, 0);
  assert.equal(r.warnings.length, 0);
  assert.equal(r.programme.completedLateProgrammeActivities, 1, "still exposed informationally");
});

test("A cancelled programme activity carries no variance judgement and never affects status", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, programmeActivities: [act({ status: "cancelled", planned_finish: "2026-01-01" })] }, ASOF);
  assert.equal(r.status, "ready");
});

// ─── Status: Handed Over ────────────────────────────────────────────

test("Handed Over: plots.handed_over_at wins regardless of what else is outstanding", () => {
  const r = computePlotHandoverReadiness(plot({ handed_over_at: "2026-01-01T00:00:00Z" }), {
    gates: [gate("not_started")], handoverDocuments: [doc("missing")],
    snags: [snag({ priority: "high", due_date: "2026-06-01" })],
  }, ASOF);
  assert.equal(r.status, "handed_over");
  // Blockers/warnings are still computed and exposed for transparency
  // — a plot can regress after handover and that should remain visible
  // even though the STATUS itself stays "handed_over".
  assert.ok(r.blockers.length > 0);
});

test("Handed Over: a clean plot with handed_over_at set reports no blockers/warnings", () => {
  const r = computePlotHandoverReadiness(plot({ handed_over_at: "2026-01-01T00:00:00Z" }), ALL_CLEAR, ASOF);
  assert.equal(r.status, "handed_over");
  assert.equal(r.blockers.length, 0);
  assert.equal(r.warnings.length, 0);
});

// ─── Status: Restricted (snagging-only) ─────────────────────────────

test("Restricted: a snagging-only caller (editorDataVisible: false) never gets Ready/Not Ready/At Risk from invisible data", () => {
  const r = computePlotHandoverReadiness(plot(), { editorDataVisible: false, gates: [], handoverDocuments: [], programmeActivities: [] }, ASOF);
  assert.equal(r.status, "restricted");
});

test("Restricted: snag-based blockers/warnings are STILL computed for a snagging-only caller (snags are member-level readable)", () => {
  const r = computePlotHandoverReadiness(plot(), { editorDataVisible: false, snags: [snag({ priority: "high", due_date: "2026-06-01" })] }, ASOF);
  assert.equal(r.status, "restricted");
  assert.equal(r.snags.blocking, 1, "the underlying snag data is still real and visible even though the overall status is restricted");
});

test("Restricted: gate/document/programme data supplied is IGNORED for status purposes when editorDataVisible is false (it would be empty in practice, but the function must not trust it either way)", () => {
  // Even if (hypothetically) non-empty gate data were passed alongside
  // editorDataVisible:false, it must never be used to compute blockers —
  // the whole point of the flag is "this data cannot be trusted as
  // complete for this caller".
  const r = computePlotHandoverReadiness(plot(), { editorDataVisible: false, gates: [gate("not_started")] }, ASOF);
  assert.equal(r.status, "restricted");
  assert.equal(r.blockers.length, 0, "gate data must not silently leak into a restricted caller's blockers");
});

// ─── Combinations ───────────────────────────────────────────────────

test("Combination: a blocker and several warnings together still resolve to Not Ready (blockers always win over warnings)", () => {
  const r = computePlotHandoverReadiness(plot(), {
    gates: [gate("not_started")], handoverDocuments: [doc("approved_final")],
    snags: [snag({ priority: "high", due_date: "2026-07-01" })],
    programmeActivities: [act({ is_milestone: true, planned_finish: "2026-07-01", forecast_finish: "2026-07-02" })],
  }, ASOF);
  assert.equal(r.status, "not_ready");
  assert.equal(r.blockers.length, 1);
  assert.ok(r.warnings.length >= 2);
});

// ─── summarisePlotGates / summarisePlotDocuments ────────────────────

test("summarisePlotGates: not_applicable counts as ready, matching checkAndMarkPlotHandedOver()'s own established rule exactly", () => {
  const s = summarisePlotGates([gate("approved"), gate("not_applicable"), gate("not_started")]);
  assert.deepEqual(s, { total: 3, approved: 2, outstanding: 1 });
});

test("summarisePlotDocuments: only approved_final counts as ready", () => {
  const s = summarisePlotDocuments([doc("approved_final"), doc("draft_received"), doc("missing")]);
  assert.deepEqual(s, { total: 3, approved: 1, outstanding: 2 });
});

// ─── Date / timezone boundaries ─────────────────────────────────────

test("Date boundary: a snag due exactly today is NOT yet overdue (categoriseSnag's own '<' comparison)", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, snags: [snag({ priority: "high", due_date: ASOF })] }, ASOF);
  assert.equal(r.status, "at_risk", "due today, not overdue — a warning, not yet a blocker");
});

test("Date boundary: a plot-tagged activity due tomorrow (1 day) vs exactly DUE_SOON_DAYS+1 (8 days) — only the former is 'upcoming'", () => {
  const withinWindow = act({ status: "not_started", planned_start: "2026-06-16", planned_finish: "2026-06-20" });
  const outsideWindow = act({ status: "not_started", planned_start: "2026-06-23", planned_finish: "2026-06-27" });
  const other = act({ planned_finish: "2026-06-01" }); // an unrelated overdue activity, so warnings.length > 0 already
  const r1 = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, programmeActivities: [withinWindow, other] }, ASOF);
  const r2 = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, programmeActivities: [outsideWindow, other] }, ASOF);
  assert.ok(r1.warnings.some((w) => w.code === "approaching_with_unresolved"));
  assert.ok(!r2.warnings.some((w) => w.code === "approaching_with_unresolved"));
});

test("Timezone boundary: the overdue snag/programme boundary is identical at UTC+14 and UTC-12 — asOfDate must never shift with the runtime's timezone", () => {
  const originalTZ = process.env.TZ;
  try {
    const results = [];
    for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12", "UTC"]) {
      process.env.TZ = tz;
      const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, snags: [snag({ priority: "high", due_date: "2026-06-14" })] }, "2026-06-15");
      results.push(r.status);
    }
    assert.deepEqual(results, ["not_ready", "not_ready", "not_ready"]);
  } finally {
    process.env.TZ = originalTZ;
  }
});

test("Never falls back to the poisoned default todayISO() — proven by an asOfDate the poisoned default would get wrong", () => {
  const r = computePlotHandoverReadiness(plot(), { ...ALL_CLEAR, snags: [snag({ priority: "high", due_date: "2026-07-01" })] }, "2026-06-15");
  assert.equal(r.status, "at_risk", "planned_finish/due_date is still in the future relative to the real asOfDate, not the poisoned 2099-01-01 default");
});
