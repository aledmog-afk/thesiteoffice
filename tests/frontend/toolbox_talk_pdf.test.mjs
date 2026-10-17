// Toolbox Talk PDF export — tests the REAL buildToolboxTalkPdfDocument()
// (and its small helpers) extracted straight from app.js, run against the
// real `jspdf` package (a devDependency — production loads the identical
// pinned version via CDN import, see generateToolboxTalkPdfBlob()'s own
// comment), producing genuine PDF bytes. Structural claims (page count,
// text presence, absence of stale content) are verified with poppler's
// `pdftotext`/`pdfinfo` CLI tools against those real bytes — not against
// jsPDF's internal call log — so these tests catch the same class of bug
// a human proof-reading the PDF would catch.
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

// Simple functions with no nested { } blocks of their own — the
// established shallow extractor (variation_workflow.test.mjs's own
// extractFunction()) is exactly right for these.
function extractShallow(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

// buildToolboxTalkPdfDocument() is large and deeply nested (helper
// closures, if/for blocks) — the shallow extractor above would stop at
// the first inner "}\n" it meets, truncating the function. This walks
// real brace depth from the function's opening "{" to its matching
// close instead, which is correct regardless of nesting (template-
// literal ${...} braces are always self-balanced, so counting every literal
// "{"/"}" in the source is safe here — there are no comments or string/regex
// literals in this function containing an unbalanced brace character).
function extractDeep(name) {
  const sigMatch = APP_JS.match(new RegExp(`(?:export )?function ${name}\\(`));
  if (!sigMatch) throw new Error(`${name} not found in app.js`);
  const start = sigMatch.index;
  const parenStart = APP_JS.indexOf("(", start);
  // Walk the parameter list's own parens first (it may destructure an
  // object — "{ a, b }" — whose braces must NOT be mistaken for the
  // function body's opening brace).
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
  ${extractShallow("toolboxTalkSignatureProgress")}
  ${extractShallow("formatDateTime")}
  ${extractShallow("formatTimeOnly")}
  ${extractShallow("toolboxTalkPdfFilename")}
  ${extractDeep("detectImageFormat")}
  const TT_PDF_PAGE = { width: 595.28, height: 841.89 };
  const TT_PDF_MARGIN = 42;
  const TT_PDF_CONTENT_WIDTH = TT_PDF_PAGE.width - TT_PDF_MARGIN * 2;
  const TT_PDF_FOOTER_RESERVE = 30;
  ${extractDeep("buildToolboxTalkPdfDocument")}
  return { buildToolboxTalkPdfDocument, toolboxTalkPdfFilename, toolboxTalkSignatureProgress, formatDateTime, formatTimeOnly, sanitizeExportFilename };
  `
)(jsPDF);
const { buildToolboxTalkPdfDocument, toolboxTalkPdfFilename, formatDateTime, formatTimeOnly } = built;

// A 1x1 red PNG, standing in for a real canvas-drawn signature — small
// enough to keep the test fast, but a real, decodable PNG data URL
// exactly like canvas.toDataURL("image/png") produces, so addImage()
// exercises the real embed path rather than being skipped.
const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const BASE_CONTENT = {
  introduction: "Falls from height are the single biggest killer in the UK construction industry.",
  key_message: "Every job at height needs planning — every time.",
  key_points: [
    "The law — The Work at Height Regulations 2005 apply to any work where a person could fall.",
    "Hierarchy of control — avoid, collective protection, then personal protection.",
  ],
  site_observations: {
    good_practice: ["CISRS inspection tag visible and in date", "Guard rails in place"],
    warning_signs: ["Missing or damaged scaffold boards", "Guard rails removed"],
  },
  discussion_questions: ["What would you do if you noticed a missing board?"],
  key_takeaways: ["We will inspect scaffold before use — every time"],
  pre_task_checks: ["Scaffold inspected — CISRS tag in date"],
};

function makeTalk(overrides = {}) {
  return {
    id: "talk-1",
    reference: "TT-003",
    title: "Working at Height",
    status: "completed",
    started_at: "2026-03-04T08:00:00Z",
    completed_at: "2026-03-04T08:22:00Z",
    site_notes: null,
    content_snapshot: BASE_CONTENT,
    template_version_number: 2,
    ...overrides,
  };
}

function makeAttendee(overrides = {}) {
  return {
    id: "a1", name: "John Smith", company: "ABC Ltd",
    signed_at: "2026-03-04T08:17:00Z", signature_data: TINY_PNG_DATA_URL, signature_typed_name: null,
    exception_reason: null, exception_at: null,
    ...overrides,
  };
}

async function renderAndExtractText(doc) {
  const buf = Buffer.from(doc.output("arraybuffer"));
  const tmpFile = path.join(os.tmpdir(), `tt-pdf-test-${Math.random().toString(36).slice(2)}.pdf`);
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

// ─── Basic generation ────────────────────────────────────────────────

test("PDF: a completed talk generates successfully with correct title, reference, version, project, date, deliverer", async () => {
  const talk = makeTalk();
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "Riverside Phase 2", orgName: "ABC Construction",
    logo: null, attendees: [makeAttendee()], deliveredByLabel: "site.manager@example.com",
  });
  const { text, pages } = await renderAndExtractText(doc);
  assert.ok(pages >= 2, "expected at least a content page + a dedicated attendance page");
  assert.ok(text.includes("Working at Height"), "title must appear");
  assert.ok(text.includes("TT-003"), "reference must appear");
  assert.ok(text.includes("Version 2"), "template version must appear");
  assert.ok(text.includes("Riverside Phase 2"), "project name must appear");
  assert.ok(text.includes("ABC Construction"), "organisation name must appear");
  assert.ok(text.includes("site.manager@example.com"), "deliverer must appear");
  assert.ok(text.includes(formatTimeOnly(talk.started_at)), "start time must appear");
});

test("PDF: refuses to build for a talk that is not completed", () => {
  const talk = makeTalk({ status: "in_progress" });
  assert.throws(
    () => buildToolboxTalkPdfDocument({ jsPDFCtor: jsPDF, talk, projectName: "X", orgName: null, logo: null, attendees: [], deliveredByLabel: null }),
    /Only a completed Toolbox Talk/
  );
});

test("PDF: omits fields that genuinely have no value, rather than inventing placeholder text", async () => {
  const talk = makeTalk({ completed_at: "2026-03-04T08:22:00Z" });
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: null, orgName: null, logo: null,
    attendees: [makeAttendee()], deliveredByLabel: null,
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(!text.includes("PROJECT"), "no Project row when projectName is null");
  assert.ok(!text.includes("ORGANISATION"), "no Organisation row when orgName is null");
  assert.ok(!text.includes("DELIVERED BY"), "no Delivered By row when deliveredByLabel is null");
});

// ─── Content integrity ─────────────────────────────────────────────────

test("PDF: uses the content_snapshot verbatim, including every section", async () => {
  const talk = makeTalk();
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null,
    attendees: [makeAttendee()], deliveredByLabel: "d@example.com",
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Falls from height are the single biggest killer"), "introduction verbatim");
  assert.ok(text.includes("Every job at height needs planning"), "key message verbatim");
  assert.ok(text.includes("The Work at Height Regulations 2005"), "key point verbatim");
  assert.ok(text.includes("CISRS inspection tag visible and in date"), "good practice verbatim");
  assert.ok(text.includes("Missing or damaged scaffold boards"), "warning sign verbatim");
  assert.ok(text.includes("What would you do if you noticed a missing board?"), "discussion question verbatim");
  assert.ok(text.includes("We will inspect scaffold before use"), "key takeaway verbatim");
  assert.ok(text.includes("Scaffold inspected"), "pre-task check verbatim");
});

test("PDF: a later template edit does not alter the historical PDF — it is built from the talk's own frozen content_snapshot, never re-fetched", async () => {
  // The snapshot the talk was actually delivered with (v2) vs a
  // DIFFERENT, edited snapshot (v3) — buildToolboxTalkPdfDocument()
  // takes only the plain talk object handed to it; there is no path by
  // which it could reach back to "the current template" even if it
  // wanted to.
  const deliveredSnapshot = { introduction: "Version 2 wording — the wording actually delivered." };
  const editedLaterSnapshot = { introduction: "Version 3 wording — edited after this talk was delivered." };
  const talk = makeTalk({ content_snapshot: deliveredSnapshot, template_version_number: 2 });
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null,
    attendees: [makeAttendee()], deliveredByLabel: "d@example.com",
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Version 2 wording"));
  assert.ok(!text.includes(editedLaterSnapshot.introduction), "the later, edited wording must never appear");
});

test("PDF: site-specific notes appear, clearly separated from the standard content, and are omitted entirely when absent", async () => {
  const withNotes = makeTalk({ site_notes: "High winds today — postponed roof work until after lunch." });
  const doc1 = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk: withNotes, projectName: "P", orgName: "O", logo: null,
    attendees: [makeAttendee()], deliveredByLabel: "d@example.com",
  });
  const { text: text1 } = await renderAndExtractText(doc1);
  assert.ok(text1.includes("Site-Specific Notes"));
  assert.ok(text1.includes("High winds today"));

  const withoutNotes = makeTalk({ site_notes: null });
  const doc2 = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk: withoutNotes, projectName: "P", orgName: "O", logo: null,
    attendees: [makeAttendee()], deliveredByLabel: "d@example.com",
  });
  const { text: text2 } = await renderAndExtractText(doc2);
  assert.ok(!text2.includes("Site-Specific Notes"), "heading must not appear when there are no notes");
});

// ─── Attendance ────────────────────────────────────────────────────────

test("PDF: every attendee appears individually — with company, and either signature/typed-name/exception evidence and a timestamp — never a single group signature", async () => {
  const talk = makeTalk();
  const attendees = [
    makeAttendee({ id: "a1", name: "John Smith", company: "ABC Ltd", signed_at: "2026-03-04T08:17:00Z", signature_data: TINY_PNG_DATA_URL }),
    makeAttendee({ id: "a2", name: "Dave Jones", company: "ABC Ltd", signed_at: "2026-03-04T08:19:00Z", signature_data: null, signature_typed_name: "Dave Jones" }),
    makeAttendee({ id: "a3", name: "Priya Patel", company: null, signed_at: null, signature_data: null, exception_reason: "Left site before the talk finished", exception_at: "2026-03-04T08:20:00Z" }),
  ];
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null, attendees, deliveredByLabel: "d@example.com",
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("John Smith"));
  assert.ok(text.includes("Dave Jones"));
  assert.ok(text.includes("Priya Patel"));
  assert.ok(text.includes("ABC Ltd"));
  assert.ok(text.includes("typed-name attestation"), "typed-name evidence must be labelled as such");
  assert.ok(text.includes("Exception: Left site before the talk finished"));
  assert.ok(text.includes(formatTimeOnly("2026-03-04T08:17:00Z")));
  assert.ok(text.includes(formatTimeOnly("2026-03-04T08:19:00Z")));
  assert.ok(text.includes(formatTimeOnly("2026-03-04T08:20:00Z")));
  assert.ok(text.includes("3 of 3 attendee(s) resolved"));
});

test("PDF: shows COMPLETED status and the attendance tally only from the real talk/attendee data passed in", async () => {
  const talk = makeTalk({ completed_at: "2026-03-04T08:22:00Z" });
  const attendees = [makeAttendee({ id: "a1" }), makeAttendee({ id: "a2", signed_at: null, signature_data: null, exception_reason: "unwell" })];
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null, attendees, deliveredByLabel: "d@example.com",
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("STATUS: COMPLETED"));
  assert.ok(text.includes("Attendance: 2 of 2 attendee(s) signed or recorded"));
  assert.ok(text.includes(formatDateTime(talk.completed_at).split(",")[0]), "completion date must appear");
});

// ─── Edge cases ──────────────────────────────────────────────────────

test("PDF: a talk with many attendees paginates the attendance table across multiple pages, each with its own repeated column header", async () => {
  const talk = makeTalk();
  const attendees = Array.from({ length: 40 }, (_, i) => makeAttendee({ id: `a${i}`, name: `Attendee Number ${i}`, signature_data: TINY_PNG_DATA_URL }));
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null, attendees, deliveredByLabel: "d@example.com",
  });
  const { text, pages } = await renderAndExtractText(doc);
  assert.ok(pages >= 3, `expected several pages for 40 attendees, got ${pages}`);
  assert.ok(text.includes("Attendee Number 0"));
  assert.ok(text.includes("Attendee Number 39"), "the last attendee, on a later page, must still appear");
  assert.ok(text.includes("continued"), "a repeated/continued heading must appear on later attendance pages");
});

test("PDF: a long talk (many key points, long paragraphs) flows across multiple pages without losing content", async () => {
  const longContent = {
    ...BASE_CONTENT,
    introduction: "This is a very long introduction. ".repeat(60),
    key_points: Array.from({ length: 25 }, (_, i) => `Key point number ${i}: ${"detail ".repeat(20)}`),
  };
  const talk = makeTalk({ content_snapshot: longContent });
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null, attendees: [makeAttendee()], deliveredByLabel: "d@example.com",
  });
  const { text, pages } = await renderAndExtractText(doc);
  assert.ok(pages >= 3, `expected multiple content pages before the attendance page, got ${pages}`);
  assert.ok(text.includes("Key point number 0:"));
  assert.ok(text.includes("Key point number 24:"), "content near the end of a long section must not be dropped");
});

test("PDF: long attendee names and company names wrap rather than overflow into neighbouring columns unreadably", async () => {
  const talk = makeTalk();
  const attendees = [
    makeAttendee({
      id: "a1",
      name: "Christopher Alexander Wolstenholme-Fitzgerald",
      company: "A Very Long Subcontractor Company Name Limited",
    }),
  ];
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null, attendees, deliveredByLabel: "d@example.com",
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Christopher"), "long name must still be present, wrapped rather than dropped");
  assert.ok(text.includes("Subcontractor"), "long company name must still be present");
});

test("PDF: a talk with no attendees still generates, showing an explicit empty state rather than a broken table", async () => {
  const talk = makeTalk();
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null, attendees: [], deliveredByLabel: "d@example.com",
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("No attendees recorded."));
  assert.ok(text.includes("0 of 0 attendee(s) resolved"));
});

test("PDF: a signature that fails to decode falls back to a clear message rather than crashing the export", async () => {
  const talk = makeTalk();
  const attendees = [makeAttendee({ signature_data: "data:image/png;base64,not-actually-valid-base64!!" })];
  assert.doesNotThrow(() => {
    buildToolboxTalkPdfDocument({
      jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null, attendees, deliveredByLabel: "d@example.com",
    });
  });
});

// ─── Filename ────────────────────────────────────────────────────────

test("toolboxTalkPdfFilename(): builds a clean, reference-led filename; falls back to the title alone when no reference exists yet", () => {
  assert.equal(toolboxTalkPdfFilename({ reference: "TT-007", title: "Working at Height" }), "TT-007 - Working at Height.pdf");
  assert.equal(toolboxTalkPdfFilename({ reference: null, title: "Manual Handling" }), "Manual Handling.pdf");
});

// ─── Page layout sanity ────────────────────────────────────────────────

test("PDF: every page is genuinely A4 and carries a page-number footer", async () => {
  const talk = makeTalk();
  const attendees = Array.from({ length: 30 }, (_, i) => makeAttendee({ id: `a${i}`, name: `Attendee ${i}` }));
  const doc = buildToolboxTalkPdfDocument({
    jsPDFCtor: jsPDF, talk, projectName: "P", orgName: "O", logo: null, attendees, deliveredByLabel: "d@example.com",
  });
  const buf = Buffer.from(doc.output("arraybuffer"));
  const tmpFile = path.join(os.tmpdir(), `tt-pdf-a4-${Math.random().toString(36).slice(2)}.pdf`);
  fs.writeFileSync(tmpFile, buf);
  try {
    const { stdout: info } = await execFileAsync("pdfinfo", [tmpFile]);
    assert.match(info, /Page size:\s+595(\.\d+)? x 841(\.\d+)? pts \(A4\)/);
    const { stdout: text } = await execFileAsync("pdftotext", ["-layout", tmpFile, "-"]);
    assert.ok(/Page \d+ of \d+/.test(text), "page-number footer must appear");
  } finally {
    fs.unlinkSync(tmpFile);
  }
});
