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
// Unlike extractConst() above (which EVALUATES a const and returns its
// value — fine for a plain value binding like PROGRAMME_STATUS_LABEL),
// this returns the RAW SOURCE TEXT of a const declaration, for
// embedding inside another scope (CATEGORISE_SCOPE below) that needs
// the actual `const NAME = ...;` statement, not its evaluated value.
function extractConstSrc(name) {
  const m = APP_JS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
const PROGRAMME_STATUS_LABEL = extractConst("PROGRAMME_STATUS_LABEL");
const PROGRAMME_STATUS_BADGE = extractConst("PROGRAMME_STATUS_BADGE");
const ACTIVITY_STATUSES = extractConst("ACTIVITY_STATUSES");
const ACTIVITY_STATUS_LABEL = extractConst("ACTIVITY_STATUS_LABEL");
const ACTIVITY_STATUS_BADGE = extractConst("ACTIVITY_STATUS_BADGE");
const PROGRAMME_VARIANCE_LABEL = extractConst("PROGRAMME_VARIANCE_LABEL");
const PROGRAMME_VARIANCE_BADGE = extractConst("PROGRAMME_VARIANCE_BADGE");
const ACTION_PRIORITIES = extractConst("ACTION_PRIORITIES");
const ACTION_PRIORITY_LABEL = extractConst("ACTION_PRIORITY_LABEL");

// categoriseProgrammeActivity() (Phase 4) is the REAL function the
// page's own Variance column/filter/sort all depend on — extracted
// (with its own private dependencies) rather than reimplemented, the
// same convention every other test file in this suite uses.
const CATEGORISE_SCOPE = `
  function todayISO() { return "2026-06-15"; }
  ${extractConstSrc("DUE_SOON_DAYS")}
  ${extractConstSrc("PROGRAMME_MATERIAL_DELAY_DAYS")}
  ${extractPrivateFn("diffCalendarDays")}
  ${extractFn("categoriseProgrammeActivity")}
  return { categoriseProgrammeActivity };
`;
const { categoriseProgrammeActivity } = new Function(CATEGORISE_SCOPE)();

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

// `myRole` defaults to "owner" (an editor) — matching this page's own
// long-standing assumption (see the file-header comment) that only
// editors are ever given a link to it; a test that specifically wants
// the v99 "disabled for non-editors" path passes its own role.
function baseSupabaseMock({ myRole = "owner" } = {}) {
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
    rpc: (name) => Promise.resolve(name === "get_my_role" ? { data: myRole, error: null } : { data: [], error: null }),
  };
}

async function runProgrammePage({
  programmes = [ACTIVE_PROGRAMME],
  activities = [activity()],
  createProgramme, activateProgramme, archiveProgramme,
  createProgrammeActivity, updateProgrammeActivity, deleteProgrammeActivity,
  createActionFromProgrammeActivity,
  confirm = () => true,
  todayISO = () => "2026-06-15",
  myRole = "owner",
} = {}) {
  const supabase = baseSupabaseMock({ myRole });
  return runPage(PROGRAMME_HTML, extractScript(PROGRAMME_HTML), {
    __url: "https://example.com/programme.html?project=p1",
    supabase,
    getParam: () => "p1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml, formatDate, showError, clearError, todayISO,
    PROGRAMME_STATUS_LABEL, PROGRAMME_STATUS_BADGE, ACTIVITY_STATUSES, ACTIVITY_STATUS_LABEL, ACTIVITY_STATUS_BADGE,
    categoriseProgrammeActivity, PROGRAMME_VARIANCE_LABEL, PROGRAMME_VARIANCE_BADGE,
    ACTION_PRIORITIES, ACTION_PRIORITY_LABEL,
    buildProgrammeActionContext: (act, cats) => `Programme activity: ${act.title}`,
    createActionFromProgrammeActivity: createActionFromProgrammeActivity || (async (act, fields) => ({ action: { id: "action-new", ...fields }, activity: { ...act, action_id: "action-new" } })),
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

// Row buttons use an inline onclick attribute, not a live listener in
// this harness's jsdom mode (see the established comment on the
// Edit/Delete tests above) — find the real button element by its own
// text, for the disabled-state assertions below, rather than guessing
// a selector from the onclick attribute string.
function completeButtonFor(document, title) {
  const row = Array.from(document.querySelectorAll("#activityRows tr")).find((r) => r.textContent.includes(title));
  return row && Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Complete");
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

// ─── Variance column + filter + Create Action (Priority 11, Phase 4) ──
// The page's injected categoriseProgrammeActivity() (extracted above,
// via CATEGORISE_SCOPE) has "today" fixed at 2026-06-15 — every date
// below is chosen relative to that fixed point, never the real
// runtime date.

test("programme.html: the Variance column shows Overdue/Late/Ahead correctly, matching categoriseProgrammeActivity()", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Overdue One", status: "in_progress", planned_finish: "2026-06-01", forecast_finish: "2026-06-10" }),
      activity({ id: "a2", title: "Late One", status: "in_progress", planned_finish: "2026-07-01", forecast_finish: "2026-07-10" }),
      activity({ id: "a3", title: "Ahead One", status: "in_progress", planned_finish: "2026-07-10", forecast_finish: "2026-07-05" }),
    ],
  });
  await wait(30);
  // The table's own default sort (forecast_finish ascending) doesn't
  // match insertion order, so find each row by its title rather than
  // assuming a position.
  const rows = Array.from(document.querySelectorAll("#activityRows tr"));
  const rowFor = (title) => rows.find((r) => r.textContent.includes(title));
  assert.match(rowFor("Overdue One").textContent, /Overdue/);
  assert.match(rowFor("Late One").textContent, /Late/);
  assert.match(rowFor("Ahead One").textContent, /Ahead/);
});

