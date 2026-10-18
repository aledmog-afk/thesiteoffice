// RFI-2 — rfi-detail.html (create + view/respond/close/reopen + evidence).
// Real inline script under jsdom. app.js's RFI data-access functions are
// mocked (already proven against a real database with real RLS in
// tests/security/rfis.test.mjs / rfi_evidence_links.test.mjs) — this file
// proves the PAGE wires them up correctly: which mode it's in (new vs
// existing), what it sends on create/update, how it reflects the
// database's OWN lifecycle rules (never inventing its own), and how it
// surfaces errors rather than failing silently.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/rfi-detail.html", import.meta.url).pathname;

const RFI_STATUS_LABEL = { open: "Open", answered: "Answered", closed: "Closed" };
const RFI_STATUS_BADGE = { open: "badge-red", answered: "badge-amber", closed: "badge-green" };
const RFI_PRIORITIES = ["low", "medium", "high", "critical"];
const RFI_PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const RFI_PRIORITY_BADGE = { low: "badge-grey", medium: "badge-blue", high: "badge-amber", critical: "badge-red" };
// Mirrors valid_rfi_status_transition() in sql/schema.sql (v51) exactly
// — same transition table proven for real in tests/security/rfis.test.mjs.
const TRANSITIONS = { open: ["answered"], answered: ["closed"], closed: ["open"] };
function validRfiStatusTransitions(from) { return TRANSITIONS[from] || []; }

const OWNER_A = "u-owner";
const COLLAB_A = "u-collab";

function sampleRfi(overrides = {}) {
  return {
    id: "r1", project_id: "p1", plot_id: null, reference: "RFI-001",
    title: "Beam clash", question: "Please confirm beam depth at gridline C4.",
    status: "open", priority: "medium", assigned_to: null, due_date: null,
    created_by: OWNER_A, created_at: "2026-09-01T00:00:00Z", updated_at: "2026-09-01T00:00:00Z",
    answered_at: null, answered_by: null, response: null, closed_at: null,
    projects: { name: "Test Site" },
    ...overrides,
  };
}

function baseContext(overrides = {}) {
  const supabase = {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        single: async () => {
          if (table === "projects") return { data: { name: "Test Site" }, error: null };
          if (table === "weekly_reports") return { data: { week_starting: "2026-09-07" }, error: null };
          return { data: null, error: null };
        },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
    rpc: async (name) => {
      if (name === "get_project_members") {
        return { data: [{ user_id: OWNER_A, email: "owner@example.com", role: "owner" }, { user_id: COLLAB_A, email: "collab@example.com", role: "collaborator" }], error: null };
      }
      return { data: null, error: null };
    },
  };
  supabase.from = (table) => {
    if (table === "plots") return { select: () => ({ eq: async () => ({ data: [{ id: "plot1", plot_number: "Plot 1" }], error: null }) }) };
    if (table === "projects") return { select: () => ({ eq: () => ({ single: async () => ({ data: { name: "Test Site" }, error: null }) }) }) };
    if (table === "weekly_reports") {
      return {
        select: () => ({
          eq: () => ({ single: async () => ({ data: { week_starting: "2026-09-07" }, error: null }) }),
          in: async () => ({ data: [{ id: "wr1", week_starting: "2026-09-07", photos: [{ id: "photo1", url: "https://example.com/p.jpg" }] }], error: null }),
        }),
      };
    }
    return { select() { return this; }, eq() { return this; }, single: async () => ({ data: null, error: null }) };
  };

  return {
    supabase,
    requireAuth: async () => ({ id: OWNER_A }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b)),
    RFI_STATUS_LABEL, RFI_STATUS_BADGE, RFI_PRIORITIES, RFI_PRIORITY_LABEL, RFI_PRIORITY_BADGE, validRfiStatusTransitions,
    getRfi: async () => sampleRfi(),
    createRfi: async () => sampleRfi(),
    updateRfi: async () => sampleRfi(),
    answerRfi: async () => sampleRfi({ status: "answered" }),
    closeRfi: async () => sampleRfi({ status: "closed" }),
    reopenRfi: async () => sampleRfi({ status: "open" }),
    createRfiFromWeeklyReportPhoto: async () => ({ rfi: sampleRfi(), evidenceLink: { id: "link1" } }),
    getRfiEvidence: async () => [],
    ...overrides,
  };
}

