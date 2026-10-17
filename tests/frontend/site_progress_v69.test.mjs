// v69 site progress, page level: the real inline scripts of the plot
// page, weekly report form, Site Details, dashboard and block page under
// jsdom with a recording Supabase mock (fake data only). Plus the real
// syncGateStatusFromMilestones() from app.js with the shared range-aware
// tag parser: gates only ever move up to Under Review.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";
import { progressHelpers } from "../lib/progress_helpers.mjs";

const page = (f) => new URL(`../../tracker/${f}`, import.meta.url).pathname;
const APP_JS = fs.readFileSync(page("js/app.js"), "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const escapeHtml = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const showError = (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; };
const clearError = (el) => { el.textContent = ""; el.style.display = "none"; };
const formatDate = (d) => (d ? String(d).slice(0, 10) : "");
// Objects built inside the page's vm context have that realm's prototypes.
const plain = (v) => JSON.parse(JSON.stringify(v));

// Table-driven Supabase mock: every query on `table` resolves to
// tables[table] (array); single()/maybeSingle() to singles[table] or the
// first row. Writes and RPCs are recorded.
function mockSupabase({ tables = {}, singles = {}, rpc = {} } = {}) {
  const calls = [];
  const sb = {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: "u-owner" } } }) },
    async rpc(name, args) {
      calls.push({ op: "rpc", name, args });
      const h = rpc[name];
      if (typeof h === "function") return h(args);
      return h || { data: null, error: null };
    },
    from(table) {
      const rows = () => tables[table] || [];
      const result = () => ({ data: rows(), error: null, count: rows().length });
      const api = new Proxy({}, {
        get(_, prop) {
          if (prop === "then") return (resolve) => resolve(result());
          if (prop === "single" || prop === "maybeSingle") {
            return async () => ({ data: singles[table] !== undefined ? singles[table] : rows()[0] || null, error: null });
          }
          if (prop === "update" || prop === "insert" || prop === "upsert" || prop === "delete") {
            return (payload) => {
              calls.push({ op: prop, table, payload });
              const w = new Proxy({}, {
                get(__, p2) {
                  if (p2 === "then") return (resolve) => resolve({ data: null, error: null });
                  if (p2 === "single" || p2 === "maybeSingle") return async () => ({ data: { id: `new-${table}`, ...(payload || {}) }, error: null });
                  return () => w;
                },
              });
              return w;
            };
          }
          return () => api;
        },
      });
      return api;
    },
  };
  return sb;
}

// ─── Plot page ─────────────────────────────────────────────────────
const PLOT_BASE = { id: "plot1", project_id: "p1", plot_number: "Plot 7", block_id: null, handed_over_at: null,
  projects: { id: "p1", name: "Fake Meadows" }, blocks: null };
const STAGES = [
  { id: "m1", plot_id: "plot1", stage_key: "st_groundworks", title: "Groundworks", percent: 100, applicable: true, sort_order: 2, last_source: "report", updated_at: "2026-10-12T09:00:00Z" },
  { id: "m2", plot_id: "plot1", stage_key: "st_roofing", title: "Roofing", percent: 40, applicable: true, sort_order: 9, last_source: "plot_page", updated_at: "2026-10-14T09:00:00Z" },
  { id: "m3", plot_id: "plot1", stage_key: "st_1fix_gas", title: "1st Fix – Gas", percent: 0, applicable: false, sort_order: 17, last_source: null, updated_at: null },
];

async function runPlotPage(plot, { rpc = {} } = {}) {
  const sb = mockSupabase({
    tables: { internal_milestones: STAGES.map((s) => ({ ...s })), plot_progress_overrides: plot.history || [] },
    singles: { plots: { ...plot } },
    rpc,
  });
  const ctx = {
    ...progressHelpers,
    __url: "https://example.com/plot-detail.html?id=plot1",
    confirm: () => true,
    supabase: sb, getParam: () => "plot1", requireAuth: async () => ({ id: "u-owner" }), renderHeader: () => {},
    escapeHtml, showError, clearError, formatDate,
    uploadImage: async () => "", checkAndMarkPlotHandedOver: async () => false,
    getPlotHandoverReadiness: async () => ({ plot, readiness: null }),
    PLOT_READINESS_LABEL: {}, PLOT_READINESS_BADGE: {}, RFI_STATUS_BADGE: {}, SNAG_STATUS_LABEL: {}, SNAG_STATUS_BADGE: {},
  };
  const r = await runPage(page("plot-detail.html"), extractScript(page("plot-detail.html")), ctx);
  await wait(30);
  return { ...r, sb };
}

