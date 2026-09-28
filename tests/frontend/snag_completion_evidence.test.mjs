// Snag completion evidence (v52) — snag-list-edit.html's real inline
// script under jsdom, following the same conventions as
// snag_photo_save_to_device.test.mjs (same page, same mock shape).
// app.js's data-access functions (completeSnagWithPhoto,
// closeSnagWithEvidence, submitSnagForReview, approveSnagReview,
// rejectSnagReview, getSnagPhotos, addSnagPhoto, deleteSnagPhoto,
// getSnagCompletionPhotoCounts — already proven against a real database
// with real RLS in tests/security/snags.test.mjs and
// tests/security/snag_photos.test.mjs) are mocked here so this file can
// focus purely on what the PAGE does: which actions it offers per
// status/photo-count, and that it calls the right function with the
// right arguments — never re-testing the server-side gate itself.
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

function makeStore(snags = [], photoCounts = {}) {
  return {
    snagList: { id: "list1", project_id: "p1", plot_id: "plotA", title: "Snag List", projects: { id: "p1", name: "Test Site" }, plots: { id: "plotA", plot_number: "5" } },
    snags,
    photoCounts, // snag id -> completion photo count, as getSnagCompletionPhotoCounts() would bulk-return it
    photos: {}, // snag id -> [{id, kind, photo_url}], as getSnagPhotos() would return it for ONE snag
    updateCalls: [],
  };
}

function makeSupabase(store) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc: async (name) => {
      if (name === "get_project_members") return { data: [], error: null };
      if (name === "get_my_role") return { data: store.myRole || "owner", error: null };
      return { data: null, error: null };
    },
    from(table) {
      const api = {
        select() { return api; },
        eq(col, val) { api._eqId = table === "snag_items" ? val : api._eqId; return api; },
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
        update(payload) {
          // The real call chain is .update(payload).eq("id", id) — the id
          // is only known once .eq() runs, not at .update() itself.
          return {
            eq: async (col, val) => {
              store.updateCalls.push({ id: val, payload });
              const snag = store.snags.find((s) => s.id === val);
              if (snag) Object.assign(snag, payload);
              return { error: store.updateError || null };
            },
          };
        },
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
    uploadImage: async (file, path) => { store.lastUploadCall = { file, path }; return `https://example.com/${path}/${file.name}`; },
    todayISO: () => "2026-01-01",
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }),
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_PRIORITY_BADGE, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE,
    categoriseSnag: () => ({ overdue: false, dueToday: false, dueSoon: false, highPriority: false }),
    assignSnag: async () => {}, verifySnag: async () => {}, unverifySnag: async () => {},
    completeSnagWithPhoto: overrides.completeSnagWithPhoto || (async (id, url) => { store.calls = store.calls || []; store.calls.push(["completeSnagWithPhoto", id, url]); }),
    closeSnagWithEvidence: overrides.closeSnagWithEvidence || (async (id) => { store.calls = store.calls || []; store.calls.push(["closeSnagWithEvidence", id]); }),
    submitSnagForReview: overrides.submitSnagForReview || (async (id) => { store.calls = store.calls || []; store.calls.push(["submitSnagForReview", id]); }),
    approveSnagReview: overrides.approveSnagReview || (async (id) => { store.calls = store.calls || []; store.calls.push(["approveSnagReview", id]); }),
    rejectSnagReview: overrides.rejectSnagReview || (async (id, note) => { store.calls = store.calls || []; store.calls.push(["rejectSnagReview", id, note]); }),
    getSnagCompletionPhotoCounts: overrides.getSnagCompletionPhotoCounts || (async (ids) => {
      const counts = {};
      for (const id of ids) if (store.photoCounts[id]) counts[id] = store.photoCounts[id];
      return counts;
    }),
    getSnagPhotos: overrides.getSnagPhotos || (async (snagId) => store.photos[snagId] || []),
    addSnagPhoto: overrides.addSnagPhoto || (async (snagId, url, kind) => {
      const photo = { id: `ph${Math.random().toString(36).slice(2, 8)}`, snag_id: snagId, kind, photo_url: url };
      store.photos[snagId] = [...(store.photos[snagId] || []), photo];
      return photo;
    }),
    deleteSnagPhoto: overrides.deleteSnagPhoto || (async (photoId) => {
      for (const snagId of Object.keys(store.photos)) {
        store.photos[snagId] = store.photos[snagId].filter((p) => p.id !== photoId);
      }
    }),
    createActionFromSnag: async () => ({}),
    ACTION_STATUS_LABEL: {}, ACTION_STATUS_BADGE: {},
    saveFileToDevice: async () => ({ method: "share", status: "saved" }),
    deviceSavePhotoFilename: () => "site-photo-test.jpg",
    deviceSaveStatusLabel: () => "",
    alert: overrides.alert || (() => {}),
    confirm: overrides.confirm !== undefined ? overrides.confirm : (() => true),
    prompt: overrides.prompt !== undefined ? overrides.prompt : (() => ""),
  });
}