test("programme.html: the variance filter narrows to overdue rows only", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Overdue One", status: "in_progress", planned_finish: "2026-06-01", forecast_finish: "2026-06-10" }),
      activity({ id: "a2", title: "On Plan One", status: "in_progress", planned_finish: "2026-07-01", forecast_finish: "2026-07-01" }),
    ],
  });
  await wait(30);
  assert.equal(document.querySelectorAll("#activityRows tr").length, 2);

  document.getElementById("varianceFilter").value = "overdue";
  fireEvent(document.getElementById("varianceFilter"), "change");
  await wait(10);

  const rows = document.querySelectorAll("#activityRows tr");
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /Overdue One/);
});

test("programme.html: 'Create Action' only appears for an exception row, never for an on-plan one", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Overdue One", status: "in_progress", planned_finish: "2026-06-01", forecast_finish: "2026-06-10" }),
      activity({ id: "a2", title: "On Plan One", status: "in_progress", planned_finish: "2026-07-01", forecast_finish: "2026-07-01" }),
    ],
  });
  await wait(30);
  const rows = document.querySelectorAll("#activityRows tr");
  assert.match(rows[0].innerHTML, /Create Action/);
  assert.doesNotMatch(rows[1].innerHTML, /Create Action/);
});

test("programme.html: an activity already linked to an action shows 'View Action' instead of 'Create Action'", async () => {
  const { document } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Overdue One", status: "in_progress", planned_finish: "2026-06-01", forecast_finish: "2026-06-10", action_id: "existing-action" })],
  });
  await wait(30);
  const row = document.querySelector("#activityRows tr");
  assert.match(row.innerHTML, /View Action/);
  assert.doesNotMatch(row.innerHTML, /Create Action/);
});

test("programme.html: clicking Create Action opens the modal pre-filled, and submitting calls createActionFromProgrammeActivity then refreshes", async () => {
  let called = null;
  const { document, window } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Overdue One", status: "in_progress", planned_finish: "2026-06-01", forecast_finish: "2026-06-10" })],
    createActionFromProgrammeActivity: async (act, fields) => { called = { activityId: act.id, fields }; return { action: { id: "new-action" }, activity: { ...act, action_id: "new-action" } }; },
  });
  await wait(30);
  // Row action buttons use an inline onclick attribute (see the
  // established comment on the Edit/Delete tests above) — not live in
  // this harness's jsdom mode, so this calls the same
  // window.openCreateAction() a real click resolves to.
  window.openCreateAction("a1");
  await wait(10);
  assert.equal(document.getElementById("createActionModal").style.display, "flex");
  assert.match(document.getElementById("actionTitle").value, /Overdue One/);

  fireEvent(document.getElementById("createActionForm"), "submit");
  await wait(30);

  assert.ok(called, "createActionFromProgrammeActivity must have been called");
  assert.equal(called.activityId, "a1");
  assert.equal(document.getElementById("createActionModal").style.display, "none", "the modal should close after a successful save");
});

