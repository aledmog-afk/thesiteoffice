// Programme Variance + Dashboard Exception Integration (Priority 11,
// Phase 4) — Plan -> Forecast -> Actual -> Variance -> Exception ->
// Action. Exercises the REAL app.js source (regex-extracted, never
// reimplemented, the same convention every frontend test file in this
// suite uses): categoriseProgrammeActivity() (one activity's
// variance), countProgrammeSignals() (rolling a programme's
// activities into dashboard counts), and computeControlStatus()'s own
// EXISTING function now carrying the new programme reason lines
// alongside actions/H&S/findings/snags — proving programme exceptions
// plug into the one Project Control Dashboard rather than becoming a
// second one.
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

// A fixed "today" the whole scope closes over — every test below
// reasons about dates relative to 2026-06-15, never the real runtime
// date, so this suite is deterministic regardless of when it runs.
const TODAY = "2026-06-15";
const SCOPE = `
  function todayISO() { return "${TODAY}"; }
  ${extractConstSrc("DUE_SOON_DAYS")}
  ${extractConstSrc("PROGRAMME_MATERIAL_DELAY_DAYS")}
  ${extractPrivateFn("diffCalendarDays")}
  ${extractFn("categoriseProgrammeActivity")}
  ${extractFn("countProgrammeSignals")}
  ${extractFn("categoriseAction")}
  ${extractFn("aggregateActionCounts")}
  ${extractFn("countHighSeverityHsIssues")}
  ${extractFn("countSnagSignals")}
  ${extractFn("categoriseSnag")}
  ${extractFn("computeControlStatus")}
  return { categoriseProgrammeActivity, countProgrammeSignals, aggregateActionCounts, countHighSeverityHsIssues, countSnagSignals, computeControlStatus, PROGRAMME_MATERIAL_DELAY_DAYS, DUE_SOON_DAYS };
`;
const {
  categoriseProgrammeActivity, countProgrammeSignals, aggregateActionCounts,
  countHighSeverityHsIssues, countSnagSignals, computeControlStatus,
  PROGRAMME_MATERIAL_DELAY_DAYS, DUE_SOON_DAYS,
} = new Function(SCOPE)();

function act(overrides = {}) {
  return {
    id: "a1", title: "Groundworks", is_milestone: false, status: "in_progress",
    planned_start: null, planned_finish: null, forecast_start: null, forecast_finish: null, actual_finish: null,
    ...overrides,
  };
}

// ─── categoriseProgrammeActivity: the full variance taxonomy ──────

test("categoriseProgrammeActivity: ahead of plan (forecast before planned)", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-07-10", forecast_finish: "2026-07-05" }));
  assert.equal(cats.label, "ahead");
  assert.equal(cats.overdue, false);
  assert.equal(cats.forecastLate, false);
  assert.equal(cats.forecastVarianceDays, -5);
});

test("categoriseProgrammeActivity: exactly on plan (forecast === planned)", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-07-10", forecast_finish: "2026-07-10" }));
  assert.equal(cats.label, "on_plan");
  assert.equal(cats.forecastVarianceDays, 0);
  assert.equal(cats.forecastLate, false);
});

test("categoriseProgrammeActivity: one day late is forecast-late but NOT material", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-07-10", forecast_finish: "2026-07-11" }));
  assert.equal(cats.label, "late");
  assert.equal(cats.forecastLate, true);
  assert.equal(cats.materialForecastDelay, false);
  assert.equal(cats.forecastVarianceDays, 1);
});

test(`categoriseProgrammeActivity: a delay beyond PROGRAMME_MATERIAL_DELAY_DAYS (${PROGRAMME_MATERIAL_DELAY_DAYS}) is material`, () => {
  const justOver = PROGRAMME_MATERIAL_DELAY_DAYS + 1;
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-07-01", forecast_finish: `2026-07-${String(1 + justOver).padStart(2, "0")}` }));
  assert.equal(cats.forecastLate, true);
  assert.equal(cats.materialForecastDelay, true);
});

