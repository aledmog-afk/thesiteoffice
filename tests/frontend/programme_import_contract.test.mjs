// Programme import architecture (Priority 11, Phase 2) — the CONTRACT
// a future XLSX importer will implement against, exercised here
// against their REAL app.js source (extracted, not reimplemented).
// This phase deliberately does not build a working importer (no
// XLSX.read(), no upload/preview/mapping UI) — see tracker/README.md
// for the full architecture rationale. What's tested here is
// everything the brief explicitly asked to be established now:
// row-level validation, the stable external-id identity strategy (and
// its (plot,title) fallback), and the plan that keeps a re-import
// from ever silently overwriting this app's own forecast/actual
// fields.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractConst(name) {
  const m = APP_JS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
function extractFn(name) {
  const m = APP_JS.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
// toLocalISODate is a dependency of parseImportDate — extracted from
// its own real source (not reimplemented) the same way client.test.mjs
// already pulls in uploadPhoto()'s own dependencies.
function extractHelperFn(name) {
  const m = APP_JS.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

// EXCEL_EPOCH_MS is a private (non-exported) const parseImportDate()
// closes over — extracted the same way client.test.mjs already pulls
// in uploadPhoto()'s own private ALLOWED_UPLOAD_MIME_TYPES dependency.
const excelEpochMatch = APP_JS.match(/const EXCEL_EPOCH_MS = .*\n/);
assert.ok(excelEpochMatch, "EXCEL_EPOCH_MS not found in app.js");

const scopeSrc = `
  ${excelEpochMatch[0]}
  ${extractHelperFn("toLocalISODate")}
  ${extractFn("parseImportDate")}
  ${extractFn("validateImportRow")}
  ${extractFn("matchImportRowToActivity")}
  ${extractConst("PROGRAMME_IMPORT_COLUMNS")}
  ${extractConst("PROGRAMME_IMPORT_OWNED_FIELDS")}
  ${extractConst("PROGRAMME_APP_OWNED_FIELDS")}
  ${extractFn("planProgrammeImport")}
  return { parseImportDate, validateImportRow, matchImportRowToActivity, planProgrammeImport, PROGRAMME_IMPORT_COLUMNS, PROGRAMME_IMPORT_OWNED_FIELDS, PROGRAMME_APP_OWNED_FIELDS };
`;
const { parseImportDate, validateImportRow, matchImportRowToActivity, planProgrammeImport, PROGRAMME_IMPORT_COLUMNS, PROGRAMME_IMPORT_OWNED_FIELDS, PROGRAMME_APP_OWNED_FIELDS } = new Function(scopeSrc)();

// ─── parseImportDate ──────────────────────────────────────────────

test("parseImportDate: accepts a plain ISO date string", () => {
  assert.deepEqual(parseImportDate("2026-03-15"), { ok: true, value: "2026-03-15" });
});

test("parseImportDate: accepts null/undefined/empty as 'no date', not an error", () => {
  assert.deepEqual(parseImportDate(null), { ok: true, value: null });
  assert.deepEqual(parseImportDate(undefined), { ok: true, value: null });
  assert.deepEqual(parseImportDate(""), { ok: true, value: null });
});

test("parseImportDate: accepts an Excel serial date number", () => {
  // Excel serial 46096 is 2026-03-15 in Excel's (UTC, day-0 = 1899-12-30) date system.
  const result = parseImportDate(46096);
  assert.equal(result.ok, true);
  assert.equal(result.value, "2026-03-15");
});

test("parseImportDate: accepts a real JS Date object", () => {
  const result = parseImportDate(new Date(2026, 2, 15)); // month is 0-indexed
  assert.equal(result.ok, true);
  assert.equal(result.value, "2026-03-15");
});

test("parseImportDate: rejects a non-ISO-shaped string rather than guessing", () => {
  assert.equal(parseImportDate("15/03/2026").ok, false);
  assert.equal(parseImportDate("March 15 2026").ok, false);
  assert.equal(parseImportDate("not a date").ok, false);
});

test("parseImportDate: rejects other malformed shapes", () => {
  assert.equal(parseImportDate({}).ok, false);
  assert.equal(parseImportDate([]).ok, false);
  assert.equal(parseImportDate(NaN).ok, false);
});

// ─── validateImportRow ────────────────────────────────────────────

test("validateImportRow: a valid row passes and returns a clean activity object", () => {
  const result = validateImportRow({ title: "Groundworks", external_id: "EXT-01", planned_start: "2026-01-01", planned_finish: "2026-01-15" });
  assert.equal(result.valid, true);
  assert.equal(result.activity.title, "Groundworks");
  assert.equal(result.activity.externalId, "EXT-01");
  assert.equal(result.activity.plannedStart, "2026-01-01");
  assert.equal(result.activity.plannedFinish, "2026-01-15");
});

test("validateImportRow: missing title is rejected", () => {
  const result = validateImportRow({ planned_start: "2026-01-01" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /title/i.test(e)));
});

test("validateImportRow: a title that's only whitespace is treated as missing", () => {
  const result = validateImportRow({ title: "   " });
  assert.equal(result.valid, false);
});

test("validateImportRow: invalid planned_start/planned_finish are both reported (not just the first)", () => {
  const result = validateImportRow({ title: "X", planned_start: "not-a-date", planned_finish: "also-bad" });
  assert.equal(result.valid, false);
  assert.equal(result.errors.length, 2, "both date errors must be reported, not just the first");
});

test("validateImportRow: planned_finish before planned_start is rejected", () => {
  const result = validateImportRow({ title: "X", planned_start: "2026-02-01", planned_finish: "2026-01-01" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /finish.*before.*start|cannot be before/i.test(e)));
});

test("validateImportRow: an invalid percent_complete is rejected (out of 0-100)", () => {
  assert.equal(validateImportRow({ title: "X", percent_complete: 150 }).valid, false);
  assert.equal(validateImportRow({ title: "X", percent_complete: -10 }).valid, false);
  assert.equal(validateImportRow({ title: "X", percent_complete: "not-a-number" }).valid, false);
});

test("validateImportRow: a missing external_id is allowed (not a hard error) — falls back to title/plot matching", () => {
  const result = validateImportRow({ title: "Groundworks" });
  assert.equal(result.valid, true);
  assert.equal(result.activity.externalId, null);
});

test("validateImportRow: a malformed row (wrong types entirely) is rejected cleanly, not thrown", () => {
  assert.doesNotThrow(() => validateImportRow({ title: 12345, planned_start: {}, percent_complete: "abc" }));
  const result = validateImportRow({ title: 12345, planned_start: {}, percent_complete: "abc" });
  assert.equal(result.valid, false);
});

test("validateImportRow: is_milestone recognises common truthy spreadsheet shapes", () => {
  assert.equal(validateImportRow({ title: "M", is_milestone: true }).activity.isMilestone, true);
  assert.equal(validateImportRow({ title: "M", is_milestone: "TRUE" }).activity.isMilestone, true);
  assert.equal(validateImportRow({ title: "M", is_milestone: 1 }).activity.isMilestone, true);
  assert.equal(validateImportRow({ title: "M", is_milestone: false }).activity.isMilestone, false);
  assert.equal(validateImportRow({ title: "M" }).activity.isMilestone, false);
});

// ─── matchImportRowToActivity (the stable-identity strategy) ────────

test("matchImportRowToActivity: matches by external_id when present, ignoring title differences", () => {
  const existing = [{ id: "a1", external_id: "EXT-01", title: "Old Title" }];
  const match = matchImportRowToActivity({ externalId: "EXT-01", title: "Renamed Title", plotNumber: null }, existing);
  assert.equal(match.id, "a1");
});

test("matchImportRowToActivity: no match by external_id -> null (a new activity), even if another row shares its title", () => {
  const existing = [{ id: "a1", external_id: "EXT-01", title: "Groundworks" }];
  const match = matchImportRowToActivity({ externalId: "EXT-99", title: "Groundworks", plotNumber: null }, existing);
  assert.equal(match, null, "a genuinely new external_id must never fall back to a title match — that would silently merge two different activities");
});

test("matchImportRowToActivity: falls back to (plot, title) when no external_id is supplied", () => {
  const existing = [{ id: "a1", external_id: null, title: "1st Fix - Electrical", plotNumber: "Plot 4" }];
  const match = matchImportRowToActivity({ externalId: null, title: "1st Fix - Electrical", plotNumber: "Plot 4" }, existing);
  assert.equal(match.id, "a1");
});

test("matchImportRowToActivity: title ALONE is never enough — two plots with the identical activity title must not collide", () => {
  const existing = [{ id: "a1", external_id: null, title: "1st Fix - Electrical", plotNumber: "Plot 4" }];
  const match = matchImportRowToActivity({ externalId: null, title: "1st Fix - Electrical", plotNumber: "Plot 5" }, existing);
  assert.equal(match, null, "a different plot with the same activity title must be treated as a different activity");
});

test("matchImportRowToActivity: an existing activity that itself has an external_id is never matched by the fallback path", () => {
  const existing = [{ id: "a1", external_id: "EXT-01", title: "Groundworks", plotNumber: null }];
  const match = matchImportRowToActivity({ externalId: null, title: "Groundworks", plotNumber: null }, existing);
  assert.equal(match, null, "an externally-identified activity should only ever be matched by its own external_id, not a coincidental title match");
});

test("matchImportRowToActivity: title matching is case/whitespace normalised", () => {
  const existing = [{ id: "a1", external_id: null, title: "  Groundworks  ", plotNumber: null }];
  const match = matchImportRowToActivity({ externalId: null, title: "groundworks", plotNumber: null }, existing);
  assert.equal(match.id, "a1");
});

// ─── Imported vs application-owned fields ────────────────────────

test("PROGRAMME_IMPORT_OWNED_FIELDS and PROGRAMME_APP_OWNED_FIELDS never overlap — an import must never be able to touch a forecast/actual/status field", () => {
  const overlap = PROGRAMME_IMPORT_OWNED_FIELDS.filter((f) => PROGRAMME_APP_OWNED_FIELDS.includes(f));
  assert.deepEqual(overlap, []);
});

test("PROGRAMME_APP_OWNED_FIELDS includes every forecast/actual/status/progress field", () => {
  for (const field of ["forecast_start", "forecast_finish", "actual_start", "actual_finish", "status", "percent_complete", "assigned_to"]) {
    assert.ok(PROGRAMME_APP_OWNED_FIELDS.includes(field), `${field} must be listed as application-owned`);
  }
});

// ─── planProgrammeImport (mixed valid/invalid batch, create vs update) ──

test("planProgrammeImport: a mixed batch of valid/invalid rows separates creates, updates, and invalid rows correctly", () => {
  const rows = [
    { title: "New Activity", external_id: "EXT-A" },       // new -> create
    { title: "" },                                          // invalid -> missing title
    { title: "Existing renamed", external_id: "EXT-B" },    // matches existing -> update
    { title: "X", planned_start: "2026-02-01", planned_finish: "2026-01-01" }, // invalid -> date order
  ];
  const existing = [{ id: "existing-1", external_id: "EXT-B", title: "Existing (old name)" }];
  const plan = planProgrammeImport(rows, existing);

  assert.equal(plan.toCreate.length, 1);
  assert.equal(plan.toCreate[0].fields.title, "New Activity");
  assert.equal(plan.toCreate[0].fields.external_id, "EXT-A");

  assert.equal(plan.toUpdate.length, 1);
  assert.equal(plan.toUpdate[0].activityId, "existing-1");
  assert.equal(plan.toUpdate[0].fields.title, "Existing renamed");
  // The update's field set must ONLY contain import-owned fields.
  for (const key of Object.keys(plan.toUpdate[0].fields)) {
    assert.ok(PROGRAMME_IMPORT_OWNED_FIELDS.includes(key), `${key} is not an import-owned field and must never appear in an update payload`);
  }

  assert.equal(plan.invalid.length, 2);
  assert.deepEqual(plan.invalid.map((r) => r.index), [1, 3]);
});

test("planProgrammeImport: a duplicate external_id WITHIN the same import batch is caught before hitting the database", () => {
  const rows = [
    { title: "First", external_id: "DUP-1" },
    { title: "Second", external_id: "DUP-1" },
  ];
  const plan = planProgrammeImport(rows, []);
  assert.equal(plan.toCreate.length, 1, "only the first occurrence should be planned as a create");
  assert.equal(plan.invalid.length, 1);
  assert.equal(plan.invalid[0].index, 1);
  assert.match(plan.invalid[0].errors[0], /Duplicate external_id/);
});

test("planProgrammeImport: resolves plot_number to a real plot_id via the supplied lookup, leaving it null when unmatched", () => {
  const rows = [
    { title: "A", plot_number: "Plot 4" },
    { title: "B", plot_number: "Plot 99" }, // not in the lookup
    { title: "C" }, // no plot at all
  ];
  const plan = planProgrammeImport(rows, [], { "Plot 4": "plot-id-4" });
  const byTitle = Object.fromEntries(plan.toCreate.map((c) => [c.fields.title, c.fields.plot_id]));
  assert.equal(byTitle["A"], "plot-id-4");
  assert.equal(byTitle["B"], null);
  assert.equal(byTitle["C"], null);
});

test("planProgrammeImport: an empty batch produces an empty plan, not an error", () => {
  const plan = planProgrammeImport([], []);
  assert.deepEqual(plan, { toCreate: [], toUpdate: [], invalid: [] });
});

test("PROGRAMME_IMPORT_COLUMNS documents the supported column vocabulary", () => {
  for (const col of ["external_id", "title", "planned_start", "planned_finish"]) {
    assert.ok(PROGRAMME_IMPORT_COLUMNS.includes(col));
  }
});
