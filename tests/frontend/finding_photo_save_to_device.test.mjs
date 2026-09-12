// Save to Device (Priority 18) — Inspection Findings. Proves
// inspection-detail.html's real inline script still uploads finding photos
// exactly as before (regression), and that each photo gets its OWN Save to
// Device control tied to its own original File — critical here since a
// finding can carry several photos and each must save the right one.
//
// The page's real markup uses inline onchange="uploadFindingPhoto(...)" and
// onclick="saveFindingPhotoToDevice(...)" attributes (this app's existing
// row-action convention — see inspections_workflow.test.mjs's own comment).
// jsdom's runScripts:"outside-only" mode never wires those attribute
// handlers up, only real page code does in a browser, so this file calls
// the same window-exposed functions those attributes would call — the
// real, unmocked functions either way.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/inspection-detail.html", import.meta.url).pathname;

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const INSPECTION_TYPES = extractConst("INSPECTION_TYPES");
const INSPECTION_TYPE_LABEL = extractConst("INSPECTION_TYPE_LABEL");
const INSPECTION_STATUSES = extractConst("INSPECTION_STATUSES");
const INSPECTION_STATUS_LABEL = extractConst("INSPECTION_STATUS_LABEL");
const INSPECTION_STATUS_BADGE = extractConst("INSPECTION_STATUS_BADGE");
const FINDING_SEVERITIES = extractConst("FINDING_SEVERITIES");
const FINDING_SEVERITY_LABEL = extractConst("FINDING_SEVERITY_LABEL");
const FINDING_SEVERITY_BADGE = extractConst("FINDING_SEVERITY_BADGE");
const FINDING_STATUSES = extractConst("FINDING_STATUSES");
const FINDING_STATUS_LABEL = extractConst("FINDING_STATUS_LABEL");
const FINDING_STATUS_BADGE = extractConst("FINDING_STATUS_BADGE");
const ACTION_PRIORITIES = extractConst("ACTION_PRIORITIES");
const ACTION_PRIORITY_LABEL = extractConst("ACTION_PRIORITY_LABEL");
const ACTION_STATUS_LABEL = extractConst("ACTION_STATUS_LABEL");
const ACTION_STATUS_BADGE = extractConst("ACTION_STATUS_BADGE");
const SNAG_PRIORITIES = extractConst("SNAG_PRIORITIES");
const SNAG_PRIORITY_LABEL = extractConst("SNAG_PRIORITY_LABEL");
const SNAG_STATUS_LABEL = extractConst("SNAG_STATUS_LABEL");
const SNAG_STATUS_BADGE = extractConst("SNAG_STATUS_BADGE");

const PROJECT_ID = "p1";

function fakeFileInput(file) {
  return { files: [file] };
}

function isOutstanding(f) { return !["resolved", "accepted", "cancelled"].includes(f.status); }

function makeStore() {
  const inspection = { id: "insp1", project_id: PROJECT_ID, title: "Roofing walk-round", inspection_type: "quality", status: "draft", inspection_date: "2026-09-01", conducted_by: "Jane", description: null, projects: { name: "Test Site" } };
  const findings = [{ id: "f1", inspection_id: "insp1", project_id: PROJECT_ID, title: "Loose handrail", description: null, severity: "high", status: "open", action_id: null, plot_id: null }];
  const photos = [];
  const store = {
    inspection, findings, photos, lastUploadCall: null,
    async getInspection() { return { ...inspection }; },
    async updateInspection() {},
    async deleteInspection() {},
    async getFindings() { return findings.map((f) => ({ ...f })); },
    async createFinding() {},
    async updateFinding() {},
    async resolveFinding() {},
    async deleteFinding() {},
    async createActionFromFinding() {},
    async getFindingPhotos(findingId) { return photos.filter((p) => p.finding_id === findingId).map((p) => ({ ...p })); },
    async addFindingPhoto(findingId, projectId, file) {
      const p = { id: `photo${photos.length + 1}`, finding_id: findingId, project_id: projectId, photo_url: `https://example.com/${file.name}` };
      photos.push(p);
      store.lastUploadCall = { findingId, projectId, file };
      return { ...p };
    },
    async deleteFindingPhoto() {},
    async createSnagFromFinding() {},
  };
  return store;
}

