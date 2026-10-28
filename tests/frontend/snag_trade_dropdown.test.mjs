// v79: the Trade dropdown on a snag's "Trade responsible" field —
// snag-list-edit.html's real inline script under jsdom, same
// conventions as snag_room_dropdown.test.mjs. trade itself is still a
// plain text column (no schema change), and stays optional (unlike
// Location) — so what's worth proving here is purely the page's own
// behaviour: the dropdown is populated, trade can still be left blank,
// "Other" reveals a free-text box and that's what actually gets
// saved, and editing an existing snag correctly tells apart a real
// trade from legacy/free text that predates this dropdown.
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
    alert: () => {}, confirm: () => true, prompt: () => "",
    moveSnagItemsToPlot: async () => 0,
  });
}

test("the Trade dropdown is populated with every SNAG_TRADES option, including a blank 'unspecified' choice and Other", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  const values = [...document.getElementById("trade").options].map((o) => o.value);
  for (const trade of SNAG_TRADES) assert.ok(values.includes(trade), `${trade} missing from the dropdown`);
  assert.ok(values.includes(""), "a blank 'choose a trade' option must exist — trade stays optional");
});

test("the Other text box is hidden until Other is chosen, then required", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  const trade = document.getElementById("trade");
  const other = document.getElementById("tradeOther");
  assert.equal(other.style.display, "none");

  trade.value = "Plumber";
  fireEvent(trade, "change");
  assert.equal(other.style.display, "none", "a real trade must not reveal the free-text box");

  trade.value = "Other";
  fireEvent(trade, "change");
  assert.equal(other.style.display, "block");
  assert.equal(other.required, true);
});

test("leaving the trade dropdown blank saves no trade at all", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  document.getElementById("location").value = "Kitchen";
  fireEvent(document.getElementById("location"), "change");
  document.getElementById("description").value = "Loose tile";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);
  assert.equal(store.inserted.trade, null, "trade stays optional — no selection means null, not an empty string");
});

test("picking a real trade saves that trade's name; picking Other saves the typed text instead", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  document.getElementById("location").value = "Kitchen";
  fireEvent(document.getElementById("location"), "change");
  document.getElementById("trade").value = "Electrician";
  fireEvent(document.getElementById("trade"), "change");
  document.getElementById("description").value = "Socket not working";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);
  assert.equal(store.inserted.trade, "Electrician");

  document.getElementById("newSnagBtn").click();
  document.getElementById("location").value = "Kitchen";
  fireEvent(document.getElementById("location"), "change");
  document.getElementById("trade").value = "Other";
  fireEvent(document.getElementById("trade"), "change");
  document.getElementById("tradeOther").value = "Glazier";
  document.getElementById("description").value = "Cracked window pane";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);
  assert.equal(store.inserted.trade, "Glazier", "Other's own free-text value is what gets saved, not the word 'Other'");
});

test("editing an existing snag whose trade matches the list pre-selects it, with the free-text box hidden", async () => {
  const snags = [{ id: "s1", item_no: 1, location: "Roof", description: "Loose tile", priority: "medium", status: "open", trade: "Roofer", plot_id: null }];
  const store = makeStore(snags);
  const { document, window } = await run(store);
  await wait(30);

  // editSnag() is the window-exposed handler the row's real "Edit"
  // button calls — same convention as every other snag test file.
  window.editSnag("s1");
  await wait(20);

  assert.equal(document.getElementById("trade").value, "Roofer");
  assert.equal(document.getElementById("tradeOther").style.display, "none");
});

test("editing an existing snag whose trade predates the dropdown (no exact match) pre-selects Other, with the real text shown", async () => {
  const snags = [{ id: "s1", item_no: 1, location: "Kitchen", description: "Worktop gap", priority: "medium", status: "open", trade: "Kitchen fitter", plot_id: null }];
  const store = makeStore(snags);
  const { document, window } = await run(store);
  await wait(30);

  window.editSnag("s1");
  await wait(20);

  assert.equal(document.getElementById("trade").value, "Other");
  assert.equal(document.getElementById("tradeOther").style.display, "block");
  assert.equal(document.getElementById("tradeOther").value, "Kitchen fitter");
});

test("editing an existing snag with no trade specified leaves the blank option selected, not Other", async () => {
  const snags = [{ id: "s1", item_no: 1, location: "Kitchen", description: "Worktop gap", priority: "medium", status: "open", trade: null, plot_id: null }];
  const store = makeStore(snags);
  const { document, window } = await run(store);
  await wait(30);

  window.editSnag("s1");
  await wait(20);

  assert.equal(document.getElementById("trade").value, "");
  assert.equal(document.getElementById("tradeOther").style.display, "none");
});