function findRowButton(document, text) {
  return [...document.querySelectorAll("#snagRows button")].find((b) => b.textContent.trim() === text);
}

// A note on interaction style throughout this file: fireEvent() dispatches
// real DOM events, which is all addEventListener-registered handlers need
// — but this table's row action buttons use inline onclick="..." attributes
// (this app's normal convention), and JSDOM's runScripts:"outside-only"
// (required so the harness's OWN injected script runs) never executes
// inline attribute handlers. The existing snag_photo_save_to_device test
// file already works around this the same way (its own
// `window.editSnag("s1")` call) — invoke the window-exposed function
// directly instead of clicking the button that would call it in a real
// browser.

test("open snag with no evidence yet: shows the quick 📷 Complete shortcut and Submit for Review", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  const { document } = await run(store);
  await wait(30);

  assert.ok(findRowButton(document, "📷 Complete"), "with zero completion photos attached, the fast single-shot path must be offered");
  assert.equal(findRowButton(document, "Mark Complete"), undefined, "Mark Complete only makes sense once evidence is already attached");
  assert.ok(findRowButton(document, "Submit for Review"));
});

test("open snag with evidence already attached: shows Mark Complete instead of the quick shortcut, plus the photo count", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }], { s1: 2 });
  const { document } = await run(store);
  await wait(30);

  assert.ok(findRowButton(document, "Mark Complete"), "once evidence is pre-attached, the smart button switches to a plain close");
  assert.equal(findRowButton(document, "📷 Complete"), undefined);
  assert.match(document.getElementById("snagRows").innerHTML, /2 evidence photos attached/);
});

test("open snag: 📷 Complete triggers the hidden completion-photo input, uploads, and calls completeSnagWithPhoto with the uploaded URL", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  const calls = [];
  const { document, window } = await run(store, { completeSnagWithPhoto: async (id, url) => calls.push([id, url]) });
  await wait(30);

  const completionInput = document.getElementById("completionPhotoInput");
  const file = { name: "fixed.jpg", type: "image/jpeg", size: 4321 };
  window.startCompleteWithPhoto("s1");
  setInputFile(completionInput, file);
  fireEvent(completionInput, "change");
  await wait(30);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "s1");
  assert.equal(calls[0][1], "https://example.com/p1/snags/fixed.jpg", "the real uploaded photo URL must be passed to completeSnagWithPhoto, not the raw File");
  assert.equal(store.lastUploadCall.path, "p1/snags");
});

test("open snag: Mark Complete (evidence already attached) calls closeSnagWithEvidence, no upload involved", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }], { s1: 1 });
  const calls = [];
  const { document, window } = await run(store, { closeSnagWithEvidence: async (id) => calls.push(id) });
  await wait(30);

  assert.ok(findRowButton(document, "Mark Complete"));
  await window.markComplete("s1");

  assert.deepEqual(calls, ["s1"]);
});

test("open snag: Submit for Review (after confirming) calls submitSnagForReview", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  const calls = [];
  const { document, window } = await run(store, { submitSnagForReview: async (id) => calls.push(id), confirm: () => true });
  await wait(30);

  assert.ok(findRowButton(document, "Submit for Review"));
  await window.submitForReview("s1");

  assert.deepEqual(calls, ["s1"]);
});

test("open snag: declining the Submit for Review confirmation does not call submitSnagForReview", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  const calls = [];
  const { window } = await run(store, { submitSnagForReview: async (id) => calls.push(id), confirm: () => false });
  await wait(30);

  await window.submitForReview("s1");

  assert.equal(calls.length, 0, "declining the confirmation must not submit the snag for review");
});

test("open snag: a review_note left by a prior rejection is shown to the assignee", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", review_note: "photo missing, please redo", plot_id: null }]);
  const { document } = await run(store);
  await wait(30);

  assert.match(document.getElementById("snagRows").innerHTML, /Sent back: photo missing, please redo/);
});