test("plot page: no typed % input or Suggest button any more; automatic figure shown with an 'Automatic' label", async () => {
  const { document } = await runPlotPage({ ...PLOT_BASE, progress_pct: 4.5, progress_calculated: 4.5, progress_override: null });
  assert.equal(document.getElementById("plotProgressInput"), null);
  assert.equal(document.getElementById("suggestProgressBtn"), null);
  assert.equal(document.getElementById("plotProgressFigure").textContent, "4.5%");
  assert.equal(document.getElementById("plotProgressMode").textContent, "Automatic");
  assert.equal(document.getElementById("plotOverrideActive").style.display, "none");
});

test("plot page: a manual figure above the calculated one shows 'Manual', its note, and a 'Switch back to automatic' button that calls clear_plot_override", async () => {
  const plot = { ...PLOT_BASE, progress_pct: 85, progress_calculated: 41.9, progress_override: 85,
    progress_override_note: "Carried over at go-live — site taken over mid-build", progress_override_at: "2026-10-17T11:00:00Z",
    history: [{ action: "carried_over", new_override: 85, calculated: 41.9, note: "Carried over at go-live — site taken over mid-build", changed_at: "2026-10-17T11:00:00Z" }] };
  const { document, window, sb } = await runPlotPage(plot);
  assert.equal(document.getElementById("plotProgressMode").textContent, "Manual");
  assert.match(document.getElementById("plotProgressExplain").textContent, /Calculated from the stages: 41\.9%/);
  assert.match(document.getElementById("plotOverrideActive").textContent, /Carried over at go-live/);
  assert.match(document.getElementById("plotOverrideHistory").textContent, /Carried over at go-live/);
  fireEvent(document.getElementById("clearOverrideBtn"), "click");
  await wait(20);
  const call = sb.calls.find((c) => c.op === "rpc" && c.name === "clear_plot_override");
  assert.deepEqual(plain(call.args), { p_plot_id: "plot1", p_note: "Switched back to automatic" });
});

test("plot page: saving a manual figure requires a note (no call without one) and goes through set_plot_override", async () => {
  const { document, sb } = await runPlotPage({ ...PLOT_BASE, progress_pct: 10, progress_calculated: 10, progress_override: null });
  document.getElementById("plotOverrideInput").value = "60";
  fireEvent(document.getElementById("saveOverrideBtn"), "click");
  await wait(10);
  assert.equal(sb.calls.filter((c) => c.name === "set_plot_override").length, 0);
  assert.match(document.getElementById("errorBox").textContent, /note/);
  document.getElementById("plotOverrideNote").value = "Walked the plot: roof and windows done";
  fireEvent(document.getElementById("saveOverrideBtn"), "click");
  await wait(20);
  const call = sb.calls.find((c) => c.name === "set_plot_override");
  assert.deepEqual(plain(call.args), { p_plot_id: "plot1", p_percent: 60, p_note: "Walked the plot: roof and windows done" });
  assert.equal(sb.calls.filter((c) => c.op === "update" && c.table === "plots").length, 0, "plot % is never written directly");
});

test("plot page: the 33-stage grid shows the source, lets you lower a value and toggle N/A (written to internal_milestones)", async () => {
  const { document, sb } = await runPlotPage({ ...PLOT_BASE, progress_pct: 46.7, progress_calculated: 46.7, progress_override: null });
  const rows = document.querySelectorAll("#milestoneRows tr");
  assert.equal(rows.length, 3);
  assert.match(rows[0].textContent, /Weekly report, 12 Oct 2026/);
  assert.match(rows[2].textContent, /N\/A/);
  assert.equal(document.querySelector('input.milestone-percent[data-milestone-id="m3"]').disabled, true);
  const input = document.querySelector('input.milestone-percent[data-milestone-id="m1"]');
  input.value = "30";
  fireEvent(input, "change");
  await wait(20);
  assert.deepEqual(plain(sb.calls.find((c) => c.op === "update" && c.table === "internal_milestones").payload), { percent: 30 });
  const na = document.querySelector('input.milestone-na[data-milestone-id="m3"]');
  na.checked = false;
  fireEvent(na, "change");
  await wait(20);
  assert.deepEqual(plain(sb.calls.filter((c) => c.op === "update" && c.table === "internal_milestones")[1].payload), { applicable: true });
});

