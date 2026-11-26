// v101: the downloadable Programme import template — a pure, testable
// row-builder (buildProgrammeImportTemplateRows(), defined directly in
// programme-import.html's own inline script, the same split
// plot-handovers.html's exportTrackers() already established:
// pure array-of-aoa-rows separate from the actual XLSX.writeFile()
// call). Extracted from the real page source, never reimplemented.
// The click handler itself (the real dynamic esm.sh XLSX import and
// file write) is not exercised here — no test in this suite exercises
// that dynamic-import write path for any of the app's existing
// Export-style buttons either (plot-handovers.html's own exportTrackers()
// has none); what's worth proving deterministically, without a real
// network call, is that the template's own column headers are right.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("../../tracker/programme-import.html", import.meta.url).pathname, "utf8");

function extractFn(name) {
  const m = HTML.match(new RegExp(`function ${name}\\(\\)\\s*\\{[\\s\\S]*?\\n  \\}\\n`));
  assert.ok(m, `${name} not found in programme-import.html`);
  return m[0];
}

const { buildProgrammeImportTemplateRows } = new Function(`
  ${extractFn("buildProgrammeImportTemplateRows")}
  return { buildProgrammeImportTemplateRows };
`)();

test("buildProgrammeImportTemplateRows: the header row carries every column this import understands, old and new alike", () => {
  const rows = buildProgrammeImportTemplateRows();
  const headers = rows[0];
  for (const col of ["Activity ID", "Title", "Plot Number", "Milestone", "Planned Start", "Planned Finish", "Summary", "% Complete"]) {
    assert.ok(headers.includes(col), `missing header: ${col}`);
  }
});

test("buildProgrammeImportTemplateRows: Summary and % Complete appear AFTER every pre-v101 column, so an old-format file's own column order is still what a reader expects to see first", () => {
  const headers = buildProgrammeImportTemplateRows()[0];
  const summaryIdx = headers.indexOf("Summary");
  const pctIdx = headers.indexOf("% Complete");
  const oldColumns = ["Activity ID", "Title", "Plot Number", "Milestone", "Planned Start", "Planned Finish"];
  for (const col of oldColumns) {
    assert.ok(headers.indexOf(col) < summaryIdx, `${col} must come before Summary`);
    assert.ok(headers.indexOf(col) < pctIdx, `${col} must come before % Complete`);
  }
});

test("buildProgrammeImportTemplateRows: includes a worked example of a summary row (Summary=Y, no % complete) and an ordinary task with a % complete, so the two optional columns are self-explanatory", () => {
  const rows = buildProgrammeImportTemplateRows();
  const headers = rows[0];
  const summaryCol = headers.indexOf("Summary");
  const pctCol = headers.indexOf("% Complete");
  const dataRows = rows.slice(1);
  assert.ok(dataRows.some((r) => String(r[summaryCol] || "").toUpperCase() === "Y"), "at least one example row must demonstrate Summary=Y");
  assert.ok(dataRows.some((r) => typeof r[pctCol] === "number" && r[pctCol] > 0), "at least one example row must demonstrate a real % complete value");
  // Every data row must be the same width as the header row — a
  // ragged array-of-arrays would otherwise misalign columns once
  // XLSX.utils.aoa_to_sheet() lays them out.
  for (const r of dataRows) assert.equal(r.length, headers.length);
});
