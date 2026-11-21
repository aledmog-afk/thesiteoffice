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

function formSupabaseMock({ existingReport = null, onUpdate = () => {} } = {}) {
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
        update(payload) {
          if (table === "weekly_reports") onUpdate(payload);
          return { eq: async () => ({ error: null }) };
        },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

// v98: `onUpdate` is called with every weekly_reports update() payload
// (the report save, then the separate commercial_items/photos follow-
// up updates the real save handler also issues) — a test that cares
// about early_warning_notes specifically reads it off the FIRST call
// (the main report save), not a later one.
async function runForm({ reportId = null, existingReport = null, getWeeklyReportPosition, reviseWeeklyReport, onUpdate = () => {}, extra = {} } = {}) {
  const supabase = formSupabaseMock({ existingReport, onUpdate });
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
    ...extra,
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

// ─── Early warnings (v97) ───────────────────────────────────────
test("weekly-report-form.html: generating a position passes the CURRENT form state (progress items, programme status, labour, weather) as the 3rd argument", async () => {
  let receivedCurrentReport = null;
  const { document } = await runForm({
    getWeeklyReportPosition: async (projectId, period, currentReport) => { receivedCurrentReport = currentReport; return samplePosition(); },
    extra: {
      mountItemListEditor: (container, items) => ({ getItems: () => (items && items.length ? items : [{ id: "x1", text: "Groundworks", plot: "Plot 1", percent: 40 }]) }),
      mountTableEditor: (container, rows) => ({ getRows: () => (rows && rows.length ? rows : [{ trade: "Groundworkers", headcount: 8 }]) }),
    },
  });
  await wait(30);
  document.getElementById("programmeStatus").value = "behind";
  fireEvent(document.getElementById("refreshPositionBtn"), "click");
  await wait(30);

  assert.deepEqual(receivedCurrentReport.progress_items, [{ id: "x1", text: "Groundworks", plot: "Plot 1", percent: 40 }]);
  assert.equal(receivedCurrentReport.programme_status, "behind");
  assert.deepEqual(receivedCurrentReport.labour_records, [{ trade: "Groundworkers", headcount: 8 }]);
  assert.ok(Array.isArray(receivedCurrentReport.weather_days), "weather_days comes straight from the real mountWeatherTracker(), not a mock");
});

test("weekly-report-form.html: the Early Warnings section lists each warning returned by getWeeklyReportPosition", async () => {
  const { document } = await runForm({
    getWeeklyReportPosition: async () => ({ ...samplePosition(), earlyWarnings: [{ type: "behind_two_weeks", message: "Behind programme for the second week running." }, { type: "weather_lost_time", message: "Weather lost time this week: 2 days affected." }] }),
  });
  await wait(30);
  const box = document.querySelector(".early-warnings-box");
  assert.ok(box, "an Early Warnings box must render");
  assert.match(box.textContent, /Behind programme for the second week running\./);
  assert.match(box.textContent, /Weather lost time this week: 2 days affected\./);
});

test("weekly-report-form.html: the Early Warnings section says 'No early warnings this week' when the array is genuinely empty", async () => {
  const { document } = await runForm({ getWeeklyReportPosition: async () => ({ ...samplePosition(), earlyWarnings: [] }) });
  await wait(30);
  assert.match(document.querySelector(".early-warnings-box").textContent, /No early warnings this week\./);
});

test("weekly-report-form.html: an existing report saved before v97 (no earlyWarnings key at all) shows 'not calculated', never a false 'none'", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "draft", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    system_position: samplePosition(), // no earlyWarnings key — exactly a pre-v97 saved position
  };
  const { document } = await runForm({ reportId: "r1", existingReport });
  await wait(30);
  const text = document.querySelector(".early-warnings-box").textContent;
  assert.match(text, /Not calculated for this report/);
  assert.ok(!text.includes("No early warnings this week"), "must never show the calculated-zero message for an uncalculated position");
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

// ─── Early warning reasons (v98) ────────────────────────────────────

test("weekly-report-form.html: an existing report's saved early_warning_notes pre-fills the matching warning's textarea", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "draft", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    system_position: { ...samplePosition(), earlyWarnings: [{ type: "labour_drop", key: "labour_drop", message: "Labour on site is down to 10 from 20 last week (50% drop)." }] },
    early_warning_notes: { labour_drop: { text: "Two groundworkers off sick", updated_at: "2026-09-10T00:00:00Z", updated_by: "u2" } },
  };
  const { document } = await runForm({ reportId: "r1", existingReport });
  await wait(30);
  const textarea = document.querySelector('.ew-reason-textarea[data-key="labour_drop"]');
  assert.ok(textarea, "the matching warning's reason textarea must render");
  assert.equal(textarea.value, "Two groundworkers off sick");
});

