// Documents (Priority 10) — documents.html and document-detail.html's
// REAL inline scripts under jsdom. Data-access functions
// (listDocuments/createDocument/addDocumentRevision/etc) are mocked
// here — they're thin Supabase wrappers already exercised for real,
// against the actual RLS/trigger boundary, in
// tests/security/documents*.test.mjs, and the pure export-planning
// functions they call are exercised for real in
// tests/frontend/documents_export_helpers.test.mjs. This file proves
// the PAGES wire everything up correctly: create -> Revision 1 ->
// upload Revision 2 -> Revision 1 superseded / Revision 2 current ->
// revision history visible, and that editor-only controls are hidden
// from a snagging-only member (who can still read).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const DOCS_HTML = new URL("../../tracker/documents.html", import.meta.url).pathname;
const DETAIL_HTML = new URL("../../tracker/document-detail.html", import.meta.url).pathname;

const DOCUMENT_TYPE_LABEL = { drawing: "Drawing", specification: "Specification", other: "Other" };
const DOCUMENT_STATUS_LABEL = { draft: "Draft", current: "Current", superseded: "Superseded", archived: "Archived" };
const DOCUMENT_STATUS_BADGE = { draft: "badge-grey", current: "badge-green", superseded: "badge-amber", archived: "badge-grey" };

function escapeHtml(str) { return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function formatDate(d) { return d || ""; }
function showError(el, err) { el.textContent = err?.message || String(err); }
function clearError(el) { el.textContent = ""; }

function setFile(input, file) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
}
function fakeFile(name = "plan.pdf", type = "application/pdf") {
  return { name, type, size: 1024 };
}

const SAMPLE_PROJECT = { id: "p1", name: "Test Site" };

// ─── documents.html ──────────────────────────────────────────────────

