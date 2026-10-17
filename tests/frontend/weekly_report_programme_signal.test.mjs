// Weekly Report Programme Integration (Priority 11, Phase 5) —
// computeWeeklyProgrammeSignal(), exercised against the REAL app.js
// source (regex-extracted, never reimplemented). Reuses
// countProgrammeSignals()/categoriseProgrammeActivity() (Phase 4)
// exactly — this is NOT a second definition of programme health, just
// a thin reshape plus an explicit "as of" date anchor (the report's
// own week_ending, never todayISO()).
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
// — every test below proves the signal is anchored to the explicit
// asOfDate argument, never this default, regardless of when the test
// suite actually runs.
const SCOPE = `
  function todayISO() { return "2099-01-01"; }
  ${extractConstSrc("DUE_SOON_DAYS")}
  ${extractConstSrc("PROGRAMME_MATERIAL_DELAY_DAYS")}
  ${extractPrivateFn("diffCalendarDays")}
  ${extractFn("categoriseProgrammeActivity")}
  ${extractFn("countProgrammeSignals")}
  ${extractFn("computeWeeklyProgrammeSignal")}
  return { computeWeeklyProgrammeSignal };
`;
const { computeWeeklyProgrammeSignal } = new Function(SCOPE)();

function act(overrides = {}) {
  return {
    title: "Activity", is_milestone: false, status: "in_progress",
    planned_start: null, planned_finish: null, forecast_start: null, forecast_finish: null, actual_finish: null,
    ...overrides,
  };
}

// ─── A. Signal generation ──────────────────────────────────────────

test("computeWeeklyProgrammeSignal: no active programme returns hasActiveProgramme:false with all-zero counts, not an error", () => {
  const signal = computeWeeklyProgrammeSignal(null, [], "2026-06-15");
  assert.equal(signal.hasActiveProgramme, false);
  assert.equal(signal.programmeName, null);
  assert.equal(signal.totalActivities, 0);
  assert.equal(signal.overdueProgrammeActivities, 0);
  assert.equal(signal.asOfDate, "2026-06-15");
});

test("computeWeeklyProgrammeSignal: an active programme with zero activities reports totalActivities:0, not an error", () => {
  const signal = computeWeeklyProgrammeSignal({ name: "Main Programme" }, [], "2026-06-15");
  assert.equal(signal.hasActiveProgramme, true);
  assert.equal(signal.programmeName, "Main Programme");
  assert.equal(signal.totalActivities, 0);
});

test("computeWeeklyProgrammeSignal: overdue activities are counted", () => {
  const activities = [act({ planned_finish: "2026-06-01" }), act({ planned_finish: "2026-06-10" })];
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-06-15");
  assert.equal(signal.totalActivities, 2);
  assert.equal(signal.overdueProgrammeActivities, 2);
});

test("computeWeeklyProgrammeSignal: forecast-late activities are counted, split into total and material", () => {
  const activities = [
    act({ planned_finish: "2026-07-01", forecast_finish: "2026-07-02" }), // minor
    act({ planned_finish: "2026-07-01", forecast_finish: "2026-07-20" }), // material
  ];
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-06-15");
  assert.equal(signal.forecastLateProgrammeActivities, 2);
  assert.equal(signal.materialForecastLateProgrammeActivities, 1);
});

test("computeWeeklyProgrammeSignal: milestone overdue/forecast-late are counted SEPARATELY from ordinary activities", () => {
  const activities = [
    act({ is_milestone: true, planned_finish: "2026-06-01" }), // overdue milestone
    act({ is_milestone: true, planned_finish: "2026-07-01", forecast_finish: "2026-07-02" }), // forecast-late milestone (any amount = material)
    act({ planned_finish: "2026-06-01" }), // overdue ordinary
  ];
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-06-15");
  assert.equal(signal.overdueProgrammeMilestones, 1);
  assert.equal(signal.overdueProgrammeActivities, 1);
  assert.equal(signal.forecastLateProgrammeMilestones, 1);
});

test("computeWeeklyProgrammeSignal: completed-late activities are counted", () => {
  const activities = [act({ status: "complete", planned_finish: "2026-06-01", actual_finish: "2026-06-10" })];
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-06-15");
  assert.equal(signal.completedLateProgrammeActivities, 1);
});