test("weekly-report-form.html: a reason textarea is disabled when the report is locked (approved/issued)", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "approved", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    system_position: { ...samplePosition(), earlyWarnings: [{ type: "weather_lost_time", key: "weather_lost_time", message: "Weather lost time this week: 2 days affected." }] },
    early_warning_notes: {},
  };
  const { document } = await runForm({ reportId: "r1", existingReport });
  await wait(30);
  const textarea = document.querySelector('.ew-reason-textarea[data-key="weather_lost_time"]');
  assert.ok(textarea, "the warning's reason textarea must still render, read-only");
  assert.equal(textarea.disabled, true, "editing a reason on a locked report must be disabled, same as every other field");
});

test("weekly-report-form.html: Revise re-enables an already-rendered reason textarea without needing a fresh position render", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "issued", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    system_position: { ...samplePosition(), earlyWarnings: [{ type: "labour_drop", key: "labour_drop", message: "Labour down." }] },
    early_warning_notes: {},
  };
  const { document } = await runForm({ reportId: "r1", existingReport, reviseWeeklyReport: async () => ({ ...existingReport, status: "draft" }) });
  await wait(30);
  assert.equal(document.querySelector('.ew-reason-textarea[data-key="labour_drop"]').disabled, true);
  fireEvent(document.getElementById("reviseBtn"), "click");
  await wait(30);
  assert.equal(document.querySelector('.ew-reason-textarea[data-key="labour_drop"]').disabled, false, "Revise must unlock the reason textarea too, the same as the rest of the form");
});

test("weekly-report-form.html: typing a reason and saving writes it into early_warning_notes, keyed and stamped with the signed-in user", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "draft", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    system_position: samplePosition(),
    early_warning_notes: {},
  };
  let savedPayload = null;
  const { document } = await runForm({
    reportId: "r1", existingReport,
    getWeeklyReportPosition: async () => ({ ...samplePosition(), earlyWarnings: [{ type: "behind_two_weeks", key: "behind_two_weeks", message: "Behind programme for the second week running." }] }),
    onUpdate: (payload) => { if (!savedPayload) savedPayload = payload; },
  });
  await wait(30);
  fireEvent(document.getElementById("refreshPositionBtn"), "click");
  await wait(30);
  const textarea = document.querySelector('.ew-reason-textarea[data-key="behind_two_weeks"]');
  assert.ok(textarea);
  textarea.value = "Crane breakdown held up the frame";
  fireEvent(textarea, "input");
  fireEvent(document.getElementById("reportForm"), "submit");
  await wait(30);

  assert.ok(savedPayload, "the report save must have gone through update()");
  const note = savedPayload.early_warning_notes.behind_two_weeks;
  assert.equal(note.text, "Crane breakdown held up the frame");
  assert.equal(note.updated_by, "u1", "stamped with the signed-in user's own id");
  assert.ok(typeof note.updated_at === "string" && note.updated_at.length > 0, "stamped with a real timestamp");
});

