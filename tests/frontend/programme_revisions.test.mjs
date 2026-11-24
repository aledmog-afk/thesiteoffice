// "Programme revisions this week" (v100) — computeProgrammeRevisionsThisWeek()'s
// own rules, exercised against the REAL app.js source (extracted, not
// reimplemented — the same convention weekly_report_early_warnings.test.mjs
// already established). Page-level wiring (where the section renders,
// the "not calculated" vs "none" distinction, the download buttons) is
// covered in weekly_report_workflow.test.mjs; the real PDF content is
// covered in programme_changes_pdf.test.mjs.
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
  ${extractPrivateFn("addCalendarDays")}
  ${extractFn("londonCalendarDate")}
  const PROGRAMME_REVISIONS_TOP_MOVES = 5;
  ${extractFn("computeProgrammeRevisionsThisWeek")}
  ${extractFn("isWeeklyReportProgrammeRevisionsCalculated")}
  return { londonCalendarDate, computeProgrammeRevisionsThisWeek, isWeeklyReportProgrammeRevisionsCalculated };
`;
const { londonCalendarDate, computeProgrammeRevisionsThisWeek, isWeeklyReportProgrammeRevisionsCalculated } = new Function(SCOPE)();

function run(overrides = {}) {
  return {
    id: "run-1", imported_at: "2026-04-08T10:00:00Z", // Wednesday
    created_count: 1, updated_count: 2, unchanged_count: 3, not_in_import_count: 1,
    changes: { entries: [], not_in_import: [] },
    ...overrides,
  };
}

// ─── londonCalendarDate() ──────────────────────────────────────────
test("londonCalendarDate: a summer (BST) instant resolves to the LOCAL London calendar date, not the UTC one", () => {
  // 2026-04-05T23:30:00Z is 2026-04-06 00:30 in BST (UTC+1).
  assert.equal(londonCalendarDate("2026-04-05T23:30:00Z"), "2026-04-06");
});
test("londonCalendarDate: a winter (GMT) instant agrees with the plain UTC date, since the offset is zero", () => {
  assert.equal(londonCalendarDate("2026-01-06T10:00:00Z"), "2026-01-06");
});
test("londonCalendarDate: null/invalid input returns null, never throws", () => {
  assert.equal(londonCalendarDate(null), null);
  assert.equal(londonCalendarDate(undefined), null);
  assert.equal(londonCalendarDate("not a date"), null);
});

// ─── computeProgrammeRevisionsThisWeek() ───────────────────────────
test("computeProgrammeRevisionsThisWeek: a run imported on the report's own Monday (weekStarting) counts", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" }; // Mon-Fri
  const r = run({ imported_at: "2026-04-06T09:00:00Z" });
  const result = computeProgrammeRevisionsThisWeek([r], period);
  assert.deepEqual(result.runIds, ["run-1"]);
});

test("computeProgrammeRevisionsThisWeek: a run imported on the Sunday after week_ending (Friday) STILL counts — the window is Mon-Sun, not week_starting..week_ending", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" }; // Fri week_ending
  const sunday = run({ id: "run-sun", imported_at: "2026-04-12T09:00:00Z" }); // the following Sunday
  const result = computeProgrammeRevisionsThisWeek([sunday], period);
  assert.deepEqual(result.runIds, ["run-sun"], "Mon-Sun window must include Saturday/Sunday even though week_ending is Friday");
});

test("computeProgrammeRevisionsThisWeek: a run imported the following Monday (the NEXT week) does not count", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" };
  const nextMonday = run({ id: "run-next", imported_at: "2026-04-13T09:00:00Z" });
  const result = computeProgrammeRevisionsThisWeek([nextMonday], period);
  assert.deepEqual(result.runIds, []);
});

test("computeProgrammeRevisionsThisWeek: a run imported the previous Sunday (before weekStarting) does not count", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" };
  const prevSunday = run({ id: "run-prev", imported_at: "2026-04-05T09:00:00Z" });
  const result = computeProgrammeRevisionsThisWeek([prevSunday], period);
  assert.deepEqual(result.runIds, []);
});

test("computeProgrammeRevisionsThisWeek: a run imported late at night in BST that crosses into the next UTC calendar day is still matched by its LONDON date, not UTC", () => {
  // 2026-04-06T23:30Z = 2026-04-07 00:30 BST — still within the same
  // Mon-Sun week in London terms even though the UTC date has rolled
  // into the 7th; a naive UTC slice would place this one day later.
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" };
  const r = run({ imported_at: "2026-04-06T23:30:00Z" });
  const result = computeProgrammeRevisionsThisWeek([r], period);
  assert.deepEqual(result.runIds, ["run-1"]);
});

test("computeProgrammeRevisionsThisWeek: sums counts across multiple runs in the same week", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" };
  const r1 = run({ id: "r1", imported_at: "2026-04-06T09:00:00Z", created_count: 1, updated_count: 2, unchanged_count: 3, not_in_import_count: 1 });
  const r2 = run({ id: "r2", imported_at: "2026-04-08T09:00:00Z", created_count: 5, updated_count: 0, unchanged_count: 1, not_in_import_count: 2 });
  const result = computeProgrammeRevisionsThisWeek([r1, r2], period);
  assert.deepEqual(result.runIds.sort(), ["r1", "r2"]);
  assert.equal(result.createdCount, 6);
  assert.equal(result.updatedCount, 2);
  assert.equal(result.unchangedCount, 4);
  assert.equal(result.notInImportCount, 3);
});

test("computeProgrammeRevisionsThisWeek: topMoves excludes created rows and rows with no actual slip, sorted by biggest |finish_slip_days| first", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" };
  const r = run({
    imported_at: "2026-04-06T09:00:00Z",
    changes: {
      entries: [
        { activity_id: "a1", title: "Small slip", created: false, finish_slip_days: 2, start_slip_days: 0 },
        { activity_id: "a2", title: "Big slip", created: false, finish_slip_days: -20, start_slip_days: 0 },
        { activity_id: "a3", title: "No slip", created: false, finish_slip_days: 0, start_slip_days: 0 },
        { activity_id: "a4", title: "Brand new", created: true, finish_slip_days: null, start_slip_days: null },
      ],
      not_in_import: [],
    },
  });
  const result = computeProgrammeRevisionsThisWeek([r], period);
  assert.deepEqual(result.topMoves.map((m) => m.title), ["Big slip", "Small slip"], "no-slip and created rows excluded; biggest magnitude first regardless of sign");
});

test("computeProgrammeRevisionsThisWeek: caps topMoves at 5 even with many moved rows", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" };
  const entries = Array.from({ length: 8 }, (_, i) => ({ activity_id: `a${i}`, title: `Task ${i}`, created: false, finish_slip_days: i + 1, start_slip_days: 0 }));
  const r = run({ imported_at: "2026-04-06T09:00:00Z", changes: { entries, not_in_import: [] } });
  const result = computeProgrammeRevisionsThisWeek([r], period);
  assert.equal(result.topMoves.length, 5);
  assert.deepEqual(result.topMoves.map((m) => m.title), ["Task 7", "Task 6", "Task 5", "Task 4", "Task 3"]);
});

test("computeProgrammeRevisionsThisWeek: with no weekStarting at all, returns the empty/zero shape rather than throwing", () => {
  const result = computeProgrammeRevisionsThisWeek([run()], {});
  assert.deepEqual(result, { runIds: [], createdCount: 0, updatedCount: 0, unchangedCount: 0, notInImportCount: 0, topMoves: [] });
});

test("computeProgrammeRevisionsThisWeek: no import runs at all (project has never re-imported) returns the zero shape, not an error", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" };
  const result = computeProgrammeRevisionsThisWeek([], period);
  assert.deepEqual(result.runIds, []);
  assert.equal(result.createdCount, 0);
});

test("computeProgrammeRevisionsThisWeek: null/undefined importRuns never throws", () => {
  const period = { weekStarting: "2026-04-06", weekEnding: "2026-04-10" };
  assert.deepEqual(computeProgrammeRevisionsThisWeek(null, period).runIds, []);
  assert.deepEqual(computeProgrammeRevisionsThisWeek(undefined, period).runIds, []);
});

// ─── isWeeklyReportProgrammeRevisionsCalculated() ──────────────────
test("isWeeklyReportProgrammeRevisionsCalculated: true only when programmeRevisions.runIds is a real array — false for undefined, null, or a non-array", () => {
  assert.equal(isWeeklyReportProgrammeRevisionsCalculated({ programmeRevisions: { runIds: [] } }), true, "a genuinely empty array IS calculated — zero revisions, not 'unknown'");
  assert.equal(isWeeklyReportProgrammeRevisionsCalculated({ programmeRevisions: { runIds: ["r1"] } }), true);
  assert.equal(isWeeklyReportProgrammeRevisionsCalculated({}), false, "a report saved before v100 has no programmeRevisions key at all");
  assert.equal(isWeeklyReportProgrammeRevisionsCalculated(null), false);
  assert.equal(isWeeklyReportProgrammeRevisionsCalculated(undefined), false);
});
