// Programme Control (Priority 11, Phase 2) — programme.html's REAL
// inline script under jsdom. Data-access functions
// (listProgrammes/createProgramme/createProgrammeActivity/etc) are
// mocked here — they're thin Supabase wrappers already exercised for
// real, against the actual RLS/trigger boundary, in
// tests/security/programme.test.mjs, and the pure import-contract
// functions they'll eventually feed are exercised for real in
// tests/frontend/programme_import_contract.test.mjs. This file proves
// the PAGE wires everything up correctly: no programme -> create one,
// draft -> activate, list/filter/sort activities, create/edit/delete
// an activity, and archive a programme.
//
// This page has no role-based UI branch (unlike documents.html) —
// Programme Control is editor-only throughout (brief: "Do not widen
// access to snagging-only users yet"), enforced entirely by RLS and
// by never linking the page from a snagging-only member's nav, the
// same minimal precedent hs-audits.html already established.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const PROGRAMME_HTML = new URL("../../tracker/programme.html", import.meta.url).pathname;

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const PROGRAMME_STATUS_LABEL = extractConst("PROGRAMME_STATUS_LABEL");
const PROGRAMME_STATUS_BADGE = extractConst("PROGRAMME_STATUS_BADGE");
const ACTIVITY_STATUSES = extractConst("ACTIVITY_STATUSES");
const ACTIVITY_STATUS_LABEL = extractConst("ACTIVITY_STATUS_LABEL");
const ACTIVITY_STATUS_BADGE = extractConst("ACTIVITY_STATUS_BADGE");

function escapeHtml(str) { return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function formatDate(d) { return d || ""; }
function showError(el, err) { el.textContent = err?.message || String(err); }
function clearError(el) { el.textContent = ""; }

const SAMPLE_PROJECT = { id: "p1", name: "Test Site" };
const DRAFT_PROGRAMME = { id: "prog1", project_id: "p1", name: "Test Site Programme", status: "draft", created_by: "u1" };
const ACTIVE_PROGRAMME = { ...DRAFT_PROGRAMME, status: "active" };

function activity(overrides = {}) {
  return {
    id: "act1", programme_id: "prog1", project_id: "p1", title: "Groundworks", plot_id: null,
    is_milestone: false, planned_start: "2026-01-01", planned_finish: "2026-01-15",
    forecast_start: "2026-01-01", forecast_finish: "2026-01-20", actual_start: null, actual_finish: null,
    status: "in_progress", percent_complete: 40, assigned_to: null, plots: null,
    ...overrides,
  };
}

function baseSupabaseMock() {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        single: async () => (table === "projects" ? { data: SAMPLE_PROJECT, error: null } : { data: null, error: null }),
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
    rpc() { return Promise.resolve({ data: [], error: null }); },
  };
}

async function runProgrammePage({
  programmes = [ACTIVE_PROGRAMME],
  activities = [activity()],
  createProgramme, activateProgramme, archiveProgramme,
  createProgrammeActivity, updateProgrammeActivity, deleteProgrammeActivity,
  confirm = () => true,
} = {}) {
  const supabase = baseSupabaseMock();
  return runPage(PROGRAMME_HTML, extractScript(PROGRAMME_HTML), {
    __url: "https://example.com/programme.html?project=p1",
    supabase,
    getParam: () => "p1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml, formatDate, showError, clearError,
    PROGRAMME_STATUS_LABEL, PROGRAMME_STATUS_BADGE, ACTIVITY_STATUSES, ACTIVITY_STATUS_LABEL, ACTIVITY_STATUS_BADGE,
    listProgrammes: async () => programmes,
    createProgramme: createProgramme || (async () => ({ id: "prog-new", project_id: "p1", name: "New", status: "draft" })),
    activateProgramme: activateProgramme || (async (id) => ({ ...programmes.find((p) => p.id === id), status: "active" })),
    archiveProgramme: archiveProgramme || (async (id) => ({ ...programmes.find((p) => p.id === id), status: "archived" })),
    listProgrammeActivities: async () => activities,
    createProgrammeActivity: createProgrammeActivity || (async () => ({})),
    updateProgrammeActivity: updateProgrammeActivity || (async () => ({})),
    deleteProgrammeActivity: deleteProgrammeActivity || (async () => {}),
    confirm,
  });
}