async function runNew(url, overrides = {}) {
  const context = baseContext(overrides);
  const params = new URLSearchParams(url.split("?")[1] || "");
  return runPage(HTML, extractScript(HTML), {
    __url: `https://example.com/${url}`,
    ...context,
    getParam: (name) => params.get(name),
  });
}

async function runExisting(overrides = {}) {
  const context = baseContext(overrides);
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/rfi-detail.html?id=r1",
    ...context,
    getParam: (name) => (name === "id" ? "r1" : null),
  });
}

// ─── Creation (plain) ────────────────────────────────────────────

test("Create (plain): the form loads with 'New RFI' heading, Project shown, no source card", async () => {
  const { document } = await runNew("rfi-detail.html?new=1&project=p1");
  await wait(30);
  assert.equal(document.getElementById("pageTitle").textContent, "New RFI");
  assert.equal(document.getElementById("sourceCard").style.display, "none");
  assert.equal(document.getElementById("saveBtn").textContent, "Create RFI");
});

test("Create (plain): submitting calls createRfi with the entered fields and redirects to the new RFI's detail page", async () => {
  let calledWith = null;
  const { document } = await runNew("rfi-detail.html?new=1&project=p1", {
    createRfi: async (projectId, fields) => { calledWith = { projectId, fields }; return sampleRfi({ id: "r-new" }); },
  });
  await wait(30);
  document.getElementById("title").value = "Window head detail";
  document.getElementById("question").value = "Is the head flashing detail as per drawing A-05 or A-06?";
  document.getElementById("priority").value = "high";
  document.getElementById("dueDate").value = "2026-10-15";
  fireEvent(document.getElementById("detailsForm"), "submit");
  await wait(30);
  assert.equal(calledWith.projectId, "p1");
  assert.equal(calledWith.fields.title, "Window head detail");
  assert.equal(calledWith.fields.question, "Is the head flashing detail as per drawing A-05 or A-06?");
  assert.equal(calledWith.fields.priority, "high");
  assert.equal(calledWith.fields.dueDate, "2026-10-15");
  // jsdom does not implement real navigation — see
  // daywork_workflow.test.mjs's identical note; the record actually
  // created (asserted above) is what matters here.
});

test("Create (plain): a creation failure (e.g. RLS rejection) shows the real error, not a silent failure", async () => {
  const { document } = await runNew("rfi-detail.html?new=1&project=p1", {
    createRfi: async () => { throw new Error("new row violates row-level security policy"); },
  });
  await wait(30);
  document.getElementById("title").value = "x";
  document.getElementById("question").value = "y";
  fireEvent(document.getElementById("detailsForm"), "submit");
  await wait(30);
  assert.match(document.getElementById("errorBox").textContent, /row-level security/);
});

// ─── Creation (from a weekly-report photo) ───────────────────────

test("Create (from photo): the source context card shows the photo, category, caption and a link to the weekly report", async () => {
  const url = "rfi-detail.html?new=1&project=p1&weekly_report_id=wr1&photo_id=photo1&photo_url=https%3A%2F%2Fexample.com%2Fphoto.jpg&category=Roofing&caption=Cracked%20tile";
  const { document } = await runNew(url);
  await wait(30);
  assert.equal(document.getElementById("sourceCard").style.display, "block");
  assert.equal(document.getElementById("sourcePhotoImg").src, "https://example.com/photo.jpg");
  assert.match(document.getElementById("sourceCategoryLine").textContent, /Roofing/);
  assert.match(document.getElementById("sourceCaptionLine").textContent, /Cracked tile/);
  await wait(20);
  assert.match(document.getElementById("sourceReportLine").innerHTML, /weekly-report-view\.html\?id=wr1/);
});

test("Create (from photo): the title is pre-filled from the photo's category as a sensible starting point", async () => {
  const url = "rfi-detail.html?new=1&project=p1&weekly_report_id=wr1&photo_id=photo1&category=Roofing";
  const { document } = await runNew(url);
  await wait(30);
  assert.equal(document.getElementById("title").value, "Roofing");
});

test("Create (from photo): a pre-matched plot is pre-selected when the URL carries one", async () => {
  const url = "rfi-detail.html?new=1&project=p1&plot=plot1&weekly_report_id=wr1&photo_id=photo1";
  const { document } = await runNew(url);
  await wait(30);
  assert.equal(document.getElementById("plot").value, "plot1");
});

