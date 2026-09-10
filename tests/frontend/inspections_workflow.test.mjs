// Inspections (Priority 7) — the critical frontend workflow: create an
// inspection, add a finding, create an Action from it, verify the
// linkage renders, then resolve the finding. Data-access functions are
// mocked here (they're thin Supabase wrappers already exercised for
// real, against the actual RLS/trigger boundary, in
// tests/security/inspections.test.mjs); this file proves the PAGE
// wires them up correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

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
const OWNER = { user_id: "u-owner", email: "owner@example.com", role: "owner" };
const COLLAB = { user_id: "u-collab", email: "collab@example.com", role: "collaborator" };

function isOutstanding(f) { return !["resolved", "accepted", "cancelled"].includes(f.status); }

function makeStore() {
  let nextFindingId = 1;
  let nextActionId = 1;
  const inspection = { id: "insp1", project_id: PROJECT_ID, title: "Roofing walk-round", inspection_type: "quality", status: "draft", inspection_date: "2026-09-01", conducted_by: "Jane", description: null, projects: { name: "Test Site" } };
  const findings = [];
  const actions = [];
  const photos = [];
  return {
    inspection, findings, actions, photos,
    async getInspection() { return { ...inspection }; },
    async updateInspection(id, fields) { Object.assign(inspection, fields); return { ...inspection }; },
    async deleteInspection() {},
    async getFindings() { return findings.map((f) => ({ ...f })); },
    async createFinding(inspectionId, projectId, fields) {
      const f = { id: `f${nextFindingId++}`, inspection_id: inspectionId, project_id: projectId, title: fields.title, description: fields.description ?? null, severity: fields.severity ?? "medium", status: "open", action_id: null };
      findings.push(f);
      return { ...f };
    },
    async updateFinding(id, fields) {
      const f = findings.find((x) => x.id === id);
      Object.assign(f, fields);
      return { ...f };
    },
    async resolveFinding(id) {
      const f = findings.find((x) => x.id === id);
      f.status = "resolved";
      return { ...f };
    },
    async deleteFinding(id) {
      const idx = findings.findIndex((x) => x.id === id);
      if (idx >= 0) findings.splice(idx, 1);
    },
    async createActionFromFinding(finding, fields) {
      const action = { id: `a${nextActionId++}`, project_id: finding.project_id, title: fields.title, description: fields.description ?? null, status: "open", priority: fields.priority ?? "medium", assigned_to: fields.assignedTo ?? null, due_date: fields.dueDate ?? null };
      actions.push(action);
      const f = findings.find((x) => x.id === finding.id);
      f.action_id = action.id;
      f.status = "action_required";
      return { action: { ...action }, finding: { ...f } };
    },
    async getFindingPhotos(findingId) { return photos.filter((p) => p.finding_id === findingId).map((p) => ({ ...p })); },
    async addFindingPhoto(findingId, projectId, file) {
      const p = { id: `photo${photos.length + 1}`, finding_id: findingId, project_id: projectId, photo_url: `https://example.com/${file.name}` };
      photos.push(p);
      return { ...p };
    },
    async deleteFindingPhoto(id) {
      const idx = photos.findIndex((p) => p.id === id);
      if (idx >= 0) photos.splice(idx, 1);
    },
    async createSnagFromFinding(finding, fields) {
      const snag = { id: `s${nextFindingId}`, project_id: finding.project_id, snag_list_id: "list1", location: fields.location, trade: fields.trade ?? null, priority: fields.priority ?? "medium", status: "open", inspection_finding_id: finding.id };
      const f = findings.find((x) => x.id === finding.id);
      f.status = "action_required";
      return { snag, finding: { ...f } };
    },
  };
}

async function run(store) {
  const supabase = {
    rpc: async (name) => {
      if (name === "get_project_members") return { data: [OWNER, COLLAB], error: null };
      return { data: null, error: null };
    },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        in() { return api; },
        single: async () => ({ data: null, error: null }),
        then(resolve) {
          if (table === "actions") return resolve({ data: store.actions.map((a) => ({ id: a.id, status: a.status, due_date: a.due_date })), error: null });
          resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/inspection-detail.html?id=insp1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "insp1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getInspection: store.getInspection, updateInspection: store.updateInspection, deleteInspection: store.deleteInspection,
    getFindings: store.getFindings, createFinding: store.createFinding, updateFinding: store.updateFinding,
    resolveFinding: store.resolveFinding, deleteFinding: store.deleteFinding, createActionFromFinding: store.createActionFromFinding,
    getFindingPhotos: store.getFindingPhotos, addFindingPhoto: store.addFindingPhoto, deleteFindingPhoto: store.deleteFindingPhoto,
    createSnagFromFinding: store.createSnagFromFinding,
    INSPECTION_TYPES, INSPECTION_TYPE_LABEL, INSPECTION_STATUSES, INSPECTION_STATUS_LABEL, INSPECTION_STATUS_BADGE,
    FINDING_SEVERITIES, FINDING_SEVERITY_LABEL, FINDING_SEVERITY_BADGE, FINDING_STATUSES, FINDING_STATUS_LABEL, FINDING_STATUS_BADGE, isFindingOutstanding: isOutstanding,
    ACTION_PRIORITIES, ACTION_PRIORITY_LABEL, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE,
    SNAG_PRIORITIES, SNAG_PRIORITY_LABEL, SNAG_STATUS_LABEL, SNAG_STATUS_BADGE,
    alert: () => {}, confirm: () => true,
  });
}

