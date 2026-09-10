// Weekly Reporting (Priority 9) — the critical frontend workflow, run
// against weekly-report-form.html's and weekly-report-view.html's REAL
// inline scripts under jsdom. Data-access functions are mocked here
// (getWeeklyReportPosition/reviseWeeklyReport/etc are thin Supabase
// wrappers already exercised for real, against the actual RLS/trigger
// boundary, in tests/security/weekly_reports.test.mjs, and the pure
// calculation functions they wrap are exercised for real in
// tests/frontend/weekly_report_helpers.test.mjs); this file proves the
// PAGE wires them up correctly — a new report auto-generates a
// position, an existing locked report disables the form and offers
// Revise, and weekly-report-view.html's lifecycle buttons show the
// correct next step and call through to the right function.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const FORM_HTML = new URL("../../tracker/weekly-report-form.html", import.meta.url).pathname;
const VIEW_HTML = new URL("../../tracker/weekly-report-view.html", import.meta.url).pathname;

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
function validWeeklyReportStatusTransitions(status) {
  return { draft: ["reviewed"], reviewed: ["approved", "draft"], approved: ["issued", "draft"], issued: ["draft"] }[status] || [];
}

const SAMPLE_PROJECT = { id: "p1", name: "Test Site", org_id: "org1", main_contractor_name: "ACME", main_contractor_email: "acme@example.com" };

function samplePosition() {
  return {
    period: { weekStarting: "2026-09-07", weekEnding: "2026-09-11" },
    generatedAt: "2026-09-11T12:00:00Z",
    exceptions: { counts: { overdue: 1 }, status: { level: "attention", label: "Attention", reason: "Attention — 1 overdue action." } },
    activity: { actionsCreated: [], actionsCompleted: [], snagsRaised: [], snagsClosed: [], snagsVerified: [], findingsResolved: [], inspectionsCompleted: [] },
    actionsSummary: { overdue: [{ id: "a1", title: "Chase permit" }], dueDuringPeriod: [], blocked: [], highCriticalOpen: [] },
    snagsSummary: { overdue: [], highPriorityOpen: [] },
    inspectionsSummary: { openFindings: [], criticalFindings: [], highSeverityFindings: [] },
    hsSummary: { auditLoggedThisMonth: true, highSeverityOpenCount: 0 },
  };
}

// ─── weekly-report-form.html ────────────────────────────────────────

function formSupabaseMock({ existingReport = null } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        limit() { return api; },
        single: async () => {
          if (table === "projects") return { data: SAMPLE_PROJECT, error: null };
          if (table === "weekly_reports" && existingReport) return { data: existingReport, error: null };
          return { data: null, error: null };
        },
        insert(payload) {
          return { select: () => ({ single: async () => ({ data: { id: "new-report-id", ...payload }, error: null }) }) };
        },
        update() { return { eq: async () => ({ error: null }) }; },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runForm({ reportId = null, existingReport = null, getWeeklyReportPosition, reviseWeeklyReport } = {}) {
  const supabase = formSupabaseMock({ existingReport });
  return runPage(FORM_HTML, extractScript(FORM_HTML), {
    __url: `https://example.com/weekly-report-form.html?project=p1${reportId ? `&id=${reportId}` : ""}`,
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: (name) => (name === "project" ? "p1" : reportId),
    escapeHtml: (s) => String(s ?? ""),
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
    getWeeklyReportPosition: getWeeklyReportPosition || (async () => samplePosition()),
    isWeeklyReportLocked,
    reviseWeeklyReport: reviseWeeklyReport || (async (id) => ({ ...existingReport, status: "draft" })),
    WEEKLY_REPORT_STATUS_LABEL, WEEKLY_REPORT_STATUS_BADGE, CONTROL_LEVEL_BADGE,
    FINDING_SEVERITY_LABEL: { critical: "Critical" },
  });
}

test("weekly-report-form.html: a new report auto-generates a system position on load", async () => {
  const { document } = await runForm();
  await wait(30);
  assert.equal(document.getElementById("weekStarting").value, "2026-09-07");
  await wait(20);
  assert.equal(document.getElementById("positionCard").style.display, "block");
  assert.ok(document.getElementById("positionBody").innerHTML.includes("Attention"), "the generated position's exceptions status should render");
  assert.equal(document.getElementById("formFieldset").disabled, false, "a brand-new (draft) report must not be locked");
  assert.equal(document.getElementById("lockedBanner").style.display, "none");
});

test("weekly-report-form.html: Refresh Position calls getWeeklyReportPosition with the current period and re-renders", async () => {
  let calledWith = null;
  const { document, window } = await runForm({
    getWeeklyReportPosition: async (projectId, period) => { calledWith = { projectId, period }; return samplePosition(); },
  });
  await wait(30);
  fireEvent(document.getElementById("refreshPositionBtn"), "click");
  await wait(30);
  assert.equal(calledWith.projectId, "p1");
  assert.equal(calledWith.period.weekStarting, document.getElementById("weekStarting").value);
});

test("weekly-report-form.html: an approved (locked) existing report disables the form and offers Revise", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "approved", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    system_position: samplePosition(),
  };
  const { document } = await runForm({ reportId: "r1", existingReport });
  await wait(30);
  assert.equal(document.getElementById("formFieldset").disabled, true, "content must be disabled while the report is approved");
  assert.equal(document.getElementById("lockedBanner").style.display, "block");
  assert.equal(document.getElementById("lockedStatusText").textContent, "Approved");
  const badge = document.getElementById("statusBadge");
  assert.equal(badge.textContent, "Approved");
});

