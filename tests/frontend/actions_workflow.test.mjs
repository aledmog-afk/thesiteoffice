// Actions Engine (Priority 5) — the critical frontend workflow: create an
// action, assign an owner, then complete it, against the real
// actions.html inline script under jsdom. The data-access functions
// (listActions/createAction/updateAction) are mocked here — they're
// thin Supabase wrappers already exercised for real in
// tests/security/actions.test.mjs, which is where the actual RLS/trigger
// boundary is proven. This file proves the PAGE wires them up correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/actions.html", import.meta.url).pathname;

// app.js can't be imported directly in plain Node (it imports the real
// Supabase client from esm.sh) — extract the pure Actions-helper source
// verbatim, the same regex-extraction approach tests/uploads/client.test.mjs
// already uses for uploadPhoto(), so this runs the app's real code rather
// than a reimplementation.
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
function extractFunction(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
const helperScope = `
  ${extractFunction("toLocalISODate")}
  ${extractFunction("todayISO")}
  ${extractConst("ACTION_STATUSES")}
  ${extractConst("ACTION_STATUS_LABEL")}
  ${extractConst("ACTION_STATUS_BADGE")}
  ${extractConst("ACTION_PRIORITIES")}
  ${extractConst("ACTION_PRIORITY_LABEL")}
  ${extractConst("ACTION_PRIORITY_BADGE")}
  ${extractConst("ACTION_STATUS_TRANSITIONS")}
  ${extractFunction("validActionStatusTransitions")}
  ${extractConst("ACTION_DUE_LABEL")}
  ${extractConst("ACTION_DUE_BADGE")}
  ${extractFunction("actionDueState")}
  return {
    ACTION_STATUSES, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE,
    ACTION_PRIORITIES, ACTION_PRIORITY_LABEL, ACTION_PRIORITY_BADGE,
    ACTION_DUE_LABEL, ACTION_DUE_BADGE, actionDueState, validActionStatusTransitions,
  };
`;
const {
  ACTION_STATUSES, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE,
  ACTION_PRIORITIES, ACTION_PRIORITY_LABEL, ACTION_PRIORITY_BADGE,
  ACTION_DUE_LABEL, ACTION_DUE_BADGE, actionDueState, validActionStatusTransitions,
} = new Function(helperScope)();

const OWNER = { user_id: "u-owner", email: "owner@example.com", role: "owner" };
const COLLAB = { user_id: "u-collab", email: "collab@example.com", role: "collaborator" };

function makeStore() {
  let nextId = 1;
  const rows = [];
  return {
    rows,
    async listActions() { return rows.map((r) => ({ ...r })); },
    async createAction(projectId, fields) {
      const row = {
        id: `a${nextId++}`, project_id: projectId, status: "open",
        title: fields.title, description: fields.description ?? null,
        priority: fields.priority ?? "medium", assigned_to: fields.assignedTo ?? null,
        due_date: fields.dueDate ?? null, completed_at: null,
      };
      rows.push(row);
      return { ...row };
    },
    async updateAction(id, fields) {
      const row = rows.find((r) => r.id === id);
      if (!row) throw new Error("not found");
      Object.assign(row, fields);
      if (fields.status === "completed") row.completed_at = "2026-09-10T00:00:00Z";
      if (fields.status && fields.status !== "completed") row.completed_at = null;
      return { ...row };
    },
    async deleteAction(id) {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx >= 0) rows.splice(idx, 1);
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
        single: async () => (table === "projects" ? { data: { name: "Test Site" }, error: null } : { data: null, error: null }),
      };
      return api;
    },
  };
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/actions.html?project=p1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "p1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d,
    showError: (el, err) => { el.textContent = err?.message || String(err); },
    clearError: (el) => { el.textContent = ""; },
    ACTION_STATUSES, ACTION_STATUS_LABEL, ACTION_STATUS_BADGE,
    ACTION_PRIORITIES, ACTION_PRIORITY_LABEL, ACTION_PRIORITY_BADGE,
    ACTION_DUE_LABEL, ACTION_DUE_BADGE, actionDueState, validActionStatusTransitions,
    listActions: store.listActions, createAction: store.createAction,
    updateAction: store.updateAction, deleteAction: store.deleteAction,
    alert: () => {}, confirm: () => true,
  });
}

