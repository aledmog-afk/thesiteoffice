// Controlled XLSX Programme Import (Priority 11, Phase 3) — the actual
// ingestion/reconciliation workflow this phase adds on top of Phase
// 2's already-tested contract (programme_import_contract.test.mjs,
// left untouched apart from two minimal patches for the timezone fix
// below). Exercised against the REAL app.js source (regex-extracted,
// never reimplemented) — the same convention every other frontend
// test file in this suite uses.
//
// Covers: real-workbook reading (readWorkbookFile), worksheet
// splitting, column-mapping suggestion, the reshape into plain import
// rows, the full create/update/unchanged/missing/ambiguous
// reconciliation preview (buildImportReconciliation — new in Phase 3,
// a client-side mirror of import_programme_activities()'s own
// matching logic), file-selection validation, and a dedicated,
// timezone-adversarial re-test of the parseImportDate fix Phase 3
// made to Phase 2's original implementation (see app.js's own comment
// on formatCalendarDateUTC for the full rationale).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import XLSX from "xlsx";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractConst(name) {
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
function extractPrivateConst(name) {
  const m = APP_JS.match(new RegExp(`const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0];
}

const excelEpochMatch = APP_JS.match(/const EXCEL_EPOCH_MS = .*\n/);
assert.ok(excelEpochMatch, "EXCEL_EPOCH_MS not found in app.js");

// readWorkbookFile's own source hardcodes `import("https://esm.sh/xlsx@0.18.5")`
// — the exact CDN URL the real browser loads at runtime. Node has no
// network-backed dynamic import here (nor should a test depend on the
// network), so this ONE substitution swaps that for the local `xlsx`
// devDependency (same package/version, installed purely for
// test-fixture construction — see package.json). Every other line of
// the real function runs completely unmodified.
const readWorkbookFileSrc = extractFn("readWorkbookFile").replace(
  'await import("https://esm.sh/xlsx@0.18.5")',
  'await import("xlsx")'
);

const scopeSrc = `
  ${excelEpochMatch[0]}
  ${extractPrivateFn("formatCalendarDateUTC")}
  ${extractFn("parseImportDate")}
  ${extractFn("validateImportRow")}
  ${extractConst("PROGRAMME_IMPORT_OWNED_FIELDS")}
  ${extractConst("IMPORT_MAX_FILE_BYTES")}
  ${extractFn("validateImportFile")}
  ${readWorkbookFileSrc}
  ${extractFn("splitSheetHeaderAndRows")}
  ${extractPrivateConst("COLUMN_MAPPING_HINTS")}
  ${extractPrivateConst("COLUMN_MAPPING_FIELD_ORDER")}
  ${extractFn("suggestColumnMapping")}
  ${extractFn("mapRowsToImportRows")}
  ${extractFn("buildImportReconciliation")}
  return { parseImportDate, validateImportRow, PROGRAMME_IMPORT_OWNED_FIELDS, IMPORT_MAX_FILE_BYTES, validateImportFile, readWorkbookFile, splitSheetHeaderAndRows, suggestColumnMapping, mapRowsToImportRows, buildImportReconciliation };
`;
const {
  parseImportDate, validateImportRow, IMPORT_MAX_FILE_BYTES, validateImportFile,
  readWorkbookFile, splitSheetHeaderAndRows, suggestColumnMapping, mapRowsToImportRows, buildImportReconciliation,
} = new Function(scopeSrc)();

function buildWorkbookFile(sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
  }
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return { name: "test.xlsx", arrayBuffer: async () => buffer };
}

// ─── validateImportFile ─────────────────────────────────────────

test("validateImportFile: accepts a well-formed .xlsx file under the size limit", () => {
  assert.equal(validateImportFile({ name: "programme.xlsx", size: 1024 }).ok, true);
});

test("validateImportFile: is case-insensitive about the .xlsx extension", () => {
  assert.equal(validateImportFile({ name: "Programme.XLSX", size: 1024 }).ok, true);
});

test("validateImportFile: rejects no file selected", () => {
  assert.equal(validateImportFile(null).ok, false);
  assert.equal(validateImportFile(undefined).ok, false);
});

test("validateImportFile: rejects a non-.xlsx file (e.g. .csv, .xls, no extension)", () => {
  assert.equal(validateImportFile({ name: "programme.csv", size: 100 }).ok, false);
  assert.equal(validateImportFile({ name: "programme.xls", size: 100 }).ok, false);
  assert.equal(validateImportFile({ name: "programme", size: 100 }).ok, false);
});

test("validateImportFile: rejects an empty file", () => {
  const r = validateImportFile({ name: "empty.xlsx", size: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error, /empty/i);
});

test("validateImportFile: rejects a file over the size limit, accepts one at the boundary", () => {
  assert.equal(validateImportFile({ name: "huge.xlsx", size: IMPORT_MAX_FILE_BYTES + 1 }).ok, false);
  assert.equal(validateImportFile({ name: "boundary.xlsx", size: IMPORT_MAX_FILE_BYTES }).ok, true);
});

// ─── readWorkbookFile ───────────────────────────────────────────

test("readWorkbookFile: reads a real multi-sheet workbook client-side, returning every sheet as a plain array-of-arrays", async () => {
  const file = buildWorkbookFile({
    Programme: [["Activity ID", "Title"], ["A-1", "Groundworks"]],
    Notes: [["nothing here"]],
  });
  const result = await readWorkbookFile(file);
  assert.deepEqual(result.sheetNames, ["Programme", "Notes"]);
  assert.deepEqual(result.sheets.Programme[0], ["Activity ID", "Title"]);
  assert.deepEqual(result.sheets.Programme[1], ["A-1", "Groundworks"]);
});

test("readWorkbookFile: a genuine Excel date cell arrives as a real JS Date (cellDates:true)", async () => {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["Start"], [new Date(Date.UTC(2026, 0, 1))]]);
  XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
  const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const result = await readWorkbookFile({ name: "dates.xlsx", arrayBuffer: async () => buffer });
  assert.ok(result.sheets.Sheet1[1][0] instanceof Date, "a formatted date cell must round-trip as a Date, not a raw serial");
});

// readWorkbookFile's own "no worksheets" branch (app.js: `if
// (!sheetNames.length) throw ...`) guards against XLSX.read() ever
// returning a workbook with an empty SheetNames array. There is no way
// to manufacture that as a real .xlsx byte buffer — SheetJS's own
// writer refuses to produce a workbook with zero sheets in the first
// place ("Workbook is empty"), and a corrupted/truncated file fails
// earlier, inside XLSX.read() itself (covered by the corruption test
// below), never reaching this check with a successfully-parsed-but-
// empty result. The branch is a legitimate defensive guard — it costs
// nothing and documents the invariant — it's just not independently
// reachable with a genuine fixture, so it isn't given its own test.

test("readWorkbookFile: a corrupted / truncated .xlsx (a real file that got cut off) is rejected with a clear error, not a raw parser exception", async () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Title"], ["Groundworks"]]), "Sheet1");
  const real = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  const truncated = real.slice(0, Math.floor(real.byteLength / 3)); // a genuinely broken ZIP container
  await assert.rejects(
    readWorkbookFile({ name: "corrupt.xlsx", arrayBuffer: async () => truncated }),
    /could not be read as an Excel workbook/i
  );
});

// ─── splitSheetHeaderAndRows ─────────────────────────────────────

test("splitSheetHeaderAndRows: splits the header row from data rows", () => {
  const { headers, rows } = splitSheetHeaderAndRows([["Title", "Start"], ["Groundworks", "2026-01-01"]]);
  assert.deepEqual(headers, ["Title", "Start"]);
  assert.deepEqual(rows, [["Groundworks", "2026-01-01"]]);
});

test("splitSheetHeaderAndRows: drops fully-blank trailing rows", () => {
  const { rows } = splitSheetHeaderAndRows([
    ["Title"],
    ["A"],
    ["B"],
    [null],
    [null],
  ]);
  assert.equal(rows.length, 2);
});

test("splitSheetHeaderAndRows: a row shorter than the header is normalised to the header's own width (missing cells become null)", () => {
  const { rows } = splitSheetHeaderAndRows([["Title", "Start", "Finish"], ["A"]]);
  assert.deepEqual(rows[0], ["A", null, null]);
});

test("splitSheetHeaderAndRows: an empty worksheet (no rows at all) returns empty headers/rows, not an error", () => {
  assert.deepEqual(splitSheetHeaderAndRows([]), { headers: [], rows: [] });
  assert.deepEqual(splitSheetHeaderAndRows(null), { headers: [], rows: [] });
});

test("splitSheetHeaderAndRows: a blank header cell becomes an empty string, not null/undefined", () => {
  const { headers } = splitSheetHeaderAndRows([["Title", null, "Finish"], ["A", "B", "C"]]);
  assert.deepEqual(headers, ["Title", "", "Finish"]);
});

// ─── suggestColumnMapping ─────────────────────────────────────────

test("suggestColumnMapping: exact-matches common construction-programme headers", () => {
  const mapping = suggestColumnMapping(["Activity ID", "Title", "Plot Number", "Planned Start", "Planned Finish", "Milestone"]);
  assert.deepEqual(mapping, { external_id: 0, title: 1, plot_number: 2, planned_start: 3, planned_finish: 4, is_milestone: 5 });
});

test("suggestColumnMapping: substring-matches looser real-world MS-Project-style headers", () => {
  const mapping = suggestColumnMapping(["Task ID", "Task Name", "Plot", "Start", "Completion Date"]);
  assert.deepEqual(mapping, { external_id: 0, title: 1, plot_number: 2, planned_start: 3, planned_finish: 4 });
});

test("suggestColumnMapping: a more specific header claims its column before a looser one can steal it", () => {
  // "Activity ID" must be claimed by external_id (exact match), not by
  // title's own looser "activity" substring hint.
  const mapping = suggestColumnMapping(["Activity ID", "Activity"]);
  assert.equal(mapping.external_id, 0);
  assert.equal(mapping.title, 1);
});

test("suggestColumnMapping: never offers the same column to two different fields", () => {
  const mapping = suggestColumnMapping(["Activity", "Something else"]);
  const usedIndexes = Object.values(mapping);
  assert.equal(new Set(usedIndexes).size, usedIndexes.length);
});

test("suggestColumnMapping: headers with no recognisable match are simply left unmapped, not guessed", () => {
  const mapping = suggestColumnMapping(["Foo", "Bar", "Baz"]);
  assert.deepEqual(mapping, {});
});

test("suggestColumnMapping: an empty header list produces an empty mapping", () => {
  assert.deepEqual(suggestColumnMapping([]), {});
  assert.deepEqual(suggestColumnMapping(null), {});
});

// ─── mapRowsToImportRows ──────────────────────────────────────────

test("mapRowsToImportRows: reshapes header-indexed rows into named import rows per the confirmed mapping", () => {
  const rows = [["A-1", "Groundworks", "Plot 4", "2026-01-01", "2026-01-15", "TRUE"]];
  const mapping = { external_id: 0, title: 1, plot_number: 2, planned_start: 3, planned_finish: 4, is_milestone: 5 };
  const [row] = mapRowsToImportRows(rows, mapping);
  assert.equal(row.external_id, "A-1");
  assert.equal(row.title, "Groundworks");
  assert.equal(row.plot_number, "Plot 4");
  assert.equal(row.planned_start, "2026-01-01");
  assert.equal(row.planned_finish, "2026-01-15");
  assert.equal(row.is_milestone, "TRUE");
  assert.equal(row.client_row_index, 0);
});

test("mapRowsToImportRows: an unmapped optional field comes through as null, not undefined or a stray column", () => {
  const rows = [["Groundworks"]];
  const mapping = { title: 0 };
  const [row] = mapRowsToImportRows(rows, mapping);
  assert.equal(row.external_id, null);
  assert.equal(row.plot_number, null);
  assert.equal(row.is_milestone, null);
  assert.equal(row.planned_start, null);
  assert.equal(row.planned_finish, null);
});

test("mapRowsToImportRows: client_row_index tracks position within THIS import batch, independent of the mapping", () => {
  const rows = [["A"], ["B"], ["C"]];
  const mapped = mapRowsToImportRows(rows, { title: 0 });
  assert.deepEqual(mapped.map((r) => r.client_row_index), [0, 1, 2]);
});

// ─── buildImportReconciliation ────────────────────────────────────

function row({ external_id = null, title, plot_number = null, planned_start = null, planned_finish = null, is_milestone = null } = {}) {
  return { external_id, title, plot_number, planned_start, planned_finish, is_milestone };
}

test("buildImportReconciliation: a brand-new external_id with no matching existing activity is planned as a create", () => {
  const recon = buildImportReconciliation([row({ external_id: "A-1", title: "Groundworks" })], []);
  assert.equal(recon.toCreate.length, 1);
  assert.equal(recon.toUpdate.length, 0);
});

test("buildImportReconciliation: a matching external_id with a changed field is planned as an update", () => {
  const existing = [{ id: "e1", external_id: "A-1", title: "Old Title", plot_id: null, planned_start: null, planned_finish: null, is_milestone: false }];
  const recon = buildImportReconciliation([row({ external_id: "A-1", title: "New Title" })], existing);
  assert.equal(recon.toUpdate.length, 1);
  assert.equal(recon.toUpdate[0].activityId, "e1");
  assert.equal(recon.toUpdate[0].fields.title, "New Title");
});

test("buildImportReconciliation: a matching row with NO changed import-owned field is 'unchanged', not an update", () => {
  const existing = [{ id: "e1", external_id: "A-1", title: "Groundworks", plot_id: null, planned_start: "2026-01-01", planned_finish: "2026-01-15", is_milestone: false }];
  const recon = buildImportReconciliation([row({ external_id: "A-1", title: "Groundworks", planned_start: "2026-01-01", planned_finish: "2026-01-15" })], existing);
  assert.equal(recon.unchanged.length, 1);
  assert.equal(recon.toUpdate.length, 0);
});

test("buildImportReconciliation: an existing activity absent from this import is reported as 'missing' — never as something to delete", () => {
  const existing = [
    { id: "e1", external_id: "A-1", title: "In this import", plot_id: null, planned_start: null, planned_finish: null, is_milestone: false },
    { id: "e2", external_id: "A-2", title: "Not in this import", plot_id: null, planned_start: null, planned_finish: null, is_milestone: false },
  ];
  const recon = buildImportReconciliation([row({ external_id: "A-1", title: "In this import" })], existing);
  assert.equal(recon.missing.length, 1);
  assert.equal(recon.missing[0].id, "e2");
  // The reconciliation plan has no concept of "delete" at all.
  assert.equal("toDelete" in recon, false);
});

test("buildImportReconciliation: a duplicate external_id WITHIN the batch rejects every row that shares it", () => {
  const recon = buildImportReconciliation([
    row({ external_id: "DUP", title: "First" }),
    row({ external_id: "DUP", title: "Second" }),
  ], []);
  assert.equal(recon.toCreate.length, 0);
  assert.equal(recon.invalid.length, 2);
  assert.ok(recon.invalid.every((inv) => /Duplicate external_id/.test(inv.errors[0])));
});

test("buildImportReconciliation: an ambiguous (plot,title) fallback match — more than one existing candidate — is rejected, never guessed", () => {
  const existing = [
    { id: "e1", external_id: null, title: "1st Fix - Electrical", plot_id: "plot-4", planned_start: null, planned_finish: null, is_milestone: false },
    { id: "e2", external_id: null, title: "1st Fix - Electrical", plot_id: "plot-4", planned_start: null, planned_finish: null, is_milestone: false },
  ];
  const recon = buildImportReconciliation([row({ title: "1st Fix - Electrical", plot_number: "Plot 4" })], existing, { "Plot 4": "plot-4" });
  assert.equal(recon.toCreate.length, 0);
  assert.equal(recon.toUpdate.length, 0);
  assert.equal(recon.invalid.length, 1);
  assert.match(recon.invalid[0].errors[0], /Ambiguous match/);
});

test("buildImportReconciliation: fallback (plot,title) matching still works normally when there's exactly one candidate", () => {
  const existing = [{ id: "e1", external_id: null, title: "1st Fix - Electrical", plot_id: "plot-4", planned_start: null, planned_finish: null, is_milestone: false }];
  const recon = buildImportReconciliation([row({ title: "1st Fix - Electrical", plot_number: "Plot 4" })], existing, { "Plot 4": "plot-4" });
  assert.equal(recon.toUpdate.length + recon.unchanged.length, 1);
});

test("buildImportReconciliation: a plot_number that doesn't resolve is flagged (plotUnmatched) rather than silently dropped or guessed", () => {
  const recon = buildImportReconciliation([row({ title: "Groundworks", plot_number: "Plot 99" })], [], {});
  assert.equal(recon.toCreate.length, 1);
  assert.equal(recon.toCreate[0].plotUnmatched, true);
  assert.equal(recon.toCreate[0].fields.plot_id, null, "the activity is still created, just left unattached to a plot");
});

test("buildImportReconciliation: an invalid row (e.g. missing title) is reported with its row index and reason, not silently dropped", () => {
  const recon = buildImportReconciliation([row({ title: "" })], []);
  assert.equal(recon.invalid.length, 1);
  assert.equal(recon.invalid[0].index, 0);
  assert.ok(recon.invalid[0].errors.length > 0);
});

test("buildImportReconciliation: only PROGRAMME_IMPORT_OWNED_FIELDS ever appear in an update's field set", () => {
  const existing = [{ id: "e1", external_id: "A-1", title: "Old", plot_id: null, planned_start: null, planned_finish: null, is_milestone: false, status: "in_progress", percent_complete: 40 }];
  const recon = buildImportReconciliation([row({ external_id: "A-1", title: "New" })], existing);
  for (const key of Object.keys(recon.toUpdate[0].fields)) {
    assert.ok(["title", "planned_start", "planned_finish", "is_milestone", "external_id", "plot_id"].includes(key));
  }
});

test("buildImportReconciliation: a mixed batch of new/updated/unchanged/invalid all reconcile independently in one pass", () => {
  const existing = [
    { id: "e1", external_id: "A-1", title: "Old title", plot_id: null, planned_start: null, planned_finish: null, is_milestone: false },
    { id: "e2", external_id: "A-2", title: "Same", plot_id: null, planned_start: null, planned_finish: null, is_milestone: false },
  ];
  const rows = [
    row({ external_id: "A-1", title: "New title" }), // update
    row({ external_id: "A-2", title: "Same" }),        // unchanged
    row({ external_id: "A-3", title: "Brand new" }),   // create
    row({ title: "" }),                                 // invalid
  ];
  const recon = buildImportReconciliation(rows, existing);
  assert.equal(recon.toUpdate.length, 1);
  assert.equal(recon.unchanged.length, 1);
  assert.equal(recon.toCreate.length, 1);
  assert.equal(recon.invalid.length, 1);
});

// ─── Timezone-safety (Phase 3's fix to Phase 2's parseImportDate) ──
// The one thing this phase's brief singled out as a required
// deterministic test: a real Excel date cell must resolve to the SAME
// calendar date no matter what timezone the code happens to run in.

const originalTZ = process.env.TZ;
test("parseImportDate: a Date built the way SheetJS encodes a real Excel cell reads back the same calendar date at extreme UTC+ and UTC- offsets", () => {
  try {
    const utcNoon = new Date(Date.UTC(2026, 2, 15)); // 2026-03-15 00:00 UTC
    for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12", "UTC", "Europe/London"]) {
      process.env.TZ = tz;
      const result = parseImportDate(utcNoon);
      assert.equal(result.value, "2026-03-15", `TZ=${tz} should read 2026-03-15, got ${result.value}`);
    }
  } finally {
    process.env.TZ = originalTZ;
  }
});

test("parseImportDate: an Excel serial number is unaffected by the runtime's own timezone", () => {
  try {
    for (const tz of ["Pacific/Kiritimati", "Etc/GMT+12"]) {
      process.env.TZ = tz;
      assert.equal(parseImportDate(46096).value, "2026-03-15");
    }
  } finally {
    process.env.TZ = originalTZ;
  }
});

// ─── Dedicated date-shape coverage (brief §10) ─────────────────────

test("parseImportDate: accepts UK-style DD/MM/YYYY and DD-MM-YYYY", () => {
  assert.equal(parseImportDate("15/03/2026").value, "2026-03-15");
  assert.equal(parseImportDate("15-03-2026").value, "2026-03-15");
  assert.equal(parseImportDate("1/3/2026").value, "2026-03-01", "single-digit day/month must still parse");
});

test("parseImportDate: accepts a date-with-time string, truncating the time component (never shifting the date)", () => {
  assert.equal(parseImportDate("2026-03-15T18:30:00").value, "2026-03-15");
  assert.equal(parseImportDate("2026-03-15 18:30:00").value, "2026-03-15");
  assert.equal(parseImportDate("15/03/2026 18:30").value, "2026-03-15");
});

test("parseImportDate: an Excel serial with a fractional (time-of-day) component floors to the correct calendar day", () => {
  // 46096.75 = 6pm on serial day 46096 (2026-03-15) — must not round up
  // into 2026-03-16.
  assert.equal(parseImportDate(46096.75).value, "2026-03-15");
});

test("parseImportDate: rejects an impossible calendar date rather than silently rolling it forward", () => {
  assert.equal(parseImportDate("2026-02-30").ok, false, "there is no Feb 30 — must not silently become March");
  assert.equal(parseImportDate("31/04/2026").ok, false, "April has 30 days");
});

test("parseImportDate: a blank cell is 'no date', not an error", () => {
  assert.deepEqual(parseImportDate(""), { ok: true, value: null });
  assert.deepEqual(parseImportDate("   "), { ok: true, value: null });
});

test("validateImportRow: finish-before-start is still caught when the dates arrive as UK-style strings", () => {
  const result = validateImportRow({ title: "X", planned_start: "15/02/2026", planned_finish: "01/02/2026" });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => /cannot be before/i.test(e)));
});