// ─── One-click Complete ──────────────────────────────────────────────
// Fixes a real bug: leaving actual_finish for
// programme_activities_before_write() to default (today) when
// catching up on long-finished work makes it show as "Completed Late"
// by however many weeks have passed. "today" is fixed at 2026-06-15
// via the injected todayISO() above, matching the variance tests.

test("programme.html: the Complete button shows on an open activity, and not at all once it's complete or cancelled", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Open One", status: "in_progress" }),
      activity({ id: "a2", title: "Done One", status: "complete" }),
      activity({ id: "a3", title: "Cancelled One", status: "cancelled" }),
    ],
  });
  await wait(30);
  assert.ok(completeButtonFor(document, "Open One"), "an open activity must offer Complete");
  assert.ok(!completeButtonFor(document, "Done One"), "an already-complete activity must not offer Complete again");
  assert.ok(!completeButtonFor(document, "Cancelled One"), "a cancelled activity must not offer Complete");
});

test("programme.html: Complete sends the forecast finish as actual_finish when it's today or earlier", async () => {
  let called = null;
  const act = activity({ id: "a1", title: "Groundworks", status: "in_progress", forecast_finish: "2026-05-01" }); // before today (2026-06-15)
  const { document, window } = await runProgrammePage({
    activities: [act],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  window.completeActivity("a1", completeButtonFor(document, "Groundworks"));
  await wait(30);

  assert.ok(called, "updateProgrammeActivity must have been called");
  assert.equal(called.id, "a1");
  assert.equal(called.fields.status, "complete");
  assert.equal(called.fields.actual_finish, "2026-05-01", "a forecast finish on or before today is the best evidence of when it actually finished");
});

test("programme.html: Complete sends today as actual_finish when the forecast finish is in the future (or missing) — never a future date", async () => {
  let called = null;
  const futureAct = activity({ id: "a1", title: "Future Forecast", status: "in_progress", forecast_finish: "2026-07-01" }); // after today
  const { document, window } = await runProgrammePage({
    activities: [futureAct],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  window.completeActivity("a1", completeButtonFor(document, "Future Forecast"));
  await wait(30);
  assert.equal(called.fields.actual_finish, "2026-06-15", "must fall back to today, never the future forecast date");

  called = null;
  const noForecastAct = activity({ id: "a2", title: "No Forecast", status: "in_progress", forecast_finish: null });
  const { document: doc2, window: win2 } = await runProgrammePage({
    activities: [noForecastAct],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  win2.completeActivity("a2", completeButtonFor(doc2, "No Forecast"));
  await wait(30);
  assert.equal(called.fields.actual_finish, "2026-06-15", "no forecast finish at all must also fall back to today");
});

test("programme.html: Complete fills an empty actual_start from forecast/planned start when that date is on or before the computed actual finish", async () => {
  let called = null;
  const act = activity({
    id: "a1", title: "Fill Start", status: "in_progress",
    forecast_start: "2026-04-01", planned_start: "2026-03-01", actual_start: null, forecast_finish: "2026-05-01",
  });
  const { document, window } = await runProgrammePage({
    activities: [act],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  window.completeActivity("a1", completeButtonFor(document, "Fill Start"));
  await wait(30);
  assert.equal(called.fields.actual_start, "2026-04-01", "forecast_start is preferred over planned_start when both exist");
});

test("programme.html: Complete falls back to planned_start for actual_start when there's no forecast_start", async () => {
  let called = null;
  const act = activity({
    id: "a1", title: "Planned Start Only", status: "in_progress",
    forecast_start: null, planned_start: "2026-03-01", actual_start: null, forecast_finish: "2026-05-01",
  });
  const { document, window } = await runProgrammePage({
    activities: [act],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  window.completeActivity("a1", completeButtonFor(document, "Planned Start Only"));
  await wait(30);
  assert.equal(called.fields.actual_start, "2026-03-01");
});

test("programme.html: Complete never overwrites an actual_start that's already set", async () => {
  let called = null;
  const act = activity({
    id: "a1", title: "Already Started", status: "in_progress",
    forecast_start: "2026-04-01", actual_start: "2026-04-10", forecast_finish: "2026-05-01",
  });
  const { document, window } = await runProgrammePage({
    activities: [act],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  window.completeActivity("a1", completeButtonFor(document, "Already Started"));
  await wait(30);
  assert.equal(called.fields.actual_start, undefined, "an already-set actual_start must be left alone, not sent in the update at all");
});

test("programme.html: Complete never fills actual_start with a date that would land after the computed actual finish", async () => {
  let called = null;
  // forecast_start is AFTER the forecast_finish being used as
  // actual_finish — a clearly inconsistent record, so must be left
  // alone rather than guessed.
  const act = activity({
    id: "a1", title: "Inconsistent Dates", status: "in_progress",
    forecast_start: "2026-05-10", planned_start: "2026-05-10", actual_start: null, forecast_finish: "2026-05-01",
  });
  const { document, window } = await runProgrammePage({
    activities: [act],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  window.completeActivity("a1", completeButtonFor(document, "Inconsistent Dates"));
  await wait(30);
  assert.equal(called.fields.actual_start, undefined, "must never fill actual_start with a date after actual_finish");
});

test("programme.html: Complete disables the button immediately so a second click before the first save resolves can't fire twice", async () => {
  let calls = 0;
  let resolveUpdate;
  const act = activity({ id: "a1", title: "Slow Save", status: "in_progress" });
  const { document, window } = await runProgrammePage({
    activities: [act],
    updateProgrammeActivity: async () => { calls++; return new Promise((resolve) => { resolveUpdate = () => resolve({}); }); },
  });
  await wait(30);
  const btn = completeButtonFor(document, "Slow Save");
  window.completeActivity("a1", btn);
  await wait(10);
  assert.equal(btn.disabled, true, "the button must be disabled as soon as the save starts");

  // A second click/call while the first save is still in flight.
  window.completeActivity("a1", btn);
  await wait(10);
  assert.equal(calls, 1, "a second click while the first save is in flight must never fire a second update");

  resolveUpdate();
  await wait(30);
});

test("programme.html: a failed Complete shows the error and re-enables the button", async () => {
  const act = activity({ id: "a1", title: "Will Fail", status: "in_progress" });
  const { document, window } = await runProgrammePage({
    activities: [act],
    updateProgrammeActivity: async () => { throw new Error("row-level security policy violation"); },
  });
  await wait(30);
  const btn = completeButtonFor(document, "Will Fail");
  window.completeActivity("a1", btn);
  await wait(30);

  assert.match(document.getElementById("pageErrorBox").textContent, /row-level security/);
  assert.equal(btn.disabled, false, "a failed save must re-enable the button so it can be retried");
});

test("programme.html: a successful Complete re-renders the row — the Complete button disappears once the activity is actually complete", async () => {
  const sharedActivities = [activity({ id: "a1", title: "Finishing Up", status: "in_progress", forecast_finish: "2026-05-01" })];
  const { document, window } = await runProgrammePage({
    activities: sharedActivities,
    updateProgrammeActivity: async (id, fields) => {
      Object.assign(sharedActivities.find((a) => a.id === id), fields);
      return sharedActivities.find((a) => a.id === id);
    },
  });
  await wait(30);
  window.completeActivity("a1", completeButtonFor(document, "Finishing Up"));
  await wait(30);

  assert.ok(!completeButtonFor(document, "Finishing Up"), "Complete must no longer be offered once the row re-renders as complete");
  assert.match(document.getElementById("activityRows").textContent, /Completed/i);
});

// ─── "Programme complete" summary (v93) ──────────────────────────
// computeProgrammeComplete() itself is exercised for real (not
// reimplemented) via the jsdom harness's own default binding — see
// loadComputeProgrammeComplete() in tests/lib/jsdom-harness.mjs — so
// these only prove the PAGE renders what that real function returns,
// the same division of responsibility the rest of this file already
// keeps between categoriseProgrammeActivity() and its own rendering.
test("programme.html: the 'Programme complete' summary shows the duration-weighted percent and the complete/counted totals", async () => {
  const { document } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Groundworks", status: "in_progress", percent_complete: 40, planned_start: "2026-01-01", planned_finish: "2026-01-15" })],
  });
  await wait(30);
  const summary = document.getElementById("programmeCompleteSummary");
  assert.equal(summary.style.display, "block");
  assert.match(summary.textContent, /Programme complete: 40% \(0 of 1 counted activities\)/);
});

// v99: the displayed total is now "counted activities" — not cancelled,
// not excluded — so it agrees with what the weighted percent is
// actually computed over, rather than the page's raw, unfiltered
// activity count.
test("programme.html: the summary excludes cancelled activities from BOTH the weighted percent and the counted total shown", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Done", status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-15" }),
      activity({ id: "a2", title: "Abandoned", status: "cancelled", percent_complete: 0, planned_start: "2026-01-01", planned_finish: "2026-01-15" }),
      activity({ id: "a3", title: "Halfway", status: "in_progress", percent_complete: 50, planned_start: "2026-01-01", planned_finish: "2026-01-15" }),
    ],
  });
  await wait(30);
  const summary = document.getElementById("programmeCompleteSummary");
  // Both countable activities (a1, a3) have equal weight (same 14-day
  // planned duration), so the weighted figure is a plain average of
  // 100% and 50% — 75% — with the cancelled activity contributing to
  // neither side of that fraction, nor to the "of N counted" total.
  assert.match(summary.textContent, /Programme complete: 75% \(1 of 2 counted activities\)/);
});

test("programme.html: an activity ticked exclude_from_progress is left out of the weighted percent AND the counted total, the same as a cancelled one", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Real work", status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-15" }),
      activity({ id: "a2", title: "Programme Title Row", status: "not_started", percent_complete: 0, planned_start: "2025-01-01", planned_finish: "2027-01-01", exclude_from_progress: true, exclude_from_progress_source: "auto" }),
    ],
  });
  await wait(30);
  const summary = document.getElementById("programmeCompleteSummary");
  assert.match(summary.textContent, /Programme complete: 100% \(1 of 1 counted activities\)/, "the excluded header row's huge span must drag down neither the percent nor the counted denominator");
});