// ─── Site Details ──────────────────────────────────────────────────
const PROJECT_BASE = { id: "p1", name: "Fake Meadows", status: "active", rag_status: "green", baseline_progress_pct: 40, actual_progress_pct: 38.4,
  total_plots: 0, external_works_pct: 20, external_works_share: null, external_works_updated_at: null, created_at: "2026-08-01T00:00:00Z" };
function projectContext(sb) {
  return {
    ...progressHelpers,
    __url: "https://example.com/project.html?id=p1",
    supabase: sb, requireAuth: async () => ({ id: "u-owner" }), renderHeader: () => {}, getParam: () => "p1",
    escapeHtml, formatDate, showError, clearError,
    RAG_LABEL: { green: "Green", amber: "Amber", red: "Red" }, renderProgressBlock: (b, a) => `<span class="pb">${a}</span>`,
    geocodePostcode: async () => null, generateMissingPlots: async () => 0, monthStartISO: () => "2026-10-01",
    getProjectControlSummary: async () => ({ status: { level: "on_track", label: "On Track", reason: "" }, counts: { openActions: 0, overdue: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0 } }),
    getAttentionActions: async () => [], getMemberEmailMap: async () => ({}),
    CONTROL_LEVEL_BADGE: { on_track: "badge-green" }, ACTION_PRIORITY_LABEL: {}, ACTION_PRIORITY_BADGE: {}, ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {}, ACTION_DUE_LABEL: {}, ACTION_DUE_BADGE: {},
    isFindingOutstanding: () => false, categoriseSnag: () => ({ overdue: false }), isSnagOutstanding: () => false,
    getProjectPlotReadiness: async () => [], getMyCommercialRole: async () => null, commercialCapabilities: () => ({ canView: false }),
    getMyToolboxTalkRole: async () => null, toolboxTalkCapabilities: () => ({ canView: false }),
    getModuleRolesCatalog: async () => [], getProjectModuleRoles: async () => [], setProjectModuleRole: async () => {},
    getCommercialOwnerAccessUserIds: async () => new Set(),
  };
}
async function runSiteDetails(project, { packages = [], reports = [], history = [], rpc = {} } = {}) {
  const sb = mockSupabase({
    tables: { external_works_packages: packages, weekly_reports: reports, external_works_updates: history },
    singles: { projects: project },
    rpc: { get_my_role: { data: "owner", error: null }, get_project_members: { data: [], error: null }, ...rpc },
  });
  const r = await runPage(page("project.html"), extractScript(page("project.html")), projectContext(sb));
  await wait(40);
  return { ...r, sb };
}