test("computeWeeklyProgrammeSignal: upcoming activities (within DUE_SOON_DAYS of the as-of date) are counted", () => {
  const activities = [act({ status: "not_started", planned_start: "2026-06-18", planned_finish: "2026-07-01", forecast_finish: "2026-07-01" })];
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-06-15");
  assert.equal(signal.upcomingProgrammeActivities, 1);
});

test("computeWeeklyProgrammeSignal: only the fields countProgrammeSignals() already supports are present — no invented metrics", () => {
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, [], "2026-06-15");
  const expectedKeys = [
    "hasActiveProgramme", "programmeName", "asOfDate", "totalActivities",
    "overdueProgrammeActivities", "forecastLateProgrammeActivities", "materialForecastLateProgrammeActivities",
    "overdueProgrammeMilestones", "forecastLateProgrammeMilestones",
    "completedLateProgrammeActivities", "upcomingProgrammeActivities",
  ];
  assert.deepEqual(Object.keys(signal).sort(), expectedKeys.sort());
});

// ─── B. Date anchoring ──────────────────────────────────────────────

test("computeWeeklyProgrammeSignal: a CURRENT week correctly identifies overdue activities as of that week's ending date", () => {
  const activities = [act({ planned_finish: "2026-06-10" })];
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-06-15");
  assert.equal(signal.overdueProgrammeActivities, 1);
});

test("computeWeeklyProgrammeSignal: a HISTORICAL week (long past) correctly reflects that week's own overdue state, never today's live state", () => {
  // An activity planned to finish 2020-06-20 is overdue as of a report
  // for the week ending 2020-06-15 (5 days before), regardless of
  // however overdue it might ALSO be by the real, current date.
  const activities = [act({ planned_finish: "2020-06-20" })];
  const historicalSignal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2020-06-15");
  assert.equal(historicalSignal.overdueProgrammeActivities, 0, "not yet overdue as of that historical week");
  const laterSignal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2020-06-25");
  assert.equal(laterSignal.overdueProgrammeActivities, 1, "overdue as of a later historical week");
});

test("computeWeeklyProgrammeSignal: a FUTURE-dated week is handled the same deterministic way — nothing special-cased for 'not yet happened'", () => {
  const activities = [act({ planned_finish: "2030-01-01" })];
  const futureSignal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2030-06-01");
  assert.equal(futureSignal.overdueProgrammeActivities, 1, "overdue as of a week ending after the future planned_finish");
});

test("computeWeeklyProgrammeSignal: correctly crosses a month boundary", () => {
  const activities = [act({ planned_finish: "2026-01-31" })];
  assert.equal(computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-02-01").overdueProgrammeActivities, 1);
  assert.equal(computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-01-31").overdueProgrammeActivities, 0, "due today, not yet overdue");
});

test("computeWeeklyProgrammeSignal: correctly crosses a year boundary", () => {
  const activities = [act({ planned_finish: "2025-12-31" })];
  assert.equal(computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-01-01").overdueProgrammeActivities, 1);
});

test("computeWeeklyProgrammeSignal: correctly handles a leap-day boundary (2028-02-29)", () => {
  const activities = [act({ planned_finish: "2028-02-29", forecast_finish: "2028-03-01" })];
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2028-02-20");
  assert.equal(signal.forecastLateProgrammeActivities, 1);
});

const originalTZ = process.env.TZ;
test("computeWeeklyProgrammeSignal: the overdue boundary is identical at UTC+14 and UTC-12 — the report's own week_ending must never shift with the runtime's timezone", () => {
  try {
    const activities = [act({ planned_finish: "2026-06-14" })];
    const results = [];
    for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12", "UTC"]) {
      process.env.TZ = tz;
      results.push(computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-06-15").overdueProgrammeActivities);
    }
    assert.deepEqual(results, [1, 1, 1]);
  } finally {
    process.env.TZ = originalTZ;
  }
});

test("computeWeeklyProgrammeSignal: never falls back to the poisoned default todayISO() — proven by an as-of date the poisoned default would get wrong", () => {
  // If the signal ever silently used todayISO() (poisoned to
  // 2099-01-01 in this scope) instead of the explicit asOfDate, this
  // activity would incorrectly show as overdue. It must not.
  const activities = [act({ planned_finish: "2026-07-01" })];
  const signal = computeWeeklyProgrammeSignal({ name: "P" }, activities, "2026-06-15");
  assert.equal(signal.overdueProgrammeActivities, 0, "planned_finish is still in the future relative to the real as-of date");
});
