// Bulk assign — snag-list-edit.html's real inline script under jsdom,
// following the same conventions as snag_photo_save_to_device.test.mjs
// and snag_completion_evidence.test.mjs (same page, same mock shape).
// app.js's assignSnag() (already proven against a real database with
// real RLS in tests/security/snags.test.mjs — assignee must be a real
// project member) is mocked here so this file can focus purely on what
// the PAGE does: selection state, the bulk-action bar, and calling
// assignSnag() once per selected snag with the chosen assignee.
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

function makeStore(snags = []) {
  return {
    snagList: { id: "list1", project_id: "p1", plot_id: "plotA", title: "Snag List", projects: { id: "p1", name: "Test Site" }, plots: { id: "plotA", plot_number: "5" } },
    snags,
  };
}

function makeSupabase(store) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async (name) => {
      if (name === "get_project_members") {
        return { data: [{ user_id: "u1", email: "owner@example.com", role: "owner" }, { user_id: "u2", email: "collab@example.com", role: "collaborator" }], error: null };
      }
      if (name === "get_my_role") return { data: "owner", error: null };
      return { data: null, error: null };
    },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        in() { return api; },
        single: async () => (table === "snag_lists" ? { data: store.snagList, error: null } : { data: null, error: null }),
        then(resolve) {
          if (table === "snag_items") return resolve({ data: store.snags, error: null });
          resolve({ data: [], error: null });
        },
        update() { return { eq: async () => ({ error: null }) }; },
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
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_PRIORITY_BADGE, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE,
    categoriseSnag: () => ({ overdue: false, dueToday: false, dueSoon: false, highPriority: false }),
    assignSnag: overrides.assignSnag || (async (id, userId) => { store.calls = store.calls || []; store.calls.push([id, userId]); }),
    verifySnag: async () => {}, unverifySnag: async () => {},
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
    confirm: overrides.confirm !== undefined ? overrides.confirm : (() => true),
    prompt: overrides.prompt !== undefined ? overrides.prompt : (() => ""),
  });
}

function sampleSnags() {
  return [
    { id: "s1", item_no: 1, location: "Kitchen", description: "Cracked tile", priority: "high", status: "open", plot_id: null },
    { id: "s2", item_no: 2, location: "Bathroom", description: "Leak", priority: "medium", status: "open", plot_id: null },
    { id: "s3", item_no: 3, location: "Hall", description: "Scuff", priority: "low", status: "closed", plot_id: null },
  ];
}

test("the bulk-action bar is hidden with nothing selected", async () => {
  const store = makeStore(sampleSnags());
  const { document } = await run(store);
  await wait(30);

  assert.equal(document.getElementById("bulkBar").style.display, "none");
});

test("selecting one snag shows the bulk bar with a count of 1", async () => {
  const store = makeStore(sampleSnags());
  const { document, window } = await run(store);
  await wait(30);

  // fireEvent() dispatches real DOM events, which is all addEventListener-
  // registered handlers need — but this table's checkboxes use inline
  // onchange="..." attributes (this app's normal convention), and JSDOM's
  // runScripts:"outside-only" (required so the harness's OWN injected
  // script runs) never executes inline attribute handlers. The existing
  // snag test files already work around this the same way — invoke the
  // window-exposed function directly instead of ticking the checkbox that
  // would call it in a real browser.
  window.toggleSelect("s1", true);
  await wait(10);

  assert.equal(document.getElementById("bulkBar").style.display, "block");
  assert.match(document.getElementById("bulkCount").textContent, /1 selected/);
});

test("selecting two, then deselecting one, updates the count correctly", async () => {
  const store = makeStore(sampleSnags());
  const { document, window } = await run(store);
  await wait(30);

  window.toggleSelect("s1", true);
  window.toggleSelect("s2", true);
  await wait(10);
  assert.match(document.getElementById("bulkCount").textContent, /2 selected/);

  window.toggleSelect("s1", false);
  await wait(10);
  assert.match(document.getElementById("bulkCount").textContent, /1 selected/);
});