test("Site Details: no share yet shows 'Share not set' and, with no note for 21+ days, the stale flag; the old Suggest button is gone", async () => {
  const { document } = await runSiteDetails(PROJECT_BASE);
  assert.equal(document.getElementById("suggestExternalWorksBtn"), null);
  assert.ok(document.getElementById("ewShareNotSet"));
  assert.match(document.getElementById("ewStale").textContent, /over 21 days/);
  assert.match(document.getElementById("externalWorksFacts").textContent, /Not set — counts as one plot's worth/);
});

test("Site Details: a recent note clears the stale flag; a set share shows; a complete site is never stale", async () => {
  const recent = new Date(Date.now() - 3 * 86400000).toISOString();
  const { document } = await runSiteDetails({ ...PROJECT_BASE, external_works_share: 15, external_works_updated_at: recent });
  assert.equal(document.getElementById("ewStale"), null);
  assert.equal(document.getElementById("ewShareNotSet"), null);
  assert.match(document.getElementById("externalWorksFacts").textContent, /15%/);
  const done = await runSiteDetails({ ...PROJECT_BASE, status: "complete", external_works_share: 15 });
  assert.equal(done.document.getElementById("ewStale"), null);
});

test("Site Details: packages show their share and %, with report tasks read-only beside the matching package and the rest under unassigned; notes history renders", async () => {
  const packages = [
    { id: "k1", name: "Sewers", share: 40, percent: 100, report_stages: ["Drainage (Below Ground)"], sort_order: 1 },
    { id: "k2", name: "Roads", share: 60, percent: 50, report_stages: ["Groundworks"], sort_order: 2 },
  ];
  const reports = [
    { week_ending: "2026-09-20", progress_items: [
      { plot: "External / Engineering Works", milestone: "Groundworks", text: "Road base", percent: 100 },
      { plot: "External / Engineering Works", milestone: "Drainage (Below Ground)", text: "Sewer connection", percent: 100 },
      { plot: "External / Engineering Works", milestone: "", text: "Fencing", percent: 100 },
      { plot: "Plot 3", milestone: "Groundworks", text: "Not external", percent: 50 },
    ] },
  ];
  const history = [{ kind: "package_added", package_name: "Roads", old_pct: null, new_pct: 50, old_share: null, new_share: 60, note: "Roads package set up", changed_by_email: "aled@example.test", changed_at: "2026-10-01T10:00:00Z" }];
  const { document } = await runSiteDetails({ ...PROJECT_BASE, external_works_pct: 70, external_works_share: 15 }, { packages, reports, history });
  const pk = document.getElementById("externalWorksPackages").textContent;
  assert.match(pk, /Sewers[\s\S]*40%[\s\S]*100%[\s\S]*Sewer connection/);
  assert.match(pk, /Roads[\s\S]*60%[\s\S]*50%[\s\S]*Road base/);
  assert.doesNotMatch(pk, /Not external/);
  assert.match(document.getElementById("externalWorksUnassigned").textContent, /no stage chosen — Fencing/);
  assert.equal(document.getElementById("externalWorksPct").disabled, true, "worked out from packages");
  assert.match(document.getElementById("externalWorksHistory").textContent, /Roads package set up/);
});

test("Site Details: saving the figure/share needs a note, then calls set_external_works; the Site Details form no longer writes external_works_pct", async () => {
  const { document, sb } = await runSiteDetails(PROJECT_BASE);
  document.getElementById("externalWorksShare").value = "15";
  document.getElementById("externalWorksPct").value = "25";
  fireEvent(document.getElementById("saveExternalWorksBtn"), "click");
  await wait(10);
  assert.equal(sb.calls.filter((c) => c.name === "set_external_works").length, 0);
  assert.match(document.getElementById("externalWorksErrorBox").textContent, /note/);
  document.getElementById("externalWorksNote").value = "Sewer connection made";
  fireEvent(document.getElementById("saveExternalWorksBtn"), "click");
  await wait(20);
  assert.deepEqual(plain(sb.calls.find((c) => c.name === "set_external_works").args), { p_project_id: "p1", p_percent: 25, p_share: 15, p_note: "Sewer connection made" });
  // The general edit form no longer carries the figure.
  fireEvent(document.getElementById("editBtn"), "click");
  fireEvent(document.getElementById("editForm"), "submit");
  await wait(20);
  const upd = sb.calls.find((c) => c.op === "update" && c.table === "projects");
  assert.ok(upd && !("external_works_pct" in upd.payload) && !("actual_progress_pct" in upd.payload));
});

test("Site Details: adding a package sends its name, share, %, chosen report stages and note", async () => {
  const { document, sb } = await runSiteDetails(PROJECT_BASE);
  document.getElementById("packageName").value = "Services";
  document.getElementById("packageShare").value = "25";
  document.getElementById("packagePct").value = "10";
  document.querySelector('.pkg-stage[value="Drainage (Below Ground)"]').checked = true;
  document.getElementById("packageNote").value = "Services package agreed";
  fireEvent(document.getElementById("savePackageBtn"), "click");
  await wait(20);
  assert.deepEqual(plain(sb.calls.find((c) => c.name === "save_external_works_package").args), {
    p_project_id: "p1", p_package_id: null, p_name: "Services", p_share: 25, p_percent: 10,
    p_report_stages: ["Drainage (Below Ground)"], p_note: "Services package agreed",
  });
});

// ─── Dashboard ─────────────────────────────────────────────────────
function dashboardContext(sb) {
  return {
    ...progressHelpers,
    supabase: sb, requireAuth: async () => ({ id: "u-owner" }), renderHeader: () => {}, escapeHtml, formatDate, showError, clearError,
    RAG_LABEL: { green: "Green" }, renderProgressBlock: (b, a) => `<span class="pb">${a}%</span>`,
    ensureOrganisation: async () => "org1",
    getPortfolioControlSummary: async () => ({ projectsRequiringAttention: 0, totals: { openActions: 0, overdue: 0, dueToday: 0, blocked: 0, highCritical: 0, overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0 }, projects: [] }),
    getAttentionActions: async () => [], getMemberEmailMap: async () => ({}),
    CONTROL_LEVEL_BADGE: {}, ACTION_PRIORITY_LABEL: {}, ACTION_PRIORITY_BADGE: {}, ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {}, ACTION_DUE_LABEL: {}, ACTION_DUE_BADGE: {},
    isSnagOutstanding: () => false,
  };
}

test("dashboard: site tiles keep the stored site % and flag 'share not set' and stale external works", async () => {
  const recent = new Date(Date.now() - 86400000).toISOString();
  const projects = [
    { ...PROJECT_BASE, id: "p1", name: "Fake Meadows", actual_progress_pct: 94.5 },
    { ...PROJECT_BASE, id: "p2", name: "Fake Orchard", actual_progress_pct: 3, external_works_share: 15, external_works_updated_at: recent },
  ];
  const sb = mockSupabase({ tables: { projects } });
  const { document } = await runPage(page("dashboard.html"), extractScript(page("dashboard.html")), dashboardContext(sb));
  await wait(40);
  const tiles = [...document.querySelectorAll("a.tile")];
  assert.equal(tiles.length, 2);
  assert.match(tiles[0].textContent, /94\.5%/);
  assert.match(tiles[0].textContent, /External works share not set/);
  assert.match(tiles[0].textContent, /not updated for 21\+ days/);
  assert.doesNotMatch(tiles[1].textContent, /share not set|not updated/);
});

test("dashboard: a share typed when creating a site is saved through set_external_works with 'Set at site setup'", async () => {
  const sb = mockSupabase({ tables: { projects: [] } });
  const { document, window } = await runPage(page("dashboard.html"), extractScript(page("dashboard.html")), dashboardContext(sb));
  await wait(30);
  document.getElementById("name").value = "Fake Fields";
  document.getElementById("externalWorksShare").value = "12";
  fireEvent(document.getElementById("projectForm"), "submit");
  await wait(30);
  const ins = sb.calls.find((c) => c.op === "insert" && c.table === "projects");
  assert.ok(ins && !("external_works_share" in ins.payload));
  assert.deepEqual(plain(sb.calls.find((c) => c.name === "set_external_works").args), { p_project_id: "new-projects", p_percent: 0, p_share: 12, p_note: "Set at site setup" });
});

// ─── Block page ────────────────────────────────────────────────────
test("block page: the Suggest button is gone; the block % is still typed and saved, with no browser-side site recalculation", async () => {
  const block = { id: "b1", project_id: "p1", block_name: "Flats 14-19", progress_pct: 30, projects: { id: "p1", name: "Fake Meadows" } };
  const sb = mockSupabase({ singles: { blocks: block }, tables: { plots: [], quality_gates: [], handover_documents: [] } });
  const ctx = {
    supabase: sb, requireAuth: async () => ({ id: "u-owner" }), renderHeader: () => {}, getParam: () => "b1",
    escapeHtml, formatDate, showError, clearError, uploadImage: async () => "",
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }), generateFlatsFromSpec: () => [],
  };
  const { document } = await runPage(page("block-detail.html"), extractScript(page("block-detail.html")), ctx);
  await wait(30);
  assert.equal(document.getElementById("suggestProgressBtn"), null);
  assert.equal(document.getElementById("blockProgressInput").value, "30");
  document.getElementById("blockProgressInput").value = "45";
  fireEvent(document.getElementById("saveProgressBtn"), "click");
  await wait(20);
  assert.deepEqual(plain(sb.calls.find((c) => c.op === "update" && c.table === "blocks").payload), { progress_pct: 45 });
  assert.equal(sb.calls.filter((c) => c.table === "projects" && c.op === "update").length, 0);
  assert.match(document.getElementById("progressSavedHint").textContent, /Saved/);
});

