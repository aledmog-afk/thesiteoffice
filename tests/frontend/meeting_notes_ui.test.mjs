// v85: tracker/meeting-notes.html (general, org-wide) and
// tracker/site-meeting-notes.html (per-site, with real Actions
// follow-ups). Server-side authorization for who can read/write each
// is covered in tests/database/v85_meeting_notes.test.mjs — these
// prove what the PAGES themselves do.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const GENERAL = new URL("../../tracker/meeting-notes.html", import.meta.url).pathname;
const SITE = new URL("../../tracker/site-meeting-notes.html", import.meta.url).pathname;

const common = {
  requireAuth: async () => ({ id: "u1" }),
  renderHeader: () => {},
  escapeHtml: (s) => String(s ?? "").replace(/</g, "&lt;"),
  formatDate: (d) => d || "",
  showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
  clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
};

// ─── General meeting notes ────────────────────────────────────────────
function generalCtx(overrides = {}) {
  const calls = [];
  return {
    calls,
    ctx: {
      ...common,
      __url: "https://example.com/meeting-notes.html",
      getMyOrganisations: async () => [{ id: "org1", name: "Owner Co" }],
      getOrgMeetingNotes: async () => [],
      createOrgMeetingNote: async (fields) => { calls.push(["create", fields]); return { id: "n1", ...fields }; },
      updateOrgMeetingNote: async (id, fields) => { calls.push(["update", id, fields]); return { id, ...fields }; },
      deleteOrgMeetingNote: async (id) => { calls.push(["delete", id]); },
      ...overrides,
    },
  };
}

test("meeting-notes.html: creating a note with follow-ups calls createOrgMeetingNote with the right org and follow-up list", async () => {
  const { ctx, calls } = generalCtx();
  const { document } = await runPage(GENERAL, extractScript(GENERAL), ctx);
  await wait(30);
  document.getElementById("meetingTitle").value = "Monthly H&S review";
  document.getElementById("newFollowUp").value = "Order more hi-vis";
  fireEvent(document.getElementById("addFollowUpBtn"), "click");
  fireEvent(document.getElementById("noteForm"), "submit");
  await wait(30);
  const created = calls.find((c) => c[0] === "create");
  assert.ok(created);
  assert.equal(created[1].org_id, "org1");
  assert.equal(created[1].title, "Monthly H&S review");
  // Individual properties, not a whole-object/array deepEqual: the
  // array was built inside the vm context, a different realm with its
  // own Object.prototype (same reasoning as company_invites_ui.test.mjs).
  assert.equal(created[1].follow_ups.length, 1);
  assert.equal(created[1].follow_ups[0].text, "Order more hi-vis");
  assert.equal(created[1].follow_ups[0].done, false);
});

test("meeting-notes.html: with no organisation at all, shows a message instead of a broken form", async () => {
  const { ctx } = generalCtx({ getMyOrganisations: async () => [] });
  const { document } = await runPage(GENERAL, extractScript(GENERAL), ctx);
  await wait(30);
  assert.match(document.getElementById("errorBox").textContent, /set one up/i);
});

test("meeting-notes.html: editing an existing note populates the form and calls updateOrgMeetingNote", async () => {
  const note = { id: "n9", org_id: "org1", meeting_date: "2026-11-01", title: "Old title", attendees: "Owner", notes: "Discussed stuff", follow_ups: [{ text: "Follow up 1", done: true }] };
  const { ctx, calls } = generalCtx({ getOrgMeetingNotes: async () => [note] });
  const { document } = await runPage(GENERAL, extractScript(GENERAL), ctx);
  await wait(30);
  document.querySelector('[data-edit="n9"]').click();
  await wait(10);
  assert.equal(document.getElementById("meetingTitle").value, "Old title");
  document.getElementById("meetingTitle").value = "New title";
  fireEvent(document.getElementById("noteForm"), "submit");
  await wait(30);
  assert.deepEqual(calls.map((c) => c[0]), ["update"]);
  assert.equal(calls[0][1], "n9");
  assert.equal(calls[0][2].title, "New title");
});

// ─── Site meeting notes ────────────────────────────────────────────────
function siteCtx(overrides = {}) {
  const calls = [];
  const supabase = {
    from(table) {
      const api = { select() { return api; }, eq() { return api; }, single: async () => ({ data: { name: "County Flats" }, error: null }) };
      return api;
    },
  };
  return {
    calls,
    ctx: {
      ...common,
      __url: "https://example.com/site-meeting-notes.html?project=p1",
      getParam: (n) => (n === "project" ? "p1" : null),
      supabase,
      getProjectMeetingNotes: async () => [],
      createProjectMeetingNote: async (fields) => { calls.push(["create", fields]); return { id: "n1", ...fields }; },
      updateProjectMeetingNote: async (id, fields) => { calls.push(["update", id, fields]); return { id, ...fields }; },
      deleteProjectMeetingNote: async (id) => { calls.push(["delete", id]); },
      getActionsForMeetingNote: async () => [],
      createAction: async (projectId, fields) => { calls.push(["createAction", projectId, fields]); return { id: "a1" }; },
      ...overrides,
    },
  };
}

test("site-meeting-notes.html: creating a note sets project_id from the URL", async () => {
  const { ctx, calls } = siteCtx();
  const { document } = await runPage(SITE, extractScript(SITE), ctx);
  await wait(30);
  document.getElementById("meetingTitle").value = "Weekly progress meeting";
  fireEvent(document.getElementById("noteForm"), "submit");
  await wait(30);
  assert.equal(calls[0][1].project_id, "p1");
});

test("site-meeting-notes.html: adding a follow-up calls createAction with sourceMeetingNoteId, not a second task system", async () => {
  const note = { id: "n1", project_id: "p1", meeting_date: "2026-11-01", title: "Progress meeting" };
  const { ctx, calls } = siteCtx({ getProjectMeetingNotes: async () => [note] });
  const { document } = await runPage(SITE, extractScript(SITE), ctx);
  await wait(30);
  const wrap = document.querySelector('[data-followup-form="n1"]');
  wrap.querySelector("input").value = "Fix the fence";
  document.querySelector('[data-add-followup="n1"]').click();
  await wait(30);
  const created = calls.find((c) => c[0] === "createAction");
  assert.ok(created);
  assert.equal(created[1], "p1");
  assert.equal(created[2].title, "Fix the fence");
  assert.equal(created[2].sourceMeetingNoteId, "n1");
});

test("site-meeting-notes.html: shows follow-up actions already raised from a note, with their status", async () => {
  const note = { id: "n1", project_id: "p1", meeting_date: "2026-11-01", title: "Progress meeting" };
  const { ctx } = siteCtx({
    getProjectMeetingNotes: async () => [note],
    getActionsForMeetingNote: async (id) => (id === "n1" ? [{ title: "Fix the fence", status: "open" }] : []),
  });
  const { document } = await runPage(SITE, extractScript(SITE), ctx);
  await wait(30);
  assert.match(document.getElementById("noteList").textContent, /Fix the fence/);
});
