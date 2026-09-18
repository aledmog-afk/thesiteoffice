// Save to Device (Priority 18) — Weekly Report photos, including the
// existing MULTIPLE-file workflow. Proves weekly-report-form.html's real
// inline script still uploads every selected photo exactly as before
// (regression — one uploadImage() call per file, correct URLs land in the
// photos array that gets saved), and that each resulting photo card gets
// its own Save to Device control tied to its own original File — the
// button/status wiring here is addEventListener-based (not an inline
// attribute), so real DOM events can be used directly, unlike
// inspection-detail.html's onclick-attribute rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const FORM_HTML = new URL("../../tracker/weekly-report-form.html", import.meta.url).pathname;

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const WEEKLY_REPORT_STATUS_LABEL = extractConst("WEEKLY_REPORT_STATUS_LABEL");
const WEEKLY_REPORT_STATUS_BADGE = extractConst("WEEKLY_REPORT_STATUS_BADGE");
const CONTROL_LEVEL_BADGE = extractConst("CONTROL_LEVEL_BADGE");

function isWeeklyReportLocked(report) { return report.status === "approved" || report.status === "issued"; }

const SAMPLE_PROJECT = { id: "p1", name: "Test Site", org_id: "org1", main_contractor_name: "ACME", main_contractor_email: "acme@example.com" };

function samplePosition() {
  return {
    period: { weekStarting: "2026-09-07", weekEnding: "2026-09-11" },
    generatedAt: "2026-09-11T12:00:00Z",
    exceptions: { counts: { overdue: 0 }, status: { level: "on_track", label: "On Track", reason: "On track." } },
    activity: { actionsCreated: [], actionsCompleted: [], snagsRaised: [], snagsClosed: [], snagsVerified: [], findingsResolved: [], inspectionsCompleted: [] },
    actionsSummary: { overdue: [], dueDuringPeriod: [], blocked: [], highCriticalOpen: [] },
    snagsSummary: { overdue: [], highPriorityOpen: [] },
    inspectionsSummary: { openFindings: [], criticalFindings: [], highSeverityFindings: [] },
    hsSummary: { auditLoggedThisMonth: true, highSeverityOpenCount: 0 },
  };
}

function setInputFiles(input, files) {
  Object.defineProperty(input, "files", { value: files, configurable: true });
}

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
        insert(payload) { return { select: () => ({ single: async () => ({ data: { id: "new-report-id", ...payload }, error: null }) }) }; },
        update() { return { eq: async () => ({ error: null }) }; },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runForm(overrides = {}) {
  const uploadCalls = [];
  const supabase = formSupabaseMock();
  const result = await runPage(FORM_HTML, extractScript(FORM_HTML), {
    __url: `https://example.com/weekly-report-form.html?project=p1`,
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: (name) => (name === "project" ? "p1" : null),
    escapeHtml: (s) => String(s ?? ""),
    showError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    mondayOf: () => "2026-09-07",
    uploadImage: async (file, path) => { uploadCalls.push({ file, path }); return `https://example.com/${path}/${file.name}`; },
    todayISO: () => "2026-09-10",
    toLocalISODate: (d) => (typeof d === "string" ? d : "2026-09-11"),
    mountItemListEditor: () => ({ getItems: () => [] }),
    mountTableEditor: () => ({ getRows: () => [] }),
    formatGBP: () => null,
    WEATHER_CONDITIONS: [],
    fetchWeatherConditions: async () => new Map(),
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b)),
    normalisePlotToken: (s) => String(s).toLowerCase(),
    syncGateStatusFromMilestones: async () => {},
    EXTERNAL_WORKS_TAG: "External / Engineering Works",
    PHOTO_COMPLIANCE_STATUS: [],
    RESOURCE_ADEQUACY: [], RESOURCE_ADEQUACY_BADGE: {},
    RISK_IMPACT_LEVELS: [], RISK_IMPACT_BADGE: {},
    RISK_OWNER_SUGGESTIONS: [],
    STATUTORY_MILESTONE_TYPES: [], STATUTORY_OUTCOMES: [], STATUTORY_OUTCOME_BADGE: {},
    getWeeklyReportPosition: async () => samplePosition(),
    isWeeklyReportLocked,
    reviseWeeklyReport: async () => ({}),
    WEEKLY_REPORT_STATUS_LABEL, WEEKLY_REPORT_STATUS_BADGE, CONTROL_LEVEL_BADGE,
    FINDING_SEVERITY_LABEL: { critical: "Critical" },
    saveFileToDevice: overrides.saveFileToDevice || (async () => ({ method: "share", status: "saved" })),
    deviceSavePhotoFilename: overrides.deviceSavePhotoFilename || (() => "site-photo-test.jpg"),
    deviceSaveStatusLabel: overrides.deviceSaveStatusLabel || ((s) => (s ? `STATUS:${s}` : "")),
  });
  return { ...result, uploadCalls };
}