// ─── Weekly report ─────────────────────────────────────────────────
test("weekly report form: the progress section explains the raise-only stage feed, and the stage dropdown is the shared 33-stage list", () => {
  const html = fs.readFileSync(page("weekly-report-form.html"), "utf8");
  assert.match(html, /id="stageFeedHint"[^>]*>[^<]*only ever raises a stage, never lowers it/);
  assert.equal(progressHelpers.BUILD_MILESTONES.length, 33);
  assert.match(APP_JS, /export const BUILD_MILESTONES = PROGRESS_STAGES\.map\(\(s\) => s\.name\);/);
});

// The real syncGateStatusFromMilestones() from app.js.
const GATE_MILESTONES = extractConst("GATE_MILESTONES");
const syncSrc = APP_JS.slice(APP_JS.indexOf("export async function syncGateStatusFromMilestones("), APP_JS.indexOf("\n}\n", APP_JS.indexOf("export async function syncGateStatusFromMilestones(")) + 3).replace(/^export /, "");
const makeSync = (supabase) => new Function("supabase", "resolvePlotTags", "BUILD_MILESTONES", "GATE_MILESTONES", `${syncSrc}\nreturn syncGateStatusFromMilestones;`)(
  supabase, progressHelpers.resolvePlotTags, progressHelpers.BUILD_MILESTONES, GATE_MILESTONES);