function docsSupabaseMock({ role = "owner" } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc(name) {
      if (name === "get_my_role") return Promise.resolve({ data: role, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        in() { return api; },
        single: async () => (table === "projects" ? { data: SAMPLE_PROJECT, error: null } : { data: null, error: null }),
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runDocumentsPage({ role = "owner", documents = [], createDocument, exportDocumentsZip } = {}) {
  const supabase = docsSupabaseMock({ role });
  return runPage(DOCS_HTML, extractScript(DOCS_HTML), {
    __url: "https://example.com/documents.html?project=p1",
    supabase,
    getParam: () => "p1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml, formatDate, showError, clearError,
    DOCUMENT_TYPE_LABEL, DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_BADGE,
    getMemberEmailMap: async () => ({ u1: "owner@example.com" }),
    listDocuments: async () => documents,
    createDocument: createDocument || (async () => ({})),
    exportDocumentsZip: exportDocumentsZip || (async () => {}),
  });
}

const SAMPLE_DOC = (overrides = {}) => ({
  id: "d1", project_id: "p1", document_type: "drawing", title: "GA Plan", doc_number: "A-101",
  status: "current", current_revision_id: "r1", created_by: "u1",
  created_at: "2026-09-01", updated_at: "2026-09-01",
  currentRevision: { id: "r1", revision_number: 1, file_name: "plan.pdf", uploaded_by: "u1", uploaded_at: "2026-09-01" },
  ...overrides,
});

test("documents.html: renders each document's title, type, status and current revision", async () => {
  const { document } = await runDocumentsPage({ documents: [SAMPLE_DOC()] });
  await wait(30);
  const row = document.querySelector("#docRows tr");
  assert.match(row.textContent, /GA Plan/);
  assert.match(row.textContent, /Drawing/);
  assert.match(row.textContent, /A-101/);
  assert.match(row.textContent, /Rev 1/);
});

test("documents.html: an owner (editor) sees the New Document button; a snagging-only member does not", async () => {
  const { document: ownerDoc } = await runDocumentsPage({ role: "owner", documents: [] });
  await wait(30);
  assert.equal(ownerDoc.getElementById("newDocBtn").style.display, "inline-flex");

  const { document: snagDoc } = await runDocumentsPage({ role: "snagging", documents: [SAMPLE_DOC()] });
  await wait(30);
  assert.equal(snagDoc.getElementById("newDocBtn").style.display, "none", "snagging-only members must not see document creation controls");
  // But they must still see the (read-only) document list.
  assert.match(snagDoc.querySelector("#docRows tr").textContent, /GA Plan/);
});

test("documents.html: submitting the New Document form calls createDocument with the entered fields and a file, then reloads the list", async () => {
  let calledWith = null;
  const { document } = await runDocumentsPage({
    documents: [],
    createDocument: async (projectId, fields, file) => { calledWith = { projectId, fields, file }; return {}; },
  });
  await wait(30);

  fireEvent(document.getElementById("newDocBtn"), "click");
  document.getElementById("docType").value = "specification";
  document.getElementById("docTitle").value = "Fire Strategy";
  document.getElementById("docNumber").value = "FS-01";
  setFile(document.getElementById("docFile"), fakeFile("fire-strategy.pdf"));

  fireEvent(document.getElementById("newDocForm"), "submit");
  await wait(30);

  assert.ok(calledWith, "createDocument must have been called");
  assert.equal(calledWith.projectId, "p1");
  assert.equal(calledWith.fields.documentType, "specification");
  assert.equal(calledWith.fields.title, "Fire Strategy");
  assert.equal(calledWith.fields.docNumber, "FS-01");
  assert.equal(calledWith.file.name, "fire-strategy.pdf");
  assert.equal(document.getElementById("newDocCard").style.display, "none", "the form should close again after a successful save");
});

test("documents.html: selecting documents and clicking Export Selected calls exportDocumentsZip with just the selected documents", async () => {
  let exportedWith = null;
  const docs = [SAMPLE_DOC({ id: "d1", title: "A" }), SAMPLE_DOC({ id: "d2", title: "B" })];
  const { document } = await runDocumentsPage({
    documents: docs,
    exportDocumentsZip: async (projectName, selected, opts) => { exportedWith = { projectName, selected, opts }; },
  });
  await wait(30);

  assert.equal(document.getElementById("exportBtn").disabled, true, "export must start disabled with nothing selected");

  const checks = document.querySelectorAll(".doc-check");
  assert.equal(checks.length, 2);
  fireEvent(checks[0], "change", { target: checks[0] });
  checks[0].checked = true;
  fireEvent(checks[0], "change");
  await wait(10);
  assert.equal(document.getElementById("exportBtn").disabled, false);

  fireEvent(document.getElementById("exportBtn"), "click");
  await wait(30);

  assert.ok(exportedWith, "exportDocumentsZip must have been called");
  assert.equal(exportedWith.selected.length, 1);
  assert.equal(exportedWith.selected[0].id, "d1");
  assert.equal(exportedWith.projectName, "Test Site");
});

// ─── document-detail.html ───────────────────────────────────────────

function detailSupabaseMock({ role = "owner" } = {}) {
  return {
    rpc(name) {
      if (name === "get_my_role") return Promise.resolve({ data: role, error: null });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

async function runDetailPage({
  role = "owner",
  doc,
  addDocumentRevision,
  archiveDocument,
  updateDocumentMetadata,
  confirm = () => true,
} = {}) {
  const supabase = detailSupabaseMock({ role });
  return runPage(DETAIL_HTML, extractScript(DETAIL_HTML), {
    __url: "https://example.com/document-detail.html?id=d1",
    supabase,
    getParam: () => "d1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml, formatDate, showError, clearError,
    DOCUMENT_TYPE_LABEL, DOCUMENT_STATUS_LABEL, DOCUMENT_STATUS_BADGE,
    getMemberEmailMap: async () => ({ u1: "owner@example.com" }),
    getDocument: async () => doc,
    addDocumentRevision: addDocumentRevision || (async () => doc),
    updateDocumentMetadata: updateDocumentMetadata || (async () => ({})),
    archiveDocument: archiveDocument || (async () => ({})),
    getDocumentFileUrl: async () => "https://example.com/signed-url",
    downloadDocumentFile: async () => ({ size: 10 }),
    confirm,
  });
}

function docWithTwoRevisions() {
  return {
    id: "d1", project_id: "p1", document_type: "drawing", title: "GA Plan", doc_number: "A-101",
    status: "current", current_revision_id: "r2", created_by: "u1",
    created_at: "2026-09-01", updated_at: "2026-09-05",
    projects: { name: "Test Site" },
    currentRevision: { id: "r2", revision_number: 2, file_name: "plan-v2.pdf", uploaded_by: "u1", uploaded_at: "2026-09-05" },
    revisions: [
      { id: "r2", revision_number: 2, file_name: "plan-v2.pdf", uploaded_by: "u1", uploaded_at: "2026-09-05", superseded_at: null },
      { id: "r1", revision_number: 1, file_name: "plan-v1.pdf", uploaded_by: "u1", uploaded_at: "2026-09-01", superseded_at: "2026-09-05" },
    ],
  };
}

test("document-detail.html: shows the current revision and marks revision history Current vs Superseded correctly", async () => {
  const { document } = await runDetailPage({ doc: docWithTwoRevisions() });
  await wait(30);

  assert.equal(document.getElementById("docTitle").textContent, "GA Plan");
  assert.match(document.getElementById("currentRevisionWrap").textContent, /Rev 2/);

  const rows = document.querySelectorAll("#revisionRows tr");
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /Rev 2/);
  assert.match(rows[0].textContent, /Current/);
  assert.match(rows[1].textContent, /Rev 1/);
  assert.match(rows[1].textContent, /Superseded/);
});

test("document-detail.html: uploading a new revision calls addDocumentRevision with the document/project id and file", async () => {
  let calledWith = null;
  const { document } = await runDetailPage({
    doc: docWithTwoRevisions(),
    addDocumentRevision: async (documentId, projectId, file) => { calledWith = { documentId, projectId, file }; return docWithTwoRevisions(); },
  });
  await wait(30);

  assert.equal(document.getElementById("uploadRevCard").style.display, "block", "an editor must see the upload-revision card");
  setFile(document.getElementById("revFile"), fakeFile("plan-v3.pdf"));
  fireEvent(document.getElementById("uploadRevForm"), "submit");
  await wait(30);

  assert.ok(calledWith, "addDocumentRevision must have been called");
  assert.equal(calledWith.documentId, "d1");
  assert.equal(calledWith.projectId, "p1");
  assert.equal(calledWith.file.name, "plan-v3.pdf");
});

test("document-detail.html: clicking Archive calls archiveDocument after confirmation", async () => {
  let archived = false;
  const { document } = await runDetailPage({
    doc: docWithTwoRevisions(),
    archiveDocument: async () => { archived = true; return {}; },
    confirm: () => true,
  });
  await wait(30);
  assert.equal(document.getElementById("archiveBtn").style.display, "inline-flex");
  fireEvent(document.getElementById("archiveBtn"), "click");
  await wait(30);
  assert.equal(archived, true, "archiveDocument must have been called");
});

test("document-detail.html: declining the Archive confirmation does NOT call archiveDocument", async () => {
  let archived = false;
  const { document } = await runDetailPage({
    doc: docWithTwoRevisions(),
    archiveDocument: async () => { archived = true; return {}; },
    confirm: () => false,
  });
  await wait(30);
  fireEvent(document.getElementById("archiveBtn"), "click");
  await wait(30);
  assert.equal(archived, false, "declining the confirmation dialog must not archive the document");
});

test("document-detail.html: a snagging-only member sees the document read-only — no edit, archive, or upload-revision controls", async () => {
  const { document } = await runDetailPage({ role: "snagging", doc: docWithTwoRevisions() });
  await wait(30);
  assert.equal(document.getElementById("docTitle").textContent, "GA Plan", "snagging-only members must still be able to READ the document");
  assert.equal(document.getElementById("editMetaBtn").style.display, "none");
  assert.equal(document.getElementById("archiveBtn").style.display, "none");
  assert.equal(document.getElementById("uploadRevCard").style.display, "none");
});

test("document-detail.html: archived documents hide the upload-revision card even for an editor", async () => {
  const archivedDoc = { ...docWithTwoRevisions(), status: "archived" };
  const { document } = await runDetailPage({ doc: archivedDoc });
  await wait(30);
  assert.equal(document.getElementById("uploadRevCard").style.display, "none", "an archived document must not accept new revisions through the UI");
  assert.equal(document.getElementById("archiveBtn").style.display, "none", "an already-archived document has no further Archive action");
});
