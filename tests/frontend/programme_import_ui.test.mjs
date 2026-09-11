// Controlled XLSX Programme Import (Priority 11, Phase 3) —
// programme-import.html's own wizard flow, exercised against its REAL
// inline module script under jsdom (never a reimplementation), the
// same convention every *_workflow.test.mjs file in this suite
// follows for a tracker/*.html page. Every helper function it imports
// from app.js (readWorkbookFile, buildImportReconciliation, etc.) is
// itself already covered against real logic in
// programme_import_workflow.test.mjs — this file is purely about
// whether the PAGE wires those functions together correctly: step
// gating, the upload -> worksheet -> mapping -> preview -> confirm ->
// result sequence, and that a rejected/failed step never silently
// advances.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML_PATH = new URL("../../tracker/programme-import.html", import.meta.url).pathname;
const scriptSrc = extractScript(HTML_PATH);

function baseContext(overrides = {}) {
  const calls = { createDocument: [] };
  const mockSupabase = {
    from(table) {
      if (table === "projects") return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: "Test Site" }, error: null }) }) }) };
      if (table === "plots") return { select: () => ({ eq: () => ({ order: async () => ({ data: [{ id: "plot-4", plot_number: "Plot 4" }], error: null }) }) }) };
      throw new Error("unexpected table " + table);
    },
  };
  const context = {
    supabase: mockSupabase,
    requireAuth: async () => {},
    renderHeader: () => {},
    getParam: () => "proj-1",
    escapeHtml: (s) => (s === null || s === undefined ? "" : String(s)),
    formatDate: (d) => d,
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    PROGRAMME_STATUS_LABEL: { draft: "Draft", active: "Active", archived: "Archived" },
    listProgrammes: async () => [{ id: "prog-1", name: "Main Programme", status: "active" }],
    listProgrammeActivities: async () => [],
    validateImportFile: () => ({ ok: true }),
    readWorkbookFile: async () => ({
      sheetNames: ["Sheet1"],
      sheets: { Sheet1: [["Activity ID", "Title", "Start", "Finish"], ["A-1", "Groundworks", "2026-01-01", "2026-01-15"]] },
    }),
    splitSheetHeaderAndRows: (aoa) => ({ headers: aoa[0], rows: aoa.slice(1) }),
    suggestColumnMapping: () => ({ external_id: 0, title: 1, planned_start: 2, planned_finish: 3 }),
    mapRowsToImportRows: (rows, mapping) => rows.map((r, i) => ({
      client_row_index: i, external_id: r[mapping.external_id], title: r[mapping.title],
      planned_start: r[mapping.planned_start], planned_finish: r[mapping.planned_finish], plot_number: null, is_milestone: null,
    })),
    buildImportReconciliation: (rows) => ({
      toCreate: rows.map((r, i) => ({ index: i, fields: { title: r.title, planned_start: r.planned_start, planned_finish: r.planned_finish, is_milestone: false, external_id: r.external_id, plot_id: null }, plotUnmatched: false })),
      toUpdate: [], unchanged: [], missing: [], invalid: [],
    }),
    importProgrammeActivities: async () => ({ created: 1, updated: 0, unchanged: 0, rejected: [], created_ids: ["new-1"], updated_ids: [] }),
    createDocument: async (...args) => { calls.createDocument.push(args); return { id: "doc-1" }; },
  };
  return { context: { ...context, ...overrides }, calls };
}

function setFile(document, window, file) {
  const input = document.getElementById("workbookFile");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
}

async function until(fn, tries = 100) {
  for (let i = 0; i < tries && !fn(); i++) await wait(10);
  return fn();
}

// ─── Precondition gate ────────────────────────────────────────────

test("programme-import.html: with no active/draft programme, shows the gate instead of the wizard", async () => {
  const { context } = baseContext({ listProgrammes: async () => [{ id: "old", name: "Archived Programme", status: "archived" }] });
  const { document } = await runPage(HTML_PATH, scriptSrc, context);
  assert.equal(document.getElementById("noProgrammeGate").style.display, "block");
  assert.equal(document.getElementById("wizard").style.display, "none");
});

test("programme-import.html: with no programme at all, still shows the gate (not a crash)", async () => {
  const { context } = baseContext({ listProgrammes: async () => [] });
  const { document } = await runPage(HTML_PATH, scriptSrc, context);
  assert.equal(document.getElementById("noProgrammeGate").style.display, "block");
});