test(`categoriseProgrammeActivity: a delay of EXACTLY PROGRAMME_MATERIAL_DELAY_DAYS is NOT yet material (boundary is exclusive)`, () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-07-01", forecast_finish: `2026-07-${String(1 + PROGRAMME_MATERIAL_DELAY_DAYS).padStart(2, "0")}` }));
  assert.equal(cats.forecastLate, true);
  assert.equal(cats.materialForecastDelay, false);
});

test("categoriseProgrammeActivity: overdue (planned_finish before today, incomplete)", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-06-01", forecast_finish: "2026-06-10" }));
  assert.equal(cats.label, "overdue");
  assert.equal(cats.overdue, true);
});

test("categoriseProgrammeActivity: a completed activity can NEVER be overdue, no matter how late its planned_finish was", () => {
  const cats = categoriseProgrammeActivity(act({ status: "complete", planned_finish: "2020-01-01", actual_finish: "2026-06-01" }));
  assert.equal(cats.overdue, false);
});

test("categoriseProgrammeActivity: completed early", () => {
  const cats = categoriseProgrammeActivity(act({ status: "complete", planned_finish: "2026-06-10", actual_finish: "2026-06-05" }));
  assert.equal(cats.label, "completed_early");
  assert.equal(cats.completedEarly, true);
  assert.equal(cats.actualVarianceDays, -5);
});

test("categoriseProgrammeActivity: completed exactly on plan", () => {
  const cats = categoriseProgrammeActivity(act({ status: "complete", planned_finish: "2026-06-10", actual_finish: "2026-06-10" }));
  assert.equal(cats.label, "completed_on_plan");
  assert.equal(cats.completedOnPlan, true);
  assert.equal(cats.actualVarianceDays, 0);
});

test("categoriseProgrammeActivity: completed late", () => {
  const cats = categoriseProgrammeActivity(act({ status: "complete", planned_finish: "2026-06-01", actual_finish: "2026-06-05" }));
  assert.equal(cats.label, "completed_late");
  assert.equal(cats.completedLate, true);
  assert.equal(cats.actualVarianceDays, 4);
});

test("categoriseProgrammeActivity: cancelled carries NO variance judgement at all, regardless of how overdue-looking its dates are", () => {
  const cats = categoriseProgrammeActivity(act({ status: "cancelled", planned_finish: "2020-01-01", forecast_finish: "2026-12-01" }));
  assert.equal(cats.label, "cancelled");
  assert.equal(cats.overdue, false);
  assert.equal(cats.forecastLate, false);
  assert.equal(cats.completedLate, false);
});

test("categoriseProgrammeActivity: an overdue milestone categorises as overdue, same as an ordinary overdue activity", () => {
  const cats = categoriseProgrammeActivity(act({ is_milestone: true, planned_finish: "2026-06-01", forecast_finish: "2026-06-10" }));
  assert.equal(cats.overdue, true);
  assert.equal(cats.label, "overdue");
});

test("categoriseProgrammeActivity: a milestone forecast late by just ONE day is already material — milestones get NO tolerance", () => {
  const cats = categoriseProgrammeActivity(act({ is_milestone: true, planned_finish: "2026-07-01", forecast_finish: "2026-07-02" }));
  assert.equal(cats.forecastLate, true);
  assert.equal(cats.materialForecastDelay, true, "a milestone's tolerance is 0 days, unlike an ordinary activity's PROGRAMME_MATERIAL_DELAY_DAYS");
});

test("categoriseProgrammeActivity: no forecast_finish at all means no forecast-late judgement is possible (never guessed)", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-07-01", forecast_finish: null }));
  assert.equal(cats.forecastLate, false);
  assert.equal(cats.forecastVarianceDays, null);
});

test("categoriseProgrammeActivity: no planned_finish at all means no overdue/forecast-late judgement is possible", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: null, forecast_finish: "2026-07-01" }));
  assert.equal(cats.label, "no_plan_date");
  assert.equal(cats.overdue, false);
  assert.equal(cats.forecastLate, false);
});

