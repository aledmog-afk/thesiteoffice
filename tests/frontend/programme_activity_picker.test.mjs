// Programme activity picker (v93) — weekly-report-form.html's
// "Progress this week" and "Plan for next week" item lists can now be
// filled from the site's own active programme instead of retyping an
// activity's title. Three layers, matching this suite's own convention
// of testing the pure/library logic for real and the page's wiring
// separately:
//   1. mountItemListEditor()'s own addFromActivity() entry point and
//      programme_activity_id passthrough — the REAL function from
//      app.js (extracted, not reimplemented), run against a real jsdom
//      container so its DOM-reading internals (the existing "+ Add"
//      button, edit/save) are exercised too.
//   2. syncNextWeekFromProgress()'s carry-over of programme_activity_id
//      — the REAL function from weekly-report-form.html (extracted the
//      same way weekly_report_save.test.mjs already extracts
//      syncCommercialItems() from the same file).
//   3. The PAGE itself: the picker row's visibility and what it calls
//      addFromActivity() with — weekly-report-form.html's real inline
//      script under jsdom, with a RECORDING stub for mountItemListEditor
//      (the same stubbing convention weekly_report_workflow.test.mjs
//      already uses for this page), so this layer proves the wiring,
//      not the editor's own internals (already covered by layer 1).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConstSrc(name) {
  const m = APP_JS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