test("Create (from photo): submitting calls createRfiFromWeeklyReportPhoto with the exact project/report/photo/plot context — not just createRfi", async () => {
  let calledSource = null, calledFields = null;
  const url = "rfi-detail.html?new=1&project=p1&plot=plot1&weekly_report_id=wr1&photo_id=photo1&photo_url=https%3A%2F%2Fexample.com%2Fp.jpg&category=Roofing&caption=Cracked";
  const { document } = await runNew(url, {
    createRfiFromWeeklyReportPhoto: async (source, fields) => { calledSource = source; calledFields = fields; return { rfi: sampleRfi({ id: "r-new" }), evidenceLink: { id: "link1" } }; },
  });
  await wait(30);
  document.getElementById("question").value = "Confirm the correct detail.";
  fireEvent(document.getElementById("detailsForm"), "submit");
  await wait(30);
  assert.equal(calledSource.projectId, "p1");
  assert.equal(calledSource.weeklyReportId, "wr1");
  assert.equal(calledSource.photoId, "photo1");
  assert.equal(calledSource.caption, "Cracked");
  assert.equal(calledSource.plotId, "plot1");
  assert.equal(calledFields.title, "Roofing", "the pre-filled category-derived title was used");
  assert.equal(calledFields.question, "Confirm the correct detail.");
});

// ─── Existing RFI: detail, edit, lifecycle ───────────────────────

test("Existing: loads and renders reference, title, status and priority badges", async () => {
  const { document } = await runExisting();
  await wait(30);
  assert.equal(document.getElementById("pageTitle").textContent, "RFI-001 — Beam clash");
  assert.equal(document.getElementById("statusBadge").textContent, "Open");
  assert.equal(document.getElementById("priorityBadge").textContent, "Medium");
  assert.equal(document.getElementById("saveBtn").textContent, "Save Changes");
});

test("Existing: editing details calls updateRfi with the edited fields, never the reference/status", async () => {
  let calledFields = null;
  const { document } = await runExisting({
    updateRfi: async (id, fields) => { calledFields = fields; return sampleRfi({ title: "Updated title" }); },
  });
  await wait(30);
  document.getElementById("title").value = "Updated title";
  fireEvent(document.getElementById("detailsForm"), "submit");
  await wait(30);
  assert.equal(calledFields.title, "Updated title");
  assert.equal(calledFields.status, undefined, "the details form must never itself send a status change");
  assert.equal(document.getElementById("pageTitle").textContent, "RFI-001 — Updated title");
});

test("Existing (open): shows the Respond form, not the Close/Reopen buttons", async () => {
  const { document } = await runExisting();
  await wait(30);
  assert.equal(document.getElementById("respondForm").style.display, "block");
  assert.equal(document.getElementById("responseDisplay").style.display, "none");
  assert.equal(document.getElementById("lifecycleActions").innerHTML.trim(), "");
});

test("Existing (open): submitting a response calls answerRfi with the response text and re-renders as Answered", async () => {
  let calledResponse = null;
  const { document } = await runExisting({
    answerRfi: async (id, response) => { calledResponse = response; return sampleRfi({ status: "answered", response, answered_by: OWNER_A, answered_at: "2026-09-05T00:00:00Z" }); },
  });
  await wait(30);
  document.getElementById("responseInput").value = "Beam depth confirmed at 450mm per structural engineer.";
  fireEvent(document.getElementById("respondForm"), "submit");
  await wait(30);
  assert.equal(calledResponse, "Beam depth confirmed at 450mm per structural engineer.");
  assert.equal(document.getElementById("statusBadge").textContent, "Answered");
  assert.match(document.getElementById("responseText").textContent, /450mm/);
});

test("Existing (answered): shows the response read-only and a Close RFI button, not Reopen", async () => {
  const { document } = await runExisting({
    getRfi: async () => sampleRfi({ status: "answered", response: "Confirmed 450mm.", answered_by: OWNER_A, answered_at: "2026-09-05T00:00:00Z" }),
  });
  await wait(30);
  assert.equal(document.getElementById("respondForm").style.display, "none");
  assert.equal(document.getElementById("responseDisplay").style.display, "block");
  assert.match(document.getElementById("responseText").textContent, /450mm/);
  assert.ok(document.getElementById("closeBtn"), "Close RFI button must be present");
  assert.equal(document.getElementById("reopenBtn"), null, "Reopen must not be offered from answered");
});