test("Select All selects every row; the header checkbox reflects the fully-selected state", async () => {
  const store = makeStore(sampleSnags());
  const { document, window } = await run(store);
  await wait(30);

  window.toggleSelectAll(true);
  await wait(10);

  assert.match(document.getElementById("bulkCount").textContent, /3 selected/);
  assert.equal(document.getElementById("selectAllCheckbox").checked, true);
});

test("Select All then deselecting one row leaves the header checkbox indeterminate, not checked", async () => {
  const store = makeStore(sampleSnags());
  const { document, window } = await run(store);
  await wait(30);

  window.toggleSelectAll(true);
  window.toggleSelect("s1", false);
  await wait(10);

  const header = document.getElementById("selectAllCheckbox");
  assert.equal(header.checked, false);
  assert.equal(header.indeterminate, true);
});

test("unchecking Select All clears the whole selection", async () => {
  const store = makeStore(sampleSnags());
  const { document, window } = await run(store);
  await wait(30);

  window.toggleSelectAll(true);
  window.toggleSelectAll(false);
  await wait(10);

  assert.equal(document.getElementById("bulkBar").style.display, "none");
});

test("Clear selection button empties the selection and hides the bar", async () => {
  const store = makeStore(sampleSnags());
  const { document, window } = await run(store);
  await wait(30);

  window.toggleSelect("s1", true);
  window.toggleSelect("s2", true);
  await wait(10);

  fireEvent(document.getElementById("bulkClearBtn"), "click");
  await wait(10);

  assert.equal(document.getElementById("bulkBar").style.display, "none");
});

test("Assign calls assignSnag once per selected snag with the chosen assignee", async () => {
  const store = makeStore(sampleSnags());
  const calls = [];
  const { document, window } = await run(store, { assignSnag: async (id, userId) => calls.push([id, userId]) });
  await wait(30);

  window.toggleSelect("s1", true);
  window.toggleSelect("s2", true);
  document.getElementById("bulkAssignSelect").value = "u2";
  fireEvent(document.getElementById("bulkAssignBtn"), "click");
  await wait(30);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls.sort(), [["s1", "u2"], ["s2", "u2"]]);
});

test("Assign with 'Unassigned' selected passes null, not an empty string", async () => {
  const store = makeStore(sampleSnags());
  const calls = [];
  const { document, window } = await run(store, { assignSnag: async (id, userId) => calls.push([id, userId]) });
  await wait(30);

  window.toggleSelect("s1", true);
  document.getElementById("bulkAssignSelect").value = "";
  fireEvent(document.getElementById("bulkAssignBtn"), "click");
  await wait(30);

  assert.deepEqual(calls, [["s1", null]]);
});

test("after a successful bulk assign, the selection clears and the bar hides", async () => {
  const store = makeStore(sampleSnags());
  const { document, window } = await run(store);
  await wait(30);

  window.toggleSelect("s1", true);
  fireEvent(document.getElementById("bulkAssignBtn"), "click");
  await wait(30);

  assert.equal(document.getElementById("bulkBar").style.display, "none");
});

test("clicking Assign with nothing selected is a no-op — assignSnag is never called", async () => {
  const store = makeStore(sampleSnags());
  const calls = [];
  const { document } = await run(store, { assignSnag: async (id, userId) => calls.push([id, userId]) });
  await wait(30);

  fireEvent(document.getElementById("bulkAssignBtn"), "click");
  await wait(30);

  assert.equal(calls.length, 0);
});

test("a partial failure (some snags rejected server-side) surfaces a visible error naming how many failed, never a silent partial success", async () => {
  const store = makeStore(sampleSnags());
  const alerts = [];
  const { document, window } = await run(store, {
    assignSnag: async (id) => { if (id === "s2") throw new Error("assigned_to must be a member of this project"); },
    alert: (msg) => alerts.push(msg),
  });
  await wait(30);

  window.toggleSelect("s1", true);
  window.toggleSelect("s2", true);
  document.getElementById("bulkAssignSelect").value = "u2";
  fireEvent(document.getElementById("bulkAssignBtn"), "click");
  await wait(30);

  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /1 of 2/);
  assert.match(alerts[0], /member of this project/, "the real server-side error message must reach the user");
});
