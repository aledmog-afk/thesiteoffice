// v77: "Move to Plot" — snag-list-edit.html's real inline script under
// jsdom, same conventions as snag_bulk_assign.test.mjs (same page, same
// mock shape). moveSnagItemsToPlot() itself is already proven against a
// real database with real RLS and real item renumbering in
// tests/database/v77_move_snag_items_to_plot.test.mjs — mocked here so
// this file can focus purely on what the PAGE does: when the button
// shows, what target plots it offers, and that it calls the RPC with
// every item currently in the list plus the chosen target.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/snag-list-edit.html", import.meta.url).pathname;

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const SNAG_PRIORITIES = extractConst("SNAG_PRIORITIES");
const SNAG_PRIORITY_LABEL = extractConst("SNAG_PRIORITY_LABEL");
const SNAG_PRIORITY_BADGE = extractConst("SNAG_PRIORITY_BADGE");
const SNAG_STATUS_LABEL = extractConst("SNAG_STATUS_LABEL");
const SNAG_STATUS_BADGE = extractConst("SNAG_STATUS_BADGE");
const SNAG_ROOMS = extractConst("SNAG_ROOMS");
const SNAG_TRADES = extractConst("SNAG_TRADES");

function makeStore({ snagList, snags = [], plots = [] }) {
  return { snagList, snags, plots, moveCalls: [] };
}

function makeSupabase(store) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async (name) => {
      if (name === "get_project_members") return { data: [], error: null };
      if (name === "get_my_role") return { data: "owner", error: null };
      if (name === "get_project_parties") return { data: null, error: { code: "PGRST202", message: "Could not find the function" } };
      return { data: null, error: null };
    },
    from(table) {
      const api = {
        select() { return api; },
        eq(col, val) { api._eq = { ...api._eq, [col]: val }; return api; },
        neq(col, val) { api._neq = val; return api; },
        order() { return api; },
        in() { return api; },
        single: async () => {
          if (table === "snag_lists") {
            // Used both for the page's own list load (by id) and for
            // the post-move "which list does the target plot land on"
            // lookup (by plot_id).
            if (api._eq?.plot_id) {
              const target = store.plots.find((p) => p.id === api._eq.plot_id);
              return { data: target ? { id: `list-${target.id}` } : null, error: null };
            }
            return { data: store.snagList, error: null };
          }
          return { data: null, error: null };
        },
        then(resolve) {
          if (table === "snag_items") return resolve({ data: store.snags, error: null });
          if (table === "plots") {
            const list = store.plots.filter((p) => p.id !== api._neq);
            return resolve({ data: list, error: null });
          }
          resolve({ data: [], error: null });
        },
        update(payload) { store.updated = payload; return { eq: async () => ({ error: null }) }; },
        insert: async (payload) => { store.inserted = payload; return { error: null }; },
        delete() { return api; },
      };
      return api;
    },
  };
}

async function run(store, overrides = {}) {
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/snag-list-edit.html?id=list1",
    supabase: makeSupabase(store),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "list1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = err?.message || String(err); },
    clearError: (el) => { el.textContent = ""; },
    uploadImage: async () => "",
    todayISO: () => "2026-01-01",
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }),
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_PRIORITY_BADGE, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE, SNAG_ROOMS, SNAG_TRADES,
    categoriseSnag: () => ({ overdue: false, dueToday: false, dueSoon: false, highPriority: false }),
    assignSnag: async () => {}, verifySnag: async () => {}, unverifySnag: async () => {},
    completeSnagWithPhoto: async () => {}, closeSnagWithEvidence: async () => {},
    submitSnagForReview: async () => {}, approveSnagReview: async () => {}, rejectSnagReview: async () => {},
    getSnagPhotos: async () => [], addSnagPhoto: async () => ({}), deleteSnagPhoto: async () => {},
    getSnagCompletionPhotoCounts: async () => ({}),
    createActionFromSnag: async () => ({}),
    ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {},
    saveFileToDevice: async () => ({ method: "share", status: "saved" }),
    deviceSavePhotoFilename: () => "",
    deviceSaveStatusLabel: () => "",
    alert: () => {},
    confirm: overrides.confirm !== undefined ? overrides.confirm : (() => true),
    prompt: () => "",
    moveSnagItemsToPlot: overrides.moveSnagItemsToPlot || (async (ids, plotId) => { store.moveCalls.push({ ids, plotId }); return ids.length; }),
  });
}