test("inspection-detail.html: create inspection details render, add finding -> create Action -> verify linkage -> resolve finding", async () => {
  const store = makeStore();
  const { document, window } = await run(store);
  await wait(30);

  assert.equal(document.getElementById("inspectionTitle").textContent, "Roofing walk-round");
  assert.equal(document.getElementById("findingsEmpty").style.display, "block");

  // Add a finding
  fireEvent(document.getElementById("newFindingBtn"), "click");
  document.getElementById("findingTitle").value = "Missing fire stopping at floor 2";
  document.getElementById("findingSeverity").value = "high";
  fireEvent(document.getElementById("newFindingForm"), "submit");
  await wait(30);

  assert.equal(store.findings.length, 1);
  const finding = store.findings[0];
  assert.equal(finding.severity, "high");
  assert.equal(finding.status, "open");
  assert.ok(document.getElementById("findingsWrap").innerHTML.includes("Missing fire stopping"));

  // Create Action from the finding. The form's real markup uses an
  // inline onsubmit="submitCreateAction(...)" attribute (matching this
  // app's existing row-action convention elsewhere) — jsdom's
  // runScripts:"outside-only" mode (required so only our own
  // vm-injected script ever executes) never wires those attribute
  // handlers up, only real page code does in a browser. Call the same
  // window-exposed function the attribute would call instead — it's
  // the real, unmocked function either way.
  window.toggleCreateActionForm(finding.id);
  await wait(10);
  const actionForm = document.getElementById(`action-form-${finding.id}`);
  assert.ok(actionForm, "the create-action form should exist for this finding");
  actionForm.querySelector(".action-title").value = "Install fire stopping";
  actionForm.querySelector(".action-assignee").value = COLLAB.user_id;
  actionForm.querySelector(".action-priority").value = "high";
  actionForm.querySelector(".action-due-date").value = "2026-12-01";
  await window.submitCreateAction(finding.id, { preventDefault: () => {}, target: actionForm });
  await wait(30);

  assert.equal(store.actions.length, 1, "creating an Action from a finding must create exactly one real Action");
  assert.equal(store.actions[0].title, "Install fire stopping");
  assert.equal(store.actions[0].assigned_to, COLLAB.user_id);
  assert.equal(finding.action_id, store.actions[0].id, "the finding must be linked back to the new action");
  assert.equal(finding.status, "action_required", "creating an Action is a deliberate, explicit status change to action_required");

  const html = document.getElementById("findingsWrap").innerHTML;
  assert.ok(html.includes("Linked Action"), "the finding card should now show the linked action");

  // Create a Snag from the same finding — independent of the Action just
  // created above; a finding may have both, one, or neither.
  window.toggleCreateSnagForm(finding.id);
  await wait(10);
  const snagForm = document.getElementById(`snag-form-${finding.id}`);
  assert.ok(snagForm, "the create-snag form should exist for this finding");
  snagForm.querySelector(".snag-location").value = "Roof level, north elevation";
  await window.submitCreateSnag(finding.id, { preventDefault: () => {}, target: snagForm });
  await wait(30);
  assert.equal(finding.status, "action_required", "creating a Snag is also a deliberate status change to action_required");
  const htmlWithSnag = document.getElementById("findingsWrap").innerHTML;
  assert.ok(htmlWithSnag.includes("Linked Snag"), "the finding card should now show the linked snag");

  // Resolve the finding — an explicit, separate step, never automatic.
  window.markFindingResolved(finding.id);
  await wait(30);
  assert.equal(finding.status, "resolved");
  const finalHtml = document.getElementById("findingsWrap").innerHTML;
  assert.ok(!finalHtml.includes("Mark Resolved"), "a resolved finding should no longer offer Mark Resolved");
});

test("inspection-detail.html: resolving a finding never happens automatically just because its Action was completed elsewhere", async () => {
  const store = makeStore();
  const { document } = await run(store);
  await wait(30);

  fireEvent(document.getElementById("newFindingBtn"), "click");
  document.getElementById("findingTitle").value = "Loose handrail";
  document.getElementById("findingSeverity").value = "high";
  fireEvent(document.getElementById("newFindingForm"), "submit");
  await wait(30);
  const finding = store.findings[0];

  // Simulate the linked action having been completed elsewhere (e.g.
  // from actions.html) without ever touching the finding.
  finding.action_id = "a99";
  finding.status = "action_required";
  store.actions.push({ id: "a99", project_id: PROJECT_ID, status: "completed", due_date: null });

  // Re-load the page fresh — even after a full reload, the finding must
  // still show its real, human-set status, not an inferred one.
  const { document: doc2 } = await run(store);
  await wait(30);
  const rendered = store.findings.find((f) => f.id === finding.id);
  assert.equal(rendered.status, "action_required", "completing the linked Action must never silently flip the finding to resolved");
});
