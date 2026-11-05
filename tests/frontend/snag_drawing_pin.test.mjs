// v87/v89: snag-list-edit.html's "Drawing Pin" section — placing a pin
// on a drawing when raising OR editing a snag. app.js's own
// drawing_pins helpers (getProjectDrawings, getSnagDrawingPin,
// getDrawing, createDrawingPin) are already proven against a real
// database with real RLS in tests/database/v74_drawing_pins.test.mjs —
// mocked here so this file can focus purely on what the PAGE does:
// which drawing(s) it offers by default (plot-list vs general-list,
// with or without the item's own plot tag), that tapping + Save Pin
// calls createDrawingPin with the right snag id and coordinates on
// Edit, that a brand-new item's tap only STAGES a pin (v89 — no
// snag_items.id exists yet for the FK) and is only turned into a real
// pin once the new item is actually saved, and that an already-pinned
// snag shows read-only status rather than a second picker (v74 has no
// "move a pin" policy).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

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
const DRAWING_STOREYS = extractConst("DRAWING_STOREYS");

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
        neq() { return api; },
        order() { return api; },
        in() { return api; },
        // v89: snagForm's submit on a brand-new item does
        // .insert(payload).select("id").single() to get the new row's
        // id back (needed for the deferred pin's FK) — mirrors the
        // exact chain snag_room_dropdown.test.mjs's own mock uses.
        insert(payload) {
          store.inserted = payload;
          return { select: () => ({ single: async () => ({ data: { id: store.newSnagId || "newsnag1" }, error: null }) }) };
        },
        single: async () => (table === "snag_lists" ? { data: store.snagList, error: null } : { data: null, error: null }),
        then(resolve) {
          if (table === "snag_items") return resolve({ data: store.snags, error: null });
          if (table === "plots") return resolve({ data: [], error: null });
          resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
}

function plotSpecificList(plotId = "plotA") {
  return { id: "list1", project_id: "p1", plot_id: plotId, title: "Plot 5", projects: { id: "p1", name: "Test Site" }, plots: { id: plotId, plot_number: "5" } };
}
function generalList() {
  return { id: "list1", project_id: "p1", plot_id: null, title: "Site Walk", projects: { id: "p1", name: "Test Site" }, plots: null };
}

function drawing({ id, scope, plotId = null, storey = null, title, hasPage = true }) {
  return { id, scope, plot_id: plotId, block_id: null, storey, title, current_page: hasPage ? { id: `page-${id}`, image_url: `path/to/${id}.jpg` } : null };
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
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_PRIORITY_BADGE, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE, SNAG_ROOMS, SNAG_TRADES, DRAWING_STOREYS,
    categoriseSnag: () => ({ overdue: false, dueToday: false, dueSoon: false, highPriority: false }),
    assignSnag: async () => {}, verifySnag: async () => {}, unverifySnag: async () => {},
    completeSnagWithPhoto: async () => {}, closeSnagWithEvidence: async () => {},
    submitSnagForReview: async () => {}, approveSnagReview: async () => {}, rejectSnagReview: async () => {},
    getSnagPhotos: async () => [], addSnagPhoto: async () => ({}), deleteSnagPhoto: async () => {},
    getSnagCompletionPhotoCounts: async () => ({}),
    createActionFromSnag: async () => ({}),
    ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {},
    saveFileToDevice: async () => ({ method: "share", status: "saved" }),
    deviceSavePhotoFilename: () => "", deviceSaveStatusLabel: () => "",
    alert: overrides.alert || (() => {}), confirm: () => true, prompt: () => "",
    moveSnagItemsToPlot: async () => {},
    getProjectDrawings: overrides.getProjectDrawings || (async () => []),
    getSnagDrawingPin: overrides.getSnagDrawingPin || (async () => null),
    getDrawing: overrides.getDrawing || (async () => null),
    createDrawingPin: overrides.createDrawingPin || (async () => "pin1"),
  });
}