function plotSpecificList() {
  return { id: "list1", project_id: "p1", plot_id: "plotA", title: "Plot 5", projects: { id: "p1", name: "Test Site" }, plots: { id: "plotA", plot_number: "5" } };
}
function generalList() {
  return { id: "list1", project_id: "p1", plot_id: null, title: "Site Walk", projects: { id: "p1", name: "Test Site" }, plots: null };
}
function sampleSnags() {
  return [
    { id: "s1", item_no: 1, location: "Kitchen", description: "Wrong plot", priority: "high", status: "open", plot_id: null },
    { id: "s2", item_no: 2, location: "Bathroom", description: "Also wrong", priority: "medium", status: "open", plot_id: null },
  ];
}
function otherPlots() {
  return [{ id: "plotA", plot_number: "5" }, { id: "plotB", plot_number: "6" }, { id: "plotC", plot_number: "7" }];
}

test("Move to Plot: hidden entirely on a General (not plot-specific) list", async () => {
  const store = makeStore({ snagList: generalList(), snags: sampleSnags(), plots: otherPlots() });
  const { document } = await run(store);
  await wait(30);

  assert.equal(document.getElementById("moveToPlotBtn").style.display, "none");
});

test("Move to Plot: hidden when this is the only plot in the project (nowhere to move items to)", async () => {
  const store = makeStore({ snagList: plotSpecificList(), snags: sampleSnags(), plots: [{ id: "plotA", plot_number: "5" }] });
  const { document } = await run(store);
  await wait(30);

  assert.equal(document.getElementById("moveToPlotBtn").style.display, "none");
});

test("Move to Plot: shown on a plot-specific list, offering every OTHER plot but not this one", async () => {
  const store = makeStore({ snagList: plotSpecificList(), snags: sampleSnags(), plots: otherPlots() });
  const { document } = await run(store);
  await wait(30);

  assert.equal(document.getElementById("moveToPlotBtn").style.display, "inline-block");
  const options = [...document.getElementById("movePlotSelect").options].map((o) => o.value);
  assert.deepEqual(options.sort(), ["plotB", "plotC"], "the current plot (plotA) must not be offered as a move target");
});

test("Move to Plot: confirming moves every item currently in the list to the chosen plot", async () => {
  const store = makeStore({ snagList: plotSpecificList(), snags: sampleSnags(), plots: otherPlots() });
  const { document } = await run(store);
  await wait(30);

  document.getElementById("moveToPlotBtn").click();
  document.getElementById("movePlotSelect").value = "plotB";
  document.getElementById("movePlotConfirmBtn").click();
  await wait(30);

  assert.equal(store.moveCalls.length, 1);
  assert.deepEqual(store.moveCalls[0].ids.sort(), ["s1", "s2"]);
  assert.equal(store.moveCalls[0].plotId, "plotB");
});

test("Move to Plot: cancelling the confirm() dialog moves nothing", async () => {
  const store = makeStore({ snagList: plotSpecificList(), snags: sampleSnags(), plots: otherPlots() });
  const { document } = await run(store, { confirm: () => false });
  await wait(30);

  document.getElementById("moveToPlotBtn").click();
  document.getElementById("movePlotSelect").value = "plotB";
  document.getElementById("movePlotConfirmBtn").click();
  await wait(30);

  assert.equal(store.moveCalls.length, 0);
});

test("Move to Plot: a failed move shows the real error and re-enables the button, without pretending success", async () => {
  const store = makeStore({ snagList: plotSpecificList(), snags: sampleSnags(), plots: otherPlots() });
  const { document } = await run(store, { moveSnagItemsToPlot: async () => { throw new Error("network blip"); } });
  await wait(30);

  document.getElementById("moveToPlotBtn").click();
  document.getElementById("movePlotSelect").value = "plotB";
  const btn = document.getElementById("movePlotConfirmBtn");
  btn.click();
  await wait(30);

  assert.match(document.getElementById("errorBox").textContent, /network blip/);
  assert.equal(btn.disabled, false);
});