test("pending_review snag: an editor sees Approve/Reject; Approve calls approveSnagReview", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "pending_review", plot_id: null }]);
  store.myRole = "owner";
  const calls = [];
  const { document, window } = await run(store, { approveSnagReview: async (id) => calls.push(id) });
  await wait(30);

  assert.ok(findRowButton(document, "Approve"), "an editor must be offered Approve for a pending-review snag");
  assert.ok(findRowButton(document, "Reject"), "an editor must be offered Reject for a pending-review snag");
  await window.approveReview("s1");
  assert.deepEqual(calls, ["s1"]);
});

test("pending_review snag: an editor's Reject is prompted for a reason and calls rejectSnagReview with it", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "pending_review", plot_id: null }]);
  store.myRole = "collaborator";
  const calls = [];
  const { window } = await run(store, {
    rejectSnagReview: async (id, note) => calls.push([id, note]),
    prompt: () => "please attach a photo",
  });
  await wait(30);

  await window.rejectReview("s1");

  assert.deepEqual(calls, [["s1", "please attach a photo"]]);
});

test("pending_review snag: cancelling the reject prompt does not call rejectSnagReview", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "pending_review", plot_id: null }]);
  store.myRole = "owner";
  const calls = [];
  const { window } = await run(store, { rejectSnagReview: async (id, note) => calls.push([id, note]), prompt: () => null });
  await wait(30);

  await window.rejectReview("s1");

  assert.equal(calls.length, 0, "cancelling the prompt must abort the rejection entirely");
});

test("pending_review snag: a non-editor (snagging-only) sees no Approve/Reject controls, just a waiting hint", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "pending_review", plot_id: null }]);
  store.myRole = "snagging";
  const { document } = await run(store);
  await wait(30);

  assert.equal(findRowButton(document, "Approve"), undefined, "a snagging-only member must never be offered Approve — the database would reject it anyway, but the UI shouldn't even suggest it");
  assert.equal(findRowButton(document, "Reject"), undefined);
  assert.match(document.getElementById("snagRows").innerHTML, /Awaiting editor review/);
});

test("closed snag: shows the Verified/Not verified badge, the evidence photo COUNT when present, and a Reopen action", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "closed", verified_at: null, plot_id: null }], { s1: 3 });
  store.myRole = "owner";
  const { document } = await run(store);
  await wait(30);

  const html = document.getElementById("snagRows").innerHTML;
  assert.match(html, /Not verified/);
  assert.match(html, /3 evidence photos \(Edit to view\)/, "the closed row must show how much evidence is attached — there's no single URL any more to link directly");
  assert.ok(findRowButton(document, "Reopen"), "a closed snag must offer Reopen");
});

test("closed snag: Reopen sends status back to open via the plain status update path", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "closed", plot_id: null }], { s1: 1 });
  const { document, window } = await run(store);
  await wait(30);

  assert.ok(findRowButton(document, "Reopen"));
  await window.setStatus("s1", "open");

  assert.equal(store.updateCalls.length, 1);
  assert.equal(store.updateCalls[0].id, "s1");
  assert.equal(store.updateCalls[0].payload.status, "open");
});

test("rejected snag: offers Reopen only, no completion actions", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "rejected", plot_id: null }]);
  const { document } = await run(store);
  await wait(30);

  assert.ok(findRowButton(document, "Reopen"));
  assert.equal(findRowButton(document, "📷 Complete"), undefined);
  assert.equal(findRowButton(document, "Submit for Review"), undefined);
});

test("open snag: a load failure from completeSnagWithPhoto surfaces a visible error, never a silent failure", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  const alerts = [];
  const { document, window } = await run(store, {
    completeSnagWithPhoto: async () => { throw new Error("a snag can only be closed directly with at least one completion photo attached"); },
    alert: (msg) => alerts.push(msg),
  });
  await wait(30);

  const completionInput = document.getElementById("completionPhotoInput");
  window.startCompleteWithPhoto("s1");
  setInputFile(completionInput, { name: "fixed.jpg", type: "image/jpeg", size: 1 });
  fireEvent(completionInput, "change");
  await wait(30);

  assert.equal(alerts.length, 1);
  assert.match(alerts[0], /Couldn't complete that snag/);
  assert.match(alerts[0], /completion photo attached/, "the real server-side error message must reach the user, not a generic one");
});

// ─── Edit form: "add more" photo galleries ───────────────────────────

