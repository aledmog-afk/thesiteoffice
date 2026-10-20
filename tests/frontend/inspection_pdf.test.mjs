// Inspection report PDF export — tests the REAL
// buildInspectionPdfDocument() (and its small helpers) extracted
// straight from app.js, run against the real `jspdf` package (a
// devDependency — production loads the identical pinned version via
// CDN import, see generateInspectionPdfBlob()'s own comment), producing
// genuine PDF bytes. Structural claims (page count, text presence) are
// verified with poppler's `pdftotext`/`pdfinfo` CLI tools against those
// real bytes, not against jsPDF's internal call log — same convention
// as commercial_event_pdf.test.mjs/toolbox_talk_pdf.test.mjs.
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

function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

// Same brace-depth-counting extractor as commercial_event_pdf.test.mjs —
// see that file's own comment for why the shallow extractor can't
// handle a large, deeply-nested function like this one.
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
  ${extractShallow("formatDate")}
  ${extractShallow("inspectionPdfFilename")}
  ${extractDeep("detectImageFormat")}
  ${extractConst("INSPECTION_TYPE_LABEL")}
  ${extractConst("INSPECTION_STATUS_LABEL")}
  ${extractConst("FINDING_SEVERITY_LABEL")}
  ${extractConst("FINDING_STATUS_LABEL")}
  ${extractConst("FINDING_SEVERITY_PDF_COLOR")}
  ${extractConst("FINDING_STATUS_PDF_COLOR")}
  const INSP_PDF_PAGE = { width: 595.28, height: 841.89 };
  const INSP_PDF_MARGIN = 42;
  const INSP_PDF_CONTENT_WIDTH = INSP_PDF_PAGE.width - INSP_PDF_MARGIN * 2;
  const INSP_PDF_FOOTER_RESERVE = 30;
  ${extractDeep("buildInspectionPdfDocument")}
  return { buildInspectionPdfDocument, inspectionPdfFilename };
  `
)(jsPDF);
const { buildInspectionPdfDocument, inspectionPdfFilename } = built;

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function makeInspection(overrides = {}) {
  return {
    id: "insp-1",
    title: "Pre-handover quality walk — Plot 4",
    inspection_type: "quality",
    status: "completed",
    inspection_date: "2026-03-10",
    conducted_by: "J. Smith",
    description: "Routine walk ahead of handover sign-off.",
    ...overrides,
  };
}

function makeFinding(overrides = {}) {
  return {
    id: "f-1",
    title: "Skirting board gap, kitchen wall",
    description: "Approx 4mm gap behind the skirting, left of the window.",
    severity: "medium",
    status: "open",
    plot_id: null,
    ...overrides,
  };
}

async function renderAndExtractText(doc) {
  const buf = Buffer.from(doc.output("arraybuffer"));
  const tmpFile = path.join(os.tmpdir(), `insp-pdf-test-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpFile, buf);
  try {
    const { stdout: text } = await execFileAsync("pdftotext", ["-layout", tmpFile, "-"]);
    const { stdout: info } = await execFileAsync("pdfinfo", [tmpFile]);
    const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1] || 0);
    return { buf, text, pages, tmpFile };
  } finally {
    fs.unlinkSync(tmpFile);
  }
}

// ─── Basic generation ──────────────────────────────────────────────

test("PDF: a completed inspection generates successfully with title, type, project, inspector", async () => {
  const doc = buildInspectionPdfDocument({
    jsPDFCtor: jsPDF, inspection: makeInspection(), findings: [makeFinding()],
    projectName: "Riverside Phase 2", orgName: "ABC Construction", logo: null,
  });
  const { text, pages } = await renderAndExtractText(doc);
  assert.ok(pages >= 1);
  assert.ok(text.includes("Pre-handover quality walk"));
  assert.ok(text.includes("Quality"));
  assert.ok(text.includes("Completed"));
  assert.ok(text.includes("Riverside Phase 2"));
  assert.ok(text.includes("J. Smith"));
});

test("PDF: refuses to build for a draft or cancelled inspection — only a completed one may be exported", () => {
  assert.throws(
    () => buildInspectionPdfDocument({ jsPDFCtor: jsPDF, inspection: makeInspection({ status: "draft" }), findings: [] }),
    /completed/i
  );
  assert.throws(
    () => buildInspectionPdfDocument({ jsPDFCtor: jsPDF, inspection: makeInspection({ status: "cancelled" }), findings: [] }),
    /completed/i
  );
});