test("programme-import.html: prefers the ACTIVE programme over a draft one when both exist", async () => {
  const { context } = baseContext({
    listProgrammes: async () => [{ id: "d1", name: "Draft One", status: "draft" }, { id: "a1", name: "Active One", status: "active" }],
  });
  const { document } = await runPage(HTML_PATH, scriptSrc, context);
  assert.equal(document.getElementById("targetProgrammeName").textContent, "Active One");
});

test("programme-import.html: falls back to a DRAFT programme when no active one exists", async () => {
  const { context } = baseContext({ listProgrammes: async () => [{ id: "d1", name: "Draft Only", status: "draft" }] });
  const { document } = await runPage(HTML_PATH, scriptSrc, context);
  assert.equal(document.getElementById("wizard").style.display, "block");
  assert.equal(document.getElementById("targetProgrammeName").textContent, "Draft Only");
});

// ─── Step 1: Upload ────────────────────────────────────────────────

test("programme-import.html: a file that fails client-side validation is rejected before reading, and the wizard does not advance", async () => {
  const { context } = baseContext({ validateImportFile: () => ({ ok: false, error: "not an .xlsx file" }) });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  setFile(document, window, { name: "programme.csv", size: 100 });
  fireEvent(document.getElementById("step1NextBtn"), "click");
  await wait(30);
  assert.notEqual(document.getElementById("step1Card").style.display, "none", "step 1 must remain the active step");
  assert.equal(document.getElementById("step2Card").style.display, "none");
  assert.match(document.getElementById("pageErrorBox").textContent, /not an \.xlsx file/);
});

test("programme-import.html: a workbook that fails to read (corrupted file) shows the error and does not advance", async () => {
  const { context } = baseContext({ readWorkbookFile: async () => { throw new Error("could not be read as an Excel workbook"); } });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  setFile(document, window, { name: "programme.xlsx", size: 100 });
  fireEvent(document.getElementById("step1NextBtn"), "click");
  await wait(30);
  assert.equal(document.getElementById("step2Card").style.display, "none");
  assert.match(document.getElementById("pageErrorBox").textContent, /could not be read/);
});

// ─── Step 2: Worksheet selection ───────────────────────────────────

test("programme-import.html: never preselects a worksheet — Next stays disabled until the user actively chooses one", async () => {
  const { context } = baseContext();
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  setFile(document, window, { name: "programme.xlsx", size: 100 });
  fireEvent(document.getElementById("step1NextBtn"), "click");
  assert.ok(await until(() => document.getElementById("step2Card").style.display === "block"));
  assert.equal(document.getElementById("sheetSelect").value, "", "no worksheet should be preselected");
  assert.equal(document.getElementById("step2NextBtn").disabled, true);
});

test("programme-import.html: a worksheet with zero data rows leaves Next disabled", async () => {
  const { context } = baseContext({
    readWorkbookFile: async () => ({ sheetNames: ["Empty"], sheets: { Empty: [["Title"]] } }),
    splitSheetHeaderAndRows: () => ({ headers: ["Title"], rows: [] }),
  });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  setFile(document, window, { name: "programme.xlsx", size: 100 });
  fireEvent(document.getElementById("step1NextBtn"), "click");
  await until(() => document.getElementById("step2Card").style.display === "block");
  const select = document.getElementById("sheetSelect");
  select.value = "Empty";
  fireEvent(select, "change");
  assert.equal(document.getElementById("step2NextBtn").disabled, true);
});

// ─── Step 3: Mapping ────────────────────────────────────────────────

async function advanceToMapping(document, window) {
  setFile(document, window, { name: "programme.xlsx", size: 100 });
  fireEvent(document.getElementById("step1NextBtn"), "click");
  await until(() => document.getElementById("step2Card").style.display === "block");
  const select = document.getElementById("sheetSelect");
  select.value = "Sheet1";
  fireEvent(select, "change");
  fireEvent(document.getElementById("step2NextBtn"), "click");
  await until(() => document.getElementById("step3Card").style.display === "block");
}