test("weekly-report-form.html: saving never drops a note for a warning that's no longer in the current list — it's carried over untouched", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "draft", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    // Saved with a labour_drop warning + its reason, but THIS recalculation
    // (below) returns no warnings at all — labour_drop has disappeared.
    system_position: { ...samplePosition(), earlyWarnings: [{ type: "labour_drop", key: "labour_drop", message: "Labour down." }] },
    early_warning_notes: { labour_drop: { text: "Resolved by Monday", updated_at: "2026-09-08T00:00:00Z", updated_by: "u2" } },
  };
  let savedPayload = null;
  const { document } = await runForm({
    reportId: "r1", existingReport,
    getWeeklyReportPosition: async () => ({ ...samplePosition(), earlyWarnings: [] }),
    onUpdate: (payload) => { if (!savedPayload) savedPayload = payload; },
  });
  await wait(30);
  fireEvent(document.getElementById("refreshPositionBtn"), "click");
  await wait(30);
  fireEvent(document.getElementById("reportForm"), "submit");
  await wait(30);

  assert.deepEqual(savedPayload.early_warning_notes.labour_drop, { text: "Resolved by Monday", updated_at: "2026-09-08T00:00:00Z", updated_by: "u2" }, "a vanished warning's reason must survive the save unchanged");
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

async function runView(report, { reviewWeeklyReport, approveWeeklyReport, issueWeeklyReport, reviseWeeklyReport, ...extra } = {}) {
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
    ...extra,
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

// ─── Early warnings (v97) — frozen snapshot, read-only ───────────
test("weekly-report-view.html: renders the SAVED earlyWarnings snapshot verbatim — this is the same page used for print/PDF, no separate template", async () => {
  const issued = {
    id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "issued", programme_status: "on-track", projects: SAMPLE_PROJECT,
    system_position: { ...samplePosition(), earlyWarnings: [{ type: "labour_drop", message: "Labour on site is down to 10 from 20 last week (50% drop)." }] },
  };
  const { document } = await runView(issued);
  await wait(30);
  const doc = document.getElementById("doc").innerHTML;
  assert.match(doc, /Early Warnings/);
  assert.match(doc, /Labour on site is down to 10 from 20 last week \(50% drop\)\./);
});

test("weekly-report-view.html: a genuinely empty earlyWarnings snapshot shows 'No early warnings this week', never silence", async () => {
  const issued = { id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "issued", programme_status: "on-track", projects: SAMPLE_PROJECT, system_position: { ...samplePosition(), earlyWarnings: [] } };
  const { document } = await runView(issued);
  await wait(30);
  assert.match(document.getElementById("doc").innerHTML, /No early warnings this week\./);
});

test("weekly-report-view.html: a report saved before v97 (no earlyWarnings key) shows 'not calculated', never a false 'none' or a 0", async () => {
  const issued = { id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "issued", programme_status: "on-track", projects: SAMPLE_PROJECT, system_position: samplePosition() };
  const { document } = await runView(issued);
  await wait(30);
  const doc = document.getElementById("doc").innerHTML;
  assert.match(doc, /Not calculated for this report\./);
  assert.ok(!doc.includes("No early warnings this week"));
});

// A progress item added via "Add an item…" can carry BOTH a milestone
// (from the dropdown) and its own free-text description — the item-list
// editor on the form shows both side by side. The "Verified Quality &
// Works Audit" table on the view page used to show only the milestone,
// silently dropping the typed description whenever a milestone was also
// set — the exact case for e.g. several "Groundworks"-tagged items each
// with their own distinct description ("Crane base", "Site entrance
// work", "Muck away"), which all collapsed to the single word
// "Groundworks" on the report with no way to tell them apart.
test("weekly-report-view.html: a progress item with BOTH a milestone and typed text shows both on the Verified Quality & Works Audit table, not just the milestone", async () => {
  const report = {
    id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "issued",
    programme_status: "on-track", projects: SAMPLE_PROJECT,
    progress_items: [
      { id: "1", plot: "", milestone: "Groundworks", text: "Crane base", percent: 0 },
      { id: "2", plot: "", milestone: "Foundations (Foots)", text: "", percent: 0 },
      { id: "3", plot: "", milestone: "", text: "Tarmac", percent: 100 },
    ],
  };
  const { document } = await runView(report);
  await wait(30);
  const auditHtml = document.getElementById("doc").innerHTML;
  assert.match(auditHtml, /Groundworks/, "the milestone must still show");
  assert.match(auditHtml, /Crane base/, "the item's own typed description must ALSO show, not be replaced by the milestone");
  assert.match(auditHtml, /Foundations \(Foots\)/, "a milestone-only item (no text) still renders correctly");
  assert.match(auditHtml, /Tarmac/, "a text-only item (no milestone) still renders correctly");
});

test("weekly-report-view.html (v62): commercial notes are left out of the page (and so the print/PDF) for a company user", async () => {
  const report = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "draft", prepared_by: "Jane", programme_status: "on-track",
    weather_days: [], commercial_items: [{ type: "instruction", title: "VO SECRET 4000" }], labour_records: [], risk_items: [], statutory_milestones: [], photos: [],
    projects: { id: "p1", name: "County Flats", org_id: "o1" },
  };
  let r = await runView(structuredClone(report));
  await wait(30);
  assert.match(r.document.body.textContent, /VO SECRET 4000/, "owner side sees them");
  r = await runView(structuredClone(report), { attachReportCommercialNotes: async (kind, list) => { list.forEach((x) => { x.commercial_items = []; }); return false; } });
  await wait(30);
  assert.doesNotMatch(r.document.body.textContent, /VO SECRET/);
});