test("categoriseProgrammeActivity: a genuinely empty/incomplete row never throws, and carries no exception flags", () => {
  assert.doesNotThrow(() => categoriseProgrammeActivity({}));
  const cats = categoriseProgrammeActivity({});
  assert.equal(cats.overdue, false);
  assert.equal(cats.forecastLate, false);
  assert.equal(cats.label, "no_plan_date");
});

test("categoriseProgrammeActivity: 'upcoming' flags a not-yet-started activity whose start falls within DUE_SOON_DAYS, and is independent of the variance label", () => {
  const soon = categoriseProgrammeActivity(act({ status: "not_started", planned_start: "2026-06-20", planned_finish: "2026-07-01", forecast_finish: "2026-07-01" }));
  assert.equal(soon.upcoming, true);
  const far = categoriseProgrammeActivity(act({ status: "not_started", planned_start: "2026-08-01", planned_finish: "2026-08-10", forecast_finish: "2026-08-10" }));
  assert.equal(far.upcoming, false);
});

// ─── Date correctness: month/year boundaries, leap years, timezone ──

test("categoriseProgrammeActivity: forecast variance correctly crosses a month boundary", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-01-31", forecast_finish: "2026-02-01" }));
  assert.equal(cats.forecastVarianceDays, 1);
});

test("categoriseProgrammeActivity: forecast variance correctly crosses a year boundary", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2025-12-31", forecast_finish: "2026-01-01" }));
  assert.equal(cats.forecastVarianceDays, 1);
});

test("categoriseProgrammeActivity: leap-day (2028-02-29) arithmetic is exactly one day, not two", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2028-02-29", forecast_finish: "2028-03-01" }));
  assert.equal(cats.forecastVarianceDays, 1);
});

test("categoriseProgrammeActivity: a non-leap year has no Feb 29 — Feb 28 to Mar 1 is 2 days, proving the arithmetic uses real calendar rules", () => {
  const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-02-28", forecast_finish: "2026-03-01" }));
  assert.equal(cats.forecastVarianceDays, 1, "2026 is not a leap year — Feb 28 to Mar 1 is a single calendar-day step");
});

const originalTZ = process.env.TZ;
test("categoriseProgrammeActivity: forecast variance is identical at UTC+14 and UTC-12 — timezone never shifts a programme calendar date", () => {
  try {
    const results = [];
    for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12", "UTC"]) {
      process.env.TZ = tz;
      const cats = categoriseProgrammeActivity(act({ planned_finish: "2026-07-01", forecast_finish: "2026-07-10" }), "2026-06-15");
      results.push(cats.forecastVarianceDays);
    }
    assert.deepEqual(results, [9, 9, 9], "the same two calendar dates must diff to the same day count regardless of runtime timezone");
  } finally {
    process.env.TZ = originalTZ;
  }
});

test("categoriseProgrammeActivity: the overdue boundary itself never shifts with timezone (plain ISO string comparison, no Date object at all)", () => {
  try {
    for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
      process.env.TZ = tz;
      assert.equal(categoriseProgrammeActivity(act({ planned_finish: "2026-06-14" }), "2026-06-15").overdue, true, `TZ=${tz}`);
      assert.equal(categoriseProgrammeActivity(act({ planned_finish: "2026-06-15" }), "2026-06-15").overdue, false, `TZ=${tz}: due today is not yet overdue`);
    }
  } finally {
    process.env.TZ = originalTZ;
  }
});

// ─── countProgrammeSignals: rolling a programme into dashboard counts ──

test("countProgrammeSignals: tallies overdue activities and milestones separately", () => {
  const rows = [
    act({ id: "a1", planned_finish: "2026-06-01" }),
    act({ id: "a2", planned_finish: "2026-06-02" }),
    act({ id: "a3", is_milestone: true, planned_finish: "2026-06-01" }),
  ];
  const counts = countProgrammeSignals(rows, TODAY);
  assert.equal(counts.overdueProgrammeActivities, 2);
  assert.equal(counts.overdueProgrammeMilestones, 1);
});