test("programme.html: with no programme at all, the summary stays hidden", async () => {
  const { document } = await runProgrammePage({ programmes: [] });
  await wait(30);
  assert.equal(document.getElementById("programmeCompleteSummary").style.display, "none");
});

// ─── "Counts?" tick + auto-ticked notice (v99) ─────────────────────

function countsCheckboxFor(document, title) {
  const row = Array.from(document.querySelectorAll("#activityRows tr")).find((r) => r.textContent.includes(title));
  return row && row.querySelector('input[type="checkbox"]');
}

test("programme.html: the Counts? checkbox is checked when exclude_from_progress is false, unchecked when true", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Counted", exclude_from_progress: false }),
      activity({ id: "a2", title: "Excluded", exclude_from_progress: true, exclude_from_progress_source: "manual" }),
    ],
  });
  await wait(30);
  assert.equal(countsCheckboxFor(document, "Counted").checked, true);
  assert.equal(countsCheckboxFor(document, "Excluded").checked, false);
});

// Like completeActivity() above, the checkbox/button's own onchange/
// onclick is an inline attribute string — never executed under this
// harness's runScripts:"outside-only" jsdom mode (see completeButtonFor()'s
// own precedent) — so these call the page's exposed window.toggleExcludeFromProgress()
// directly, the same real function that attribute would call, rather
// than dispatching a DOM event nothing here would pick up.
test("programme.html: unticking Counts? calls updateProgrammeActivity with exclude_from_progress true and source 'manual'", async () => {
  let called = null;
  const { window } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Groundworks", exclude_from_progress: false })],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  window.toggleExcludeFromProgress("a1", true);
  await wait(30);
  assert.equal(called.id, "a1");
  assert.equal(called.fields.exclude_from_progress, true);
  assert.equal(called.fields.exclude_from_progress_source, "manual");
});

