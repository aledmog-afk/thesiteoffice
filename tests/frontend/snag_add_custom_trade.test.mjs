// v80: "+ Add new trade…" on the Trade dropdown — snag-list-edit.html's
// real inline script under jsdom, same conventions as
// snag_trade_dropdown.test.mjs. add_org_custom_trade() itself is already
// proven against a real database in tests/database/v80_org_custom_trades.test.mjs
// — mocked here so this file can focus purely on what the PAGE does:
// prompting, saving, merging the new option into the dropdown so it's
// immediately reusable, and recognising an already-added custom trade
// when editing a later snag.
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

function makeStore(snags = [], { existingCustomTrades = [] } = {}) {
  return {
    snagList: { id: "list1", project_id: "p1", plot_id: "plotA", title: "Snag List", projects: { id: "p1", name: "Test Site", org_id: "org1" }, plots: { id: "plotA", plot_number: "5" } },
    snags,
    customTrades: existingCustomTrades,
    addedTrades: [],
    inserted: null,
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

// Mocked directly (like moveSnagItemsToPlot elsewhere), not via
// supabase.rpc — the real add_org_custom_trade()/getOrgCustomTrades()
// are thin app.js wrappers already proven against a real database in
// tests/database/v80_org_custom_trades.test.mjs; this file only needs
// to prove what the PAGE itself does with them.
function makeDataFns(store) {
  return {
    getOrgCustomTrades: async () => store.customTrades.slice(),
    addOrgCustomTrade: async (orgId, trade) => {
      const trimmed = (trade || "").trim();
      if (!trimmed) return null;
      const existing = store.customTrades.find((t) => t.toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing;
      store.customTrades.push(trimmed);
      store.addedTrades.push(trimmed);
      return trimmed;
    },
  };
}

async function run(store, overrides = {}) {
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/snag-list-edit.html?id=list1",
    supabase: makeSupabase(store),
    ...makeDataFns(store),
    ...(overrides.addOrgCustomTrade ? { addOrgCustomTrade: overrides.addOrgCustomTrade } : {}),
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
    alert: overrides.alert || (() => {}),
    confirm: () => true,
    prompt: overrides.prompt || (() => ""),
    moveSnagItemsToPlot: async () => 0,
  });
}

test("the dropdown offers '+ Add new trade…' after Other", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  const values = [...document.getElementById("trade").options].map((o) => o.value);
  const otherIdx = values.indexOf("Other");
  const addIdx = values.indexOf("__add_trade__");
  assert.ok(otherIdx >= 0 && addIdx === otherIdx + 1, "'+ Add new trade…' must sit right after Other");
});

test("picking '+ Add new trade…', typing a name, saves it, selects it, and keeps the Other box hidden", async () => {
  const store = makeStore();
  const { document } = await run(store, { prompt: () => "Glazier" });
  await wait(30);

  document.getElementById("newSnagBtn").click();
  const trade = document.getElementById("trade");
  trade.value = "__add_trade__";
  fireEvent(trade, "change");
  await wait(30);

  assert.equal(trade.value, "Glazier");
  assert.equal(document.getElementById("tradeOther").style.display, "none");
  assert.deepEqual(store.addedTrades, ["Glazier"]);

  const values = [...trade.options].map((o) => o.value);
  assert.ok(values.includes("Glazier"), "the new trade must now be a real option");
});

test("a just-added trade is immediately reusable on the next snag in the same list, without saving it again", async () => {
  const store = makeStore();
  const { document } = await run(store, { prompt: () => "Glazier" });
  await wait(30);

  document.getElementById("newSnagBtn").click();
  const trade = document.getElementById("trade");
  trade.value = "__add_trade__";
  fireEvent(trade, "change");
  await wait(30);
  assert.equal(store.addedTrades.length, 1);

  // A second, new snag — picking the now-real "Glazier" option directly
  // must NOT go through "+ Add new trade…" or call the RPC again.
  document.getElementById("newSnagBtn").click();
  trade.value = "Glazier";
  fireEvent(trade, "change");
  await wait(30);
  assert.equal(store.addedTrades.length, 1, "selecting the already-added option must not re-save it");
  assert.equal(document.getElementById("tradeOther").style.display, "none");
});

test("cancelling the prompt (empty/blank input) adds nothing and leaves the dropdown blank", async () => {
  const store = makeStore();
  const { document } = await run(store, { prompt: () => "" });
  await wait(30);

  document.getElementById("newSnagBtn").click();
  const trade = document.getElementById("trade");
  trade.value = "__add_trade__";
  fireEvent(trade, "change");
  await wait(30);

  assert.equal(trade.value, "");
  assert.equal(store.addedTrades.length, 0);
});

test("adding a trade that's a near-duplicate of one already saved (case/whitespace) reuses the existing one, not a second option", async () => {
  const store = makeStore([], { existingCustomTrades: ["Kitchen Fitter"] });
  const { document } = await run(store, { prompt: () => "  kitchen fitter " });
  await wait(30);

  document.getElementById("newSnagBtn").click();
  const trade = document.getElementById("trade");
  trade.value = "__add_trade__";
  fireEvent(trade, "change");
  await wait(30);

  assert.equal(trade.value, "Kitchen Fitter", "the stored canonical spelling wins, not the newly typed casing");
  const matches = [...trade.options].filter((o) => o.value === "Kitchen Fitter");
  assert.equal(matches.length, 1, "must not create a second, duplicate option");
});

test("a trade already saved for this organisation from a previous snag appears in the dropdown on page load", async () => {
  const store = makeStore([], { existingCustomTrades: ["Scaffolder's Mate"] });
  const { document } = await run(store);
  await wait(30);

  const values = [...document.getElementById("trade").options].map((o) => o.value);
  assert.ok(values.includes("Scaffolder's Mate"));
});

test("editing an existing snag whose trade is a previously-added custom trade pre-selects it cleanly, not Other", async () => {
  const snags = [{ id: "s1", item_no: 1, location: "Kitchen", description: "Worktop gap", priority: "medium", status: "open", trade: "Kitchen Fitter", plot_id: null }];
  const store = makeStore(snags, { existingCustomTrades: ["Kitchen Fitter"] });
  const { document, window } = await run(store);
  await wait(30);

  window.editSnag("s1");
  await wait(20);

  assert.equal(document.getElementById("trade").value, "Kitchen Fitter");
  assert.equal(document.getElementById("tradeOther").style.display, "none");
});

test("a failed save shows a real error and leaves the dropdown blank, not a half-added option", async () => {
  const store = makeStore();
  let alerted = "";
  const { document } = await run(store, {
    prompt: () => "Glazier",
    alert: (msg) => { alerted = msg; },
    addOrgCustomTrade: async () => { throw new Error("network blip"); },
  });
  await wait(30);

  document.getElementById("newSnagBtn").click();
  const trade = document.getElementById("trade");
  trade.value = "__add_trade__";
  fireEvent(trade, "change");
  await wait(30);

  assert.match(alerted, /network blip/);
  assert.equal(trade.value, "");
});