test("weekly-report-form.html: selecting MULTIPLE photos still uploads each one via the existing (unchanged) uploadImage() pipeline — no regression", async () => {
  const { document, uploadCalls } = await runForm();
  await wait(50);

  const file1 = { name: "site1.jpg", type: "image/jpeg", size: 111 };
  const file2 = { name: "site2.jpg", type: "image/jpeg", size: 222 };
  const input = document.getElementById("photoInput");
  setInputFiles(input, [file1, file2]);
  fireEvent(input, "change");
  await wait(30);

  assert.equal(uploadCalls.length, 2, "each selected file must be uploaded individually, exactly as before");
  assert.equal(uploadCalls[0].file, file1);
  assert.equal(uploadCalls[1].file, file2);
  const gallery = document.getElementById("photoGallery").innerHTML;
  assert.ok(gallery.includes("site1.jpg") && gallery.includes("site2.jpg"), "both uploaded photos must render");
});

test("weekly-report-form.html: each of the two uploaded photos gets its OWN Save to Device button, correctly associated with its OWN original File", async () => {
  const calls = [];
  const { document } = await runForm({
    saveFileToDevice: async (file, filename) => { calls.push({ file, filename }); return { method: "share", status: "saved" }; },
  });
  await wait(50);

  const file1 = { name: "photo-a.jpg", type: "image/jpeg", size: 1 };
  const file2 = { name: "photo-b.jpg", type: "image/jpeg", size: 2 };
  const input = document.getElementById("photoInput");
  setInputFiles(input, [file1, file2]);
  fireEvent(input, "change");
  await wait(30);

  const buttons = document.querySelectorAll(".save-device");
  assert.equal(buttons.length, 2, "each photo must have its own Save to Device button");

  fireEvent(buttons[1], "click");
  await wait(30);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, file2, "clicking the SECOND photo's Save to Device button must save the SECOND file — never the wrong one exposed to a mismatched button");
});

test("weekly-report-form.html: saving the FIRST of two photos to device never saves the second's file (and removing a photo does not corrupt the remaining association)", async () => {
  const calls = [];
  const { document } = await runForm({
    saveFileToDevice: async (file) => { calls.push(file); return { method: "share", status: "saved" }; },
  });
  await wait(50);

  const file1 = { name: "photo-1.jpg", type: "image/jpeg", size: 1 };
  const file2 = { name: "photo-2.jpg", type: "image/jpeg", size: 2 };
  const file3 = { name: "photo-3.jpg", type: "image/jpeg", size: 3 };
  const input = document.getElementById("photoInput");
  setInputFiles(input, [file1, file2, file3]);
  fireEvent(input, "change");
  await wait(30);

  // Remove the middle photo (index 1) — the remaining photos' Save to
  // Device buttons must still point at the CORRECT surviving files by
  // object identity, not by a now-stale index.
  const removeButtons = document.querySelectorAll(".remove");
  assert.equal(removeButtons.length, 3);
  fireEvent(removeButtons[1], "click");
  await wait(20);

  const saveButtons = document.querySelectorAll(".save-device");
  assert.equal(saveButtons.length, 2, "two photos should remain after removing the middle one");

  fireEvent(saveButtons[0], "click");
  await wait(30);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], file1, "the first remaining photo must still save file1");

  fireEvent(saveButtons[1], "click");
  await wait(30);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], file3, "the second remaining photo must save file3 (the original third file), never the removed file2");
});

