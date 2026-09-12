// Pure calculation helpers behind the Documents bulk export (Priority
// 10) — filename sanitisation, naming, de-duplication, manifest
// building, and export planning. These are exercised here against
// their REAL app.js source (extracted, not reimplemented), completely
// independent of JSZip/network/storage — see documents_export.test.mjs
// for the end-to-end ZIP-building flow and tests/security/documents*.test.mjs
// for the RLS boundary that makes sure an export can never see another
// organisation's files in the first place.
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

const scopeSrc = `
  ${extractConst("EXPORT_FOLDER_BY_TYPE")}
  ${extractConst("DOCUMENT_TYPE_LABEL")}
  ${extractFn("sanitizeExportFilename")}
  ${extractFn("exportFilenameFor")}
  ${extractFn("dedupeExportFilenames")}
  ${extractFn("buildExportManifestCsv")}
  ${extractFn("planDocumentExport")}
  return { sanitizeExportFilename, exportFilenameFor, dedupeExportFilenames, buildExportManifestCsv, planDocumentExport, EXPORT_FOLDER_BY_TYPE };
`;
const { sanitizeExportFilename, exportFilenameFor, dedupeExportFilenames, buildExportManifestCsv, planDocumentExport, EXPORT_FOLDER_BY_TYPE } = new Function(scopeSrc)();

// ─── sanitizeExportFilename ──────────────────────────────────────────

test("sanitizeExportFilename: strips characters Windows/SharePoint disallow", () => {
  // The exact replacement character doesn't matter — what matters is
  // that none of the disallowed characters survive.
  const result = sanitizeExportFilename('A<>:"/\\|?*B');
  for (const ch of '<>:"/\\|?*') {
    assert.ok(!result.includes(ch), `disallowed character "${ch}" must not survive sanitisation`);
  }
  assert.ok(result.startsWith("A") && result.endsWith("B"), "surrounding safe characters must be preserved");
});

test("sanitizeExportFilename: collapses whitespace and trims a trailing dot/space (Windows rule)", () => {
  assert.equal(sanitizeExportFilename("  A    B  "), "A B");
  assert.equal(sanitizeExportFilename("Trailing dot."), "Trailing dot");
  assert.equal(sanitizeExportFilename("Trailing space "), "Trailing space");
});

test("sanitizeExportFilename: falls back to 'Untitled' for an empty/whitespace-only name", () => {
  assert.equal(sanitizeExportFilename(""), "Untitled");
  assert.equal(sanitizeExportFilename("   "), "Untitled");
  assert.equal(sanitizeExportFilename(null), "Untitled");
});

test("sanitizeExportFilename: caps length at 150 characters", () => {
  const long = "A".repeat(300);
  assert.ok(sanitizeExportFilename(long).length <= 150);
});

// ─── exportFilenameFor ───────────────────────────────────────────────

test("exportFilenameFor: '[Title] - Rev [N].[ext]' when there's no doc number", () => {
  const doc = { doc_number: null, title: "Ground Floor GA Plan" };
  const revision = { revision_number: 3, file_name: "whatever-original-name.pdf" };
  assert.equal(exportFilenameFor(doc, revision), "Ground Floor GA Plan - Rev 3.pdf");
});

test("exportFilenameFor: '[Doc Number] - [Title] - Rev [N].[ext]' when a doc number is set (extension is lowercased)", () => {
  const doc = { doc_number: "A-101", title: "Ground Floor GA Plan" };
  const revision = { revision_number: 1, file_name: "original.PDF" };
  assert.equal(exportFilenameFor(doc, revision), "A-101 - Ground Floor GA Plan - Rev 1.pdf");
});

test("exportFilenameFor: the true original filename is never destroyed — it's preserved separately, only the export name is computed", () => {
  const doc = { doc_number: null, title: "Spec" };
  const revision = { revision_number: 1, file_name: "the-real-original-name-with-info.docx" };
  const exported = exportFilenameFor(doc, revision);
  assert.notEqual(exported, revision.file_name, "export filename is a clean computed name, not a passthrough");
  assert.equal(revision.file_name, "the-real-original-name-with-info.docx", "the original filename object itself must be untouched");
});

// ─── dedupeExportFilenames ────────────────────────────────────────────

test("dedupeExportFilenames: leaves unique names untouched", () => {
  assert.deepEqual(dedupeExportFilenames(["A.pdf", "B.pdf", "C.pdf"]), ["A.pdf", "B.pdf", "C.pdf"]);
});

test("dedupeExportFilenames: appends (2), (3), ... to repeats, in stable input order, preserving the extension", () => {
  assert.deepEqual(
    dedupeExportFilenames(["Plan.pdf", "Plan.pdf", "Plan.pdf", "Other.pdf"]),
    ["Plan.pdf", "Plan (2).pdf", "Plan (3).pdf", "Other.pdf"]
  );
});

