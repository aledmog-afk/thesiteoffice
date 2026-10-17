// Weekly Report Programme Integration (Priority 11, Phase 5) — the
// PAGE-level wiring: weekly-report-form.html renders a clearly
// separate, read-only "PROGRAMME CONTROL SIGNAL" block (never
// editable, never overwriting programme_status/programme_comments),
// and weekly-report-view.html renders the SAVED snapshot (never a
// live re-fetch). Both real inline scripts under jsdom, following the
// same conventions as weekly_report_workflow.test.mjs.
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
function formatDate(d) { return d || ""; }

const SAMPLE_PROJECT = { id: "p1", name: "Test Site", org_id: "org1", main_contractor_name: "ACME", main_contractor_email: "acme@example.com" };

function samplePositionWithProgramme(programmeSummary) {
  return {
    period: { weekStarting: "2026-09-07", weekEnding: "2026-09-11" },
    generatedAt: "2026-09-11T12:00:00Z",
    exceptions: { counts: { overdue: 0 }, status: { level: "on_track", label: "On Track", reason: "On track — no open actions." } },
    activity: { actionsCreated: [], actionsCompleted: [], snagsRaised: [], snagsClosed: [], snagsVerified: [], findingsResolved: [], inspectionsCompleted: [] },
    actionsSummary: { overdue: [], dueDuringPeriod: [], blocked: [], highCriticalOpen: [] },
    snagsSummary: { overdue: [], highPriorityOpen: [] },
    inspectionsSummary: { openFindings: [], criticalFindings: [], highSeverityFindings: [] },
    hsSummary: { auditLoggedThisMonth: true, highSeverityOpenCount: 0 },
    programmeSummary,
  };
}

