// v85: the "Site Diary" pull-in section on weekly-report-form.html,
// and its read-only rendering on weekly-report-view.html. Server-side
// authorization (contractor-side editor only; everyone else only once
// issued) is covered in tests/database/v85_weekly_report_diary_entries.test.mjs
// — this proves the PAGES wire it up correctly: hidden until the
// report is saved, the picker calls the right RPC with the right
// date range, attaching/removing calls the right functions, and an
// owner-side/client caller (whose RPC call throws) just loses the
// picker rather than erroring the whole page.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const FORM_HTML = new URL("../../tracker/weekly-report-form.html", import.meta.url).pathname;
const VIEW_HTML = new URL("../../tracker/weekly-report-view.html", import.meta.url).pathname;
const SAMPLE_PROJECT = { id: "p1", name: "Test Site", org_id: "org1", main_contractor_name: "ACME", main_contractor_email: "acme@example.com" };

function isWeeklyReportLocked(report) { return report.status === "approved" || report.status === "issued"; }

function formSupabaseMock({ existingReport = null } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; }, limit() { return api; },
        single: async () => {
          if (table === "projects") return { data: SAMPLE_PROJECT, error: null };
          if (table === "weekly_reports" && existingReport) return { data: existingReport, error: null };
          return { data: null, error: null };
        },
        insert(payload) { return { select: () => ({ single: async () => ({ data: { id: "new-report-id", ...payload }, error: null }) }) }; },
        update() { return { eq: async () => ({ error: null }) }; },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runForm({ reportId = null, existingReport = null, ...overrides } = {}) {
  const supabase = formSupabaseMock({ existingReport });
  return runPage(FORM_HTML, extractScript(FORM_HTML), {
    __url: `https://example.com/weekly-report-form.html?project=p1${reportId ? `&id=${reportId}` : ""}`,
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: (name) => (name === "project" ? "p1" : reportId),
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    mondayOf: () => "2026-09-07",
    uploadImage: async () => "https://example.com/photo.jpg",
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
    getWeeklyReportPosition: async () => ({}),
    isWeeklyReportLocked,
    reviseWeeklyReport: async () => ({ ...existingReport, status: "draft" }),
    WEEKLY_REPORT_STATUS_LABEL: { draft: "Draft", reviewed: "Reviewed", approved: "Approved", issued: "Issued" },
    WEEKLY_REPORT_STATUS_BADGE: {}, CONTROL_LEVEL_BADGE: {},
    FINDING_SEVERITY_LABEL: { critical: "Critical" },
    ...overrides,
  });
}

const LOCKED_REPORT = { id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "draft", photos: [], labour_records: [], risk_items: [], statutory_milestones: [], commercial_items: [], progress_items: [], next_week_items: [] };

test("weekly-report-form.html: a brand-new (unsaved) report shows the 'save first' hint, never the picker", async () => {
  const { document } = await runForm();
  await wait(40);
  assert.equal(document.getElementById("diaryField").style.display, "block");
  assert.equal(document.getElementById("saveFirstForDiaryHint").style.display, "block");
  assert.equal(document.getElementById("diaryPickerRow").style.display, "none");
});

test("weekly-report-form.html: an existing report calls getUnattachedDiaryEntries with the project and real week range, and shows candidates", async () => {
  let calledWith = null;
  const { document } = await runForm({
    reportId: "r1",
    existingReport: LOCKED_REPORT,
    getUnattachedDiaryEntries: async (projectId, weekStarting, weekEnding) => {
      calledWith = { projectId, weekStarting, weekEnding };
      return [{ diary_entry_id: "d1", entry_date: "2026-09-08", author_email: "mc@main.test", body: "Steel delivery today" }];
    },
    getWeeklyReportDiaryEntries: async () => [],
  });
  await wait(40);
  assert.equal(calledWith.projectId, "p1");
  assert.equal(calledWith.weekStarting, "2026-09-07");
  assert.equal(calledWith.weekEnding, "2026-09-11");
  assert.equal(document.getElementById("diaryPickerRow").style.display, "flex");
  assert.match(document.getElementById("diaryPicker").innerHTML, /Steel delivery today/);
});

test("weekly-report-form.html: pulling in a candidate calls attachDiaryEntryToReport with the report id and the picked entry", async () => {
  let attached = null;
  const { document } = await runForm({
    reportId: "r1",
    existingReport: LOCKED_REPORT,
    getUnattachedDiaryEntries: async () => [{ diary_entry_id: "d1", entry_date: "2026-09-08", author_email: "mc@main.test", body: "Steel delivery today" }],
    getWeeklyReportDiaryEntries: async () => [],
    attachDiaryEntryToReport: async (reportId, entry) => { attached = { reportId, entry }; return { id: "att1" }; },
  });
  await wait(40);
  const picker = document.getElementById("diaryPicker");
  picker.value = picker.options[0].value;
  fireEvent(document.getElementById("pullInDiaryBtn"), "click");
  await wait(40);
  assert.equal(attached.reportId, "r1");
  assert.equal(attached.entry.diary_entry_id, "d1");
  assert.equal(attached.entry.body, "Steel delivery today");
});

