// v81: "Quick-add a recurring issue…" on the snag Description field —
// snag-list-edit.html's real inline script under jsdom, same
// conventions as snag_add_custom_trade.test.mjs. add_org_custom_snag_description()
// itself is already proven against a real database in
// tests/database/v81_org_custom_snag_descriptions.test.mjs — mocked
// here so this file can focus purely on what the PAGE does: saving the
// currently-typed description, picking a saved one to fill the
// textarea, and making it immediately reusable within the same list.
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

function makeStore(snags = [], { existingCustomDescriptions = [] } = {}) {
  return {
    snagList: { id: "list1", project_id: "p1", plot_id: "plotA", title: "Snag List", projects: { id: "p1", name: "Test Site", org_id: "org1" }, plots: { id: "plotA", plot_number: "5" } },
    snags,
    customDescriptions: existingCustomDescriptions,
    addedDescriptions: [],
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

// Mocked directly (like moveSnagItemsToPlot/addOrgCustomTrade
// elsewhere), not via supabase.rpc — the real app.js wrappers are
// already proven against a real database separately.
function makeDataFns(store) {
  return {
    getOrgCustomSnagDescriptions: async () => store.customDescriptions.slice(),
    addOrgCustomSnagDescription: async (orgId, description) => {
      const trimmed = (description || "").trim();
      if (!trimmed) return null;
      const existing = store.customDescriptions.find((d) => d.toLowerCase() === trimmed.toLowerCase());
      if (existing) return existing;
      store.customDescriptions.push(trimmed);
      store.addedDescriptions.push(trimmed);
      return trimmed;
    },
  };
}

async function run(store, overrides = {}) {
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/snag-list-edit.html?id=list1",
    supabase: makeSupabase(store),
    ...makeDataFns(store),
    ...(overrides.addOrgCustomSnagDescription ? { addOrgCustomSnagDescription: overrides.addOrgCustomSnagDescription } : {}),
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

test("clicking 'Save as quick-add' with text typed saves it and adds it as a picker option", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  document.getElementById("description").value = "Skirting gap at external corner";
  document.getElementById("saveDescriptionBtn").click();
  await wait(30);

  assert.deepEqual(store.addedDescriptions, ["Skirting gap at external corner"]);
  const values = [...document.getElementById("quickAddDescription").options].map((o) => o.value);
  assert.ok(values.includes("Skirting gap at external corner"));
});

test("clicking 'Save as quick-add' with an empty textarea alerts and saves nothing", async () => {
  const store = makeStore();
  let alerted = "";
  const { document } = await run(store, { alert: (msg) => { alerted = msg; } });
  await wait(30);

  document.getElementById("newSnagBtn").click();
  document.getElementById("saveDescriptionBtn").click();
  await wait(30);

  assert.match(alerted, /description/i);
  assert.equal(store.addedDescriptions.length, 0);
});

test("picking a quick-add option fills the textarea with the full text and resets the picker to blank", async () => {
  const store = makeStore([], { existingCustomDescriptions: ["Hinge squeaks on main entrance door"] });
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  const picker = document.getElementById("quickAddDescription");
  picker.value = "Hinge squeaks on main entrance door";
  fireEvent(picker, "change");
  await wait(20);

  assert.equal(document.getElementById("description").value, "Hinge squeaks on main entrance door");
  assert.equal(picker.value, "", "the picker resets to blank — it's a one-shot fill action, not a persistent selection");
});

test("a saved description is immediately reusable later in the same list, without saving it again", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  document.getElementById("description").value = "Paint overspray on skirting";
  document.getElementById("saveDescriptionBtn").click();
  await wait(30);
  assert.equal(store.addedDescriptions.length, 1);

  document.getElementById("newSnagBtn").click();
  const picker = document.getElementById("quickAddDescription");
  picker.value = "Paint overspray on skirting";
  fireEvent(picker, "change");
  await wait(20);

  assert.equal(document.getElementById("description").value, "Paint overspray on skirting");
  assert.equal(store.addedDescriptions.length, 1, "picking an already-saved option must not re-save it");
});

test("saving a near-duplicate (case/whitespace) of one already saved reuses the existing entry, not a second option", async () => {
  const store = makeStore([], { existingCustomDescriptions: ["Door doesn't close properly"] });
  const { document } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").click();
  document.getElementById("description").value = "  DOOR DOESN'T CLOSE PROPERLY  ";
  document.getElementById("saveDescriptionBtn").click();
  await wait(30);

  const matches = [...document.getElementById("quickAddDescription").options].filter((o) => o.value === "Door doesn't close properly");
  assert.equal(matches.length, 1, "must not create a second, duplicate option");
  assert.equal(store.addedDescriptions.length, 0, "the existing stored spelling is reused, nothing new is added");
});

test("a descriptions saved for this organisation from a previous session appears in the picker on page load", async () => {
  const store = makeStore([], { existingCustomDescriptions: ["Grout missing in en-suite"] });
  const { document } = await run(store);
  await wait(30);

  const values = [...document.getElementById("quickAddDescription").options].map((o) => o.value);
  assert.ok(values.includes("Grout missing in en-suite"));
});

test("a failed save shows a real error and adds nothing to the picker", async () => {
  const store = makeStore();
  let alerted = "";
  const { document } = await run(store, {
    alert: (msg) => { alerted = msg; },
    addOrgCustomSnagDescription: async () => { throw new Error("network blip"); },
  });
  await wait(30);

  document.getElementById("newSnagBtn").click();
  document.getElementById("description").value = "Cracked window pane";
  document.getElementById("saveDescriptionBtn").click();
  await wait(30);

  assert.match(alerted, /network blip/);
  const values = [...document.getElementById("quickAddDescription").options].map((o) => o.value);
  assert.ok(!values.includes("Cracked window pane"));
});
