// Save to Device (Priority 18) — Snagging. Proves snag-list-edit.html's
// real inline script: (a) still uploads exactly as before (regression —
// uploadImage() receives the file, photo_url ends up on the saved snag),
// and (b) offers Save to Device for a just-uploaded photo, passing the
// SAME original File reference (never a second/compressed copy) into
// saveFileToDevice(), correctly reflecting saved/cancelled/failed outcomes
// in the UI and never claiming a save before it actually happens.
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

function setInputFile(input, file) {
  Object.defineProperty(input, "files", { value: [file], configurable: true });
}

function makeStore() {
  return {
    snagList: { id: "list1", project_id: "p1", plot_id: "plotA", title: "Snag List", projects: { id: "p1", name: "Test Site" }, plots: { id: "plotA", plot_number: "5" } },
    snags: [],
  };
}

function makeSupabase(store) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async (name) => {
      if (name === "get_project_members") return { data: [], error: null };
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
        insert: async (payload) => {
          store.snags.push({ id: `s${store.snags.length + 1}`, item_no: store.snags.length + 1, ...payload });
          return { error: null };
        },
        update: async () => ({ error: null }),
        delete() { return api; },
      };
      return api;
    },
  };
}

async function run(store, { saveFileToDevice, deviceSavePhotoFilename, deviceSaveStatusLabel } = {}) {
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
    uploadImage: async (file, path) => { store.lastUploadCall = { file, path }; return `https://example.com/${path}/${file.name}`; },
    todayISO: () => "2026-01-01",
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }),
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_PRIORITY_BADGE, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE,
    categoriseSnag: () => ({ overdue: false, dueToday: false, dueSoon: false, highPriority: false }),
    assignSnag: async () => {}, verifySnag: async () => {}, unverifySnag: async () => {},
    createActionFromSnag: async () => ({}),
    ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {},
    saveFileToDevice: saveFileToDevice || (async () => ({ method: "share", status: "saved" })),
    deviceSavePhotoFilename: deviceSavePhotoFilename || (() => "site-photo-test.jpg"),
    deviceSaveStatusLabel: deviceSaveStatusLabel || ((s) => (s ? `STATUS:${s}` : "")),
  });
}

test("snag-list-edit.html: adding a photo still uploads via the existing (unchanged) uploadImage() pipeline — no regression", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  fireEvent(document.getElementById("newSnagBtn"), "click");
  const file = { name: "IMG_1.jpg", type: "image/jpeg", size: 12345 };
  setInputFile(document.getElementById("photoInput"), file);
  fireEvent(document.getElementById("photoInput"), "change");
  await wait(30);

  assert.equal(store.lastUploadCall.file, file, "the real, original file must reach uploadImage() unchanged");
  assert.equal(store.lastUploadCall.path, "p1/snags");
  assert.ok(document.getElementById("photoGrid").innerHTML.includes("<img"), "the uploaded photo's thumbnail must render");

  document.getElementById("location").value = "Kitchen";
  document.getElementById("description").value = "Cracked tile";
  fireEvent(document.getElementById("snagForm"), "submit");
  await wait(30);

  assert.equal(store.snags.length, 1);
  assert.ok(store.snags[0].photo_url.includes("IMG_1.jpg"), "the saved snag must carry the real uploaded photo_url");
});

test("snag-list-edit.html: after a photo uploads, a Save to Device button appears and calls saveFileToDevice() with the SAME original File — never a second/compressed copy", async () => {
  const store = makeStore();
  const calls = [];
  const { document } = await run(store, {
    saveFileToDevice: async (file, filename) => { calls.push({ file, filename }); return { method: "share", status: "saved" }; },
  });
  await wait(30);

  fireEvent(document.getElementById("newSnagBtn"), "click");
  const file = { name: "IMG_2.jpg", type: "image/jpeg", size: 99999 };
  setInputFile(document.getElementById("photoInput"), file);
  fireEvent(document.getElementById("photoInput"), "change");
  await wait(30);

  const btn = document.getElementById("savePhotoDeviceBtn");
  assert.ok(btn, "Save to Device button must appear once a photo has just been uploaded");
  fireEvent(btn, "click");
  await wait(30);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, file, "saveFileToDevice() must receive the exact same original File object uploadImage() also received — not the compressed upload result");
  assert.equal(calls[0].filename, "site-photo-test.jpg");
  assert.match(document.getElementById("savePhotoDeviceStatus").textContent, /STATUS:saved/);
});

test("snag-list-edit.html: a cancelled/failed device save is shown honestly, never as 'Saved to Device'", async () => {
  const store = makeStore();
  const { document } = await run(store, {
    saveFileToDevice: async () => ({ method: "share", status: "cancelled" }),
  });
  await wait(30);

  fireEvent(document.getElementById("newSnagBtn"), "click");
  setInputFile(document.getElementById("photoInput"), { name: "IMG_3.jpg", type: "image/jpeg", size: 1 });
  fireEvent(document.getElementById("photoInput"), "change");
  await wait(30);

  fireEvent(document.getElementById("savePhotoDeviceBtn"), "click");
  await wait(30);

  const statusText = document.getElementById("savePhotoDeviceStatus").textContent;
  assert.match(statusText, /STATUS:cancelled/);
  assert.doesNotMatch(statusText, /STATUS:saved/);
});

test("snag-list-edit.html: editing an existing snag with a previously-saved photo (no surviving File this session) shows the photo but NO Save to Device control — an honest limitation, not a bug", async () => {
  const store = makeStore();
  store.snags.push({ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", photo_url: "https://example.com/old-photo.jpg", plot_id: null });
  const { document, window } = await run(store);
  await wait(30);

  window.editSnag("s1");
  await wait(10);

  assert.ok(document.getElementById("photoGrid").innerHTML.includes("old-photo.jpg"));
  assert.equal(document.getElementById("savePhotoDeviceBtn"), null, "no Save to Device control for a photo whose original File no longer exists in memory");
});
