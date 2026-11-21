// Early warnings (v97) — computeEarlyWarnings()'s own three rules,
// exercised against the REAL app.js source (extracted, not
// reimplemented — the same convention every other pure-function test
// file in this suite already uses). Page-level wiring (where the
// section renders, the "not calculated" vs "none" distinction, the
// dashboard tile) is covered in weekly_report_workflow.test.mjs and
// dashboard_control.test.mjs.
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
  ${extractPrivateFn("normaliseWarningText")}
  ${extractPrivateFn("earlyWarningItemsMatch")}
  ${extractPrivateFn("totalLabourHeadcount")}
  ${extractPrivateFn("earlyWarningKey")}
  ${extractFn("computeEarlyWarnings")}
  ${extractFn("isWeeklyReportEarlyWarningsCalculated")}
  ${extractFn("buildEarlyWarningNotes")}
  return { computeEarlyWarnings, isWeeklyReportEarlyWarningsCalculated, buildEarlyWarningNotes };
`;
const { computeEarlyWarnings, isWeeklyReportEarlyWarningsCalculated, buildEarlyWarningNotes } = new Function(SCOPE)();

function warningTypes(warnings) {
  return warnings.map((w) => w.type);
}

// ─── No previous report ──────────────────────────────────────────
test("computeEarlyWarnings: no previous report means no warnings at all — never an error", () => {
  assert.deepEqual(computeEarlyWarnings(null, { progress_items: [], programme_status: "behind", labour_records: [], weather_days: [] }), []);
  assert.deepEqual(computeEarlyWarnings(undefined, {}), []);
});

// ─── 1. Planned but no progress ──────────────────────────────────
test("computeEarlyWarnings: an unmatched planned item produces its own 'planned but no progress' warning, naming it", () => {
  const previous = { next_week_items: [{ id: "n1", text: "Roof Covering", plot: "Plot 4" }] };
  const current = { progress_items: [] };
  const warnings = computeEarlyWarnings(previous, current);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].type, "planned_no_progress");
  assert.match(warnings[0].message, /Roof Covering/);
  assert.match(warnings[0].message, /Plot 4/);
});

test("computeEarlyWarnings: matches by programme_activity_id when BOTH items carry one, even if the text differs", () => {
  const previous = { next_week_items: [{ id: "n1", text: "Roof Covering", plot: "Plot 4", programme_activity_id: "act-1" }] };
  const current = { progress_items: [{ id: "p1", text: "Roof — finishing off", plot: "Plot 9", programme_activity_id: "act-1" }] };
  assert.deepEqual(computeEarlyWarnings(previous, current), [], "same programme_activity_id must match regardless of text/plot");
});

test("computeEarlyWarnings: a different programme_activity_id does NOT match, even with identical text/plot", () => {
  const previous = { next_week_items: [{ id: "n1", text: "Roof Covering", plot: "Plot 4", programme_activity_id: "act-1" }] };
  const current = { progress_items: [{ id: "p1", text: "Roof Covering", plot: "Plot 4", programme_activity_id: "act-2" }] };
  const warnings = computeEarlyWarnings(previous, current);
  assert.equal(warnings.length, 1, "a mismatched id must not fall back to a text match when both sides actually carry an id");
});

test("computeEarlyWarnings: falls back to normalised text + plot when only one side (or neither) carries a programme_activity_id", () => {
  const previous = { next_week_items: [{ id: "n1", text: "  Roof Covering  ", plot: "Plot 4", programme_activity_id: "act-1" }] };
  const current = { progress_items: [{ id: "p1", text: "roof covering", plot: "plot 4" }] }; // no id at all — "both have one" is false
  assert.deepEqual(computeEarlyWarnings(previous, current), [], "a planned item with an id can still match a plain freetext progress item on text+plot");
});

test("computeEarlyWarnings: text matching is trimmed and case-insensitive, but the plot tag must still match", () => {
  const previous = { next_week_items: [{ id: "n1", text: "Snagging walk", plot: "Plot 4" }] };
  const matched = computeEarlyWarnings(previous, { progress_items: [{ id: "p1", text: "  SNAGGING WALK  ", plot: "Plot 4" }] });
  assert.deepEqual(matched, []);
  const unmatchedPlot = computeEarlyWarnings(previous, { progress_items: [{ id: "p1", text: "Snagging walk", plot: "Plot 5" }] });
  assert.equal(unmatchedPlot.length, 1, "same text but a different plot tag must not match");
});

test("computeEarlyWarnings: multiple unmatched planned items each get their own warning entry", () => {
  const previous = { next_week_items: [{ id: "n1", text: "Groundworks", plot: "" }, { id: "n2", text: "Roofing", plot: "Plot 2" }] };
  const warnings = computeEarlyWarnings(previous, { progress_items: [] });
  assert.equal(warnings.length, 2);
  assert.deepEqual(warningTypes(warnings), ["planned_no_progress", "planned_no_progress"]);
});

test("computeEarlyWarnings: a matched planned item produces no warning at all", () => {
  const previous = { next_week_items: [{ id: "n1", text: "Groundworks", plot: "Plot 1" }] };
  const warnings = computeEarlyWarnings(previous, { progress_items: [{ id: "p1", text: "Groundworks", plot: "Plot 1", percent: 50 }] });
  assert.deepEqual(warnings, []);
});

test("computeEarlyWarnings: an empty previous next_week_items (or missing entirely) never produces a 'planned but no progress' warning", () => {
  assert.deepEqual(computeEarlyWarnings({ next_week_items: [] }, { progress_items: [] }), []);
  assert.deepEqual(computeEarlyWarnings({}, { progress_items: [] }), []);
});

// ─── 2. Behind two weeks running ──────────────────────────────────
test("computeEarlyWarnings: 'behind' this week AND last week fires the behind-two-weeks warning", () => {
  const warnings = computeEarlyWarnings({ programme_status: "behind" }, { programme_status: "behind" });
  assert.deepEqual(warningTypes(warnings), ["behind_two_weeks"]);
});

test("computeEarlyWarnings: 'behind' only this week (on-track or ahead last week) does not fire it", () => {
  assert.deepEqual(warningTypes(computeEarlyWarnings({ programme_status: "on-track" }, { programme_status: "behind" })), []);
  assert.deepEqual(warningTypes(computeEarlyWarnings({ programme_status: "ahead" }, { programme_status: "behind" })), []);
});

test("computeEarlyWarnings: 'behind' only last week (recovered this week) does not fire it", () => {
  assert.deepEqual(warningTypes(computeEarlyWarnings({ programme_status: "behind" }, { programme_status: "on-track" })), []);
});

// ─── 3. Labour and weather ────────────────────────────────────────
function labourRecords(...headcounts) {
  return headcounts.map((h) => ({ trade: "Groundworkers", headcount: h }));
}

test("computeEarlyWarnings: labour down exactly 25% fires the labour-drop warning ('25% or more')", () => {
  const warnings = computeEarlyWarnings({ labour_records: labourRecords(20) }, { labour_records: labourRecords(15) }); // 15/20 = 75% remaining, exactly 25% drop
  assert.deepEqual(warningTypes(warnings), ["labour_drop"]);
  assert.match(warnings[0].message, /15/);
  assert.match(warnings[0].message, /20/);
});

test("computeEarlyWarnings: labour down 24% (just inside the threshold) does not fire", () => {
  const warnings = computeEarlyWarnings({ labour_records: labourRecords(100) }, { labour_records: labourRecords(76) }); // 24% drop
  assert.deepEqual(warningTypes(warnings), []);
});

test("computeEarlyWarnings: labour down more than 25% still fires", () => {
  const warnings = computeEarlyWarnings({ labour_records: labourRecords(20) }, { labour_records: labourRecords(5) });
  assert.deepEqual(warningTypes(warnings), ["labour_drop"]);
});

test("computeEarlyWarnings: a previous total of zero is never a base for the labour-drop comparison, even if this week is also zero", () => {
  assert.deepEqual(warningTypes(computeEarlyWarnings({ labour_records: labourRecords(0) }, { labour_records: labourRecords(0) })), []);
  assert.deepEqual(warningTypes(computeEarlyWarnings({ labour_records: [] }, { labour_records: labourRecords(5) })), [], "going from no previous records to some headcount is progress, never a warning");
});

test("computeEarlyWarnings: labour headcount sums across multiple trade rows on both sides", () => {
  const previous = { labour_records: [{ trade: "A", headcount: 10 }, { trade: "B", headcount: 10 }] }; // total 20
  const current = { labour_records: [{ trade: "A", headcount: 5 }, { trade: "B", headcount: 5 }] }; // total 10, 50% drop
  assert.deepEqual(warningTypes(computeEarlyWarnings(previous, current)), ["labour_drop"]);
});

test("computeEarlyWarnings: any weather day with lost_hours > 0 fires the weather-lost-time warning", () => {
  const warnings = computeEarlyWarnings({}, { weather_days: [{ date: "2026-06-01", lost_hours: 0 }, { date: "2026-06-02", lost_hours: 4 }] });
  assert.deepEqual(warningTypes(warnings), ["weather_lost_time"]);
  assert.match(warnings[0].message, /1 day/);
});

test("computeEarlyWarnings: all weather days at zero lost_hours (or no weather_days at all) fires nothing", () => {
  assert.deepEqual(warningTypes(computeEarlyWarnings({}, { weather_days: [{ date: "2026-06-01", lost_hours: 0 }] })), []);
  assert.deepEqual(warningTypes(computeEarlyWarnings({}, { weather_days: [] })), []);
  assert.deepEqual(warningTypes(computeEarlyWarnings({}, {})), []);
});

test("computeEarlyWarnings: multiple lost weather days are reported as one warning with the count, pluralised correctly", () => {
  const warnings = computeEarlyWarnings({}, { weather_days: [{ lost_hours: 2 }, { lost_hours: 0 }, { lost_hours: 6 }] });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /2 days/);
});

test("computeEarlyWarnings: labour drop and weather lost time are two SEPARATE warnings when both fire — never merged into one", () => {
  const previous = { labour_records: labourRecords(20) };
  const current = { labour_records: labourRecords(10), weather_days: [{ lost_hours: 3 }] };
  const warnings = computeEarlyWarnings(previous, current);
  assert.deepEqual(warningTypes(warnings).sort(), ["labour_drop", "weather_lost_time"]);
});

// ─── All three rules together ────────────────────────────────────
test("computeEarlyWarnings: all applicable warnings fire together, independently, in one call", () => {
  const previous = {
    next_week_items: [{ id: "n1", text: "Fit windows", plot: "Plot 7" }],
    programme_status: "behind",
    labour_records: labourRecords(40),
  };
  const current = {
    progress_items: [], // "Fit windows" unmatched
    programme_status: "behind",
    labour_records: labourRecords(10), // 75% drop
    weather_days: [{ lost_hours: 8 }],
  };
  const warnings = computeEarlyWarnings(previous, current);
  assert.deepEqual(warningTypes(warnings).sort(), ["behind_two_weeks", "labour_drop", "planned_no_progress", "weather_lost_time"]);
});

// ─── v98: warning.key ──────────────────────────────────────────────
test("computeEarlyWarnings: the three singleton warnings use their own `type` as a fixed, stable key", () => {
  const warnings = computeEarlyWarnings(
    { programme_status: "behind", labour_records: labourRecords(20) },
    { programme_status: "behind", labour_records: labourRecords(5), weather_days: [{ lost_hours: 3 }] }
  );
  const byType = Object.fromEntries(warnings.map((w) => [w.type, w.key]));
  assert.equal(byType.behind_two_weeks, "behind_two_weeks");
  assert.equal(byType.labour_drop, "labour_drop");
  assert.equal(byType.weather_lost_time, "weather_lost_time");
});

test("computeEarlyWarnings: a planned_no_progress warning keys off the planned item's own programme_activity_id when it has one", () => {
  const previous = { next_week_items: [{ id: "n1", text: "Roof Covering", plot: "Plot 4", programme_activity_id: "act-1" }] };
  const warnings = computeEarlyWarnings(previous, { progress_items: [] });
  assert.equal(warnings[0].key, "planned_no_progress:pa:act-1");
});

test("computeEarlyWarnings: a planned_no_progress warning with no programme_activity_id keys off normalised text+plot instead", () => {
  const previous = { next_week_items: [{ id: "n1", text: "  Roof Covering  ", plot: " Plot 4 " }] };
  const warnings = computeEarlyWarnings(previous, { progress_items: [] });
  assert.equal(warnings[0].key, "planned_no_progress:tx:roof covering|plot 4");
});

test("computeEarlyWarnings: a planned_no_progress key stays stable across recalculation even as the planned item's own text/plot is edited later — only its programme_activity_id matters when present", () => {
  const warnings1 = computeEarlyWarnings(
    { next_week_items: [{ id: "n1", text: "Roof Covering", plot: "Plot 4", programme_activity_id: "act-1" }] },
    { progress_items: [] }
  );
  const warnings2 = computeEarlyWarnings(
    { next_week_items: [{ id: "n1", text: "Roof Covering — revised wording", plot: "Plot 5", programme_activity_id: "act-1" }] },
    { progress_items: [] }
  );
  assert.equal(warnings1[0].key, warnings2[0].key);
});

test("computeEarlyWarnings: two different unmatched planned items (no ids) get two distinct keys", () => {
  const previous = { next_week_items: [{ id: "n1", text: "Groundworks", plot: "" }, { id: "n2", text: "Roofing", plot: "Plot 2" }] };
  const warnings = computeEarlyWarnings(previous, { progress_items: [] });
  assert.notEqual(warnings[0].key, warnings[1].key);
});

// ─── v98: buildEarlyWarningNotes() ─────────────────────────────────
test("buildEarlyWarningNotes: a non-blank textarea value for a CURRENT warning key is written, with updated_at/updated_by stamped", () => {
  const result = buildEarlyWarningNotes({}, ["labour_drop"], { labour_drop: "Subcontractor short-staffed this week" }, "user-1", "2026-03-04T10:00:00Z");
  assert.deepEqual(result, { labour_drop: { text: "Subcontractor short-staffed this week", updated_at: "2026-03-04T10:00:00Z", updated_by: "user-1" } });
});

test("buildEarlyWarningNotes: a blank/whitespace-only textarea for a current key clears that key's stored reason", () => {
  const existing = { labour_drop: { text: "Old reason", updated_at: "2026-02-01T00:00:00Z", updated_by: "user-1" } };
  const result = buildEarlyWarningNotes(existing, ["labour_drop"], { labour_drop: "   " }, "user-1");
  assert.deepEqual(result, {}, "an explicitly blanked textarea must clear the note, not keep the old value");
});

test("buildEarlyWarningNotes: a note for a key NOT in the current warning list (its warning disappeared) is carried over untouched", () => {
  const existing = { weather_lost_time: { text: "Three days of rain", updated_at: "2026-02-01T00:00:00Z", updated_by: "user-1" } };
  const result = buildEarlyWarningNotes(existing, ["labour_drop"], { labour_drop: "" }, "user-1");
  assert.deepEqual(result, { weather_lost_time: existing.weather_lost_time }, "a vanished warning's note must never be dropped just because it's no longer in the current list");
});

test("buildEarlyWarningNotes: a key that reappears after being carried over untouched is then updatable again like any other current key", () => {
  const existing = { weather_lost_time: { text: "Old note from before it disappeared", updated_at: "2026-02-01T00:00:00Z", updated_by: "user-1" } };
  const result = buildEarlyWarningNotes(existing, ["weather_lost_time"], { weather_lost_time: "It's back, same cause as before" }, "user-2", "2026-03-10T00:00:00Z");
  assert.deepEqual(result, { weather_lost_time: { text: "It's back, same cause as before", updated_at: "2026-03-10T00:00:00Z", updated_by: "user-2" } });
});

test("buildEarlyWarningNotes: missing/undefined inputs never throw — defaults to an empty object", () => {
  assert.deepEqual(buildEarlyWarningNotes(null, [], {}, null), {});
  assert.deepEqual(buildEarlyWarningNotes(undefined, ["labour_drop"], undefined, "u1"), {});
});

// ─── isWeeklyReportEarlyWarningsCalculated() ──────────────────────
test("isWeeklyReportEarlyWarningsCalculated: true only when earlyWarnings is a real array — false for undefined, null, or a non-array", () => {
  assert.equal(isWeeklyReportEarlyWarningsCalculated({ earlyWarnings: [] }), true, "a genuinely empty array IS calculated — zero warnings, not 'unknown'");
  assert.equal(isWeeklyReportEarlyWarningsCalculated({ earlyWarnings: [{ type: "x", message: "y" }] }), true);
  assert.equal(isWeeklyReportEarlyWarningsCalculated({}), false, "a report saved before v97 has no earlyWarnings key at all");
  assert.equal(isWeeklyReportEarlyWarningsCalculated(null), false);
  assert.equal(isWeeklyReportEarlyWarningsCalculated(undefined), false);
});