test("countProgrammeSignals: an overdue activity is counted ONLY as overdue, never also as forecast-late, even though it may also be forecast-late", () => {
  const rows = [act({ planned_finish: "2026-06-01", forecast_finish: "2026-06-20" })]; // overdue AND forecast 19 days late
  const counts = countProgrammeSignals(rows, TODAY);
  assert.equal(counts.overdueProgrammeActivities, 1);
  assert.equal(counts.forecastLateProgrammeActivities, 0, "must not be double-counted into forecast-late once it's already overdue");
  assert.equal(counts.materialForecastLateProgrammeActivities, 0);
});

test("countProgrammeSignals: splits forecast-late activities into the total and the material subset", () => {
  const rows = [
    act({ id: "a1", planned_finish: "2026-07-01", forecast_finish: "2026-07-02" }), // minor, 1 day
    act({ id: "a2", planned_finish: "2026-07-01", forecast_finish: "2026-07-10" }), // material, 9 days
  ];
  const counts = countProgrammeSignals(rows, TODAY);
  assert.equal(counts.forecastLateProgrammeActivities, 2, "both count toward the total");
  assert.equal(counts.materialForecastLateProgrammeActivities, 1, "only the material one counts toward the material subset");
});

test("countProgrammeSignals: completedLateProgrammeActivities and upcomingProgrammeActivities are counted but computed independently of overdue/forecast-late", () => {
  const rows = [
    act({ id: "a1", status: "complete", planned_finish: "2026-06-01", actual_finish: "2026-06-05" }),
    act({ id: "a2", status: "not_started", planned_start: "2026-06-16", planned_finish: "2026-07-01", forecast_finish: "2026-07-01" }),
  ];
  const counts = countProgrammeSignals(rows, TODAY);
  assert.equal(counts.completedLateProgrammeActivities, 1);
  assert.equal(counts.upcomingProgrammeActivities, 1);
  assert.equal(counts.overdueProgrammeActivities, 0);
});

test("countProgrammeSignals: an empty programme (no activities) produces all-zero counts, not an error", () => {
  const counts = countProgrammeSignals([], TODAY);
  for (const key of Object.keys(counts)) assert.equal(counts[key], 0, key);
});

// ─── Dashboard integration: computeControlStatus() now reasoning about programme signals ──

function progOnlyCounts(overrides = {}) {
  return {
    openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0,
    highSeverityHs: 0, criticalOpenFindings: 0, highSeverityOverdueLinkedFindings: 0, highSeverityDueSoonLinkedFindings: 0,
    overdueSnags: 0, dueTodaySnags: 0, dueSoonSnags: 0, highPrioritySnags: 0,
    overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, forecastLateProgrammeActivities: 0,
    materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0,
    completedLateProgrammeActivities: 0, upcomingProgrammeActivities: 0,
    ...overrides,
  };
}

test("computeControlStatus: an overdue programme activity alone is Attention, with a specific, plain-English reason", () => {
  const status = computeControlStatus(progOnlyCounts({ overdueProgrammeActivities: 3 }));
  assert.equal(status.level, "attention");
  assert.match(status.reason, /3 programme activities are overdue/);
});

test("computeControlStatus: an overdue programme milestone alone is Attention, worded distinctly from an ordinary activity", () => {
  const status = computeControlStatus(progOnlyCounts({ overdueProgrammeMilestones: 1 }));
  assert.equal(status.level, "attention");
  assert.match(status.reason, /1 programme milestone overdue/);
});

test("computeControlStatus: a materially forecast-late activity is Attention", () => {
  const status = computeControlStatus(progOnlyCounts({ materialForecastLateProgrammeActivities: 2 }));
  assert.equal(status.level, "attention");
  assert.match(status.reason, /2 programme activities forecast materially late/);
});

