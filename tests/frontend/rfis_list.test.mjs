// RFI-2 — rfis.html (list page). Real inline script under jsdom,
// following the same conventions as tests/frontend/daywork_workflow.test.mjs:
// app.js's RFI data-access functions (listRfis, etc. — already proven
// against a real database with real RLS in tests/security/rfis.test.mjs)
// are mocked here so this file can focus purely on what the PAGE does
// with their results: rendering, filtering, and the +New RFI link.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/rfis.html", import.meta.url).pathname;

const RFI_STATUS_LABEL = { open: "Open", answered: "Answered", closed: "Closed" };
const RFI_STATUS_BADGE = { open: "badge-red", answered: "badge-amber", closed: "badge-green" };
const RFI_PRIORITIES = ["low", "medium", "high", "critical"];
const RFI_PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
const RFI_PRIORITY_BADGE = { low: "badge-grey", medium: "badge-blue", high: "badge-amber", critical: "badge-red" };

const OWNER_A = "u-owner";
const COLLAB_A = "u-collab";

function sampleRfis() {
  return [
    { id: "r1", reference: "RFI-001", title: "Beam clash", plot_id: "plot1", priority: "high", status: "open", assigned_to: COLLAB_A, due_date: "2026-10-01", created_at: "2026-09-01T00:00:00Z" },
    { id: "r2", reference: "RFI-002", title: "Cladding spec", plot_id: null, priority: "low", status: "closed", assigned_to: null, due_date: null, created_at: "2026-08-01T00:00:00Z" },
    { id: "r3", reference: "RFI-003", title: "Roof detail", plot_id: null, priority: "medium", status: "answered", assigned_to: OWNER_A, due_date: "2026-09-15", created_at: "2026-08-15T00:00:00Z" },
  ];
}

function makeSupabase() {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        single: async () => (table === "projects" ? { data: { name: "Test Site" }, error: null } : { data: null, error: null }),
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
}

async function run({ rfis = sampleRfis(), plots = [{ id: "plot1", plot_number: "Plot 1" }] } = {}) {
  const supabase = makeSupabase();
  supabase.from = (table) => {
    if (table === "plots") return { select: () => ({ eq: async () => ({ data: plots, error: null }) }) };
    const api = {
      select() { return api; },
      eq() { return api; },
      single: async () => (table === "projects" ? { data: { name: "Test Site" }, error: null } : { data: null, error: null }),
    };
    return api;
  };
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/rfis.html?project=p1",
    supabase,
    requireAuth: async () => ({ id: OWNER_A }),
    renderHeader: () => {},
    getParam: (name) => (name === "project" ? "p1" : null),
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    RFI_STATUS_LABEL, RFI_STATUS_BADGE, RFI_PRIORITIES, RFI_PRIORITY_LABEL, RFI_PRIORITY_BADGE,
    listRfis: async () => rfis,
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b)),
  });
}

test("List: loads and renders all RFIs by default (Active filter: open/answered)", async () => {
  const { document } = await run();
  await wait(30);
  const rows = document.getElementById("rfiRows").textContent;
  assert.match(rows, /RFI-001/);
  assert.match(rows, /RFI-003/);
  assert.doesNotMatch(rows, /RFI-002/, "closed RFI-002 must be hidden under the default 'Active' filter");
});

test("List: 'All' status filter shows every RFI including closed", async () => {
  const { document } = await run();
  await wait(30);
  document.getElementById("statusFilter").value = "all";
  fireEvent(document.getElementById("statusFilter"), "change");
  const rows = document.getElementById("rfiRows").textContent;
  assert.match(rows, /RFI-001/);
  assert.match(rows, /RFI-002/);
  assert.match(rows, /RFI-003/);
});

test("List: priority filter narrows to the selected priority only", async () => {
  const { document } = await run();
  await wait(30);
  document.getElementById("statusFilter").value = "all";
  fireEvent(document.getElementById("statusFilter"), "change");
  document.getElementById("priorityFilter").value = "high";
  fireEvent(document.getElementById("priorityFilter"), "change");
  const rows = document.getElementById("rfiRows").textContent;
  assert.match(rows, /RFI-001/);
  assert.doesNotMatch(rows, /RFI-002/);
  assert.doesNotMatch(rows, /RFI-003/);
});

test("List: assigned-to filter narrows to a specific user, and 'Unassigned' works", async () => {
  const { document } = await run();
  await wait(30);
  document.getElementById("statusFilter").value = "all";
  fireEvent(document.getElementById("statusFilter"), "change");
  document.getElementById("assignedFilter").value = "unassigned";
  fireEvent(document.getElementById("assignedFilter"), "change");
  const rows = document.getElementById("rfiRows").textContent;
  assert.match(rows, /RFI-002/, "RFI-002 has no assignee");
  assert.doesNotMatch(rows, /RFI-001/);
  assert.doesNotMatch(rows, /RFI-003/);
});

test("List: empty state shown when there are no RFIs at all", async () => {
  const { document } = await run({ rfis: [] });
  await wait(30);
  assert.equal(document.getElementById("emptyState").style.display, "block");
});

test("List: +New RFI link points at rfi-detail.html?new=1 for this project", async () => {
  const { document } = await run();
  await wait(30);
  assert.equal(document.getElementById("newRfiBtn").getAttribute("href"), "rfi-detail.html?new=1&project=p1");
});

test("List: a row links to the correct rfi-detail.html?id=", async () => {
  const { document } = await run();
  await wait(30);
  const row = [...document.querySelectorAll("#rfiRows tr")].find((r) => r.textContent.includes("RFI-001"));
  assert.ok(row.getAttribute("onclick").includes("rfi-detail.html?id=r1"));
});

test("List: a load failure shows an error rather than crashing", async () => {
  const supabase = makeSupabase();
  const { document } = await runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/rfis.html?project=p1",
    supabase,
    requireAuth: async () => ({ id: OWNER_A }),
    renderHeader: () => {},
    getParam: () => "p1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    RFI_STATUS_LABEL, RFI_STATUS_BADGE, RFI_PRIORITIES, RFI_PRIORITY_LABEL, RFI_PRIORITY_BADGE,
    listRfis: async () => { throw new Error("network failure"); },
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b)),
  });
  await wait(30);
  assert.match(document.getElementById("pageErrorBox").textContent, /network failure/);
  assert.equal(document.getElementById("emptyState").style.display, "block");
});