test("programme.html: re-ticking Counts? on a previously auto-excluded row calls updateProgrammeActivity with exclude_from_progress false and source 'manual' — an editor's own choice, never left as 'auto'", async () => {
  let called = null;
  const { window } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Prelims", exclude_from_progress: true, exclude_from_progress_source: "auto" })],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  window.toggleExcludeFromProgress("a1", false);
  await wait(30);
  assert.equal(called.id, "a1");
  assert.equal(called.fields.exclude_from_progress, false);
  assert.equal(called.fields.exclude_from_progress_source, "manual");
});

test("programme.html: the Counts? checkbox is disabled for a non-editor (snagging role)", async () => {
  const { document } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Groundworks" })],
    myRole: "snagging",
  });
  await wait(30);
  assert.equal(countsCheckboxFor(document, "Groundworks").disabled, true);
});

test("programme.html: the Counts? checkbox is enabled for an editor (owner or collaborator)", async () => {
  const owner = await runProgrammePage({ activities: [activity({ id: "a1", title: "Groundworks" })], myRole: "owner" });
  await wait(30);
  assert.equal(countsCheckboxFor(owner.document, "Groundworks").disabled, false);

  const collaborator = await runProgrammePage({ activities: [activity({ id: "a1", title: "Groundworks" })], myRole: "collaborator" });
  await wait(30);
  assert.equal(countsCheckboxFor(collaborator.document, "Groundworks").disabled, false);
});