function activeProgrammeSummary(overrides = {}) {
  return {
    hasActiveProgramme: true, programmeName: "Main Programme", asOfDate: "2026-09-11", totalActivities: 10,
    overdueProgrammeActivities: 2, forecastLateProgrammeActivities: 1, materialForecastLateProgrammeActivities: 1,
    overdueProgrammeMilestones: 1, forecastLateProgrammeMilestones: 0,
    completedLateProgrammeActivities: 1, upcomingProgrammeActivities: 2,
    ...overrides,
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

async function runForm({ reportId = null, existingReport = null, getWeeklyReportPosition } = {}) {
  const supabase = formSupabaseMock({ existingReport });
  return runPage(FORM_HTML, extractScript(FORM_HTML), {
    __url: `https://example.com/weekly-report-form.html?project=p1${reportId ? `&id=${reportId}` : ""}`,
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: (name) => (name === "project" ? "p1" : reportId),
    escapeHtml: (s) => String(s ?? ""),
    formatDate,
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
    getWeeklyReportPosition: getWeeklyReportPosition || (async () => samplePositionWithProgramme(activeProgrammeSummary())),
    isWeeklyReportLocked,
    reviseWeeklyReport: async (id) => ({ ...existingReport, status: "draft" }),
    WEEKLY_REPORT_STATUS_LABEL, WEEKLY_REPORT_STATUS_BADGE, CONTROL_LEVEL_BADGE,
    FINDING_SEVERITY_LABEL: { critical: "Critical" },
  });
}

test("weekly-report-form.html: renders a distinct 'PROGRAMME CONTROL SIGNAL' block with the real counts, separate from the generic exceptions banner", async () => {
  const { document } = await runForm();
  await wait(40);
  const body = document.getElementById("positionBody").innerHTML;
  assert.match(body, /PROGRAMME CONTROL SIGNAL/);
  assert.match(body, /As of week ending/);
  assert.match(body, /Main Programme/);
  assert.match(body, />2</, "overdue count (2) must appear");
});

test("weekly-report-form.html: 'No Active Programme' is shown plainly when the project has none, not an error or blank section", async () => {
  const { document } = await runForm({
    getWeeklyReportPosition: async () => samplePositionWithProgramme({ hasActiveProgramme: false, programmeName: null, asOfDate: "2026-09-11", totalActivities: 0, overdueProgrammeActivities: 0, forecastLateProgrammeActivities: 0, materialForecastLateProgrammeActivities: 0, overdueProgrammeMilestones: 0, forecastLateProgrammeMilestones: 0, completedLateProgrammeActivities: 0, upcomingProgrammeActivities: 0 }),
  });
  await wait(40);
  const body = document.getElementById("positionBody").innerHTML;
  assert.match(body, /No Active Programme/);
});

test("weekly-report-form.html: the human 'Programme status' field is visually labelled as the human assessment, distinct from the system signal", async () => {
  const { document } = await runForm();
  await wait(40);
  const label = document.querySelector('label[for="programmeStatus"]').innerHTML;
  assert.match(label, /HUMAN WEEKLY ASSESSMENT/);
});

test("weekly-report-form.html: the programme signal section is read-only — it contains no input/select/textarea elements of its own", async () => {
  const { document } = await runForm();
  await wait(40);
  const positionBody = document.getElementById("positionBody");
  const inputs = positionBody.querySelectorAll("input, select, textarea");
  assert.equal(inputs.length, 0, "the system programme signal must never itself be an editable field");
});

test("weekly-report-form.html: loading an EXISTING report with a saved programmeSummary renders it from system_position, without calling getWeeklyReportPosition again", async () => {
  let positionCalls = 0;
  const existingReport = {
    id: "report-1", project_id: "p1", status: "draft",
    week_starting: "2026-09-07", week_ending: "2026-09-11",
    programme_status: "on-track", programme_comments: "",
    system_position: samplePositionWithProgramme(activeProgrammeSummary({ overdueProgrammeActivities: 5 })),
  };
  const { document } = await runForm({
    reportId: "report-1",
    existingReport,
    getWeeklyReportPosition: async () => { positionCalls++; return samplePositionWithProgramme(activeProgrammeSummary()); },
  });
  await wait(40);
  assert.equal(positionCalls, 0, "an existing report's saved position must be shown as-is, not silently regenerated on load");
  const body = document.getElementById("positionBody").innerHTML;
  assert.match(body, />5</, "the SAVED overdue count (5) must render, not a freshly regenerated one");
});

// ─── weekly-report-view.html ────────────────────────────────────────

function viewSupabaseMock(report) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        lte() { return api; },
        lt() { return api; },
        gte() { return api; },
        gt() { return api; },
        order() { return api; },
        single: async () => {
          // weekly-report-view.html embeds the project via
          // select("*, projects(*)") — one joined query, not a second
          // .from("projects") call.
          if (table === "weekly_reports") return { data: { ...report, projects: SAMPLE_PROJECT }, error: null };
          if (table === "projects") return { data: SAMPLE_PROJECT, error: null };
          return { data: null, error: null };
        },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runView(report) {
  return runPage(VIEW_HTML, extractScript(VIEW_HTML), {
    __url: `https://example.com/weekly-report-view.html?id=${report.id}`,
    supabase: viewSupabaseMock(report),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => report.id,
    escapeHtml: (s) => String(s ?? ""),
    formatDate,
    getOrgLogoUrl: async () => null,
    formatGBP: () => null,
    showError: (el, err) => { el.textContent = err?.message || String(err); },
    clearError: (el) => { el.textContent = ""; },
    PHOTO_COMPLIANCE_BADGE: {}, RESOURCE_ADEQUACY_BADGE: {}, RISK_IMPACT_BADGE: {}, STATUTORY_OUTCOME_BADGE: {},
    WEEKLY_REPORT_STATUS_LABEL, WEEKLY_REPORT_STATUS_BADGE,
    validWeeklyReportStatusTransitions,
    reviewWeeklyReport: async () => ({ ...report, status: "reviewed" }),
    approveWeeklyReport: async () => ({ ...report, status: "approved" }),
    issueWeeklyReport: async () => ({ ...report, status: "issued" }),
    reviseWeeklyReport: async () => ({ ...report, status: "draft" }),
    CONTROL_LEVEL_BADGE,
  });
}

test("weekly-report-view.html: renders the SAVED programme signal snapshot from system_position, with its own 'Programme Control Signal' heading", async () => {
  const report = {
    id: "r1", project_id: "p1", status: "issued",
    week_starting: "2026-09-07", week_ending: "2026-09-11",
    programme_status: "behind", programme_comments: "Groundworks running late.",
    system_position: samplePositionWithProgramme(activeProgrammeSummary({ overdueProgrammeActivities: 4 })),
    progress_items: [], next_week_items: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], weather_days: [],
  };
  const { document } = await runView(report);
  await wait(40);
  const doc = document.getElementById("doc").innerHTML;
  assert.match(doc, /Programme Control Signal/);
  assert.match(doc, /Main Programme/);
  assert.match(doc, /Overdue: 4/, "the saved overdue count (4) must render");
});

test("weekly-report-view.html: a report with no programme signal in its snapshot (created before this phase) renders cleanly, with no broken section", async () => {
  const report = {
    id: "r2", project_id: "p1", status: "draft",
    week_starting: "2026-09-07", week_ending: "2026-09-11",
    programme_status: "on-track", programme_comments: "",
    system_position: { exceptions: { counts: {}, status: { level: "on_track", label: "On Track", reason: "On track." } }, activity: { actionsCreated: [], actionsCompleted: [], snagsRaised: [], snagsClosed: [], snagsVerified: [], findingsResolved: [], inspectionsCompleted: [] }, actionsSummary: { overdue: [], dueDuringPeriod: [], blocked: [], highCriticalOpen: [] }, snagsSummary: { overdue: [], highPriorityOpen: [] }, inspectionsSummary: { openFindings: [], criticalFindings: [], highSeverityFindings: [] }, hsSummary: { auditLoggedThisMonth: true, highSeverityOpenCount: 0 } },
    progress_items: [], next_week_items: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], weather_days: [],
  };
  await assert.doesNotReject(runView(report));
  const { document } = await runView(report);
  await wait(40);
  assert.doesNotMatch(document.getElementById("doc").innerHTML, /Programme Control Signal/, "no programmeSummary key at all means no section, not a broken one");
});
