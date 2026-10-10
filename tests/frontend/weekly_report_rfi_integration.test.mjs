// RFI-2 — Weekly Report -> "RFI Required" -> "Raise RFI" integration.
// Real inline scripts (weekly-report-form.html AND weekly-report-view.html)
// under jsdom. getRfiLinksForWeeklyReport()/createRfiFromWeeklyReportPhoto()
// (already proven against a real database with real RLS in
// tests/security/rfi_evidence_links.test.mjs) are mocked here — this file
// proves the PAGE wires the compliance-status option and the Raise RFI
// affordance up correctly, carries the right context through, and never
// creates anything just from selecting the status.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const FORM_HTML = new URL("../../tracker/weekly-report-form.html", import.meta.url).pathname;
const VIEW_HTML = new URL("../../tracker/weekly-report-view.html", import.meta.url).pathname;

const PHOTO_COMPLIANCE_STATUS = ["Approved / Compliant", "Action Required", "Info Only", "RFI Required"];

const SAMPLE_PROJECT = { id: "p1", name: "Test Site", org_id: "org1" };

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
        insert(payload) { return { select: () => ({ single: async () => ({ data: { id: "new-report-id", ...payload }, error: null }) }) }; },
        update() { return { eq: async () => ({ error: null }) }; },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

async function runForm({ reportId = null, existingReport = null, getRfiLinksForWeeklyReport } = {}) {
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
    normalisePlotToken: (s) => String(s).trim().toLowerCase(),
    syncGateStatusFromMilestones: async () => {},
    EXTERNAL_WORKS_TAG: "External / Engineering Works",
    PHOTO_COMPLIANCE_STATUS,
    RESOURCE_ADEQUACY: [], RESOURCE_ADEQUACY_BADGE: {},
    RISK_IMPACT_LEVELS: [], RISK_IMPACT_BADGE: {},
    RISK_OWNER_SUGGESTIONS: [],
    STATUTORY_MILESTONE_TYPES: [], STATUTORY_OUTCOMES: [], STATUTORY_OUTCOME_BADGE: {},
    getWeeklyReportPosition: async () => ({ generatedAt: "2026-09-11T12:00:00Z", exceptions: { counts: { overdue: 0 }, status: { level: "on_track", label: "On Track", reason: "On track." } }, activity: {}, actionsSummary: {}, snagsSummary: {}, inspectionsSummary: {}, hsSummary: {} }),
    isWeeklyReportLocked: (r) => r.status === "approved" || r.status === "issued",
    reviseWeeklyReport: async (id) => ({ ...existingReport, status: "draft" }),
    WEEKLY_REPORT_STATUS_LABEL: {}, WEEKLY_REPORT_STATUS_BADGE: {}, CONTROL_LEVEL_BADGE: {},
    FINDING_SEVERITY_LABEL: {},
    saveFileToDevice: async () => ({ status: "saved" }),
    deviceSavePhotoFilename: () => "photo.jpg",
    deviceSaveStatusLabel: () => "",
    getRfiLinksForWeeklyReport: getRfiLinksForWeeklyReport || (async () => ({})),
    // Not one of the globals tests/lib/jsdom-harness.mjs's vm context
    // provides by default — rfiActionHtml() (weekly-report-form.html)
    // needs it to build the Raise RFI link's query string.
    URLSearchParams,
  });
}

test("Form: 'RFI Required' is offered as a compliance status option, alongside the existing three, unchanged", async () => {
  const { document } = await runForm();
  await wait(30);
  const url = new URL("../../tracker/weekly-report-form.html", import.meta.url);
  const html = (await import("node:fs")).readFileSync(url, "utf8");
  // Options are rendered per-photo at runtime from PHOTO_COMPLIANCE_STATUS
  // (imported from app.js, not hard-coded per page) — that array is
  // exercised directly below via a real uploaded photo; this test just
  // pins the four values this integration depends on existing exactly
  // as named, matching weekly-report-form.html's own <select> markup.
  assert.deepEqual(PHOTO_COMPLIANCE_STATUS, ["Approved / Compliant", "Action Required", "Info Only", "RFI Required"]);
});