// ─── Early warning reasons (v98) ────────────────────────────────────

test("weekly-report-view.html: shows the saved reason under its matching warning", async () => {
  const issued = {
    id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "issued", programme_status: "on-track", projects: SAMPLE_PROJECT,
    system_position: { ...samplePosition(), earlyWarnings: [{ type: "labour_drop", key: "labour_drop", message: "Labour on site is down to 10 from 20 last week (50% drop)." }] },
    early_warning_notes: { labour_drop: { text: "Two groundworkers off sick, agency cover booked for Monday", updated_at: "2026-09-10T00:00:00Z", updated_by: "u2" } },
  };
  const { document } = await runView(issued);
  await wait(30);
  const doc = document.getElementById("doc").innerHTML;
  assert.match(doc, /Labour on site is down to 10 from 20 last week/);
  assert.match(doc, /Two groundworkers off sick, agency cover booked for Monday/);
});

test("weekly-report-view.html: a warning with no stored reason shows nothing extra under it — never an empty line or placeholder", async () => {
  const issued = {
    id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "issued", programme_status: "on-track", projects: SAMPLE_PROJECT,
    system_position: { ...samplePosition(), earlyWarnings: [{ type: "weather_lost_time", key: "weather_lost_time", message: "Weather lost time this week: 1 day affected." }] },
    early_warning_notes: {},
  };
  const { document } = await runView(issued);
  await wait(30);
  const doc = document.getElementById("doc").innerHTML;
  assert.match(doc, /Weather lost time this week: 1 day affected\./);
  // the warning's own <li> must not carry a trailing empty reason paragraph
  assert.doesNotMatch(doc, /<p class="hint" style="margin:0\.2rem 0 0;"><\/p>/);
});

test("weekly-report-view.html: a reason kept for a warning no longer in the current list stays hidden, never shown loose", async () => {
  const issued = {
    id: "r1", week_starting: "2026-09-07", week_ending: "2026-09-11", status: "issued", programme_status: "on-track", projects: SAMPLE_PROJECT,
    system_position: { ...samplePosition(), earlyWarnings: [] }, // labour_drop has since disappeared
    early_warning_notes: { labour_drop: { text: "Should stay hidden — its warning is gone", updated_at: "2026-09-08T00:00:00Z", updated_by: "u2" } },
  };
  const { document } = await runView(issued);
  await wait(30);
  const doc = document.getElementById("doc").innerHTML;
  assert.doesNotMatch(doc, /Should stay hidden/, "a note for a warning that's no longer listed must never render on its own");
});