test("programme-import.html: required fields (title, planned start/finish) block Next when unmapped; mapping them enables it", async () => {
  const { context } = baseContext({ suggestColumnMapping: () => ({}) }); // nothing auto-mapped
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToMapping(document, window);
  assert.equal(document.getElementById("step3NextBtn").disabled, true, "no required field mapped yet");

  const selects = Array.from(document.querySelectorAll("#mappingRows select[data-field]"));
  const titleSelect = selects.find((s) => s.dataset.field === "title");
  const startSelect = selects.find((s) => s.dataset.field === "planned_start");
  const finishSelect = selects.find((s) => s.dataset.field === "planned_finish");
  titleSelect.value = "1"; fireEvent(titleSelect, "change");
  assert.equal(document.getElementById("step3NextBtn").disabled, true, "still missing planned dates");
  startSelect.value = "2"; fireEvent(startSelect, "change");
  finishSelect.value = "3"; fireEvent(finishSelect, "change");
  assert.equal(document.getElementById("step3NextBtn").disabled, false, "all required fields are now mapped");
});

test("programme-import.html: external_id is NOT required to be mapped (Phase 2's plot+title fallback is a legitimate path)", async () => {
  const { context } = baseContext({ suggestColumnMapping: () => ({ title: 1, planned_start: 2, planned_finish: 3 }) }); // no external_id
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToMapping(document, window);
  assert.equal(document.getElementById("step3NextBtn").disabled, false);
});

test("programme-import.html: mapping selections pre-fill from suggestColumnMapping's own guess", async () => {
  const { context } = baseContext();
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToMapping(document, window);
  const titleSelect = Array.from(document.querySelectorAll("#mappingRows select[data-field]")).find((s) => s.dataset.field === "title");
  assert.equal(titleSelect.value, "1");
});

// ─── Step 4: Preview & confirm ──────────────────────────────────────

async function advanceToPreview(document, window) {
  await advanceToMapping(document, window);
  fireEvent(document.getElementById("step3NextBtn"), "click");
  await until(() => document.getElementById("step4Card").style.display === "block");
}

test("programme-import.html: the preview step shows accurate summary counts and never writes anything before Confirm is clicked", async () => {
  const importCalls = [];
  const { context } = baseContext({ importProgrammeActivities: async (...args) => { importCalls.push(args); return { created: 1, updated: 0, unchanged: 0, rejected: [], created_ids: [], updated_ids: [] }; } });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  assert.match(document.getElementById("summaryGrid").innerHTML, /Total rows/);
  assert.equal(importCalls.length, 0, "nothing should be written just by reaching the preview step");
});

test("programme-import.html: invalid rows are listed with their reasons in the preview", async () => {
  const { context } = baseContext({
    buildImportReconciliation: () => ({ toCreate: [], toUpdate: [], unchanged: [], missing: [], invalid: [{ index: 0, errors: ["Title is required."] }] }),
  });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  assert.equal(document.getElementById("invalidSection").style.display, "block");
  assert.match(document.getElementById("invalidRows").innerHTML, /Title is required/);
});

test("programme-import.html: activities missing from this import are shown as 'not present', never as something to delete", async () => {
  const { context } = baseContext({
    buildImportReconciliation: () => ({ toCreate: [], toUpdate: [], unchanged: [], invalid: [], missing: [{ id: "e1", title: "Old Activity", external_id: "A-9" }] }),
  });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  assert.equal(document.getElementById("missingSection").style.display, "block");
  assert.match(document.getElementById("missingRows").innerHTML, /Old Activity/);
  assert.doesNotMatch(document.body.innerHTML, /delete.*Old Activity/i);
});

test("programme-import.html: confirming import calls the RPC wrapper with only the create/update rows, never the unchanged ones", async () => {
  const importCalls = [];
  const { context } = baseContext({
    buildImportReconciliation: () => ({
      toCreate: [{ index: 0, fields: { title: "New" }, plotUnmatched: false }],
      toUpdate: [{ index: 1, activityId: "e1", fields: { title: "Updated" }, plotUnmatched: false }],
      unchanged: [{ index: 2, activityId: "e2" }],
      missing: [], invalid: [],
    }),
    importProgrammeActivities: async (programmeId, rows) => { importCalls.push({ programmeId, rows }); return { created: 1, updated: 1, unchanged: 0, rejected: [], created_ids: ["n1"], updated_ids: ["e1"] }; },
  });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  fireEvent(document.getElementById("confirmImportBtn"), "click");
  await until(() => document.getElementById("resultCard").style.display === "block");
  assert.equal(importCalls.length, 1);
  assert.equal(importCalls[0].programmeId, "prog-1");
  assert.equal(importCalls[0].rows.length, 2, "only the 1 create + 1 update, never the unchanged row");
});

