// Programme changes PDF export (v100) — tests the REAL
// buildProgrammeChangesPdfDocument() (and its filename helper)
// extracted straight from app.js, run against the real `jspdf`
// package (a devDependency — production loads the identical pinned
// version via CDN import, see generateProgrammeChangesPdfBlob()'s own
// comment), producing genuine PDF bytes. Structural claims are
// verified with poppler's `pdftotext`/`pdfinfo` CLI tools against
// those real bytes — the exact same convention toolbox_talk_pdf.test.mjs
// already established — never against jsPDF's internal call log.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { jsPDF } from "jspdf";

const execFileAsync = promisify(execFile);
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractShallow(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

// buildProgrammeChangesPdfDocument() is large and deeply nested (helper
// closures) — same reasoning toolbox_talk_pdf.test.mjs's own
// extractDeep() already documents: walks real brace depth so it's
// correct regardless of nesting.
function extractDeep(name) {
  const sigMatch = APP_JS.match(new RegExp(`(?:export )?function ${name}\\(`));
  if (!sigMatch) throw new Error(`${name} not found in app.js`);
  const start = sigMatch.index;
  const parenStart = APP_JS.indexOf("(", start);
  let parenDepth = 0;
  let j = parenStart;
  for (; j < APP_JS.length; j++) {
    if (APP_JS[j] === "(") parenDepth++;
    else if (APP_JS[j] === ")") {
      parenDepth--;
      if (parenDepth === 0) { j++; break; }
    }
  }
  const braceStart = APP_JS.indexOf("{", j);
  let depth = 0;
  let i = braceStart;
  for (; i < APP_JS.length; i++) {
    if (APP_JS[i] === "{") depth++;
    else if (APP_JS[i] === "}") {
      depth--;
      if (depth === 0) { i++; break; }
    }
  }
  if (depth !== 0) throw new Error(`extractDeep(${name}): unbalanced braces — extraction is unreliable`);
  return APP_JS.slice(start, i).replace(/^export /, "");
}

const built = new Function(
  "jsPDF",
  `
  ${extractShallow("sanitizeExportFilename")}
  ${extractShallow("formatDateTime")}
  ${extractShallow("londonCalendarDate")}
  ${extractShallow("programmeChangesPdfFilename")}
  const PCR_PDF_PAGE = { width: 595.28, height: 841.89 };
  const PCR_PDF_MARGIN = 42;
  const PCR_PDF_CONTENT_WIDTH = PCR_PDF_PAGE.width - PCR_PDF_MARGIN * 2;
  const PCR_PDF_FOOTER_RESERVE = 30;
  ${extractDeep("buildProgrammeChangesPdfDocument")}
  return { buildProgrammeChangesPdfDocument, programmeChangesPdfFilename, formatDateTime };
  `
)(jsPDF);
const { buildProgrammeChangesPdfDocument, programmeChangesPdfFilename, formatDateTime } = built;

async function renderAndExtractText(doc) {
  const buf = Buffer.from(doc.output("arraybuffer"));
  const tmpFile = path.join(os.tmpdir(), `pcr-pdf-test-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpFile, buf);
  try {
    const { stdout: text } = await execFileAsync("pdftotext", ["-layout", tmpFile, "-"]);
    const { stdout: info } = await execFileAsync("pdfinfo", [tmpFile]);
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
    return { text, pages };
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

function makeRun(overrides = {}) {
  return {
    id: "run-1",
    project_id: "p1",
    programme_id: "prog1",
    imported_by: "u1",
    imported_at: "2026-04-06T10:00:00Z",
    created_count: 1,
    updated_count: 2,
    unchanged_count: 3,
    not_in_import_count: 1,
    changes: {
      entries: [
        { activity_id: "a1", title: "Roof Covering", created: false, old_title: null, old_planned_start: "2026-01-01", new_planned_start: "2026-01-01", old_planned_finish: "2026-02-01", new_planned_finish: "2026-02-15", start_slip_days: 0, finish_slip_days: 14, milestone_changed: false },
        { activity_id: "a2", title: "Groundworks", created: false, old_title: null, old_planned_start: "2026-01-05", new_planned_start: "2026-01-01", old_planned_finish: "2026-01-20", new_planned_finish: "2026-01-16", start_slip_days: -4, finish_slip_days: -4, milestone_changed: false },
        { activity_id: "a3", title: "Frame Erect", created: true, old_title: null, old_planned_start: null, new_planned_start: "2026-03-01", old_planned_finish: null, new_planned_finish: "2026-03-20", start_slip_days: null, finish_slip_days: null, milestone_changed: false },
      ],
      not_in_import: [
        { id: "a4", title: "Old Scaffold Task", external_id: "EXT-9" },
      ],
    },
    ...overrides,
  };
}

// ─── Basic generation ────────────────────────────────────────────────

test("PDF: generates successfully with project, programme, importer, date, and summary counts", async () => {
  const run = makeRun();
  const doc = buildProgrammeChangesPdfDocument({
    jsPDFCtor: jsPDF, run, projectName: "Red Dragon", programmeName: "Red Dragon Batch Rev 07", importedByLabel: "site.manager@example.com",
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Red Dragon"), "project name must appear");
  assert.ok(text.includes("Red Dragon Batch Rev 07"), "programme name must appear");
  assert.ok(text.includes("site.manager@example.com"), "importer must appear");
  assert.ok(text.includes(formatDateTime(run.imported_at)), "imported-at date, formatted exactly as formatDateTime() renders it, must appear");
  assert.ok(text.includes("Created: 1"), "created count must appear");
  assert.ok(text.includes("Updated: 2"), "updated count must appear");
  assert.ok(text.includes("Unchanged: 3"), "unchanged count must appear");
  assert.ok(text.includes("Not in import: 1"), "not-in-import count must appear");
});

test("PDF: 'dates moved' section lists moved rows sorted by biggest finish slip first, with old date, new date and slip in days", async () => {
  const run = makeRun();
  const doc = buildProgrammeChangesPdfDocument({ jsPDFCtor: jsPDF, run, projectName: "Red Dragon", programmeName: "Programme A", importedByLabel: "u@x.test" });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Dates moved (2)"), "both moved rows (a1, a2) must be counted — a3 is created, not moved");
  const roofIdx = text.indexOf("Roof Covering");
  const groundworksIdx = text.indexOf("Groundworks");
  assert.ok(roofIdx !== -1 && groundworksIdx !== -1, "both moved activities must appear");
  assert.ok(roofIdx < groundworksIdx, "Roof Covering (14d slip) must come before Groundworks (4d slip) — biggest slip first");
  assert.ok(text.includes("2026-02-01") && text.includes("2026-02-15"), "old and new planned finish dates must both appear for Roof Covering");
  assert.ok(text.includes("+14d"), "a positive slip must be shown with an explicit + sign");
  assert.ok(text.includes("-4d"), "a negative slip (pulled forward) must be shown with its sign");
  // jsPDF's built-in Helvetica only supports WinAnsi-encoded characters
  // — "→" (U+2192) isn't one of them and renders as a garbled glyph
  // (confirmed against a real render: "2026-07-01 !' 2026-07-08"), so
  // the old/new date separator must be the plain word "to", never an
  // arrow character.
  const roofLine = text.split("\n").find((l) => l.includes("Roof Covering"));
  assert.ok(roofLine, "the Roof Covering line must exist");
  assert.match(roofLine, / to /, "old date and new date must be joined by the word 'to'");
  assert.doesNotMatch(roofLine, /→/, "never a right-arrow character — Helvetica can't render it");
});

test("PDF: 'newly added' section lists created rows, excluded from 'dates moved'", async () => {
  const run = makeRun();
  const doc = buildProgrammeChangesPdfDocument({ jsPDFCtor: jsPDF, run, projectName: "Red Dragon", programmeName: "Programme A", importedByLabel: null });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Newly added (1)"));
  assert.ok(text.includes("Frame Erect"));
  assert.ok(text.includes("2026-03-01") && text.includes("2026-03-20"));
  const frameLine = text.split("\n").find((l) => l.includes("Frame Erect"));
  assert.match(frameLine, / to /, "the created row's own start/finish dates must also be joined by 'to', not an arrow");
  assert.doesNotMatch(frameLine, /→/);
});

test("PDF: no non-WinAnsi character ever reaches the page — jsPDF's built-in Helvetica can only draw WinAnsi-encoded glyphs, and a garbled character (confirmed empirically: a real render of '→' comes back from pdftotext as \"2026-07-01 !’ 2026-07-08\") would otherwise go unnoticed since the PDF 'succeeds' either way", async () => {
  const run = makeRun();
  const doc = buildProgrammeChangesPdfDocument({ jsPDFCtor: jsPDF, run, projectName: "Red Dragon", programmeName: "Programme A", importedByLabel: "u@x.test" });
  const { text } = await renderAndExtractText(doc);
  assert.doesNotMatch(text, /→/, "no right-arrow anywhere in the document");
  // The one non-ASCII character this builder's own literal strings use
  // is the em dash (—, U+2014) — WinAnsi position 0x97, already relied
  // on by several other jsPDF builders in this codebase (e.g.
  // buildPlotHandoverPdfDocument's own "—" fallback), and confirmed
  // here to render as a literal em dash, not a garbled glyph.
  assert.ok(text.includes("—"), "the em dash fallback (Project/Programme/Imported by) must render as itself");
});

test("PDF: 'not in this import' section lists existing activities absent from the import", async () => {
  const run = makeRun();
  const doc = buildProgrammeChangesPdfDocument({ jsPDFCtor: jsPDF, run, projectName: "Red Dragon", programmeName: "Programme A", importedByLabel: null });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Not in this import (1)"));
  assert.ok(text.includes("Old Scaffold Task"));
  assert.ok(text.includes("EXT-9"));
});

test("PDF: a run with nothing moved, nothing created, and nothing missing says so plainly in each section, never a blank page", async () => {
  const run = makeRun({
    created_count: 0, updated_count: 0, unchanged_count: 5, not_in_import_count: 0,
    changes: { entries: [], not_in_import: [] },
  });
  const doc = buildProgrammeChangesPdfDocument({ jsPDFCtor: jsPDF, run, projectName: "Red Dragon", programmeName: "Programme A", importedByLabel: null });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("No dates moved in this import."));
  assert.ok(text.includes("No new activities in this import."));
  assert.ok(text.includes("Every existing activity was present in this import."));
});

test("PDF: untitled/missing titles never crash the build and render a clear placeholder", async () => {
  const run = makeRun({
    changes: {
      entries: [{ activity_id: "a9", title: null, created: true, old_title: null, old_planned_start: null, new_planned_start: null, old_planned_finish: null, new_planned_finish: null, start_slip_days: null, finish_slip_days: null, milestone_changed: false }],
      not_in_import: [{ id: "a10", title: null, external_id: null }],
    },
  });
  const doc = buildProgrammeChangesPdfDocument({ jsPDFCtor: jsPDF, run, projectName: "Red Dragon", programmeName: "Programme A", importedByLabel: null });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("(untitled)"));
});

test("PDF: escapes/neutralises user-controlled text — a title containing characters that could otherwise break out of a template never corrupts the PDF", async () => {
  const run = makeRun({
    changes: {
      entries: [{ activity_id: "a11", title: `</script><img src=x onerror=alert(1)> & "quotes" 'ticks'`, created: true, old_title: null, old_planned_start: null, new_planned_start: "2026-05-01", old_planned_finish: null, new_planned_finish: "2026-05-11", start_slip_days: null, finish_slip_days: null, milestone_changed: false }],
      not_in_import: [],
    },
  });
  const doc = buildProgrammeChangesPdfDocument({ jsPDFCtor: jsPDF, run, projectName: "Red Dragon", programmeName: "Programme A", importedByLabel: null });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("quotes"), "the literal text content must still render — a PDF has no HTML to break out of, it just prints what it's given");
});

// ─── Filename ───────────────────────────────────────────────────────

test("programmeChangesPdfFilename: builds a sanitized, human-identifying filename from the programme name and the run's own London calendar date", () => {
  const run = makeRun({ imported_at: "2026-04-06T23:30:00Z" }); // 2026-04-07 00:30 BST -> London date is 2026-04-07
  const filename = programmeChangesPdfFilename(run, "Red Dragon Batch Rev 07");
  assert.match(filename, /\.pdf$/);
  assert.match(filename, /Programme changes/);
  assert.match(filename, /Red Dragon Batch Rev 07/);
});

test("programmeChangesPdfFilename: falls back to a plain date-based name when no programme name is available", () => {
  const run = makeRun();
  const filename = programmeChangesPdfFilename(run, null);
  assert.match(filename, /\.pdf$/);
  assert.match(filename, /2026-04-06/);
});