test("dedupeExportFilenames: never produces two identical names in its output — the ZIP must never silently overwrite one file with another", () => {
  const input = ["A.pdf", "A.pdf", "B", "B", "B"];
  const out = dedupeExportFilenames(input);
  assert.equal(new Set(out).size, out.length, "every output name must be unique");
});

// ─── buildExportManifestCsv ───────────────────────────────────────────

test("buildExportManifestCsv: builds a header row plus one row per entry, correctly CSV-escaped", () => {
  const csv = buildExportManifestCsv([
    { project: "Site A", title: 'Plan "1"', type: "Drawing", docNumber: "A-101", revision: 2, status: "current", originalFilename: "orig.pdf", exportFilename: "A-101 - Plan - Rev 2.pdf", exportedDate: "2026-09-11" },
  ]);
  const lines = csv.split("\r\n");
  assert.equal(lines[0], "Project,Document Title,Document Type,Document Number,Revision,Status,Original Filename,Export Filename,Exported Date");
  assert.equal(lines[1], 'Site A,"Plan ""1""",Drawing,A-101,2,current,orig.pdf,A-101 - Plan - Rev 2.pdf,2026-09-11');
});

// ─── planDocumentExport ───────────────────────────────────────────────

function doc(overrides = {}) {
  return {
    id: "d1", document_type: "drawing", title: "Plan", doc_number: null, status: "current",
    current_revision_id: "r1",
    currentRevision: { id: "r1", revision_number: 1, file_name: "plan.pdf", file_size: 100 },
    revisions: [{ id: "r1", revision_number: 1, file_name: "plan.pdf", file_size: 100, superseded_at: null }],
    ...overrides,
  };
}

test("planDocumentExport: current-revision-only export groups by type folder, one entry per document", () => {
  const plan = planDocumentExport([doc(), doc({ id: "d2", document_type: "specification", title: "Spec" })]);
  assert.equal(plan.length, 2);
  const drawing = plan.find((e) => e.doc.id === "d1");
  assert.deepEqual(drawing.folderPath, [EXPORT_FOLDER_BY_TYPE.drawing]);
  assert.equal(drawing.isCurrent, true);
  const spec = plan.find((e) => e.doc.id === "d2");
  assert.deepEqual(spec.folderPath, [EXPORT_FOLDER_BY_TYPE.specification]);
});

test("planDocumentExport: a document with no current revision is skipped, not exported as an empty entry", () => {
  const plan = planDocumentExport([doc({ current_revision_id: null, currentRevision: null })]);
  assert.equal(plan.length, 0);
});

test("planDocumentExport: default export includes ONLY the current revision, never every historical revision", () => {
  const withHistory = doc({
    currentRevision: { id: "r2", revision_number: 2, file_name: "plan-v2.pdf", file_size: 100 },
    revisions: [
      { id: "r1", revision_number: 1, file_name: "plan-v1.pdf", file_size: 100, superseded_at: "2026-01-01" },
      { id: "r2", revision_number: 2, file_name: "plan-v2.pdf", file_size: 100, superseded_at: null },
    ],
    current_revision_id: "r2",
  });
  const plan = planDocumentExport([withHistory]); // includeHistory defaults to false
  assert.equal(plan.length, 1, "default export must contain exactly one entry per document — the current revision only");
  assert.equal(plan[0].revision.id, "r2");
});

test("planDocumentExport: includeHistory=true exports every revision, under Current/ and Revision History/ subfolders", () => {
  const withHistory = doc({
    currentRevision: { id: "r2", revision_number: 2, file_name: "plan-v2.pdf", file_size: 100 },
    revisions: [
      { id: "r1", revision_number: 1, file_name: "plan-v1.pdf", file_size: 100, superseded_at: "2026-01-01" },
      { id: "r2", revision_number: 2, file_name: "plan-v2.pdf", file_size: 100, superseded_at: null },
    ],
    current_revision_id: "r2",
  });
  const plan = planDocumentExport([withHistory], { includeHistory: true });
  assert.equal(plan.length, 2, "both revisions must be included");
  const current = plan.find((e) => e.revision.id === "r2");
  const superseded = plan.find((e) => e.revision.id === "r1");
  assert.equal(current.folderPath[current.folderPath.length - 1], "Current");
  assert.equal(superseded.folderPath[superseded.folderPath.length - 1], "Revision History");
  // Both share the same document-named parent folder.
  assert.equal(current.folderPath[1], superseded.folderPath[1]);
});

test("planDocumentExport: two documents with identical export filenames in the SAME folder are de-duplicated", () => {
  const docA = doc({ id: "dA", title: "Plan", doc_number: null });
  const docB = doc({ id: "dB", title: "Plan", doc_number: null }); // same title, same type folder, same rev number -> same computed filename
  const plan = planDocumentExport([docA, docB]);
  const names = plan.map((e) => e.filename);
  assert.equal(new Set(names).size, names.length, "filenames within the same export folder must never collide");
});