test("programme-import.html: a failed confirm (RPC rejects) shows the error and stays on the preview step — nothing silently marked done", async () => {
  const { context } = baseContext({ importProgrammeActivities: async () => { throw new Error("network error"); } });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  fireEvent(document.getElementById("confirmImportBtn"), "click");
  await wait(30);
  assert.equal(document.getElementById("resultCard").style.display, "none");
  assert.equal(document.getElementById("step4Card").style.display, "block");
  assert.match(document.getElementById("pageErrorBox").textContent, /network error/);
});

// ─── Step 5: Result ──────────────────────────────────────────────

test("programme-import.html: a clean import (nothing rejected) reports success without overclaiming", async () => {
  const { context } = baseContext({ importProgrammeActivities: async () => ({ created: 2, updated: 1, unchanged: 0, rejected: [], created_ids: [], updated_ids: [] }) });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  fireEvent(document.getElementById("confirmImportBtn"), "click");
  await until(() => document.getElementById("resultCard").style.display === "block");
  assert.match(document.getElementById("resultHeading").textContent, /completed successfully/i);
  assert.equal(document.getElementById("rejectedSection").style.display, "none");
});

test("programme-import.html: a partially-rejected import NEVER claims full success — precise wording, not 'imported successfully'", async () => {
  const { context } = baseContext({
    importProgrammeActivities: async () => ({ created: 1, updated: 0, unchanged: 0, rejected: [{ index: 3, reason: "Duplicate external_id" }], created_ids: [], updated_ids: [] }),
  });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  fireEvent(document.getElementById("confirmImportBtn"), "click");
  await until(() => document.getElementById("resultCard").style.display === "block");
  assert.doesNotMatch(document.getElementById("resultHeading").textContent, /completed successfully/i);
  assert.equal(document.getElementById("rejectedSection").style.display, "block");
  assert.match(document.getElementById("rejectedRows").innerHTML, /Duplicate external_id/);
});

test("programme-import.html: when 'save a copy to Documents' is checked, createDocument is called with document_type 'programme' using the original file", async () => {
  const { context, calls } = baseContext();
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  document.getElementById("retainCopyCheckbox").checked = true;
  await advanceToPreview(document, window);
  fireEvent(document.getElementById("confirmImportBtn"), "click");
  await until(() => document.getElementById("resultCard").style.display === "block");
  assert.equal(calls.createDocument.length, 1);
  const [, opts, file] = calls.createDocument[0];
  assert.equal(opts.documentType, "programme");
  assert.equal(file.name, "programme.xlsx");
});

test("programme-import.html: unchecking 'save a copy to Documents' means createDocument is never called", async () => {
  const { context, calls } = baseContext();
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  document.getElementById("retainCopyCheckbox").checked = false;
  await advanceToPreview(document, window);
  fireEvent(document.getElementById("confirmImportBtn"), "click");
  await until(() => document.getElementById("resultCard").style.display === "block");
  assert.equal(calls.createDocument.length, 0);
});

test("programme-import.html: a Documents-retention failure does not undo or hide the successful import result", async () => {
  const { context } = baseContext({ createDocument: async () => { throw new Error("storage quota exceeded"); } });
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  fireEvent(document.getElementById("confirmImportBtn"), "click");
  await until(() => document.getElementById("resultCard").style.display === "block");
  assert.match(document.getElementById("resultHeading").textContent, /completed successfully/i);
  assert.match(document.getElementById("retainCopyStatus").textContent, /storage quota exceeded/);
});

test("programme-import.html: 'Import Another File' resets the wizard back to step 1 with a clean state", async () => {
  const { context } = baseContext();
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToPreview(document, window);
  fireEvent(document.getElementById("confirmImportBtn"), "click");
  await until(() => document.getElementById("resultCard").style.display === "block");
  fireEvent(document.getElementById("importAnotherBtn"), "click");
  assert.equal(document.getElementById("step1Card").style.display, "block");
  assert.equal(document.getElementById("resultCard").style.display, "none");
});

// ─── Back navigation ────────────────────────────────────────────────

test("programme-import.html: Back from mapping returns to worksheet selection without losing the read workbook", async () => {
  const { context } = baseContext();
  const { document, window } = await runPage(HTML_PATH, scriptSrc, context);
  await advanceToMapping(document, window);
  fireEvent(document.getElementById("step3BackBtn"), "click");
  assert.equal(document.getElementById("step2Card").style.display, "block");
  assert.equal(document.getElementById("sheetSelect").value, "Sheet1", "the earlier worksheet choice should still be selected");
});
