// "Programme complete" (v93) — computeProgrammeComplete()'s own
// weighting maths, exercised against the REAL app.js source (extracted,
// not reimplemented — the same convention programme_import_contract.test.mjs
// already established for this file's pure-function siblings). Page-level
// rendering of the figure (project.html's Site Details, programme.html's
// own summary, the dashboard tile) is covered where those pages already
// have their own test files — see site_progress_v69.test.mjs,
// programme_workflow.test.mjs and dashboard_programme_totals.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractFn(name) {
  const m = APP_JS.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
function extractPrivateFn(name) {
  const m = APP_JS.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0];
}

const SCOPE = `
  ${extractPrivateFn("diffCalendarDays")}
  ${extractPrivateFn("programmeActivityDurationWeight")}
  ${extractFn("computeProgrammeComplete")}
  return { computeProgrammeComplete };
`;
const { computeProgrammeComplete } = new Function(SCOPE)();

function act(overrides = {}) {
  return {
    id: "a1", status: "in_progress", percent_complete: 0, is_milestone: false,
    planned_start: null, planned_finish: null, forecast_start: null, forecast_finish: null,
    ...overrides,
  };
}

test("computeProgrammeComplete: a single in-progress activity returns its own percent_complete (weight is irrelevant with only one activity)", () => {
  const pct = computeProgrammeComplete([act({ percent_complete: 40, planned_start: "2026-01-01", planned_finish: "2026-01-15" })]);
  assert.equal(pct, 40);
});

test("computeProgrammeComplete: a complete activity always counts as 100, regardless of a stale percent_complete value", () => {
  const pct = computeProgrammeComplete([act({ status: "complete", percent_complete: 10, planned_start: "2026-01-01", planned_finish: "2026-01-15" })]);
  assert.equal(pct, 100);
});

test("computeProgrammeComplete: weights by planned duration in days — a 20-day task half-done outweighs a 2-day task fully done", () => {
  const longHalf = act({ id: "long", percent_complete: 50, planned_start: "2026-01-01", planned_finish: "2026-01-21" }); // 20 days
  const shortDone = act({ id: "short", status: "complete", percent_complete: 100, planned_start: "2026-02-01", planned_finish: "2026-02-03" }); // 2 days
  const pct = computeProgrammeComplete([longHalf, shortDone]);
  // (20*0.5 + 2*1) / (20+2) = 12/22
  assert.ok(Math.abs(pct - (12 / 22) * 100) < 1e-9);
});

test("computeProgrammeComplete: a zero-duration (same-day) task still gets at least 1 day of weight, never zero", () => {
  const sameDay = act({ percent_complete: 100, status: "complete", planned_start: "2026-01-01", planned_finish: "2026-01-01" });
  const pct = computeProgrammeComplete([sameDay]);
  assert.equal(pct, 100);
});

test("computeProgrammeComplete: falls back to the forecast date pair when planned dates are missing", () => {
  const a = act({ percent_complete: 100, status: "complete", forecast_start: "2026-01-01", forecast_finish: "2026-01-11" }); // 10 days
  const b = act({ id: "b", percent_complete: 0, planned_start: "2026-02-01", planned_finish: "2026-02-11" }); // 10 days via planned
  const pct = computeProgrammeComplete([a, b]);
  // Equal 10-day weights: (10*1 + 10*0) / 20 = 50
  assert.equal(pct, 50);
});

test("computeProgrammeComplete: with no planned OR forecast dates, falls back to a flat weight of 1", () => {
  const noDates = act({ percent_complete: 100, status: "complete" });
  const longOne = act({ id: "b", percent_complete: 0, planned_start: "2026-01-01", planned_finish: "2026-01-31" }); // 30 days
  const pct = computeProgrammeComplete([noDates, longOne]);
  // (1*1 + 30*0) / 31 ≈ 3.2%, nowhere near a naive 50/50 split
  assert.ok(Math.abs(pct - (1 / 31) * 100) < 1e-9);
});

test("computeProgrammeComplete: a milestone always gets weight 1, even with a long planned span", () => {
  const milestone = act({ is_milestone: true, status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-31" }); // would be 30 days if not a milestone
  const task = act({ id: "task", percent_complete: 0, planned_start: "2026-02-01", planned_finish: "2026-02-02" }); // 1 day
  const pct = computeProgrammeComplete([milestone, task]);
  // Equal weight 1 each: (1*1 + 1*0) / 2 = 50
  assert.equal(pct, 50);
});

test("computeProgrammeComplete: cancelled activities are excluded entirely — neither weighted nor counted in the denominator", () => {
  const done = act({ status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  const cancelled = act({ id: "c", status: "cancelled", percent_complete: 0, planned_start: "2026-01-01", planned_finish: "2026-12-31" }); // huge weight if it counted
  const pct = computeProgrammeComplete([done, cancelled]);
  assert.equal(pct, 100);
});

test("computeProgrammeComplete: returns null, not 0, with no activities at all", () => {
  assert.equal(computeProgrammeComplete([]), null);
  assert.equal(computeProgrammeComplete(null), null);
  assert.equal(computeProgrammeComplete(undefined), null);
});

test("computeProgrammeComplete: returns null when every activity is cancelled (nothing countable, even though the array isn't empty)", () => {
  const pct = computeProgrammeComplete([act({ status: "cancelled" }), act({ id: "c2", status: "cancelled" })]);
  assert.equal(pct, null);
});

// ─── v99: exclude_from_progress ────────────────────────────────────
test("computeProgrammeComplete: an activity with exclude_from_progress set is excluded entirely — neither weighted nor counted — the same as a cancelled one", () => {
  const done = act({ status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  const headerRow = act({ id: "header", status: "not_started", percent_complete: 0, planned_start: "2025-01-01", planned_finish: "2027-01-01", exclude_from_progress: true }); // huge weight if it counted
  const pct = computeProgrammeComplete([done, headerRow]);
  assert.equal(pct, 100);
});

test("computeProgrammeComplete: exclude_from_progress excludes regardless of its source ('auto' or 'manual')", () => {
  const done = act({ status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  const autoExcluded = act({ id: "auto", percent_complete: 0, planned_start: "2025-01-01", planned_finish: "2027-01-01", exclude_from_progress: true, exclude_from_progress_source: "auto" });
  const manualExcluded = act({ id: "manual", percent_complete: 0, planned_start: "2025-01-01", planned_finish: "2027-01-01", exclude_from_progress: true, exclude_from_progress_source: "manual" });
  assert.equal(computeProgrammeComplete([done, autoExcluded]), 100);
  assert.equal(computeProgrammeComplete([done, manualExcluded]), 100);
});

test("computeProgrammeComplete: returns null when every activity is excluded (nothing countable, even though the array isn't empty)", () => {
  const pct = computeProgrammeComplete([act({ exclude_from_progress: true }), act({ id: "e2", exclude_from_progress: true })]);
  assert.equal(pct, null);
});

test("computeProgrammeComplete: exclude_from_progress false (or absent, matching every pre-existing activity row) never excludes — unaffected by this flag existing at all", () => {
  const a = act({ percent_complete: 60, planned_start: "2026-01-01", planned_finish: "2026-01-11", exclude_from_progress: false });
  const b = act({ id: "b", percent_complete: 40, planned_start: "2026-01-01", planned_finish: "2026-01-11" }); // no such field at all
  assert.equal(computeProgrammeComplete([a, b]), 50);
});
