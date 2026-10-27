// v78: the Room dropdown on a snag's Location field — snag-list-edit.html's
// real inline script under jsdom, same conventions as
// snag_bulk_assign.test.mjs. location itself is still a plain text
// column (no schema change), so what's worth proving here is purely
// the page's own behaviour: the dropdown is populated, "Other" reveals
// a free-text box and that's what actually gets saved, and editing an
// existing snag correctly tells apart a real room from legacy/free
// text that predates this dropdown.
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

function makeStore(snags = []) {
  return {
    snagList: { id: "list1", project_id: "p1", plot_id: "plotA", title: "Snag List", projects: { id: "p1", name: "Test Site" }, plots: { id: "plotA", plot_number: "5" } },
    snags,
    inserted: null,
    updated: null,
  };
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
        eq() { return api; },
        neq() { return api; },
        order() { return api; },
        in() { return api; },
        single: async () => (table === "snag_lists" ? { data: store.snagList, error: null } : { data: null, error: null }),
        then(resolve) {
          if (table === "snag_items") return resolve({ data: store.snags, error: null });
          resolve({ data: [], error: null });
        },
        update(payload) { store.updated = payload; return { eq: async () => ({ error: null }) }; },
        insert: (payload) => { store.inserted = payload; return { select: () => ({ single: async () => ({ data: { id: "new1", item_no: store.snags.length + 1, ...payload }, error: null }) }) }; },
        delete() { return api; },
      };
      return api;
    },
  };
}

async function run(store) {
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
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_PRIORITY_BADGE, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE, SNAG_ROOMS,
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
    alert: () => {}, confirm: () => true, prompt: () => "",
    moveSnagItemsToPlot: async () => 0,
  });
}

test("the Room dropdown is populated with every SNAG_ROOMS option, including Other", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  const values = [...document.getElementById("location").options].map((o) => o.value);
  for (const room of SNAG_ROOMS) assert.ok(values.includes(room), `${room} missing from the dropdown`);
  assert.ok(values.includes(""), "a blank 'choose a room' option must exist so nothing is silently pre-selected");
});

test("the Other text box is hidden until Other is chosen, then required", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  const location = document.getElementById("location");
  const other = document.getElementById("locationOther");
  assert.equal(other.style.display, "none");

  location.value = "Kitchen";
  fireEvent(location, "change");
  assert.equal(other.style.display, "none", "a real room must not reveal the free-text box");

  location.value = "Other";
  fireEvent(location, "change");
  assert.equal(other.style.display, "block");
  assert.equal(other.required, true);
});

test("picking a real room saves that room's name; picking Other saves the typed text instead", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  document.getElementById("location").value = "Bedroom 2";
  fireEvent(document.getElementById("location"), "change");
  document.getElementById("description").value = "Paint touch-up";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);
  assert.equal(store.inserted.location, "Bedroom 2");

  document.getElementById("newSnagBtn").click();
  document.getElementById("location").value = "Other";
  fireEvent(document.getElementById("location"), "change");
  document.getElementById("locationOther").value = "Loft hatch";
  document.getElementById("description").value = "Hatch won't close";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);
  assert.equal(store.inserted.location, "Loft hatch", "Other's own free-text value is what gets saved, not the word 'Other'");
});

test("editing an existing snag whose room matches the list pre-selects it, with the free-text box hidden", async () => {
  const snags = [{ id: "s1", item_no: 1, location: "Bathroom", description: "Grout", priority: "medium", status: "open", plot_id: null }];
  const store = makeStore(snags);
  const { document, window } = await run(store);
  await wait(30);

  // editSnag() is the window-exposed handler the row's real "Edit"
  // button calls (onclick="editSnag('...')", this app's established
  // row-action convention — jsdom's runScripts:"outside-only" never
  // wires inline attribute handlers up, only real page code does in a
  // browser, same limitation every other snag test file works around
  // by calling the window-exposed function directly instead).
  window.editSnag("s1");
  await wait(20);

  assert.equal(document.getElementById("location").value, "Bathroom");
  assert.equal(document.getElementById("locationOther").style.display, "none");
});

test("editing an existing snag whose location predates the dropdown (no exact match) pre-selects Other, with the real text shown", async () => {
  const snags = [{ id: "s1", item_no: 1, location: "FF electric riser cupboard", description: "Loose panel", priority: "medium", status: "open", plot_id: null }];
  const store = makeStore(snags);
  const { document, window } = await run(store);
  await wait(30);

  window.editSnag("s1");
  await wait(20);

  assert.equal(document.getElementById("location").value, "Other");
  assert.equal(document.getElementById("locationOther").style.display, "block");
  assert.equal(document.getElementById("locationOther").value, "FF electric riser cupboard");
});