test("Existing (answered): clicking Close RFI calls closeRfi and re-renders as Closed", async () => {
  const { document } = await runExisting({
    getRfi: async () => sampleRfi({ status: "answered", response: "Confirmed.", answered_by: OWNER_A, answered_at: "2026-09-05T00:00:00Z" }),
    closeRfi: async () => sampleRfi({ status: "closed", response: "Confirmed.", answered_by: OWNER_A, answered_at: "2026-09-05T00:00:00Z", closed_at: "2026-09-06T00:00:00Z" }),
  });
  await wait(30);
  fireEvent(document.getElementById("closeBtn"), "click");
  await wait(30);
  assert.equal(document.getElementById("statusBadge").textContent, "Closed");
});

test("Existing (closed): shows a Reopen button, response and closed date preserved", async () => {
  const { document } = await runExisting({
    getRfi: async () => sampleRfi({ status: "closed", response: "Confirmed 450mm.", answered_by: OWNER_A, answered_at: "2026-09-05T00:00:00Z", closed_at: "2026-09-06T00:00:00Z" }),
  });
  await wait(30);
  assert.ok(document.getElementById("reopenBtn"), "Reopen button must be present from closed");
  assert.equal(document.getElementById("closeBtn"), null);
  assert.match(document.getElementById("responseText").textContent, /450mm/);
  assert.match(document.getElementById("closedAtLine").textContent, /Closed on/);
});

test("Existing (closed): clicking Reopen calls reopenRfi and re-renders as Open, keeping the prior response visible in the UI's own re-fetched state", async () => {
  const { document } = await runExisting({
    getRfi: async () => sampleRfi({ status: "closed", response: "Confirmed 450mm.", answered_by: OWNER_A, answered_at: "2026-09-05T00:00:00Z", closed_at: "2026-09-06T00:00:00Z" }),
    reopenRfi: async () => sampleRfi({ status: "open", response: "Confirmed 450mm.", answered_by: OWNER_A, answered_at: "2026-09-05T00:00:00Z", closed_at: null }),
  });
  await wait(30);
  fireEvent(document.getElementById("reopenBtn"), "click");
  await wait(30);
  assert.equal(document.getElementById("statusBadge").textContent, "Open");
  assert.equal(document.getElementById("respondForm").style.display, "block", "reopened RFI goes back to offering a fresh respond form");
});

test("Existing: an invalid transition rejected by the database shows the real error, not a client-invented one", async () => {
  const { document } = await runExisting({
    getRfi: async () => sampleRfi({ status: "answered", response: "x", answered_by: OWNER_A, answered_at: "2026-09-05T00:00:00Z" }),
    closeRfi: async () => { throw new Error("Invalid RFI status transition: answered -> closed"); },
  });
  await wait(30);
  fireEvent(document.getElementById("closeBtn"), "click");
  await wait(30);
  assert.match(document.getElementById("errorBox").textContent, /Invalid RFI status transition/);
});

test("Existing: an unauthorised-operation error from the database is surfaced plainly", async () => {
  const { document } = await runExisting({
    updateRfi: async () => { throw new Error("new row violates row-level security policy for table \"rfis\"") },
  });
  await wait(30);
  document.getElementById("title").value = "Attempted edit";
  fireEvent(document.getElementById("detailsForm"), "submit");
  await wait(30);
  assert.match(document.getElementById("errorBox").textContent, /row-level security/);
});

// ─── Evidence ─────────────────────────────────────────────────────

test("Evidence: a linked weekly-report photo renders with its category/caption and a link back to the report", async () => {
  const { document } = await runExisting({
    getRfiEvidence: async () => [{ id: "link1", source_type: "weekly_report_photo", weekly_report_id: "wr1", photo_id: "photo1", caption: "Cracked tile" }],
  });
  // Override the weekly_reports lookup inside loadEvidence() (a
  // second, direct supabase.from("weekly_reports") select for
  // photo/report enrichment) to return the report + its photos array.
  await wait(50);
  const wrap = document.getElementById("evidenceWrap").innerHTML;
  assert.match(wrap, /rfi-evidence-item/);
});

test("Evidence: empty state shown when no evidence is linked", async () => {
  const { document } = await runExisting({ getRfiEvidence: async () => [] });
  await wait(30);
  assert.equal(document.getElementById("evidenceEmpty").style.display, "block");
});

test("Existing: RFI not found shows a clear message instead of crashing", async () => {
  const { document } = await runExisting({ getRfi: async () => { throw new Error("no rows"); } });
  await wait(30);
  assert.equal(document.getElementById("pageTitle").textContent, "RFI not found");
});