test("Edit an existing snag: the Additional Photos and Completion Evidence galleries load and render this snag's existing photos, split by kind", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", photo_url: "https://example.com/primary.jpg", plot_id: null }]);
  store.photos.s1 = [
    { id: "ph1", kind: "problem", photo_url: "https://example.com/extra1.jpg" },
    { id: "ph2", kind: "completion", photo_url: "https://example.com/done1.jpg" },
  ];
  const { document, window } = await run(store);
  await wait(30);

  await window.editSnag("s1");
  await wait(10);

  assert.equal(document.getElementById("extraPhotosWrap").style.display, "block", "the additional-photo sections only make sense for an existing (already-saved) snag");
  assert.ok(document.getElementById("problemPhotoGrid").innerHTML.includes("extra1.jpg"));
  assert.ok(document.getElementById("completionEvidenceGrid").innerHTML.includes("done1.jpg"));
  assert.ok(!document.getElementById("problemPhotoGrid").innerHTML.includes("done1.jpg"), "photos must be split by kind, not mixed together");
});

test("new snag (Add Item): the additional-photo sections are hidden — a snag needs a real id before snag_photos rows can reference it", async () => {
  const store = makeStore([]);
  const { document, window } = await run(store);
  await wait(30);

  document.getElementById("newSnagBtn").dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  await wait(10);

  assert.equal(document.getElementById("extraPhotosWrap").style.display, "none");
});

test("Edit an existing snag: adding an Additional Photo uploads and calls addSnagPhoto with kind 'problem', then shows it in the gallery", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  const calls = [];
  const { document, window } = await run(store, {
    addSnagPhoto: async (snagId, url, kind) => { calls.push([snagId, url, kind]); const photo = { id: "phNew", kind, photo_url: url }; store.photos[snagId] = [...(store.photos[snagId] || []), photo]; return photo; },
  });
  await wait(30);

  await window.editSnag("s1");
  await wait(10);

  const input = document.getElementById("problemPhotoInput");
  setInputFile(input, { name: "extra.jpg", type: "image/jpeg", size: 111 });
  fireEvent(input, "change");
  await wait(20);

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "s1");
  assert.equal(calls[0][2], "problem");
  assert.ok(document.getElementById("problemPhotoGrid").innerHTML.includes("extra.jpg"));
});

test("Edit an existing snag: adding a Completion Evidence photo calls addSnagPhoto with kind 'completion' and does NOT close the snag by itself", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  const addCalls = [];
  const closeCalls = [];
  const { document, window } = await run(store, {
    addSnagPhoto: async (snagId, url, kind) => { addCalls.push([snagId, url, kind]); const photo = { id: "phNew", kind, photo_url: url }; store.photos[snagId] = [...(store.photos[snagId] || []), photo]; return photo; },
    closeSnagWithEvidence: async (id) => closeCalls.push(id),
  });
  await wait(30);

  await window.editSnag("s1");
  await wait(10);

  const input = document.getElementById("completionEvidenceInput");
  setInputFile(input, { name: "done.jpg", type: "image/jpeg", size: 222 });
  fireEvent(input, "change");
  await wait(20);

  assert.deepEqual(addCalls, [["s1", "https://example.com/p1/snags/done.jpg", "completion"]]);
  assert.equal(closeCalls.length, 0, "attaching evidence must never itself close the snag — that's a separate, explicit Mark Complete action");
});

test("Edit an existing snag: removing a gallery photo (after confirming) calls deleteSnagPhoto and drops it from the grid", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  store.photos.s1 = [{ id: "ph1", kind: "problem", photo_url: "https://example.com/extra1.jpg" }];
  const calls = [];
  const { document, window } = await run(store, { deleteSnagPhoto: async (id) => calls.push(id), confirm: () => true });
  await wait(30);

  await window.editSnag("s1");
  await wait(10);
  assert.ok(document.getElementById("problemPhotoGrid").innerHTML.includes("extra1.jpg"));

  await window.removeExtraPhoto("ph1", "problem");

  assert.deepEqual(calls, ["ph1"]);
  assert.ok(!document.getElementById("problemPhotoGrid").innerHTML.includes("extra1.jpg"), "a removed photo must disappear from the gallery immediately");
});

test("Edit an existing snag: declining the remove-photo confirmation keeps the photo", async () => {
  const store = makeStore([{ id: "s1", item_no: 1, location: "Bathroom", description: "Leak", priority: "high", status: "open", plot_id: null }]);
  store.photos.s1 = [{ id: "ph1", kind: "completion", photo_url: "https://example.com/done1.jpg" }];
  const calls = [];
  const { document, window } = await run(store, { deleteSnagPhoto: async (id) => calls.push(id), confirm: () => false });
  await wait(30);

  await window.editSnag("s1");
  await wait(10);

  await window.removeExtraPhoto("ph1", "completion");

  assert.equal(calls.length, 0);
  assert.ok(document.getElementById("completionEvidenceGrid").innerHTML.includes("done1.jpg"));
});