async function run(overrides = {}) {
  const store = makeStore();
  const supabase = {
    rpc: async () => ({ data: [], error: null }),
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        in() { return api; },
        single: async () => ({ data: null, error: null }),
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
  const { document, window } = await runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/inspection-detail.html?id=insp1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "insp1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = err?.message || String(err); },
    clearError: (el) => { el.textContent = ""; },
    getInspection: store.getInspection, updateInspection: store.updateInspection, deleteInspection: store.deleteInspection,
    getFindings: store.getFindings, createFinding: store.createFinding, updateFinding: store.updateFinding,
    resolveFinding: store.resolveFinding, deleteFinding: store.deleteFinding, createActionFromFinding: store.createActionFromFinding,
    getFindingPhotos: store.getFindingPhotos, addFindingPhoto: store.addFindingPhoto, deleteFindingPhoto: store.deleteFindingPhoto,
    createSnagFromFinding: store.createSnagFromFinding,
    INSPECTION_TYPES, INSPECTION_TYPE_LABEL, INSPECTION_STATUSES, INSPECTION_STATUS_LABEL, INSPECTION_STATUS_BADGE,
    FINDING_SEVERITIES, FINDING_SEVERITY_LABEL, FINDING_SEVERITY_BADGE, FINDING_STATUSES, FINDING_STATUS_LABEL, FINDING_STATUS_BADGE, isFindingOutstanding: isOutstanding,
    ACTION_PRIORITIES, ACTION_PRIORITY_LABEL, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE,
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE,
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }),
    alert: () => {}, confirm: () => true,
    saveFileToDevice: overrides.saveFileToDevice || (async () => ({ method: "share", status: "saved" })),
    deviceSavePhotoFilename: overrides.deviceSavePhotoFilename || (() => "site-photo-test.jpg"),
    deviceSaveStatusLabel: overrides.deviceSaveStatusLabel || ((s) => (s ? `STATUS:${s}` : "")),
  });
  return { document, window, store };
}

test("inspection-detail.html: adding a finding photo still uploads via the existing (unchanged) addFindingPhoto() — no regression", async () => {
  const { document, window, store } = await run();
  await wait(30);

  const file = { name: "evidence1.jpg", type: "image/jpeg", size: 100 };
  await window.uploadFindingPhoto("f1", fakeFileInput(file));
  await wait(30);

  assert.equal(store.lastUploadCall.file, file, "the real, original file must reach addFindingPhoto() unchanged");
  assert.equal(store.photos.length, 1);
  assert.ok(document.getElementById("findingsWrap").innerHTML.includes("evidence1.jpg"), "the uploaded photo must render");
});

test("inspection-detail.html: a just-uploaded finding photo gets its own Save to Device control, calling saveFileToDevice() with that exact original File", async () => {
  const calls = [];
  const { document, window } = await run({
    saveFileToDevice: async (file, filename) => { calls.push({ file, filename }); return { method: "share", status: "saved" }; },
  });
  await wait(30);

  const file = { name: "evidence2.jpg", type: "image/jpeg", size: 200 };
  await window.uploadFindingPhoto("f1", fakeFileInput(file));
  await wait(30);

  const html = document.getElementById("findingsWrap").innerHTML;
  assert.match(html, /Save to Device/, "Save to Device control must appear for the just-uploaded photo");

  const photoId = "photo1";
  await window.saveFindingPhotoToDevice("f1", photoId);
  await wait(30);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].file, file, "saveFileToDevice() must receive the exact same original File — never a compressed/second copy");
  assert.match(document.getElementById("findingsWrap").innerHTML, /STATUS:saved/);
});

