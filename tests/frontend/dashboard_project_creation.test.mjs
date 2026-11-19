// Dashboard load + project creation (Priority 1: every new project must
// resolve/create the caller's organisation via ensure_organisation()
// before inserting — this proves the real dashboard.html page does that,
// not just that the RPC exists).
import { test } from "node:test";
import assert from "node:assert/strict";
import { progressHelpers } from "../lib/progress_helpers.mjs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/dashboard.html", import.meta.url).pathname;

function makeSupabase({ ensureOrgId = "org-1", projects = [], programmes = [], programmeActivities = [], snags = [], reports = [] } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc(name, args) {
      calls.push({ op: "rpc", name, args });
      if (name === "ensure_organisation") return Promise.resolve({ data: ensureOrgId, error: null });
      if (name === "create_site") return Promise.resolve({ data: "new-project-id", error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        in() { return api; }, // v93: dashboard's bulk programme_activities lookup for the "Programme complete" tile figure
        order() { return api; },
        single: async () => ({ data: { id: "new-project-id" }, error: null }),
        insert(payload) {
          calls.push({ table, op: "insert", payload });
          return { select: () => ({ single: async () => ({ data: { id: "new-project-id", ...payload }, error: null }) }) };
        },
        then(resolve) {
          if (table === "projects") resolve({ data: projects, error: null });
          else if (table === "programmes") resolve({ data: programmes, error: null });
          else if (table === "programme_activities") resolve({ data: programmeActivities, error: null });
          else if (table === "snag_items") resolve({ data: snags, error: null });
          else if (table === "weekly_reports") resolve({ data: reports, error: null });
          else resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
}

async function run(supabase) {
  return runPage(HTML, extractScript(HTML), {
    ...progressHelpers,
    __url: "https://example.com/dashboard.html",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    RAG_LABEL: { red: "Red", amber: "Amber", green: "Green" },
    renderProgressBlock: (b, a) => `<div class="progress-block" data-actual="${a}"></div>`,
    // The real isSnagOutstanding() (app.js) — every pre-existing test
    // here passes no snags at all, so this was never previously
    // exercised; the v96 "Completed sites" tests below are the first
    // to pass real snag rows through loadSites()'s own open-snag count.
    isSnagOutstanding: (s) => !["closed", "rejected"].includes(s.status),
    ensureOrganisation: async () => {
      const { data, error } = await supabase.rpc("ensure_organisation");
      if (error) throw error;
      return data;
    },
    // v90: referenced unconditionally at module top-level (populating
    // the quick-create Action priority dropdown), so every dashboard.html
    // harness needs it even when a test never opens that form.
    ACTION_PRIORITIES: ["low", "medium", "high", "critical"],
    ACTION_PRIORITY_LABEL: { low: "Low", medium: "Medium", high: "High", critical: "Critical" },
    createAction: async () => ({}),
    isPlatformAdmin: async () => false,
  });
}

test("dashboard.html: an empty account shows the empty state, not an error", async () => {
  const { document } = await run(makeSupabase({ projects: [] }));
  await wait(20);
  assert.equal(document.getElementById("emptyState").style.display, "block");
});

test("dashboard.html: existing projects render as tiles", async () => {
  const project = { id: "p1", name: "Elm Grove", main_contractor_name: "Acme Ltd", rag_status: "green", status: "active", baseline_progress_pct: 10, actual_progress_pct: 12 };
  const { document } = await run(makeSupabase({ projects: [project] }));
  await wait(20);
  assert.equal(document.getElementById("emptyState").style.display, "none");
  assert.ok(document.getElementById("grid").innerHTML.includes("Elm Grove"));
});

// "Programme complete" tile figure (v93) — two BULK queries (never one
// per site, see dashboard.html's own comment), grouped client-side by
// project. computeProgrammeComplete() itself runs for real here via
// the jsdom harness's default binding — see programme_complete_figure.test.mjs
// for its own weighting-maths coverage.
test("dashboard.html: a site with an active programme shows 'Programme complete' on its tile, alongside the stored Actual Progress figure", async () => {
  const project = { id: "p1", name: "Elm Grove", main_contractor_name: "Acme Ltd", rag_status: "green", status: "active", baseline_progress_pct: 10, actual_progress_pct: 12 };
  const programmes = [{ id: "prog1", project_id: "p1", status: "active" }];
  const programmeActivities = [
    { programme_id: "prog1", status: "complete", percent_complete: 100, is_milestone: false, planned_start: "2026-01-01", planned_finish: "2026-01-11" },
    { programme_id: "prog1", status: "in_progress", percent_complete: 50, is_milestone: false, planned_start: "2026-01-01", planned_finish: "2026-01-11" },
  ];
  const { document } = await run(makeSupabase({ projects: [project], programmes, programmeActivities }));
  await wait(20);
  assert.match(document.getElementById("grid").innerHTML, /Programme complete: 75% \(1 of 2 activities\)/);
});

test("dashboard.html: a site with no active programme shows no 'Programme complete' figure on its tile", async () => {
  const project = { id: "p1", name: "Elm Grove", main_contractor_name: "Acme Ltd", rag_status: "green", status: "active", baseline_progress_pct: 10, actual_progress_pct: 12 };
  const { document } = await run(makeSupabase({ projects: [project] }));
  await wait(20);
  assert.ok(!document.getElementById("grid").innerHTML.includes("Programme complete"));
});

// ─── "Completed sites" section (v96) ─────────────────────────────
// A complete-status site drops out of the live grid into its own
// collapsed section below — it stays fully clickable/usable (its tile
// still links to project.html), it just loses the progress/programme
// figures that are no longer meaningfully tracked once the build is
// done (open snags / last report stay, per the brief: snagging is why
// a complete site is still open at all).
test("dashboard.html: a live (active/on hold) site stays in the main grid; a complete site moves into the collapsed 'Completed sites' section, collapsed by default", async () => {
  const live = { id: "p1", name: "Elm Grove", main_contractor_name: "Acme Ltd", rag_status: "green", status: "active", baseline_progress_pct: 10, actual_progress_pct: 12 };
  const onHold = { id: "p2", name: "Oak Close", main_contractor_name: "Acme Ltd", rag_status: "amber", status: "on hold", baseline_progress_pct: 20, actual_progress_pct: 15 };
  const done = { id: "p3", name: "Birch Lane", main_contractor_name: "Acme Ltd", rag_status: "green", status: "complete", baseline_progress_pct: 100, actual_progress_pct: 100 };
  const { document } = await run(makeSupabase({ projects: [live, onHold, done] }));
  await wait(20);

  const grid = document.getElementById("grid").innerHTML;
  assert.match(grid, /Elm Grove/);
  assert.match(grid, /Oak Close/, "an on-hold site stays in the live grid exactly as now");
  assert.ok(!grid.includes("Birch Lane"), "a complete site must not appear in the live grid");

  const section = document.getElementById("completedSitesSection");
  assert.equal(section.style.display, "block", "shown once there's at least one completed site");
  assert.equal(section.open, false, "collapsed by default — not auto-expanded");
  assert.equal(document.getElementById("completedSitesCount").textContent, "1");
  assert.match(document.getElementById("completedGrid").innerHTML, /Birch Lane/);
  assert.match(document.getElementById("completedGrid").innerHTML, /href="project.html\?id=p3"/, "a completed site's tile still links straight to its project page");
});

test("dashboard.html: with no completed sites at all, the 'Completed sites' section stays hidden", async () => {
  const live = { id: "p1", name: "Elm Grove", main_contractor_name: "Acme Ltd", rag_status: "green", status: "active", baseline_progress_pct: 10, actual_progress_pct: 12 };
  const { document } = await run(makeSupabase({ projects: [live] }));
  await wait(20);
  assert.equal(document.getElementById("completedSitesSection").style.display, "none");
  assert.equal(document.getElementById("completedSitesCount").textContent, "0");
});

test("dashboard.html: a completed site's tile shows neither the Actual Progress bar nor a 'Programme complete' figure — open snags and last report are unaffected", async () => {
  const done = { id: "p3", name: "Birch Lane", main_contractor_name: "Acme Ltd", rag_status: "green", status: "complete", baseline_progress_pct: 100, actual_progress_pct: 100 };
  const programmes = [{ id: "prog1", project_id: "p3", status: "active" }];
  const programmeActivities = [{ programme_id: "prog1", status: "complete", percent_complete: 100, is_milestone: false, planned_start: "2026-01-01", planned_finish: "2026-01-11" }];
  const { document } = await run(makeSupabase({
    projects: [done], programmes, programmeActivities,
    snags: [{ project_id: "p3", status: "open" }, { project_id: "p3", status: "open" }],
    reports: [{ project_id: "p3", week_ending: "2026-10-01" }],
  }));
  await wait(20);

  const html = document.getElementById("completedGrid").innerHTML;
  assert.ok(!html.includes("progress-block"), "no Actual Progress bar for a completed site's tile");
  assert.ok(!html.includes("Programme complete"), "no 'Programme complete' figure for a completed site's tile, even with an active programme behind it");
  assert.match(html, />2<\/strong>\s*open snags/, "open snag count is unaffected by completion status");
  assert.match(html, />2026-10-01<\/strong>\s*last report/, "last report date is unaffected by completion status");
});

test("dashboard.html: creating a project resolves the caller's organisation and includes org_id in the insert", async () => {
  const supabase = makeSupabase({ ensureOrgId: "org-abc-123" });
  const { document } = await run(supabase);

  fireEvent(document.getElementById("newProjectBtn"), "click");
  document.getElementById("name").value = "New Site";
  fireEvent(document.getElementById("projectForm"), "submit");
  await wait(30);

  const rpcCalls = supabase.calls.filter((c) => c.op === "rpc" && c.name === "ensure_organisation");
  assert.equal(rpcCalls.length, 1, "expected ensure_organisation to be called exactly once");

  // v69: the site is created through one create_site() call (site + share).
  const inserts = supabase.calls.filter((c) => c.op === "rpc" && c.name === "create_site");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].args.p_site.org_id, "org-abc-123", "the resolved organisation id must be included in the insert");
  assert.equal(inserts[0].args.p_site.name, "New Site");
  assert.equal(supabase.calls.filter((c) => c.table === "projects" && c.op === "insert").length, 0, "no direct insert");
});

test("dashboard.html: if resolving the organisation fails, no project insert is attempted", async () => {
  const supabase = makeSupabase({});
  supabase.rpc = (name) => (name === "ensure_organisation" ? Promise.resolve({ data: null, error: { message: "boom" } }) : Promise.resolve({ data: null, error: null }));
  const { document } = await run(supabase);

  fireEvent(document.getElementById("newProjectBtn"), "click");
  document.getElementById("name").value = "New Site";
  fireEvent(document.getElementById("projectForm"), "submit");
  await wait(30);

  const inserts = supabase.calls.filter((c) => (c.table === "projects" && c.op === "insert") || c.name === "create_site");
  assert.equal(inserts.length, 0, "must not attempt to insert a project if the organisation couldn't be resolved");
  assert.ok(document.getElementById("errorBox").textContent.includes("boom"));
});

// v60: ensure_organisation() returns null when the caller isn't an admin
// of any company (brand-new, or only a member via an invite). The page
// must then route to the "Set up your company" screen and never insert.
test("dashboard.html: no admin organisation (null) sends the user to setup and inserts nothing", async () => {
  const supabase = makeSupabase({ ensureOrgId: null });
  const { document } = await run(supabase);
  fireEvent(document.getElementById("newProjectBtn"), "click");
  document.getElementById("name").value = "Sub's Own Site";
  fireEvent(document.getElementById("projectForm"), "submit");
  await wait(30);
  const inserts = supabase.calls.filter((c) => (c.table === "projects" && c.op === "insert") || c.name === "create_site");
  assert.equal(inserts.length, 0, "must never create a project without an admin organisation");
  assert.equal(document.getElementById("errorBox").textContent, "", "this is a redirect, not an error");
});

test("dashboard.html: the setup redirect target is onboarding.html?reason=create_project", () => {
  const src = extractScript(HTML);
  assert.match(src, /if \(!orgId\) \{\s*window\.location\.href = "onboarding\.html\?reason=create_project";\s*return;/);
});