test("weekly-report-form.html: shows already-attached entries, and Remove calls removeAttachedDiaryEntry after confirming", async () => {
  const attachedEntry = { id: "att1", entry_date: "2026-09-08", body: "Scaffolding went up", weather: "Dry" };
  let removedId = null;
  const { document, window } = await runForm({
    reportId: "r1",
    existingReport: LOCKED_REPORT,
    getUnattachedDiaryEntries: async () => [],
    getWeeklyReportDiaryEntries: async () => [attachedEntry],
    removeAttachedDiaryEntry: async (id) => { removedId = id; },
  });
  await wait(40);
  assert.match(document.getElementById("diaryAttachedList").textContent, /Scaffolding went up/);

  window.confirm = () => false;
  document.querySelector('[data-remove-diary="att1"]').click();
  await wait(30);
  assert.equal(removedId, null);

  window.confirm = () => true;
  document.querySelector('[data-remove-diary="att1"]').click();
  await wait(30);
  assert.equal(removedId, "att1");
});

test("weekly-report-form.html: an owner-side/client caller (getUnattachedDiaryEntries throws) just loses the picker, not a page error", async () => {
  const attachedEntry = { id: "att1", entry_date: "2026-09-08", body: "Already attached, visible once issued" };
  const { document } = await runForm({
    reportId: "r1",
    existingReport: LOCKED_REPORT,
    getUnattachedDiaryEntries: async () => { throw new Error("Only a contractor-side project editor can pull in diary entries"); },
    getWeeklyReportDiaryEntries: async () => [attachedEntry],
  });
  await wait(40);
  assert.equal(document.getElementById("diaryPickerRow").style.display, "none");
  assert.equal(document.getElementById("errorBox").textContent, "", "an owner-side caller losing the picker must not show as a page error");
  assert.match(document.getElementById("diaryAttachedList").textContent, /Already attached/);
});

// ─── weekly-report-view.html ────────────────────────────────────────
function viewSupabaseMock(report) {
  return {
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, lte() { return api; },
        single: async () => (table === "weekly_reports" ? { data: report, error: null } : { data: null, error: null }),
        then(resolve) { resolve({ count: 1, data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runView(report, overrides = {}) {
  return runPage(VIEW_HTML, extractScript(VIEW_HTML), {
    __url: "https://example.com/weekly-report-view.html?id=r1",
    supabase: viewSupabaseMock(report),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "r1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    getOrgLogoUrl: async () => null,
    formatGBP: () => "",
    showError: () => {}, clearError: () => {},
    PHOTO_COMPLIANCE_BADGE: {}, RESOURCE_ADEQUACY_BADGE: {}, RISK_IMPACT_BADGE: {}, STATUTORY_OUTCOME_BADGE: {},
    WEEKLY_REPORT_STATUS_LABEL: { draft: "Draft", issued: "Issued" }, WEEKLY_REPORT_STATUS_BADGE: {},
    validWeeklyReportStatusTransitions: () => [],
    reviewWeeklyReport: async () => {}, approveWeeklyReport: async () => {}, issueWeeklyReport: async () => {}, reviseWeeklyReport: async () => {},
    CONTROL_LEVEL_BADGE: {},
    getRfiLinksForWeeklyReport: async () => ({}),
    normalisePlotToken: (s) => String(s).toLowerCase(),
    attachReportCommercialNotes: async () => true,
    getWeeklyReportDiaryEntries: async () => [],
    ...overrides,
  });
}

const VIEW_REPORT = { id: "r1", project_id: "p1", projects: SAMPLE_PROJECT, status: "issued", week_starting: "2026-09-07", week_ending: "2026-09-11", programme_status: "on-track", photos: [] };

test("weekly-report-view.html: renders the Site Diary section when entries are visible to this reader", async () => {
  const { document } = await runView(VIEW_REPORT, {
    getWeeklyReportDiaryEntries: async () => [{ entry_date: "2026-09-08", author_email: "mc@main.test", body: "Scaffolding went up on the east elevation.", weather: "Dry" }],
  });
  await wait(40);
  assert.match(document.getElementById("doc").textContent, /Site Diary/);
  assert.match(document.getElementById("doc").textContent, /Scaffolding went up/);
});

test("weekly-report-view.html: no Site Diary section at all when nothing is visible to this reader (e.g. a draft report to an owner-side user)", async () => {
  const { document } = await runView(VIEW_REPORT, { getWeeklyReportDiaryEntries: async () => [] });
  await wait(40);
  assert.doesNotMatch(document.getElementById("doc").textContent, /Site Diary/);
});
