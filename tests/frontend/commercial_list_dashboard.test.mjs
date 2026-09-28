// Commercial Module — Phase 1. Proves dayworks.html (the list) and
// commercial-dashboard.html each independently ask the database for
// the caller's OWN Commercial role and gate their content on it — a
// no-grant user (even a project owner) sees the no-access card and
// nothing else, a Viewer sees data but no create controls, and a
// Contributor sees the create controls too. Also proves the dashboard
// correctly summarises a small set of events (counts, values, TBC/
// evidence/rejected warnings) entirely from the events it's given.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const DAYWORKS_HTML = new URL("../../tracker/dayworks.html", import.meta.url).pathname;
const DASHBOARD_HTML = new URL("../../tracker/commercial-dashboard.html", import.meta.url).pathname;

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function formatDate(d) { return d || ""; }
function formatCommercialGBP(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function commercialCapabilities(role) {
  return {
    role,
    canView: role === "viewer" || role === "contributor" || role === "approver",
    canEdit: role === "contributor" || role === "approver",
    canSubmit: role === "contributor" || role === "approver",
    canApprove: role === "contributor" || role === "approver", // v48
  };
}
const COMMERCIAL_STATUS_LABEL = { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected" };
const COMMERCIAL_STATUS_BADGE = { draft: "badge-grey", submitted: "badge-amber", approved: "badge-green", rejected: "badge-red" };

function baseContext(role, events, extra = {}) {
  const supabase = {
    from(table) {
      const api = { select() { return api; }, eq() { return api; }, order() { return api; }, single: async () => (table === "projects" ? { data: { name: "Test Site" }, error: null } : { data: null, error: null }) };
      return new Proxy(api, { get(t, p) { if (p === "then") return (resolve) => resolve({ data: [], error: null }); return t[p]; } });
    },
  };
  return {
    __url: "https://example.com/page.html?project=p1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "p1",
    escapeHtml, formatDate, formatCommercialGBP, commercialCapabilities,
    COMMERCIAL_STATUS_LABEL, COMMERCIAL_STATUS_BADGE,
    showCommercialError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getMyCommercialRole: async () => role,
    listCommercialEvents: async () => events,
    getMemberEmailMap: async () => ({}),
    getCommercialSummary: async () => {
      const counts = { draft: 0, submitted: 0, approved: 0, rejected: 0 };
      let approvedValue = 0, submittedValue = 0;
      events.forEach((e) => {
        counts[e.status]++;
        if (e.status === "approved") approvedValue += e.total_value;
        if (e.status === "submitted") submittedValue += e.total_value;
      });
      return { events, counts, approvedValue, submittedValue };
    },
    getCommercialWarnings: async () => ({ tbcEventIds: new Set(extra.tbc || []), eventsWithEvidence: new Set(extra.evidence || []) }),
    ...extra.overrides,
  };
}

// ─── dayworks.html ──────────────────────────────────────────────

test("dayworks.html: a user with NO Commercial grant sees the no-access card, not the list", async () => {
  const { document } = await runPage(DAYWORKS_HTML, extractScript(DAYWORKS_HTML), baseContext(null, []));
  await wait(30);
  assert.equal(document.getElementById("noAccessCard").style.display, "block");
  assert.notEqual(document.getElementById("listBody").style.display, "block");
});

test("dayworks.html: a Viewer sees the list but no + New Daywork button", async () => {
  const events = [{ id: "e1", reference: "DW-001", title: "Groundworks", status: "draft", total_value: 100, created_by: "u1", submitted_at: null, approved_at: null, plot_id: null, created_at: "2026-09-01T00:00:00Z" }];
  const { document } = await runPage(DAYWORKS_HTML, extractScript(DAYWORKS_HTML), baseContext("viewer", events));
  await wait(30);
  assert.equal(document.getElementById("listBody").style.display, "block");
  assert.equal(document.getElementById("newDayworkLink").style.display, "none");
  assert.ok(document.getElementById("rows").textContent.includes("Groundworks"));
});

test("dayworks.html: a Contributor sees the + New Daywork button, and status/search filters narrow the list", async () => {
  const events = [
    { id: "e1", reference: "DW-001", title: "Groundworks", status: "draft", total_value: 100, created_by: "u1", submitted_at: null, approved_at: null, plot_id: null, created_at: "2026-09-01T00:00:00Z" },
    { id: "e2", reference: "DW-002", title: "Scaffolding", status: "approved", total_value: 500, created_by: "u1", submitted_at: "2026-09-02T00:00:00Z", approved_at: "2026-09-03T00:00:00Z", plot_id: null, created_at: "2026-09-01T00:00:00Z" },
  ];
  const { document } = await runPage(DAYWORKS_HTML, extractScript(DAYWORKS_HTML), baseContext("contributor", events));
  await wait(30);
  assert.equal(document.getElementById("newDayworkLink").style.display, "inline-flex");
  assert.equal(document.querySelectorAll("#rows tr").length, 2);

  const statusFilter = document.getElementById("statusFilter");
  statusFilter.value = "approved";
  statusFilter.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
  await wait(10);
  const rows = document.querySelectorAll("#rows tr");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes("Scaffolding"));
});

// ─── commercial-dashboard.html ──────────────────────────────────

test("commercial-dashboard.html: a user with NO Commercial grant sees the no-access card, not the dashboard", async () => {
  const { document } = await runPage(DASHBOARD_HTML, extractScript(DASHBOARD_HTML), baseContext(null, []));
  await wait(30);
  assert.equal(document.getElementById("noAccessCard").style.display, "block");
  assert.notEqual(document.getElementById("dashboardBody").style.display, "block");
});

test("commercial-dashboard.html: summary cards, activity, and warnings all reflect the given events correctly", async () => {
  const events = [
    { id: "e1", reference: "DW-001", type: "daywork", title: "Draft one", status: "draft", total_value: 0, plot_id: null, created_at: "2026-09-01T00:00:00Z", submitted_at: null },
    { id: "e2", reference: "DW-002", type: "daywork", title: "Submitted one", status: "submitted", total_value: 150.5, plot_id: null, created_at: "2026-09-01T00:00:00Z", submitted_at: "2026-09-02T00:00:00Z" },
    { id: "e3", reference: "DW-003", type: "daywork", title: "Approved one", status: "approved", total_value: 300, plot_id: null, created_at: "2026-09-01T00:00:00Z", submitted_at: "2026-09-02T00:00:00Z" },
    { id: "e4", reference: "DW-004", type: "daywork", title: "Rejected one", status: "rejected", total_value: 0, plot_id: null, created_at: "2026-09-01T00:00:00Z", submitted_at: "2026-09-02T00:00:00Z" },
  ];
  const { document } = await runPage(DASHBOARD_HTML, extractScript(DASHBOARD_HTML), baseContext("approver", events, { tbc: ["e2"], evidence: ["e3"] }));
  await wait(30);

  assert.equal(document.getElementById("draftCount").textContent, "1");
  assert.equal(document.getElementById("submittedCount").textContent, "1");
  assert.equal(document.getElementById("approvedCount").textContent, "1");
  assert.equal(document.getElementById("rejectedCount").textContent, "1");
  assert.equal(document.getElementById("approvedValue").textContent, formatCommercialGBP(300));
  assert.equal(document.getElementById("submittedValue").textContent, formatCommercialGBP(150.5));

  const activityText = document.getElementById("activityRows").textContent;
  assert.ok(activityText.includes("Draft one"));
  assert.ok(activityText.includes("Approved one"));

  const warningsText = document.getElementById("warningsList").textContent;
  assert.ok(warningsText.includes("TBC"), "the submitted-with-TBC event should surface a TBC warning");
  assert.ok(warningsText.includes("rejected"), "the rejected event should surface a rejected-requiring-action warning");
  // e2 (submitted) has no evidence -> should count toward "no evidence";
  // e3 (approved) has evidence -> should not.
  assert.ok(warningsText.includes("no evidence"));
});

test("commercial-dashboard.html: a Viewer does not see the + New Daywork action", async () => {
  const { document } = await runPage(DASHBOARD_HTML, extractScript(DASHBOARD_HTML), baseContext("viewer", []));
  await wait(30);
  assert.equal(document.getElementById("newDayworkLink").style.display, "none");
  assert.equal(document.getElementById("headerActions").style.display, "flex");
});

// ─── variations.html ─────────────────────────────────────────────

const VARIATIONS_HTML = new URL("../../tracker/variations.html", import.meta.url).pathname;

function variationsBaseContext(role, events, extra = {}) {
  const supabase = {
    from(table) {
      const api = { select() { return api; }, eq() { return api; }, order() { return api; }, single: async () => (table === "projects" ? { data: { name: "Test Site" }, error: null } : { data: null, error: null }) };
      return new Proxy(api, {
        get(t, p) {
          if (p === "then") {
            return (resolve) => {
              if (table === "variations") return resolve({ data: extra.variationFields || [], error: null });
              if (table === "variation_dayworks") return resolve({ data: extra.links || [], error: null });
              return resolve({ data: [], error: null });
            };
          }
          return t[p];
        },
      });
    },
  };
  return {
    __url: "https://example.com/variations.html?project=p1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "p1",
    escapeHtml, formatDate, formatCommercialGBP, commercialCapabilities,
    COMMERCIAL_STATUS_LABEL, COMMERCIAL_STATUS_BADGE,
    showCommercialError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getMyCommercialRole: async () => role,
    listCommercialEvents: async () => events,
  };
}

test("variations.html: a user with NO Commercial grant sees the no-access card, not the list", async () => {
  const { document } = await runPage(VARIATIONS_HTML, extractScript(VARIATIONS_HTML), variationsBaseContext(null, []));
  await wait(30);
  assert.equal(document.getElementById("noAccessCard").style.display, "block");
  assert.notEqual(document.getElementById("listBody").style.display, "block");
});

test("variations.html: a Viewer sees the list (including linked-Daywork count) but no + New Variation button", async () => {
  const events = [{ id: "v1", reference: "VAR-001", title: "Drainage change", status: "draft", total_value: 500, plot_id: null, created_at: "2026-09-01T00:00:00Z", submitted_at: null, approved_at: null }];
  const links = [{ variation_id: "v1" }, { variation_id: "v1" }];
  const { document } = await runPage(VARIATIONS_HTML, extractScript(VARIATIONS_HTML), variationsBaseContext("viewer", events, { links }));
  await wait(30);
  assert.equal(document.getElementById("listBody").style.display, "block");
  assert.equal(document.getElementById("newVariationLink").style.display, "none");
  const rowText = document.querySelector("#rows tr").textContent;
  assert.ok(rowText.includes("Drainage change"));
  assert.ok(rowText.includes("2"), "the linked Daywork count column must show 2");
});

test("variations.html: a Contributor sees the + New Variation button, and the status filter narrows the list", async () => {
  const events = [
    { id: "v1", reference: "VAR-001", title: "Change A", status: "draft", total_value: 100, plot_id: null, created_at: "2026-09-01T00:00:00Z" },
    { id: "v2", reference: "VAR-002", title: "Change B", status: "approved", total_value: 500, plot_id: null, created_at: "2026-09-01T00:00:00Z" },
  ];
  const { document } = await runPage(VARIATIONS_HTML, extractScript(VARIATIONS_HTML), variationsBaseContext("contributor", events));
  await wait(30);
  assert.equal(document.getElementById("newVariationLink").style.display, "inline-flex");
  assert.equal(document.querySelectorAll("#rows tr").length, 2);

  const statusFilter = document.getElementById("statusFilter");
  statusFilter.value = "approved";
  statusFilter.dispatchEvent(new document.defaultView.Event("change", { bubbles: true }));
  await wait(10);
  const rows = document.querySelectorAll("#rows tr");
  assert.equal(rows.length, 1);
  assert.ok(rows[0].textContent.includes("Change B"));
});

// ─── commercial-dashboard.html: Phase 2 Variation integration ────

test("commercial-dashboard.html: Variation-only summary cards reflect only Variation events, and each activity row links to the right detail page by type", async () => {
  const events = [
    { id: "e1", reference: "DW-001", type: "daywork", title: "A daywork", status: "approved", total_value: 200, plot_id: null, created_at: "2026-09-01T00:00:00Z", submitted_at: null },
    { id: "v1", reference: "VAR-001", type: "variation", title: "A variation", status: "submitted", total_value: 400, plot_id: null, created_at: "2026-09-01T00:00:00Z", submitted_at: "2026-09-02T00:00:00Z" },
    { id: "v2", reference: "VAR-002", type: "variation", title: "Another variation", status: "approved", total_value: 600, plot_id: null, created_at: "2026-09-01T00:00:00Z", submitted_at: "2026-09-02T00:00:00Z" },
  ];
  const { document } = await runPage(DASHBOARD_HTML, extractScript(DASHBOARD_HTML), baseContext("approver", events));
  await wait(30);

  // Combined cards include both types.
  assert.equal(document.getElementById("approvedCount").textContent, "2", "combined approved count must include both the daywork and the variation");
  // Variation-only cards must reflect ONLY the two variation events.
  assert.equal(document.getElementById("varSubmittedCount").textContent, "1");
  assert.equal(document.getElementById("varApprovedCount").textContent, "1");
  assert.equal(document.getElementById("varApprovedValue").textContent, formatCommercialGBP(600));
  assert.equal(document.getElementById("varSubmittedValue").textContent, formatCommercialGBP(400));

  const dayworkLink = document.querySelector('a[href="daywork-detail.html?id=e1"]');
  const variationLink = document.querySelector('a[href="variation-detail.html?id=v1"]');
  assert.ok(dayworkLink, "a Daywork activity row must link to daywork-detail.html, not variation-detail.html");
  assert.ok(variationLink, "a Variation activity row must link to variation-detail.html, not daywork-detail.html");
});

test("commercial-dashboard.html: a Contributor sees both + New Daywork and + New Variation actions", async () => {
  const { document } = await runPage(DASHBOARD_HTML, extractScript(DASHBOARD_HTML), baseContext("contributor", []));
  await wait(30);
  assert.equal(document.getElementById("newDayworkLink").style.display, "inline-flex");
  assert.equal(document.getElementById("newVariationLink").style.display, "inline-flex");
});