test("weekly-report-form.html: a failed device save is shown honestly for that specific photo, never as a false 'Saved to Device'", async () => {
  const { document } = await runForm({ saveFileToDevice: async () => ({ method: "share", status: "failed", error: new Error("nope") }) });
  await wait(50);

  const input = document.getElementById("photoInput");
  setInputFiles(input, [{ name: "site1.jpg", type: "image/jpeg", size: 1 }]);
  fireEvent(input, "change");
  await wait(30);

  fireEvent(document.querySelector(".save-device"), "click");
  await wait(30);

  const status = document.querySelector(".save-device-status").textContent;
  assert.match(status, /STATUS:failed/);
  assert.doesNotMatch(status, /STATUS:saved/);
});

test("weekly-report-form.html: a photo loaded back from an already-saved report (no surviving File this session) shows no Save to Device control", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "draft", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [],
    photos: [{ url: "https://example.com/already-saved.jpg", plot_area: "", category: "", compliance_status: "", caption: "" }],
    system_position: samplePosition(),
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; }, limit() { return api; },
        single: async () => {
          if (table === "projects") return { data: SAMPLE_PROJECT, error: null };
          if (table === "weekly_reports") return { data: existingReport, error: null };
          return { data: null, error: null };
        },
        insert() { return { select: () => ({ single: async () => ({ data: {}, error: null }) }) }; },
        update() { return { eq: async () => ({ error: null }) }; },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
  const { document } = await runPage(FORM_HTML, extractScript(FORM_HTML), {
    __url: `https://example.com/weekly-report-form.html?project=p1&id=r1`,
    supabase, requireAuth: async () => ({ id: "u1" }), renderHeader: () => {},
    getParam: (name) => (name === "project" ? "p1" : "r1"),
    escapeHtml: (s) => String(s ?? ""),
    showError: () => {}, clearError: () => {},
    mondayOf: () => "2026-09-07",
    uploadImage: async () => "https://example.com/x.jpg",
    todayISO: () => "2026-09-10",
    toLocalISODate: (d) => (typeof d === "string" ? d : "2026-09-11"),
    mountItemListEditor: () => ({ getItems: () => [] }),
    mountTableEditor: () => ({ getRows: () => [] }),
    formatGBP: () => null,
    WEATHER_CONDITIONS: [],
    fetchWeatherConditions: async () => new Map(),
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b)),
    normalisePlotToken: (s) => String(s).toLowerCase(),
    syncGateStatusFromMilestones: async () => {},
    EXTERNAL_WORKS_TAG: "External / Engineering Works",
    PHOTO_COMPLIANCE_STATUS: [],
    RESOURCE_ADEQUACY: [], RESOURCE_ADEQUACY_BADGE: {},
    RISK_IMPACT_LEVELS: [], RISK_IMPACT_BADGE: {},
    RISK_OWNER_SUGGESTIONS: [],
    STATUTORY_MILESTONE_TYPES: [], STATUTORY_OUTCOMES: [], STATUTORY_OUTCOME_BADGE: {},
    getWeeklyReportPosition: async () => samplePosition(),
    isWeeklyReportLocked,
    reviseWeeklyReport: async () => ({ ...existingReport, status: "draft" }),
    WEEKLY_REPORT_STATUS_LABEL, WEEKLY_REPORT_STATUS_BADGE, CONTROL_LEVEL_BADGE,
    FINDING_SEVERITY_LABEL: { critical: "Critical" },
    saveFileToDevice: async () => ({ method: "share", status: "saved" }),
    deviceSavePhotoFilename: () => "site-photo-test.jpg",
    deviceSaveStatusLabel: (s) => (s ? `STATUS:${s}` : ""),
  });
  await wait(50);

  const gallery = document.getElementById("photoGallery").innerHTML;
  assert.ok(gallery.includes("already-saved.jpg"));
  assert.equal(document.querySelectorAll(".save-device").length, 0, "a photo restored from a saved report has no surviving File — no Save to Device control must appear");
});