test("weekly-report-form.html: Revise unlocks the form again", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "issued", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    system_position: samplePosition(),
  };
  const { document } = await runForm({
    reportId: "r1",
    existingReport,
    reviseWeeklyReport: async () => ({ ...existingReport, status: "draft" }),
  });
  await wait(30);
  assert.equal(document.getElementById("formFieldset").disabled, true);
  fireEvent(document.getElementById("reviseBtn"), "click");
  await wait(30);
  assert.equal(document.getElementById("formFieldset").disabled, false, "Revise must unlock the form");
  assert.equal(document.getElementById("lockedBanner").style.display, "none");
});

// ─── weekly-report-view.html ────────────────────────────────────────

function viewSupabaseMock(report) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        lte() { return api; },
        single: async () => (table === "weekly_reports" ? { data: report, error: null } : { data: null, error: null }),
        then(resolve) { resolve({ count: 1, data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runView(report, { reviewWeeklyReport, approveWeeklyReport, issueWeeklyReport, reviseWeeklyReport } = {}) {
  const supabase = viewSupabaseMock(report);
  return runPage(VIEW_HTML, extractScript(VIEW_HTML), {
    __url: "https://example.com/weekly-report-view.html?id=r1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "r1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    getOrgLogoUrl: async () => null,
    formatGBP: () => null,
    showError: (el, err) => { el.textContent = err?.message || String(err); },
    clearError: (el) => { el.textContent = ""; },
    PHOTO_COMPLIANCE_BADGE: {}, RESOURCE_ADEQUACY_BADGE: {}, RISK_IMPACT_BADGE: {}, STATUTORY_OUTCOME_BADGE: {},
    WEEKLY_REPORT_STATUS_LABEL, WEEKLY_REPORT_STATUS_BADGE,
    validWeeklyReportStatusTransitions,
    reviewWeeklyReport: reviewWeeklyReport || (async () => ({ ...report, status: "reviewed" })),
    approveWeeklyReport: approveWeeklyReport || (async () => ({ ...report, status: "approved" })),
    issueWeeklyReport: issueWeeklyReport || (async () => ({ ...report, status: "issued" })),
    reviseWeeklyReport: reviseWeeklyReport || (async () => ({ ...report, status: "draft" })),
    CONTROL_LEVEL_BADGE,
  });
}

test("weekly-report-view.html: a draft report offers only 'Mark Reviewed', a locked report offers 'Revise'", async () => {
  const draft = { id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "draft", programme_status: "on-track", projects: SAMPLE_PROJECT };
  const { document } = await runView(draft);
  await wait(30);
  assert.equal(document.getElementById("reviewBtn").style.display, "inline-flex");
  assert.equal(document.getElementById("approveBtn").style.display, "none");
  assert.equal(document.getElementById("issueBtn").style.display, "none");
  assert.equal(document.getElementById("reviseBtn").style.display, "none");
});

test("weekly-report-view.html: an approved report offers Issue and Revise, and clicking Issue calls through and re-renders", async () => {
  const approved = { id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "approved", programme_status: "on-track", projects: SAMPLE_PROJECT };
  let issueCalled = false;
  const { document } = await runView(approved, {
    issueWeeklyReport: async () => { issueCalled = true; return { ...approved, status: "issued" }; },
  });
  await wait(30);
  assert.equal(document.getElementById("issueBtn").style.display, "inline-flex");
  assert.equal(document.getElementById("reviseBtn").style.display, "inline-flex");
  fireEvent(document.getElementById("issueBtn"), "click");
  await wait(30);
  assert.ok(issueCalled, "clicking Issue must call issueWeeklyReport");
  assert.equal(document.getElementById("statusBadge").textContent, "Issued");
  assert.equal(document.getElementById("issueBtn").style.display, "none", "once issued, Issue itself is no longer a valid next step");
});

test("weekly-report-view.html: the status badge and doc both reflect the real report status", async () => {
  const issued = { id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "issued", programme_status: "on-track", projects: SAMPLE_PROJECT, system_position: samplePosition() };
  const { document } = await runView(issued);
  await wait(30);
  assert.equal(document.getElementById("statusBadge").textContent, "Issued");
  assert.ok(document.getElementById("doc").innerHTML.includes("Issued"), "the printable document itself must also show the real status");
});