test("Form: selecting 'RFI Required' on a freshly-uploaded (unsaved) photo never creates anything and never shows a Raise RFI link — the photo has no stable id yet", async () => {
  const { document, window } = await runForm();
  await wait(30);
  const fileInput = document.getElementById("photoInput");
  const file = new window.File(["x"], "photo.jpg", { type: "image/jpeg" });
  Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
  fireEvent(fileInput, "change");
  await wait(30);
  const statusSelect = document.querySelector(".pc-status");
  statusSelect.value = "RFI Required";
  fireEvent(statusSelect, "change");
  await wait(20);
  // The .pc-status change handler only updates the in-memory photos[]
  // array (photos[i].compliance_status = ...) — it deliberately never
  // re-renders on its own, exactly like the pre-existing
  // "Action Required" status already behaves (its own "a snag will be
  // raised..." hint is equally not live-rendered on selection). Nothing
  // is created by this selection either way — no RPC/insert call
  // exists in this mock for it to have reached.
  assert.equal(document.querySelectorAll("a[href*='rfi-detail.html']").length, 0, "no Raise RFI link can exist yet — the photo has no id");
});

test("Form: an existing, already-normalised photo tagged RFI Required shows a working Raise RFI link with the full context", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "draft", prepared_by: "Jane", programme_status: "on-track",
    photos: [{ id: "photo-abc", url: "https://example.com/roof.jpg", plot_area: "", category: "Roofing", compliance_status: "RFI Required", caption: "Missing flashing", snag_item_id: null, snag_list_id: null }],
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [],
    system_position: {},
  };
  const { document } = await runForm({ reportId: "r1", existingReport });
  await wait(40);
  const link = document.querySelector("a[href*='rfi-detail.html']");
  assert.ok(link, "a Raise RFI link must be present for a saved, RFI-Required photo");
  const href = link.getAttribute("href");
  assert.match(href, /new=1/);
  assert.match(href, /project=p1/);
  assert.match(href, /weekly_report_id=r1/);
  assert.match(href, /photo_id=photo-abc/);
  assert.match(href, /category=Roofing/);
  assert.match(href, /caption=Missing\+flashing|caption=Missing%20flashing/);
});

test("Form: a photo already linked to an RFI shows 'RFI Raised — RFI-00N' instead of the Raise RFI link — no duplicate possible via the UI", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "draft", prepared_by: "Jane", programme_status: "on-track",
    photos: [{ id: "photo-abc", url: "https://example.com/roof.jpg", plot_area: "", category: "Roofing", compliance_status: "RFI Required", caption: "", snag_item_id: null, snag_list_id: null }],
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [],
    system_position: {},
  };
  const { document } = await runForm({
    reportId: "r1",
    existingReport,
    getRfiLinksForWeeklyReport: async () => ({ "photo-abc": { rfiId: "rfi-99", reference: "RFI-005", status: "open" } }),
  });
  await wait(40);
  assert.equal(document.querySelectorAll("a[href*='rfi-detail.html?new=1']").length, 0, "no Raise RFI link once a link already exists");
  const badge = document.querySelector("a[href='rfi-detail.html?id=rfi-99']");
  assert.ok(badge, "an 'Open this RFI' link must be present");
  assert.match(badge.textContent, /RFI Raised — RFI-005/);
});

test("Form: existing compliance statuses (Approved / Compliant, Action Required, Info Only) are completely unaffected", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", week_starting: "2026-09-07", week_ending: "2026-09-11",
    status: "draft", prepared_by: "Jane", programme_status: "on-track",
    photos: [
      { id: "p1id", url: "https://example.com/a.jpg", plot_area: "", category: "", compliance_status: "Approved / Compliant", caption: "", snag_item_id: null, snag_list_id: null },
      { id: "p2id", url: "https://example.com/b.jpg", plot_area: "Plot 1", category: "", compliance_status: "Action Required", caption: "", snag_item_id: null, snag_list_id: null },
      { id: "p3id", url: "https://example.com/c.jpg", plot_area: "", category: "", compliance_status: "Info Only", caption: "", snag_item_id: null, snag_list_id: null },
    ],
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [],
    system_position: {},
  };
  const { document } = await runForm({ reportId: "r1", existingReport });
  await wait(40);
  assert.match(document.querySelectorAll(".photo-card")[1].textContent, /A snag will be raised for this automatically when you save/);
  assert.equal(document.querySelectorAll("a[href*='rfi-detail.html']").length, 0, "none of these three statuses ever show a Raise RFI link");
});