test("Drawing Pin: v89 — shown while adding a brand-new item too, when pinnable drawings exist; Save Pin is hidden since the pin saves together with the item", async () => {
  const store = { snagList: plotSpecificList(), snags: [] };
  const { document } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" })],
  });
  await wait(30);
  document.getElementById("newSnagBtn").click();
  await wait(10);

  assert.equal(document.getElementById("pinWrap").style.display, "block");
  assert.equal(document.getElementById("pinPicker").style.display, "block");
  assert.equal(document.getElementById("noDrawingsHint").style.display, "none");
  assert.equal(document.getElementById("savePinBtn").style.display, "none", "Save Pin has no role while adding — the tap is staged and saved together with the new item");
  const options = [...document.getElementById("pinDrawingSelect").options];
  assert.equal(options.length, 1);
  assert.equal(options[0].value, "dGF");
});

test("Drawing Pin: v89 — adding a brand-new item with no pinnable drawings at all shows the same graceful hint as editing", async () => {
  const store = { snagList: plotSpecificList(), snags: [] };
  const { document } = await run(store, { getProjectDrawings: async () => [] });
  await wait(30);
  document.getElementById("newSnagBtn").click();
  await wait(10);

  assert.equal(document.getElementById("noDrawingsHint").style.display, "block");
  assert.equal(document.getElementById("pinPicker").style.display, "none");
});

test("Drawing Pin: v89 — tapping while adding only stages the pin; createDrawingPin is never called until the item is actually saved", async () => {
  const store = { snagList: plotSpecificList(), snags: [] };
  const calls = [];
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" })],
    createDrawingPin: async (...args) => { calls.push(args); return "newpin"; },
  });
  await wait(30);
  document.getElementById("newSnagBtn").click();
  await wait(10);

  const img = document.getElementById("pinCanvasImg");
  img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
  document.getElementById("pinCanvas").dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 100, clientY: 25 }));
  await wait(10);

  assert.equal(calls.length, 0, "a tap while adding must never call createDrawingPin directly");
});

test("Drawing Pin: v89 — saving a brand-new item with a staged pin creates it afterward, using the new snag's real id and the selected drawing", async () => {
  const store = { snagList: plotSpecificList(), snags: [], newSnagId: "newsnag1" };
  const calls = [];
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" })],
    createDrawingPin: async (pageId, x, y, owner, drawingId) => { calls.push({ pageId, x, y, owner, drawingId }); return "newpin"; },
  });
  await wait(30);
  document.getElementById("newSnagBtn").click();
  await wait(10);

  const img = document.getElementById("pinCanvasImg");
  img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
  document.getElementById("pinCanvas").dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 100, clientY: 25 }));
  await wait(10);

  document.getElementById("location").value = "Kitchen";
  document.getElementById("description").value = "Crack in wall";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);

  assert.equal(calls.length, 1, "createDrawingPin must fire exactly once, after the snag was created");
  assert.equal(calls[0].pageId, "page-dGF");
  assert.equal(calls[0].owner.snagItemId, "newsnag1", "must use the id the insert actually returned, not a stale/empty editingId");
  assert.equal(calls[0].drawingId, "dGF");
  assert.equal(calls[0].x, 50, "100/200 width = 50%");
  assert.equal(calls[0].y, 25, "25/100 height = 25%");
});

test("Drawing Pin: v89 — saving a brand-new item with nothing tapped never calls createDrawingPin at all", async () => {
  const store = { snagList: plotSpecificList(), snags: [], newSnagId: "newsnag2" };
  const calls = [];
  const { document } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" })],
    createDrawingPin: async (...args) => { calls.push(args); return "newpin"; },
  });
  await wait(30);
  document.getElementById("newSnagBtn").click();
  await wait(10);

  document.getElementById("location").value = "Kitchen";
  document.getElementById("description").value = "No pin on this one";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);

  assert.equal(calls.length, 0, "no tap, no pin — createDrawingPin must not be called just because drawings exist");
});