test("actions.html: create -> assign -> update -> complete workflow", async () => {
  const store = makeStore();
  const { document, window } = await run(store);
  await wait(30);

  // Create
  fireEvent(document.getElementById("newActionBtn"), "click");
  document.getElementById("title").value = "Chase Building Control sign-off";
  document.getElementById("priority").value = "high";
  document.getElementById("assignedTo").value = COLLAB.user_id;
  document.getElementById("dueDate").value = "2026-12-01";
  fireEvent(document.getElementById("actionForm"), "submit");
  await wait(30);

  assert.equal(store.rows.length, 1, "creating should have added exactly one action");
  const created = store.rows[0];
  assert.equal(created.title, "Chase Building Control sign-off");
  assert.equal(created.priority, "high");
  assert.equal(created.assigned_to, COLLAB.user_id, "the action should be assigned on creation");
  assert.equal(created.status, "open");

  let row = document.querySelector("#actionRows tr");
  assert.ok(row, "the new action should render in the table");
  assert.ok(row.textContent.includes("Chase Building Control sign-off"));
  assert.ok(row.textContent.includes("collab@example.com"), "the assignee's email should be shown");
  assert.ok(row.textContent.includes("High"));
  assert.ok(row.textContent.includes("Open"));

  // Update (edit priority). Row action buttons use an inline
  // onclick="fn('id')" attribute (matching commercials.html's existing
  // convention) — jsdom's runScripts:"outside-only" mode (required so
  // only our own vm-injected script ever executes) never wires those
  // attribute handlers up, only real page code does in a browser. Call
  // the same window-exposed function the attribute would call instead —
  // it's the real, unmocked function either way.
  const editBtn = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Edit");
  assert.ok(editBtn, "the row should offer an Edit button");
  await window.editAction(created.id);
  await wait(10);
  assert.equal(document.getElementById("title").value, "Chase Building Control sign-off", "the edit form should be pre-filled");
  assert.equal(document.getElementById("editingId").value, created.id, "editing an existing action should populate the hidden id field");
  document.getElementById("priority").value = "critical";
  fireEvent(document.getElementById("actionForm"), "submit");
  await wait(30);
  assert.equal(store.rows.length, 1, "editing must update the existing row, not create a second one");
  assert.equal(store.rows[0].priority, "critical", "the priority change should have persisted");

  // Complete
  row = document.querySelector("#actionRows tr");
  const completeBtn = Array.from(row.querySelectorAll("button")).find((b) => b.textContent === "Complete");
  assert.ok(completeBtn, "an active action should offer a Complete button");
  await window.quickComplete(created.id);
  await wait(30);

  assert.equal(store.rows[0].status, "completed", "completing should have persisted the status change");
  assert.ok(store.rows[0].completed_at, "completed_at should be set");

  // The default "Active" filter deliberately excludes completed/cancelled
  // work — confirm it drops out of that view...
  assert.equal(document.querySelector("#actionRows tr"), null, "a completed action should disappear from the default Active filter");

  // ...then switch to "All" (a real addEventListener-bound control, so
  // this fires correctly under jsdom) to confirm it's still there with
  // the right status and no more quick-complete/cancel actions.
  const filterSelect = document.getElementById("statusFilter");
  filterSelect.value = "all";
  fireEvent(filterSelect, "change");
  row = document.querySelector("#actionRows tr");
  assert.ok(row, "the completed action should still be visible under the All filter");
  assert.ok(row.textContent.includes("Completed"));
  const stillHasCompleteBtn = Array.from(row.querySelectorAll("button")).some((b) => b.textContent === "Complete");
  assert.equal(stillHasCompleteBtn, false, "a completed action should no longer offer Complete/Cancel quick actions");
});