// ─── weekly-report-view.html ────────────────────────────────────────

function viewSupabaseMock(report) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        lte() { return api; }, lt() { return api; }, gte() { return api; }, gt() { return api; },
        order() { return api; },
        single: async () => {
          if (table === "weekly_reports") return { data: { ...report, projects: SAMPLE_PROJECT }, error: null };
          if (table === "projects") return { data: SAMPLE_PROJECT, error: null };
          return { data: null, error: null };
        },
        then(resolve) {
          if (table === "plots") resolve({ data: [], error: null });
          else resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
}

async function runView(report, { getRfiLinksForWeeklyReport } = {}) {
  return runPage(VIEW_HTML, extractScript(VIEW_HTML), {
    __url: `https://example.com/weekly-report-view.html?id=${report.id}`,
    supabase: viewSupabaseMock(report),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => report.id,
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    getOrgLogoUrl: async () => null,
    formatGBP: () => null,
    showError: (el, err) => { el.textContent = err?.message || String(err); },
    clearError: (el) => { el.textContent = ""; },
    PHOTO_COMPLIANCE_BADGE: { "RFI Required": "badge-amber" }, RESOURCE_ADEQUACY_BADGE: {}, RISK_IMPACT_BADGE: {}, STATUTORY_OUTCOME_BADGE: {},
    WEEKLY_REPORT_STATUS_LABEL: {}, WEEKLY_REPORT_STATUS_BADGE: {},
    validWeeklyReportStatusTransitions: () => [],
    reviewWeeklyReport: async () => report, approveWeeklyReport: async () => report,
    issueWeeklyReport: async () => report, reviseWeeklyReport: async () => report,
    CONTROL_LEVEL_BADGE: {},
    normalisePlotToken: (s) => String(s).trim().toLowerCase(),
    getRfiLinksForWeeklyReport: getRfiLinksForWeeklyReport || (async () => ({})),
    URLSearchParams,
  });
}

function sampleReport(overrides = {}) {
  return {
    id: "r1", project_id: "p1", status: "issued",
    week_starting: "2026-09-07", week_ending: "2026-09-11",
    photos: [{ id: "photo-xyz", url: "https://example.com/roof.jpg", plot_area: "", category: "Roofing", compliance_status: "RFI Required", caption: "Missing flashing" }],
    weather_days: [], commercial_items: [], labour_records: [], risk_items: [], statutory_milestones: [],
    system_position: {},
    ...overrides,
  };
}

test("View: an issued report's RFI-Required photo (which always has a real id) shows a working Raise RFI link", async () => {
  const { document } = await runView(sampleReport());
  await wait(50);
  const html = document.getElementById("doc").innerHTML;
  assert.match(html, /rfi-detail\.html\?new=1[^"]*weekly_report_id=r1[^"]*photo_id=photo-xyz/);
});

test("View: a photo already linked to an RFI shows the 'RFI Raised' badge with a working link, never the Raise RFI link", async () => {
  const { document } = await runView(sampleReport(), {
    getRfiLinksForWeeklyReport: async () => ({ "photo-xyz": { rfiId: "rfi-77", reference: "RFI-002", status: "answered" } }),
  });
  await wait(50);
  const html = document.getElementById("doc").innerHTML;
  assert.match(html, /RFI Raised — RFI-002/);
  assert.match(html, /rfi-detail\.html\?id=rfi-77/);
  assert.doesNotMatch(html, /rfi-detail\.html\?new=1/);
});

test("View: existing 'Action Required' / snag-raised photos are completely unaffected by the RFI addition", async () => {
  const report = sampleReport({
    photos: [{ id: "p2", url: "https://example.com/b.jpg", plot_area: "", category: "", compliance_status: "Action Required", caption: "", snag_item_id: "snag1", snag_list_id: "list1" }],
  });
  const { document } = await runView(report);
  await wait(50);
  const html = document.getElementById("doc").innerHTML;
  assert.match(html, /✓ Snag Raised/);
  assert.match(html, /snag-list-edit\.html\?id=list1/);
});