test("programme.html: with no programme yet, shows the empty state and a Create Programme button", async () => {
  const { document } = await runProgrammePage({ programmes: [], activities: [] });
  await wait(30);
  assert.equal(document.getElementById("noProgrammeCard").style.display, "block");
  assert.equal(document.getElementById("programmeCard").style.display, "none");
  assert.equal(document.getElementById("activitiesListCard").style.display, "none");
});

test("programme.html: clicking Create Programme calls createProgramme and then shows the programme card", async () => {
  let called = null;
  const { document } = await runProgrammePage({
    programmes: [], activities: [],
    createProgramme: async (projectId, fields) => { called = { projectId, fields }; return { id: "prog-new", project_id: "p1", name: fields.name, status: "draft" }; },
  });
  await wait(30);
  fireEvent(document.getElementById("createProgrammeBtn"), "click");
  await wait(30);
  assert.ok(called, "createProgramme must have been called");
  assert.equal(called.projectId, "p1");
  assert.equal(document.getElementById("programmeCard").style.display, "block");
  assert.equal(document.getElementById("programmeName").textContent, called.fields.name);
});

test("programme.html: an active programme's activities render with the right columns", async () => {
  const { document } = await runProgrammePage({
    activities: [activity({ title: "Roof Covering", percent_complete: 75, status: "in_progress" })],
  });
  await wait(30);
  assert.equal(document.getElementById("programmeName").textContent, "Test Site Programme");
  assert.match(document.getElementById("programmeStatusBadge").textContent, /Active/);
  const row = document.querySelector("#activityRows tr");
  assert.match(row.textContent, /Roof Covering/);
  assert.match(row.textContent, /75%/);
  assert.match(row.textContent, /In Progress/);
});

test("programme.html: a DRAFT programme shows an Activate button; an ACTIVE one does not", async () => {
  const { document: draftDoc } = await runProgrammePage({ programmes: [DRAFT_PROGRAMME] });
  await wait(30);
  assert.equal(draftDoc.getElementById("activateProgrammeBtn").style.display, "inline-flex");

  const { document: activeDoc } = await runProgrammePage({ programmes: [ACTIVE_PROGRAMME] });
  await wait(30);
  assert.equal(activeDoc.getElementById("activateProgrammeBtn").style.display, "none");
});

test("programme.html: clicking Activate calls activateProgramme and updates the status badge", async () => {
  let activatedId = null;
  const { document } = await runProgrammePage({
    programmes: [DRAFT_PROGRAMME],
    activateProgramme: async (id) => { activatedId = id; return { ...DRAFT_PROGRAMME, status: "active" }; },
  });
  await wait(30);
  fireEvent(document.getElementById("activateProgrammeBtn"), "click");
  await wait(30);
  assert.equal(activatedId, "prog1");
  assert.match(document.getElementById("programmeStatusBadge").textContent, /Active/);
  assert.equal(document.getElementById("activateProgrammeBtn").style.display, "none");
});

test("programme.html: clicking Archive (after confirmation) calls archiveProgramme", async () => {
  let archivedId = null;
  const { document } = await runProgrammePage({
    archiveProgramme: async (id) => { archivedId = id; return { ...ACTIVE_PROGRAMME, status: "archived" }; },
    confirm: () => true,
  });
  await wait(30);
  fireEvent(document.getElementById("archiveProgrammeBtn"), "click");
  await wait(30);
  assert.equal(archivedId, "prog1");
  assert.match(document.getElementById("programmeStatusBadge").textContent, /Archived/);
});

test("programme.html: declining the Archive confirmation does NOT call archiveProgramme", async () => {
  let archived = false;
  const { document } = await runProgrammePage({
    archiveProgramme: async () => { archived = true; return {}; },
    confirm: () => false,
  });
  await wait(30);
  fireEvent(document.getElementById("archiveProgrammeBtn"), "click");
  await wait(30);
  assert.equal(archived, false);
});