test("inspection-detail.html: two photos added to the same finding each keep their OWN Save to Device association — saving the second never saves the first's file", async () => {
  const calls = [];
  const { window } = await run({
    saveFileToDevice: async (file) => { calls.push(file); return { method: "share", status: "saved" }; },
  });
  await wait(30);

  const file1 = { name: "photo-a.jpg", type: "image/jpeg", size: 1 };
  const file2 = { name: "photo-b.jpg", type: "image/jpeg", size: 2 };
  await window.uploadFindingPhoto("f1", fakeFileInput(file1));
  await wait(30);
  await window.uploadFindingPhoto("f1", fakeFileInput(file2));
  await wait(30);

  await window.saveFindingPhotoToDevice("f1", "photo2");
  await wait(30);
  assert.equal(calls.length, 1);
  assert.equal(calls[0], file2, "saving the SECOND photo must save the SECOND file, not the first");

  await window.saveFindingPhotoToDevice("f1", "photo1");
  await wait(30);
  assert.equal(calls.length, 2);
  assert.equal(calls[1], file1, "saving the FIRST photo must save the FIRST file");
});

test("inspection-detail.html: a cancelled device save is shown honestly for that specific photo, never as a false success", async () => {
  const { document, window } = await run({ saveFileToDevice: async () => ({ method: "share", status: "cancelled" }) });
  await wait(30);

  const file = { name: "evidence3.jpg", type: "image/jpeg", size: 3 };
  await window.uploadFindingPhoto("f1", fakeFileInput(file));
  await wait(30);

  await window.saveFindingPhotoToDevice("f1", "photo1");
  await wait(30);

  const html = document.getElementById("findingsWrap").innerHTML;
  assert.match(html, /STATUS:cancelled/);
  assert.doesNotMatch(html, /STATUS:saved/);
});

test("inspection-detail.html: a finding photo loaded from a fresh page load (no surviving File) shows no Save to Device control — an honest limitation, not a bug", async () => {
  const store = makeStore();
  store.photos.push({ id: "old1", finding_id: "f1", project_id: PROJECT_ID, photo_url: "https://example.com/already-saved.jpg" });
  const supabase = { rpc: async () => ({ data: [], error: null }), from() { const api = { select() { return api; }, eq() { return api; }, in() { return api; }, single: async () => ({ data: null, error: null }), then(resolve) { resolve({ data: [], error: null }); } }; return api; } };
  const { document } = await runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/inspection-detail.html?id=insp1",
    supabase, requireAuth: async () => ({ id: "u1" }), renderHeader: () => {}, getParam: () => "insp1",
    escapeHtml: (s) => String(s ?? ""), formatDate: (d) => d || "",
    showError: () => {}, clearError: () => {},
    getInspection: store.getInspection, updateInspection: store.updateInspection, deleteInspection: store.deleteInspection,
    getFindings: store.getFindings, createFinding: store.createFinding, updateFinding: store.updateFinding,
    resolveFinding: store.resolveFinding, deleteFinding: store.deleteFinding, createActionFromFinding: store.createActionFromFinding,
    getFindingPhotos: store.getFindingPhotos, addFindingPhoto: store.addFindingPhoto, deleteFindingPhoto: store.deleteFindingPhoto,
    createSnagFromFinding: store.createSnagFromFinding,
    INSPECTION_TYPES, INSPECTION_TYPE_LABEL, INSPECTION_STATUSES, INSPECTION_STATUS_LABEL, INSPECTION_STATUS_BADGE,
    FINDING_SEVERITIES, FINDING_SEVERITY_LABEL, FINDING_SEVERITY_BADGE, FINDING_STATUSES, FINDING_STATUS_LABEL, FINDING_STATUS_BADGE, isFindingOutstanding: isOutstanding,
    ACTION_PRIORITIES, ACTION_PRIORITY_LABEL, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE,
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE,
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }),
    alert: () => {}, confirm: () => true,
    saveFileToDevice: async () => ({ method: "share", status: "saved" }),
    deviceSavePhotoFilename: () => "site-photo-test.jpg",
    deviceSaveStatusLabel: (s) => (s ? `STATUS:${s}` : ""),
  });
  await wait(30);

  const html = document.getElementById("findingsWrap").innerHTML;
  assert.ok(html.includes("already-saved.jpg"));
  assert.doesNotMatch(html, /Save to Device/, "a photo whose original File no longer exists in memory must not offer a Save to Device control");
});