test("computeControlStatus: a forecast-late programme milestone is Attention", () => {
  const status = computeControlStatus(progOnlyCounts({ forecastLateProgrammeMilestones: 1 }));
  assert.equal(status.level, "attention");
  assert.match(status.reason, /1 programme milestone forecast late/);
});

test("computeControlStatus: a MINOR (non-material) forecast-late activity is only Watch, never Attention", () => {
  const status = computeControlStatus(progOnlyCounts({ forecastLateProgrammeActivities: 1, materialForecastLateProgrammeActivities: 0 }));
  assert.equal(status.level, "watch");
  assert.match(status.reason, /1 programme activity forecast late/);
});

test("computeControlStatus: zero programme signals (and zero everything else) is On Track", () => {
  const status = computeControlStatus(progOnlyCounts());
  assert.equal(status.level, "on_track");
});

test("computeControlStatus: completedLateProgrammeActivities and upcomingProgrammeActivities NEVER drive Attention or Watch — historical/future context only", () => {
  const status = computeControlStatus(progOnlyCounts({ completedLateProgrammeActivities: 5, upcomingProgrammeActivities: 5 }));
  assert.equal(status.level, "on_track", "neither signal is a CURRENT exception");
});

test("computeControlStatus: programme Attention + H&S Attention combine into one reason, both mentioned", () => {
  const status = computeControlStatus(progOnlyCounts({ overdueProgrammeActivities: 1, highSeverityHs: 1 }));
  assert.equal(status.level, "attention");
  assert.match(status.reason, /programme activity is overdue/);
  assert.match(status.reason, /unresolved high-severity H&S issue/);
});

test("computeControlStatus: programme Attention + an overdue Action combine into one reason", () => {
  const status = computeControlStatus(progOnlyCounts({ overdueProgrammeActivities: 1, overdue: 2 }));
  assert.equal(status.level, "attention");
  assert.match(status.reason, /2 overdue actions/);
  assert.match(status.reason, /1 programme activity is overdue/);
});

test("computeControlStatus: programme Attention + an overdue Snag combine into one reason", () => {
  const status = computeControlStatus(progOnlyCounts({ overdueProgrammeActivities: 1, overdueSnags: 1 }));
  assert.equal(status.level, "attention");
  assert.match(status.reason, /1 overdue snag/);
  assert.match(status.reason, /1 programme activity is overdue/);
});

test("computeControlStatus: multiple simultaneous programme exception types all appear in one Attention reason", () => {
  const status = computeControlStatus(progOnlyCounts({
    overdueProgrammeActivities: 2, overdueProgrammeMilestones: 1,
    materialForecastLateProgrammeActivities: 1, forecastLateProgrammeMilestones: 1,
  }));
  assert.equal(status.level, "attention");
  assert.match(status.reason, /2 programme activities are overdue/);
  assert.match(status.reason, /1 programme milestone overdue/);
  assert.match(status.reason, /1 programme activity forecast materially late/);
  assert.match(status.reason, /1 programme milestone forecast late/);
});

test("computeControlStatus: Attention (programme) outranks Watch (a due-soon Action) — the worst status always wins", () => {
  const status = computeControlStatus(progOnlyCounts({ overdueProgrammeActivities: 1, dueSoon: 5 }));
  assert.equal(status.level, "attention");
});

test("computeControlStatus: a real end-to-end mix (actions + programme, via the real aggregator functions, not hand-built counts)", () => {
  const actions = [{ id: "act1", status: "open", priority: "critical", due_date: "2020-01-01" }];
  const progRows = [act({ id: "p1", planned_finish: "2026-06-01", forecast_finish: "2026-06-01" })];
  const counts = aggregateActionCounts(actions, TODAY);
  counts.highSeverityHs = countHighSeverityHsIssues([]);
  Object.assign(counts, countSnagSignals([], TODAY));
  Object.assign(counts, countProgrammeSignals(progRows, TODAY));
  const status = computeControlStatus(counts);
  assert.equal(status.level, "attention");
  assert.match(status.reason, /1 overdue action/);
  assert.match(status.reason, /1 programme activity is overdue/);
});
