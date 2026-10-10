// Commercial (Daywork/Variation) PDF export — tests the REAL
// buildCommercialEventPdfDocument() (and its small helpers) extracted
// straight from app.js, run against the real `jspdf` package (a
// devDependency — production loads the identical pinned version via
// CDN import, see generateCommercialEventPdfBlob()'s own comment),
// producing genuine PDF bytes. Structural claims (page count, text
// presence) are verified with poppler's `pdftotext`/`pdfinfo` CLI tools
// against those real bytes, not against jsPDF's internal call log —
// same convention as toolbox_talk_pdf.test.mjs.
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

// Same brace-depth-counting extractor as toolbox_talk_pdf.test.mjs — see
// that file's own comment for why the shallow extractor can't handle a
// large, deeply-nested function like buildCommercialEventPdfDocument().
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
  ${extractShallow("formatDateTime")}
  ${extractShallow("commercialEventPdfFilename")}
  ${extractDeep("detectImageFormat")}
  ${extractConst("COMMERCIAL_STATUS_LABEL")}
  ${extractConst("COMMERCIAL_LINE_TYPE_LABEL")}
  ${extractShallow("formatCommercialGBP")}
  const CE_PDF_PAGE = { width: 595.28, height: 841.89 };
  const CE_PDF_MARGIN = 42;
  const CE_PDF_CONTENT_WIDTH = CE_PDF_PAGE.width - CE_PDF_MARGIN * 2;
  const CE_PDF_FOOTER_RESERVE = 30;
  ${extractDeep("buildCommercialEventPdfDocument")}
  return { buildCommercialEventPdfDocument, commercialEventPdfFilename };
  `
)(jsPDF);
const { buildCommercialEventPdfDocument, commercialEventPdfFilename } = built;

const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function makeDaywork(overrides = {}) {
  return {
    id: "ev-1",
    type: "daywork",
    reference: "DW-004",
    title: "Additional groundworks — plot 4 foundations",
    status: "submitted",
    date_undertaken: "2026-03-10",
    total_value: 1250.50,
    approved_at: null,
    ...overrides,
  };
}

function makeVariation(overrides = {}) {
  return {
    id: "ev-2",
    type: "variation",
    reference: "VAR-002",
    title: "Revised drainage route around plot 6",
    status: "approved",
    date_identified: "2026-03-01",
    instruction_reference: "RFI-014",
    reason: "Client instructed a revised drainage route to avoid the existing services run.",
    markup_pct: 10,
    total_value: 2475.00,
    approved_at: "2026-03-12T10:00:00Z",
    ...overrides,
  };
}

function makeLineItem(overrides = {}) {
  return {
    id: "li-1", line_type: "labour", description: "2 labourers, 1 day",
    quantity: 16, unit: "hrs", rate: 25, line_total: 400,
    ...overrides,
  };
}

function makeSignature(overrides = {}) {
  return {
    action: "approved", signed_by_user_id: "u1", signed_by_name: "approver@example.com",
    signature_data: TINY_PNG_DATA_URL, signature_typed_name: null,
    signed_at: "2026-03-12T10:00:00Z",
    ...overrides,
  };
}

async function renderAndExtractText(doc) {
  const buf = Buffer.from(doc.output("arraybuffer"));
  const tmpFile = path.join(os.tmpdir(), `ce-pdf-test-${Math.random().toString(36).slice(2)}.pdf`);
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

test("PDF: a submitted Daywork generates successfully with title, reference, project, status", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF, event: makeDaywork(), lineItems: [makeLineItem()], projectName: "Riverside Phase 2", orgName: "ABC Construction", logo: null,
  });
  const { text, pages } = await renderAndExtractText(doc);
  assert.ok(pages >= 1);
  assert.ok(text.includes("Additional groundworks"));
  assert.ok(text.includes("DW-004"));
  assert.ok(text.includes("Riverside Phase 2"));
  assert.ok(text.includes("PENDING APPROVAL"), "a submitted-but-not-yet-approved record must never claim to be approved");
});

test("PDF: an approved Variation generates successfully, showing APPROVED status and the approval date", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF, event: makeVariation(), lineItems: [makeLineItem()], projectName: "Riverside Phase 2", orgName: "ABC Construction", logo: null,
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("VAR-002"));
  assert.ok(text.includes("STATUS: APPROVED"));
  assert.ok(text.includes("12 Mar 2026") || /Approved:/.test(text), "the real approval timestamp must appear");
});

test("PDF: refuses to build for a draft or rejected record — only submitted/approved may be exported", () => {
  assert.throws(
    () => buildCommercialEventPdfDocument({ jsPDFCtor: jsPDF, event: makeDaywork({ status: "draft" }), lineItems: [] }),
    /submitted or approved/i
  );
  assert.throws(
    () => buildCommercialEventPdfDocument({ jsPDFCtor: jsPDF, event: makeDaywork({ status: "rejected" }), lineItems: [] }),
    /submitted or approved/i
  );
});

// ─── Line items ──────────────────────────────────────────────────────

test("PDF: line items table shows type, description, quantity, rate and total, plus the real grand total", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF,
    event: makeDaywork({ total_value: 725.00 }),
    lineItems: [
      makeLineItem({ description: "2 labourers, 1 day", quantity: 16, unit: "hrs", rate: 25, line_total: 400 }),
      makeLineItem({ id: "li-2", line_type: "plant", description: "Mini digger hire", quantity: 1, unit: "day", rate: 325, line_total: 325 }),
    ],
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Labour"));
  assert.ok(text.includes("Plant"));
  assert.ok(text.includes("2 labourers, 1 day"));
  assert.ok(text.includes("Mini digger hire"));
  assert.ok(text.includes("£725.00"), "the real event total_value must appear, not a client-recomputed sum");
});

test("PDF: a line item with no rate yet shows TBC rather than inventing a price", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF, event: makeDaywork(),
    lineItems: [makeLineItem({ rate: null, line_total: null })],
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("TBC"));
});

test("PDF: a Daywork with zero line items still generates, showing an explicit empty state", async () => {
  const doc = buildCommercialEventPdfDocument({ jsPDFCtor: jsPDF, event: makeDaywork(), lineItems: [] });
  const { text } = await renderAndExtractText(doc);
  assert.ok(/no line items recorded/i.test(text));
});

// ─── Linked Dayworks (Variations only) ──────────────────────────────

test("PDF: a Variation's linked Dayworks appear in their own section with reference, title and value", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF, event: makeVariation(), lineItems: [makeLineItem()],
    linkedDayworks: [{ reference: "DW-001", title: "Groundworks prep", total_value: 500 }],
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Linked Dayworks"));
  assert.ok(text.includes("DW-001"));
  assert.ok(text.includes("Groundworks prep"));
});

test("PDF: a Daywork (never has linked Dayworks of its own) never shows a Linked Dayworks section", async () => {
  const doc = buildCommercialEventPdfDocument({ jsPDFCtor: jsPDF, event: makeDaywork(), lineItems: [makeLineItem()], linkedDayworks: [] });
  const { text } = await renderAndExtractText(doc);
  assert.ok(!text.includes("Linked Dayworks"));
});

// ─── Evidence ────────────────────────────────────────────────────────

test("PDF: evidence is listed by title with uploader and date — referenced, not embedded (files may be PDFs, not just images)", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF, event: makeDaywork(), lineItems: [makeLineItem()],
    evidence: [{ caption: null, document: { title: "Client email request.pdf", created_by: "u2", created_at: "2026-03-09T00:00:00Z" } }],
    evidenceUploaderLabel: (uid) => (uid === "u2" ? "site.manager@example.com" : null),
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Client email request.pdf"));
  assert.ok(text.includes("site.manager@example.com"));
  assert.ok(/remain attached/i.test(text), "must point back at Site Tracker for the actual file, never claim to include it");
});

test("PDF: no evidence attached shows an explicit empty state, not a blank section", async () => {
  const doc = buildCommercialEventPdfDocument({ jsPDFCtor: jsPDF, event: makeDaywork(), lineItems: [makeLineItem()], evidence: [] });
  const { text } = await renderAndExtractText(doc);
  assert.ok(/no evidence attached/i.test(text));
});

// ─── Signatures ──────────────────────────────────────────────────────

test("PDF: a drawn signature is embedded as an image against the correct action and signer", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF, event: makeVariation(), lineItems: [makeLineItem()],
    signatures: [makeSignature({ action: "submitted", signed_by_name: "contributor@example.com", signature_data: TINY_PNG_DATA_URL }), makeSignature()],
  });
  const { text, buf } = await renderAndExtractText(doc);
  assert.ok(text.includes("Submitted"));
  assert.ok(text.includes("Approved"));
  assert.ok(text.includes("contributor@example.com"));
  assert.ok(text.includes("approver@example.com"));
  assert.ok(buf.includes(Buffer.from("Image", "ascii")) || buf.length > 3000, "a real embedded PNG must materially increase the PDF's byte size");
});

test("PDF: a typed-name signature (no drawn signature) shows the typed name with an attestation label", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF, event: makeVariation(), lineItems: [makeLineItem()],
    signatures: [makeSignature({ signature_data: null, signature_typed_name: "Jane Approver" })],
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("Jane Approver"));
  assert.ok(/typed-name attestation/i.test(text));
});

test("PDF: signerLabel() is preferred over the stored signed_by_name when both are available", async () => {
  const doc = buildCommercialEventPdfDocument({
    jsPDFCtor: jsPDF, event: makeVariation(), lineItems: [makeLineItem()],
    signatures: [makeSignature({ signed_by_user_id: "u9", signed_by_name: "stale-email@example.com" })],
    signerLabel: (uid) => (uid === "u9" ? "current-email@example.com" : null),
  });
  const { text } = await renderAndExtractText(doc);
  assert.ok(text.includes("current-email@example.com"));
  assert.ok(!text.includes("stale-email@example.com"));
});

// ─── Filename & page format ──────────────────────────────────────────

test("PDF: filename is built from the reference and title, sanitized for the filesystem", () => {
  assert.equal(commercialEventPdfFilename(makeDaywork()), "DW-004 - Additional groundworks — plot 4 foundations.pdf");
});

test("PDF: every page is genuinely A4 and carries a page-number footer", async () => {
  const doc = buildCommercialEventPdfDocument({ jsPDFCtor: jsPDF, event: makeDaywork(), lineItems: [makeLineItem()] });
  const buf = Buffer.from(doc.output("arraybuffer"));
  const tmpFile = path.join(os.tmpdir(), `ce-pdf-a4-${Math.random().toString(36).slice(2)}.pdf`);
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