function extractPrivateConstSrc(name) {
  const m = APP_JS.match(new RegExp(`const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0];
}
function extractFn(name) {
  const m = APP_JS.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

// ─── Layer 1: mountItemListEditor() for real ─────────────────────
const escapeHtmlSrc = `function escapeHtml(str) { return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }`;
const EDITOR_SCOPE = `
  ${escapeHtmlSrc}
  ${extractConstSrc("PROGRESS_STAGES")}
  ${extractConstSrc("BUILD_MILESTONES")}
  ${extractPrivateConstSrc("MILESTONE_CUSTOM_VALUE")}
  ${extractFn("mountItemListEditor")}
  return { mountItemListEditor };
`;
const { mountItemListEditor } = new Function(EDITOR_SCOPE)();

function makeContainer() {
  const dom = new JSDOM(`<!doctype html><div id="c"></div>`);
  return dom.window.document.getElementById("c");
}

test("mountItemListEditor: addFromActivity() adds an item carrying the given text/plot/percent and programme_activity_id", () => {
  const editor = mountItemListEditor(makeContainer(), [], () => {}, { withPercent: true });
  editor.addFromActivity({ text: "Roof Covering", plot: "Plot 4", percent: 60, programme_activity_id: "act-1" });
  const items = editor.getItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "Roof Covering");
  assert.equal(items[0].plot, "Plot 4");
  assert.equal(items[0].percent, 60);
  assert.equal(items[0].programme_activity_id, "act-1");
});

test("mountItemListEditor: an item added via addFromActivity with no percent given defaults to 0, same as the normal + Add button", () => {
  const editor = mountItemListEditor(makeContainer(), [], () => {}, { withPercent: true });
  editor.addFromActivity({ text: "No percent given", plot: "", programme_activity_id: "act-2" });
  assert.equal(editor.getItems()[0].percent, 0);
});

test("mountItemListEditor: free-text items typed through the existing '+ Add' button are completely unchanged — no programme_activity_id, normal text/plot", () => {
  const container = makeContainer();
  const editor = mountItemListEditor(container, [], () => {}, { withPercent: true });
  container.querySelector("#itemListNewInput").value = "Typed freely";
  container.querySelector("#itemListNewPlot").value = "Plot 9";
  container.querySelector("#itemListAddBtn").click();
  const items = editor.getItems();
  assert.equal(items.length, 1);
  assert.equal(items[0].text, "Typed freely");
  assert.equal(items[0].plot, "Plot 9");
  assert.ok(!items[0].programme_activity_id, "a freetext item must carry no programme_activity_id");
});

test("mountItemListEditor: editing an item added from the picker preserves its programme_activity_id", () => {
  const container = makeContainer();
  const editor = mountItemListEditor(container, [{ id: "x1", text: "From programme", plot: "Plot 4", programme_activity_id: "act-1", percent: 0 }], () => {}, { withPercent: true });
  container.querySelector('[data-edit="0"]').click();
  container.querySelector(".item-edit-input").value = "Edited title";
  container.querySelector('[data-save="0"]').click();
  const items = editor.getItems();
  assert.equal(items[0].text, "Edited title");
  assert.equal(items[0].programme_activity_id, "act-1", "manual edits must never drop the traceback id");
});

// ─── Layer 2: syncNextWeekFromProgress() for real ────────────────
const FORM_HTML = fs.readFileSync(new URL("../../tracker/weekly-report-form.html", import.meta.url).pathname, "utf8");
const syncMatch = FORM_HTML.match(/function syncNextWeekFromProgress\(progressItems, nextWeekItems\)[\s\S]*?\n  \}/);
assert.ok(syncMatch, "syncNextWeekFromProgress not found in weekly-report-form.html");
const syncNextWeekFromProgress = new Function(`return ${syncMatch[0]}`)();

test("syncNextWeekFromProgress: an unfinished progress item carries its programme_activity_id into next week's plan", () => {
  const progressItems = [{ id: "p1", plot: "Plot 4", text: "Roof Covering", milestone: "", percent: 60, programme_activity_id: "act-1" }];
  const result = syncNextWeekFromProgress(progressItems, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].programme_activity_id, "act-1");
});

test("syncNextWeekFromProgress: a freetext progress item (no programme_activity_id) carries forward as null, unaffected", () => {
  const progressItems = [{ id: "p1", plot: "", text: "Freetext task", milestone: "", percent: 30 }];
  const result = syncNextWeekFromProgress(progressItems, []);
  assert.equal(result.length, 1);
  assert.equal(result[0].programme_activity_id, null);
});

test("syncNextWeekFromProgress: a next-week item already matched by id keeps its own programme_activity_id (the 'kept' branch, untouched by this change)", () => {
  const progressItems = [{ id: "p1", plot: "Plot 4", text: "Roof Covering", percent: 80, programme_activity_id: "act-1" }];
  const nextWeekItems = [{ id: "p1", plot: "Plot 4", text: "Roof Covering", percent: 50, programme_activity_id: "act-1" }];
  const result = syncNextWeekFromProgress(progressItems, nextWeekItems);
  assert.equal(result.length, 1);
  assert.equal(result[0].percent, 80, "percent is still rolled forward from the progress item");
  assert.equal(result[0].programme_activity_id, "act-1");
});

test("syncNextWeekFromProgress: an item reaching 100% still drops out of next week's plan entirely, programme_activity_id or not", () => {
  const progressItems = [{ id: "p1", plot: "Plot 4", text: "Roof Covering", percent: 100, programme_activity_id: "act-1" }];
  const result = syncNextWeekFromProgress(progressItems, [{ id: "p1", plot: "Plot 4", text: "Roof Covering", percent: 80, programme_activity_id: "act-1" }]);
  assert.equal(result.length, 0);
});

// ─── Layer 3: the page's own wiring ──────────────────────────────
const FORM_PATH = new URL("../../tracker/weekly-report-form.html", import.meta.url).pathname;
const SAMPLE_PROJECT = { id: "p1", name: "Test Site", org_id: "org1" };

function formSupabaseMock() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        limit() { return api; },
        single: async () => (table === "projects" ? { data: SAMPLE_PROJECT, error: null } : { data: null, error: null }),
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

// A recording stand-in for mountItemListEditor — proves what the PAGE
// calls addFromActivity() with, the same "stub the library, check the
// call" boundary weekly_report_workflow.test.mjs already draws for
// this exact function on this exact page.
function recordingEditorFactory(recorded) {
  return (container, initialItems) => {
    const items = [...(initialItems || [])];
    return {
      getItems: () => items,
      addFromActivity: (partial) => { recorded.push(partial); items.push(partial); },
    };
  };
}

async function runForm({ activeProgramme = null, activities = [] } = {}) {
  const added = [];
  const result = await runPage(FORM_PATH, extractScript(FORM_PATH), {
    __url: "https://example.com/weekly-report-form.html?project=p1",
    supabase: formSupabaseMock(),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: (name) => (name === "project" ? "p1" : null),
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    mondayOf: () => "2026-09-07",
    uploadImage: async () => "https://example.com/photo.jpg",
    todayISO: () => "2026-09-11",
    mountItemListEditor: recordingEditorFactory(added),
    mountTableEditor: () => ({ getRows: () => [] }),
    toLocalISODate: (d) => d.toISOString().slice(0, 10),
    WEATHER_CONDITIONS: [],
    fetchWeatherConditions: async () => [],
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b)),
    normalisePlotToken: (s) => String(s || "").replace(/\D/g, ""),
    syncGateStatusFromMilestones: async () => {},
    EXTERNAL_WORKS_TAG: "External / Engineering Works",
    PHOTO_COMPLIANCE_STATUS: [],
    RESOURCE_ADEQUACY: [], RESOURCE_ADEQUACY_BADGE: {},
    RISK_IMPACT_LEVELS: [], RISK_IMPACT_BADGE: {},
    RISK_OWNER_SUGGESTIONS: [],
    STATUTORY_MILESTONE_TYPES: [], STATUTORY_OUTCOMES: [], STATUTORY_OUTCOME_BADGE: {},
    getWeeklyReportPosition: async () => null,
    isWeeklyReportLocked: () => false,
    reviseWeeklyReport: async () => ({}),
    WEEKLY_REPORT_STATUS_LABEL: {}, WEEKLY_REPORT_STATUS_BADGE: {},
    CONTROL_LEVEL_BADGE: {}, FINDING_SEVERITY_LABEL: {},
    saveFileToDevice: async () => ({}), deviceSavePhotoFilename: () => "photo.jpg", deviceSaveStatusLabel: () => "",
    getRfiLinksForWeeklyReport: async () => [], attachReportCommercialNotes: async () => true,
    getUnattachedDiaryEntries: async () => [], getWeeklyReportDiaryEntries: async () => [],
    attachDiaryEntryToReport: async () => ({}), updateAttachedDiaryEntry: async () => ({}), removeAttachedDiaryEntry: async () => {},
    getActiveProgramme: async () => activeProgramme,
    listProgrammeActivities: async () => activities,
  });
  return { ...result, added };
}

function sampleActivity(overrides = {}) {
  return {
    id: "act-1", title: "Roof Covering", status: "in_progress", percent_complete: 60,
    forecast_finish: "2026-09-20", plots: { plot_number: "Plot 4" },
    ...overrides,
  };
}

test("weekly-report-form.html: with no active programme, both pickers stay hidden", async () => {
  const { document } = await runForm({ activeProgramme: null });
  await wait(30);
  assert.equal(document.getElementById("progressActivityPickerRow").style.display, "none");
  assert.equal(document.getElementById("nextWeekActivityPickerRow").style.display, "none");
});

test("weekly-report-form.html: with an active programme that has eligible activities, both pickers show, offering only non-complete/non-cancelled activities", async () => {
  const { document } = await runForm({
    activeProgramme: { id: "prog1", project_id: "p1", status: "active" },
    activities: [sampleActivity(), sampleActivity({ id: "act-2", title: "Done already", status: "complete" }), sampleActivity({ id: "act-3", title: "Scrapped", status: "cancelled" })],
  });
  await wait(30);
  assert.equal(document.getElementById("progressActivityPickerRow").style.display, "flex");
  assert.equal(document.getElementById("nextWeekActivityPickerRow").style.display, "flex");
  const progressOptions = document.getElementById("progressActivityPicker").innerHTML;
  assert.match(progressOptions, /Roof Covering/);
  assert.ok(!progressOptions.includes("Done already"), "a complete activity must not be offered");
  assert.ok(!progressOptions.includes("Scrapped"), "a cancelled activity must not be offered");
});

test("weekly-report-form.html: picking an activity on the progress picker calls addFromActivity with the activity's title, plot and percent_complete", async () => {
  const { document, added } = await runForm({
    activeProgramme: { id: "prog1", project_id: "p1", status: "active" },
    activities: [sampleActivity()],
  });
  await wait(30);
  const picker = document.getElementById("progressActivityPicker");
  picker.value = "act-1";
  fireEvent(picker, "change");
  await wait(10);
  assert.equal(added.length, 1);
  assert.equal(added[0].text, "Roof Covering");
  assert.equal(added[0].plot, "Plot 4");
  assert.equal(added[0].percent, 60);
  assert.equal(added[0].programme_activity_id, "act-1");
  assert.equal(picker.value, "", "the picker resets so the same activity can be added again or another picked");
});

test("weekly-report-form.html: picking an activity on the next-week picker calls addFromActivity with no percent field (next-week items have none)", async () => {
  const { document, added } = await runForm({
    activeProgramme: { id: "prog1", project_id: "p1", status: "active" },
    activities: [sampleActivity()],
  });
  await wait(30);
  const picker = document.getElementById("nextWeekActivityPicker");
  picker.value = "act-1";
  fireEvent(picker, "change");
  await wait(10);
  assert.equal(added.length, 1);
  assert.equal(added[0].text, "Roof Covering");
  assert.equal(added[0].plot, "Plot 4");
  assert.equal(added[0].programme_activity_id, "act-1");
  assert.ok(!("percent" in added[0]), "the next-week picker must not invent a percent field");
});

test("weekly-report-form.html: an activity with no plot tagged adds an item with no plot pre-selected", async () => {
  const { document, added } = await runForm({
    activeProgramme: { id: "prog1", project_id: "p1", status: "active" },
    activities: [sampleActivity({ plots: null })],
  });
  await wait(30);
  const picker = document.getElementById("progressActivityPicker");
  picker.value = "act-1";
  fireEvent(picker, "change");
  await wait(10);
  assert.equal(added[0].plot, "");
});