test("PDF: the inspection's own notes/description appear under a Notes heading", async () => {
  const doc = buildInspectionPdfDocument({
    jsPDFCtor: jsPDF, inspection: makeInspection({ description: "Site was wet underfoot; findings below are unaffected." }), findings: [],
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Notes"));
  assert.ok(text.includes("Site was wet underfoot"));
});

// ─── Findings ──────────────────────────────────────────────────────

test("PDF: a finding shows its title, severity, status and description", async () => {
  const doc = buildInspectionPdfDocument({
    jsPDFCtor: jsPDF, inspection: makeInspection(),
    findings: [makeFinding({ severity: "high", status: "action_required", description: "Needs a joiner back out." })],
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Skirting board gap"));
  assert.ok(text.includes("High"));
  assert.ok(text.includes("Action Required"));
  assert.ok(text.includes("Needs a joiner back out."));
});

test("PDF: a finding's plot shows via plotLabel() when the finding has a plot_id, and is omitted when it doesn't", async () => {
  const withPlot = buildInspectionPdfDocument({
    jsPDFCtor: jsPDF, inspection: makeInspection(),
    findings: [makeFinding({ plot_id: "p-9" })],
    plotLabel: (id) => (id === "p-9" ? "Plot 9" : null),
  });
  const { text: textWithPlot } = await renderAndExtractText(withPlot);
  assert.ok(textWithPlot.includes("Plot 9"));

  const withoutPlot = buildInspectionPdfDocument({
    jsPDFCtor: jsPDF, inspection: makeInspection(), findings: [makeFinding({ plot_id: null })],
  });
  const { text: textWithoutPlot } = await renderAndExtractText(withoutPlot);
  assert.ok(!textWithoutPlot.includes("Plot 9"));
});

test("PDF: zero findings still generates, showing an explicit empty state", async () => {
  const doc = buildInspectionPdfDocument({ jsPDFCtor: jsPDF, inspection: makeInspection(), findings: [] });
  const { text } = await renderAndExtractText(doc);
  assert.ok(/no findings recorded/i.test(text));
});

test("PDF: several findings each render in full, in order", async () => {
  const doc = buildInspectionPdfDocument({
    jsPDFCtor: jsPDF, inspection: makeInspection(),
    findings: [
      makeFinding({ id: "f-1", title: "Missing fire stopping" }),
      makeFinding({ id: "f-2", title: "Loose balustrade on stairs" }),
      makeFinding({ id: "f-3", title: "Paint touch-up required, hallway" }),
    ],
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Missing fire stopping"));
  assert.ok(text.includes("Loose balustrade on stairs"));
  assert.ok(text.includes("Paint touch-up required"));
  const firstIdx = text.indexOf("Missing fire stopping");
  const secondIdx = text.indexOf("Loose balustrade");
  const thirdIdx = text.indexOf("Paint touch-up");
  assert.ok(firstIdx < secondIdx && secondIdx < thirdIdx, "findings must appear in the order given, not reordered");
});

// ─── Photos ──────────────────────────────────────────────────────────

test("PDF: a finding's photos are embedded as images, not merely referenced — real bytes must materially increase", async () => {
  const withoutPhotos = buildInspectionPdfDocument({ jsPDFCtor: jsPDF, inspection: makeInspection(), findings: [makeFinding()] });
  const { buf: bufWithout } = await renderAndExtractText(withoutPhotos);

  const withPhotos = buildInspectionPdfDocument({
    jsPDFCtor: jsPDF, inspection: makeInspection(), findings: [makeFinding()],
    findingPhotos: { "f-1": [{ dataUrl: TINY_PNG_DATA_URL, width: 10, height: 10 }, { dataUrl: TINY_PNG_DATA_URL, width: 10, height: 10 }] },
  });
  const { buf: bufWith } = await renderAndExtractText(withPhotos);
  assert.ok(bufWith.length > bufWithout.length, "embedding real photo bytes must increase the PDF's own byte size");
});

test("PDF: a photo that failed to load (null) draws an empty frame, never crashes the export", async () => {
  assert.doesNotThrow(() => {
    buildInspectionPdfDocument({
      jsPDFCtor: jsPDF, inspection: makeInspection(), findings: [makeFinding()],
      findingPhotos: { "f-1": [null, { dataUrl: TINY_PNG_DATA_URL, width: 10, height: 10 }] },
    });
  });
});

test("PDF: a finding with no photos shows no photo grid at all (not an empty one)", async () => {
  const doc = buildInspectionPdfDocument({
    jsPDFCtor: jsPDF, inspection: makeInspection(), findings: [makeFinding()], findingPhotos: {},
  });
  const { pages } = await renderAndExtractText(doc);
  assert.equal(pages, 1, "no photos and one short finding must never spill onto a second page");
});

// ─── Filename & page format ──────────────────────────────────────────

test("PDF: filename is built from the inspection date and title, sanitized for the filesystem", () => {
  assert.equal(inspectionPdfFilename(makeInspection()), "2026-03-10 - Pre-handover quality walk — Plot 4.pdf");
});

test("PDF: every page is genuinely A4 and carries a page-number footer", async () => {
  const doc = buildInspectionPdfDocument({ jsPDFCtor: jsPDF, inspection: makeInspection(), findings: [makeFinding()] });
  const buf = Buffer.from(doc.output("arraybuffer"));
  const tmpFile = path.join(os.tmpdir(), `insp-pdf-a4-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpFile, buf);
  try {
    const { stdout: info } = await execFileAsync("pdfinfo", [tmpFile]);
    assert.match(info, /Page size:\s+595(\.\d+)? x 841(\.\d+)? pts/);
    const { stdout: text } = await execFileAsync("pdftotext", ["-layout", tmpFile, "-"]);
    assert.match(text, /Page 1 of \d+/);
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