test("weekly report save: quality gates use the same range-aware parser — '22-24' moves every plot's gate in range to Under Review, never further; block names and External move none", async () => {
  const sub = GATE_MILESTONES.substructure_drainage.map((m) => ({ plot: "22-24", milestone: m, percent: 100 }));
  const items = [...sub, { plot: "Flats 14-19", milestone: "Groundworks", percent: 100 }, { plot: "External / Engineering Works", milestone: "Groundworks", percent: 100 }];
  const plots = [{ id: "a", plot_number: "Plot 22" }, { id: "b", plot_number: "Plot 23" }, { id: "c", plot_number: "Plot 24" }, { id: "d", plot_number: "Plot 25" }];
  const gates = [
    { id: "g-a", plot_id: "a", gate_key: "substructure_drainage", status: "not_started" },
    { id: "g-b", plot_id: "b", gate_key: "substructure_drainage", status: "in_progress" },
    { id: "g-c", plot_id: "c", gate_key: "substructure_drainage", status: "approved" },
    { id: "g-d", plot_id: "d", gate_key: "substructure_drainage", status: "not_started" },
  ];
  const sb = mockSupabase({ tables: { plots, blocks: [{ block_name: "Flats 14-19" }], weekly_reports: [{ progress_items: items }], quality_gates: gates } });
  const n = await makeSync(sb)("p1", items);
  assert.equal(n, 2, "plots 22 and 23 advance; 24 is already approved and is left alone; 25 is outside the range");
  const upd = sb.calls.find((c) => c.op === "update" && c.table === "quality_gates");
  assert.deepEqual(plain(upd.payload), { status: "under_review" });
});

test("weekly report save: a block-name or External tag alone advances no gate", async () => {
  const items = GATE_MILESTONES.substructure_drainage.map((m) => ({ plot: "Flats 14-19", milestone: m, percent: 100 }));
  const sb = mockSupabase({ tables: { plots: [{ id: "a", plot_number: "Plot 14" }], blocks: [{ block_name: "Flats 14-19" }], weekly_reports: [{ progress_items: items }], quality_gates: [{ id: "g", plot_id: "a", gate_key: "substructure_drainage", status: "not_started" }] } });
  assert.equal(await makeSync(sb)("p1", items), 0);
  assert.equal(sb.calls.filter((c) => c.op === "update").length, 0);
});

test("plotProgressMode / externalWorksStale helpers", () => {
  const { plotProgressMode, externalWorksStale } = progressHelpers;
  assert.equal(plotProgressMode({ progress_override: null, progress_calculated: 10 }), "auto");
  assert.equal(plotProgressMode({ progress_override: 50, progress_calculated: 10 }), "manual");
  assert.equal(plotProgressMode({ progress_override: 50, progress_calculated: 50 }), "auto");
  const now = new Date("2026-10-17T12:00:00Z");
  assert.equal(externalWorksStale({ status: "active", external_works_updated_at: "2026-09-25T12:00:00Z" }, now), true, "22 days");
  assert.equal(externalWorksStale({ status: "active", external_works_updated_at: "2026-09-27T12:00:00Z" }, now), false, "20 days");
  assert.equal(externalWorksStale({ status: "active", external_works_updated_at: null, created_at: "2026-10-10T00:00:00Z" }, now), false, "falls back to created_at");
  assert.equal(externalWorksStale({ status: "complete", external_works_updated_at: null, created_at: "2025-01-01" }, now), false);
});