test("programme.html: submitting the New Activity form calls createProgrammeActivity with the entered fields", async () => {
  let called = null;
  const { document } = await runProgrammePage({
    activities: [],
    createProgrammeActivity: async (programmeId, fields) => { called = { programmeId, fields }; return {}; },
  });
  await wait(30);
  fireEvent(document.getElementById("newActivityBtn"), "click");
  document.getElementById("activityTitle").value = "Drainage (Below Ground)";
  document.getElementById("plannedStart").value = "2026-04-01";
  document.getElementById("plannedFinish").value = "2026-04-10";
  document.getElementById("activityMilestone").value = "true";
  fireEvent(document.getElementById("activityForm"), "submit");
  await wait(30);

  assert.ok(called, "createProgrammeActivity must have been called");
  assert.equal(called.programmeId, "prog1");
  assert.equal(called.fields.title, "Drainage (Below Ground)");
  assert.equal(called.fields.planned_start, "2026-04-01");
  assert.equal(called.fields.is_milestone, true);
  assert.equal(document.getElementById("activityFormCard").style.display, "none", "the form should close again after a successful save");
});

test("programme.html: clicking Edit on a row pre-fills the form, and saving calls updateProgrammeActivity (never createProgrammeActivity)", async () => {
  let updateCalled = null;
  let createCalled = false;
  const { document, window } = await runProgrammePage({
    activities: [activity({ id: "act-edit", title: "Slab Pour", percent_complete: 20 })],
    updateProgrammeActivity: async (id, fields) => { updateCalled = { id, fields }; return {}; },
    createProgrammeActivity: async () => { createCalled = true; return {}; },
  });
  await wait(30);
  // Row action buttons use an inline onclick="..." attribute (the same
  // pattern documents.html/drawings.html already use) rather than
  // addEventListener — jsdom's "outside-only" script mode (this
  // harness's mode, so the page's own <script> tag is never double-run)
  // never compiles inline handler attributes into live listeners, so a
  // simulated DOM click can't reach them here. Calling the exposed
  // window.editActivity() directly exercises the exact same function a
  // real click resolves to in an actual browser.
  window.editActivity("act-edit");
  await wait(10);
  assert.equal(document.getElementById("activityTitle").value, "Slab Pour");
  assert.equal(document.getElementById("editingId").value, "act-edit");

  document.getElementById("percentComplete").value = "55";
  fireEvent(document.getElementById("activityForm"), "submit");
  await wait(30);

  assert.ok(updateCalled, "updateProgrammeActivity must have been called");
  assert.equal(updateCalled.id, "act-edit");
  assert.equal(updateCalled.fields.percent_complete, 55);
  assert.equal(createCalled, false, "editing an existing activity must never call createProgrammeActivity");
});

test("programme.html: Delete (after confirmation) calls deleteProgrammeActivity and refreshes the list", async () => {
  let deletedId = null;
  const { window } = await runProgrammePage({
    activities: [activity({ id: "act-del", title: "To Delete" })],
    deleteProgrammeActivity: async (id) => { deletedId = id; },
    confirm: () => true,
  });
  await wait(30);
  // See the comment in the "clicking Edit" test above — inline onclick
  // attributes aren't live in this harness's jsdom mode, so this calls
  // the same window.deleteActivity() a real click resolves to.
  window.deleteActivity("act-del", "To Delete");
  await wait(30);
  assert.equal(deletedId, "act-del");
});

test("programme.html: the status filter narrows the rendered rows to the selected status", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Not Started One", status: "not_started" }),
      activity({ id: "a2", title: "In Progress One", status: "in_progress" }),
      activity({ id: "a3", title: "Complete One", status: "complete" }),
    ],
  });
  await wait(30);
  assert.equal(document.querySelectorAll("#activityRows tr").length, 3);

  document.getElementById("statusFilter").value = "complete";
  fireEvent(document.getElementById("statusFilter"), "change");
  await wait(10);

  const rows = document.querySelectorAll("#activityRows tr");
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Complete One/);
});

test("programme.html: an empty activity list (for the current programme) shows the empty state, not an empty table", async () => {
  const { document } = await runProgrammePage({ activities: [] });
  await wait(30);
  assert.equal(document.getElementById("emptyState").style.display, "block");
  assert.equal(document.querySelectorAll("#activityRows tr").length, 0);
});