test("Drawing Pin: v89 — a pin failure after a successful add is reported but never blocks the snag from being saved", async () => {
  const store = { snagList: plotSpecificList(), snags: [], newSnagId: "newsnag3" };
  const alerts = [];
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" })],
    createDrawingPin: async () => { throw new Error("permission denied for table drawing_pins"); },
    alert: (msg) => alerts.push(msg),
  });
  await wait(30);
  document.getElementById("newSnagBtn").click();
  await wait(10);

  const img = document.getElementById("pinCanvasImg");
  img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
  document.getElementById("pinCanvas").dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 100, clientY: 25 }));
  await wait(10);

  document.getElementById("location").value = "Kitchen";
  document.getElementById("description").value = "Crack in wall";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);

  assert.equal(document.getElementById("errorBox").textContent, "", "the primary save succeeded — showError must not fire for a pin-only failure");
  assert.equal(alerts.length, 1, "the pin failure must still be surfaced, just not as a blocking form error");
  assert.match(alerts[0], /pin couldn't be placed/);
  assert.equal(document.getElementById("snagCard").style.display, "none", "the form must still close — the snag itself was saved successfully");
});

test("Drawing Pin: a plot-specific list with exactly one storey drawing auto-selects it", async () => {
  const snag = { id: "s1", item_no: 1, location: "Kitchen", description: "Crack in wall", priority: "medium", status: "open" };
  const store = { snagList: plotSpecificList(), snags: [snag] };
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" })],
  });
  await wait(30);
  await window.editSnag("s1");
  await wait(30);

  assert.equal(document.getElementById("pinWrap").style.display, "block");
  assert.equal(document.getElementById("pinPicker").style.display, "block");
  assert.equal(document.getElementById("noDrawingsHint").style.display, "none");
  const options = [...document.getElementById("pinDrawingSelect").options];
  assert.equal(options.length, 1);
  assert.equal(options[0].value, "dGF");
  assert.equal(document.getElementById("pinCanvasImg").src.includes("dGF"), true, "the auto-selected drawing's image must already be showing");
});

test("Drawing Pin: a plot-specific list with multiple storeys offers a storey picker, all under 'This plot'", async () => {
  const snag = { id: "s1", item_no: 1, location: "Kitchen", description: "Crack in wall", priority: "medium", status: "open" };
  const store = { snagList: plotSpecificList(), snags: [snag] };
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [
      drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" }),
      drawing({ id: "dFF", scope: "plot_storey", plotId: "plotA", storey: "FF", title: "Plot 5" }),
      drawing({ id: "dSite", scope: "site", title: "Site Layout" }), // a different plot/scope — must not appear preferred
    ],
  });
  await wait(30);
  await window.editSnag("s1");
  await wait(30);

  const select = document.getElementById("pinDrawingSelect");
  const thisPlotGroup = [...select.querySelectorAll("optgroup")].find((g) => g.label === "This plot");
  assert.ok(thisPlotGroup, "a 'This plot' group must exist");
  assert.deepEqual([...thisPlotGroup.querySelectorAll("option")].map((o) => o.value).sort(), ["dFF", "dGF"]);
  const otherGroup = [...select.querySelectorAll("optgroup")].find((g) => g.label === "Other drawings");
  assert.ok(otherGroup, "the site drawing must still be offered, just not preferred");
  assert.deepEqual([...otherGroup.querySelectorAll("option")].map((o) => o.value), ["dSite"]);
});

test("Drawing Pin: general list, item has its own plot tag — prefers that plot's drawings but still allows choosing another", async () => {
  const snag = { id: "s1", item_no: 1, location: "External", description: "Fence damaged", priority: "medium", status: "open", plot_id: "plotB" };
  const store = { snagList: generalList(), snags: [snag] };
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [
      drawing({ id: "dPlotB", scope: "plot_storey", plotId: "plotB", storey: "GF", title: "Plot 9" }),
      drawing({ id: "dPlotC", scope: "plot_storey", plotId: "plotC", storey: "GF", title: "Plot 10" }),
    ],
  });
  await wait(30);
  await window.editSnag("s1");
  await wait(30);

  const select = document.getElementById("pinDrawingSelect");
  const thisPlotGroup = [...select.querySelectorAll("optgroup")].find((g) => g.label === "This plot");
  assert.deepEqual([...thisPlotGroup.querySelectorAll("option")].map((o) => o.value), ["dPlotB"]);
  const otherGroup = [...select.querySelectorAll("optgroup")].find((g) => g.label === "Other drawings");
  assert.deepEqual([...otherGroup.querySelectorAll("option")].map((o) => o.value), ["dPlotC"], "a different plot's drawing must still be choosable, not hidden");
});