test("programme.html: an auto-excluded row appears in the auto-ticked notice, a manually-excluded row does not", async () => {
  const { document } = await runProgrammePage({
    activities: [
      activity({ id: "a1", title: "Programme Title Row", exclude_from_progress: true, exclude_from_progress_source: "auto" }),
      activity({ id: "a2", title: "Deliberately Excluded By Editor", exclude_from_progress: true, exclude_from_progress_source: "manual" }),
      activity({ id: "a3", title: "Normal Task", exclude_from_progress: false }),
    ],
  });
  await wait(30);
  const card = document.getElementById("autoExcludedCard");
  assert.equal(card.style.display, "block");
  const text = document.getElementById("autoExcludedList").textContent;
  assert.match(text, /Programme Title Row/);
  assert.ok(!text.includes("Deliberately Excluded By Editor"), "a manually-excluded row must never appear in the AUTO-ticked notice");
  assert.ok(!text.includes("Normal Task"), "a counted row must never appear in the notice");
});

test("programme.html: the auto-ticked notice stays hidden when nothing is currently auto-excluded", async () => {
  const { document } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Normal Task", exclude_from_progress: false })],
  });
  await wait(30);
  assert.equal(document.getElementById("autoExcludedCard").style.display, "none");
});

test("programme.html: the auto-ticked notice offers an Untick action that is the same window.toggleExcludeFromProgress(id, false) its onclick attribute calls", async () => {
  let called = null;
  const { document, window } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Prelims", exclude_from_progress: true, exclude_from_progress_source: "auto" })],
    updateProgrammeActivity: async (id, fields) => { called = { id, fields }; return {}; },
  });
  await wait(30);
  const btn = Array.from(document.getElementById("autoExcludedList").querySelectorAll("button")).find((b) => b.textContent.includes("Untick"));
  assert.ok(btn, "the notice must offer an Untick action");
  assert.match(btn.getAttribute("onclick"), /toggleExcludeFromProgress\('a1', false\)/);
  window.toggleExcludeFromProgress("a1", false);
  await wait(30);
  assert.equal(called.id, "a1");
  assert.equal(called.fields.exclude_from_progress, false);
  assert.equal(called.fields.exclude_from_progress_source, "manual");
});

test("programme.html: the Untick button in the auto-ticked notice is disabled for a non-editor too", async () => {
  const { document } = await runProgrammePage({
    activities: [activity({ id: "a1", title: "Prelims", exclude_from_progress: true, exclude_from_progress_source: "auto" })],
    myRole: "snagging",
  });
  await wait(30);
  const btn = Array.from(document.getElementById("autoExcludedList").querySelectorAll("button")).find((b) => b.textContent.includes("Untick"));
  assert.equal(btn.disabled, true);
});
