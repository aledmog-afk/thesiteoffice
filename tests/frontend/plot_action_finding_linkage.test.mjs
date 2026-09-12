// Plot Control Data Linkage (Priority 13) — computePlotHandoverReadiness()'s
// new Actions/Findings rules, exercised against the REAL app.js source
// (regex-extracted, never reimplemented). Also proves the automatic
// plot-context inheritance wiring in createActionFromSnag()/
// createActionFromFinding()/createActionFromProgrammeActivity()/
// createFinding(), each against a mocked supabase client that records
// exactly what payload would have been sent — this is real branching
// logic (own plot_id vs a snag's list fallback vs null), not a trivial
// pass-through, and deserves its own proof distinct from the pure
// readiness-calculation tests.
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
  const m = APP_JS.match(new RegExp(`(?:async )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0];
}

// ─── Pure readiness rules ───────────────────────────────────────────

const READINESS_SCOPE = `
  function todayISO() { return "2099-01-01"; }
  ${extractConstSrc("DUE_SOON_DAYS")}
  ${extractConstSrc("PROGRAMME_MATERIAL_DELAY_DAYS")}
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
  return { computePlotHandoverReadiness };
`;
const { computePlotHandoverReadiness } = new Function(READINESS_SCOPE)();

function plot(overrides = {}) { return { handed_over_at: null, ...overrides }; }
const ASOF = "2026-06-15";
const CLEAR = { gates: [{ status: "approved" }], handoverDocuments: [{ status: "approved_final" }] };
function act(overrides = {}) { return { status: "open", priority: "medium", due_date: null, ...overrides }; }
function finding(overrides = {}) { return { status: "open", severity: "medium", ...overrides }; }

test("Not Ready: a blocked Action linked to this plot is a hard blocker, regardless of priority", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, actions: [act({ status: "blocked", priority: "low" })] }, ASOF);
  assert.equal(r.status, "not_ready");
  assert.ok(r.blockers.some((b) => b.code === "actions_blocking"));
});

test("Not Ready: an overdue, critical-priority Action is a hard blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, actions: [act({ priority: "critical", due_date: "2026-06-01" })] }, ASOF);
  assert.equal(r.status, "not_ready");
});

test("Not Ready: an overdue, high-priority Action is a hard blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, actions: [act({ priority: "high", due_date: "2026-06-01" })] }, ASOF);
  assert.equal(r.status, "not_ready");
});

test("At Risk: an overdue LOW/MEDIUM-priority Action is a warning, never a blocker on its own", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, actions: [act({ priority: "medium", due_date: "2026-06-01" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.equal(r.blockers.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "actions_warning"));
});

test("At Risk: an open high/critical-priority Action that is NOT yet overdue is a warning, never a blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, actions: [act({ priority: "critical", due_date: "2030-01-01" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.equal(r.blockers.length, 0);
});

test("Completed/cancelled Actions never affect readiness, no matter how overdue or high priority", () => {
  const r = computePlotHandoverReadiness(plot(), {
    ...CLEAR,
    actions: [act({ status: "completed", priority: "critical", due_date: "2020-01-01" }), act({ status: "cancelled", priority: "critical", due_date: "2020-01-01" })],
  }, ASOF);
  assert.equal(r.status, "ready");
  assert.deepEqual(r.actions, { total: 2, open: 0, blocking: 0, warning: 0 });
});

test("Not Ready: an unresolved CRITICAL Inspection Finding is a hard blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, findings: [finding({ severity: "critical" })] }, ASOF);
  assert.equal(r.status, "not_ready");
  assert.ok(r.blockers.some((b) => b.code === "findings_blocking"));
});

test("At Risk: an unresolved HIGH (not critical) Inspection Finding is a warning, never a blocker", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, findings: [finding({ severity: "high" })] }, ASOF);
  assert.equal(r.status, "at_risk");
  assert.equal(r.blockers.length, 0);
  assert.ok(r.warnings.some((w) => w.code === "findings_warning"));
});

test("Medium/low severity findings never affect readiness on their own", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, findings: [finding({ severity: "medium" }), finding({ severity: "low" })] }, ASOF);
  assert.equal(r.status, "ready");
});

test("Resolved/accepted/cancelled findings never affect readiness, even critical ones", () => {
  const r = computePlotHandoverReadiness(plot(), {
    ...CLEAR,
    findings: [finding({ status: "resolved", severity: "critical" }), finding({ status: "accepted", severity: "critical" }), finding({ status: "cancelled", severity: "critical" })],
  }, ASOF);
  assert.equal(r.status, "ready");
  assert.deepEqual(r.findings, { total: 3, open: 0, blocking: 0, warning: 0 });
});

test("False-certainty protection: zero linked Actions/Findings is exposed as a real zero count, not hidden — the caller can tell 'nothing here' apart from 'field never fetched'", () => {
  const r = computePlotHandoverReadiness(plot(), CLEAR, ASOF);
  assert.deepEqual(r.actions, { total: 0, open: 0, blocking: 0, warning: 0 });
  assert.deepEqual(r.findings, { total: 0, open: 0, blocking: 0, warning: 0 });
  assert.equal(r.status, "ready", "zero-linked is treated as ready, but the UI must show the raw zero, never imply confirmed-clean — see plot-detail.html's own explicit wording");
});

test("Restricted (snagging-only) caller: Actions/Findings data is ignored for status purposes, exactly like gates/documents/programme", () => {
  const r = computePlotHandoverReadiness(plot(), {
    editorDataVisible: false,
    actions: [act({ status: "blocked", priority: "critical" })],
    findings: [finding({ severity: "critical" })],
  }, ASOF);
  assert.equal(r.status, "restricted");
  assert.equal(r.blockers.length, 0, "actions/findings must not leak into a restricted caller's blockers");
});

test("Combination: a blocking Action AND a blocking Finding together still resolve to Not Ready with both reasons listed", () => {
  const r = computePlotHandoverReadiness(plot(), {
    ...CLEAR,
    actions: [act({ status: "blocked" })],
    findings: [finding({ severity: "critical" })],
  }, ASOF);
  assert.equal(r.status, "not_ready");
  assert.equal(r.blockers.length, 2);
});

test("Date boundary: an Action due exactly today is not yet overdue (categoriseAction's own '<' comparison, reused unchanged)", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, actions: [act({ priority: "critical", due_date: ASOF })] }, ASOF);
  assert.equal(r.status, "at_risk", "due today + critical is a warning, not yet a blocker");
});

test("Never falls back to the poisoned default todayISO()", () => {
  const r = computePlotHandoverReadiness(plot(), { ...CLEAR, actions: [act({ priority: "critical", due_date: "2026-07-01" })] }, "2026-06-15");
  assert.equal(r.status, "at_risk", "not yet overdue relative to the real asOfDate — if the poisoned 2099-01-01 default leaked in, this would wrongly show not_ready");
});

// ─── Creation-flow plot inheritance (network wrappers, mocked supabase) ───

const WRAPPER_SCOPE = `
  ${extractFn("createAction")}
  ${extractFn("updateAction")}
  ${extractFn("updateSnag")}
  ${extractFn("updateFinding")}
  ${extractFn("updateProgrammeActivity")}
  ${extractPrivateFn("resolveSnagPlotId")}
  ${extractFn("createActionFromSnag")}
  ${extractFn("createActionFromFinding")}
  ${extractFn("createActionFromProgrammeActivity")}
  ${extractFn("createFinding")}
  return { createActionFromSnag, createActionFromFinding, createActionFromProgrammeActivity, createFinding };
`;

function mockSupabase(inserted) {
  return {
    from(table) {
      const api = {
        insert(payload) {
          inserted.push({ table, payload });
          return api;
        },
        update(payload) {
          inserted.push({ table, payload, op: "update" });
          return api;
        },
        select() { return api; },
        eq() { return api; },
        single: async () => ({ data: { id: `${table}-new`, ...(inserted[inserted.length - 1]?.payload || {}) }, error: null }),
        maybeSingle: async () => ({ data: { plot_id: mockSupabase.snagListPlotId }, error: null }),
      };
      return api;
    },
  };
}

function buildWrapperFns(supabase) {
  return new Function("supabase", `${WRAPPER_SCOPE}`)(supabase);
}

test("createActionFromSnag(): a snag with its OWN plot_id set (general-list tag) inherits that plot directly, no list lookup needed", async () => {
  const inserted = [];
  const supabase = mockSupabase(inserted);
  const { createActionFromSnag } = buildWrapperFns(supabase);
  await createActionFromSnag({ id: "s1", project_id: "p1", plot_id: "plotX", snag_list_id: "list1" }, { title: "Fix" });
  const actionInsert = inserted.find((i) => i.table === "actions");
  assert.equal(actionInsert.payload.plot_id, "plotX");
});

test("createActionFromSnag(): a snag with NO own plot_id falls back to its snag_list's plot_id (the normal, everyday plot-list case)", async () => {
  const inserted = [];
  const supabase = mockSupabase(inserted);
  mockSupabase.snagListPlotId = "plotFromList";
  const { createActionFromSnag } = buildWrapperFns(supabase);
  await createActionFromSnag({ id: "s1", project_id: "p1", plot_id: null, snag_list_id: "list1" }, { title: "Fix" });
  const actionInsert = inserted.find((i) => i.table === "actions");
  assert.equal(actionInsert.payload.plot_id, "plotFromList");
});

test("createActionFromSnag(): a snag with no plot_id and no list (defensive) results in a null plot, never an error", async () => {
  const inserted = [];
  const supabase = mockSupabase(inserted);
  const { createActionFromSnag } = buildWrapperFns(supabase);
  await createActionFromSnag({ id: "s1", project_id: "p1", plot_id: null, snag_list_id: null }, { title: "Fix" });
  const actionInsert = inserted.find((i) => i.table === "actions");
  assert.equal(actionInsert.payload.plot_id, null);
});

test("createActionFromFinding(): the new Action inherits the finding's own plot_id automatically", async () => {
  const inserted = [];
  const supabase = mockSupabase(inserted);
  const { createActionFromFinding } = buildWrapperFns(supabase);
  await createActionFromFinding({ id: "f1", project_id: "p1", plot_id: "plotY" }, { title: "Fix" });
  const actionInsert = inserted.find((i) => i.table === "actions");
  assert.equal(actionInsert.payload.plot_id, "plotY");
});

test("createActionFromFinding(): a finding with no plot_id produces a project-level Action (null plot), not an error", async () => {
  const inserted = [];
  const supabase = mockSupabase(inserted);
  const { createActionFromFinding } = buildWrapperFns(supabase);
  await createActionFromFinding({ id: "f1", project_id: "p1", plot_id: null }, { title: "Fix" });
  const actionInsert = inserted.find((i) => i.table === "actions");
  assert.equal(actionInsert.payload.plot_id, null);
});

test("createActionFromProgrammeActivity(): the new Action inherits the activity's own plot_id automatically", async () => {
  const inserted = [];
  const supabase = mockSupabase(inserted);
  const { createActionFromProgrammeActivity } = buildWrapperFns(supabase);
  await createActionFromProgrammeActivity({ id: "a1", project_id: "p1", plot_id: "plotZ" }, { title: "Fix" });
  const actionInsert = inserted.find((i) => i.table === "actions");
  assert.equal(actionInsert.payload.plot_id, "plotZ");
});

test("createFinding(): an explicitly supplied plotId is inserted as-is (the manual 'Plot' field on the Add Finding form)", async () => {
  const inserted = [];
  const supabase = mockSupabase(inserted);
  const { createFinding } = buildWrapperFns(supabase);
  await createFinding("insp1", "p1", { title: "Crack", plotId: "plotW" });
  const findingInsert = inserted.find((i) => i.table === "inspection_findings");
  assert.equal(findingInsert.payload.plot_id, "plotW");
});

test("createFinding(): omitting plotId (the default) leaves the finding project-level (null), matching a multi-plot or site-wide inspection", async () => {
  const inserted = [];
  const supabase = mockSupabase(inserted);
  const { createFinding } = buildWrapperFns(supabase);
  await createFinding("insp1", "p1", { title: "Crack" });
  const findingInsert = inserted.find((i) => i.table === "inspection_findings");
  assert.equal(findingInsert.payload.plot_id, null);
});