test("Drawing Pin: general list, item has no plot tag at all — shows every current drawing, with no 'This plot' group", async () => {
  const snag = { id: "s1", item_no: 1, location: "External", description: "General site issue", priority: "medium", status: "open", plot_id: null };
  const store = { snagList: generalList(), snags: [snag] };
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dSite", scope: "site", title: "Site Layout" })],
  });
  await wait(30);
  await window.editSnag("s1");
  await wait(30);

  const select = document.getElementById("pinDrawingSelect");
  assert.equal(select.querySelectorAll("optgroup[label='This plot']").length, 0);
  assert.deepEqual([...select.querySelectorAll("option")].map((o) => o.value), ["dSite"]);
});

test("Drawing Pin: no drawings uploaded for the project at all — shows the graceful hint, not an error", async () => {
  const snag = { id: "s1", item_no: 1, location: "Kitchen", description: "Crack in wall", priority: "medium", status: "open" };
  const store = { snagList: plotSpecificList(), snags: [snag] };
  const { document, window } = await run(store, { getProjectDrawings: async () => [] });
  await wait(30);
  await window.editSnag("s1");
  await wait(30);

  assert.equal(document.getElementById("noDrawingsHint").style.display, "block");
  assert.equal(document.getElementById("pinPicker").style.display, "none");
  assert.equal(document.getElementById("errorBox").textContent, "");
});

test("Drawing Pin: tapping the drawing then Save Pin calls createDrawingPin with this snag's id and the tapped coordinates", async () => {
  const snag = { id: "s1", item_no: 1, location: "Kitchen", description: "Crack in wall", priority: "medium", status: "open" };
  const store = { snagList: plotSpecificList(), snags: [snag] };
  const calls = [];
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" })],
    createDrawingPin: async (pageId, x, y, owner, drawingId) => { calls.push({ pageId, x, y, owner, drawingId }); return "newpin"; },
  });
  await wait(30);
  await window.editSnag("s1");
  await wait(30);

  const img = document.getElementById("pinCanvasImg");
  img.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 });
  const saveBtn = document.getElementById("savePinBtn");
  assert.equal(saveBtn.disabled, true, "Save Pin must start disabled — nothing tapped yet");

  document.getElementById("pinCanvas").dispatchEvent(new window.MouseEvent("click", { bubbles: true, clientX: 100, clientY: 25 }));
  await wait(10);
  assert.equal(saveBtn.disabled, false, "a valid tap must enable Save Pin");

  saveBtn.click();
  await wait(30);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].pageId, "page-dGF");
  assert.equal(calls[0].x, 50, "100/200 width = 50%");
  assert.equal(calls[0].y, 25, "25/100 height = 25%");
  assert.equal(calls[0].owner.snagItemId, "s1");
  assert.equal(calls[0].drawingId, "dGF", "the drawing the user actually selected must be passed through, not inferred from the page");
});

test("Drawing Pin: an already-pinned snag shows read-only pinned status, never a second picker", async () => {
  const snag = { id: "s1", item_no: 1, location: "Kitchen", description: "Crack in wall", priority: "medium", status: "open" };
  const store = { snagList: plotSpecificList(), snags: [snag] };
  const { document, window } = await run(store, {
    getProjectDrawings: async () => [drawing({ id: "dGF", scope: "plot_storey", plotId: "plotA", storey: "GF", title: "Plot 5" })],
    getSnagDrawingPin: async (id) => (id === "s1" ? { id: "pinX", x_pct: 50, y_pct: 50, drawing_page_id: "page-dGF", drawing_id: "dGF" } : null),
    getDrawing: async (id) => (id === "dGF" ? { id: "dGF", title: "Plot 5" } : null),
  });
  await wait(30);
  await window.editSnag("s1");
  await wait(30);

  assert.match(document.getElementById("pinStatus").textContent, /Pinned on Plot 5/);
  assert.equal(document.getElementById("pinPicker").style.display, "none", "an already-pinned snag must not offer a new pin picker — v74 has no move/replace policy");
});
