// v85: tracker/my-diary.html — personal diary create/edit/delete, and
// the UI-level rule that photos only appear once a site is picked
// (the database enforces the same thing — see
// tests/database/v85_personal_diary_entries.test.mjs — this just
// proves the page doesn't even show the control when it would fail).
//
// v86: raising a follow-up Action from a site-assigned entry — see
// tests/database/v86_diary_raise_action.test.mjs for the real
// actions.source_diary_entry_id authorization/privacy rules. This
// file just proves the follow-up control only appears for a
// site-assigned entry (Actions require project_id) and wires
// createAction correctly.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const PAGE = new URL("../../tracker/my-diary.html", import.meta.url).pathname;

function ctx(overrides = {}) {
  const calls = [];
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) },
    from(table) {
      const api = {
        select() { return api; }, order() { return api; }, eq() { return api; },
        then(resolve) { resolve({ data: table === "projects" ? [{ id: "p1", name: "County Flats" }] : [], error: null }); },
      };
      return api;
    },
  };
  return {
    calls,
    ctx: {
      __url: "https://example.com/my-diary.html",
      supabase,
      requireAuth: async () => ({ id: "u1" }),
      renderHeader: () => {},
      escapeHtml: (s) => String(s ?? "").replace(/</g, "&lt;"),
      formatDate: (d) => d || "",
      showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
      clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
      getMyDiaryEntries: async () => [],
      createDiaryEntry: async (fields) => { calls.push(["create", fields]); return { id: "d1", ...fields }; },
      updateDiaryEntry: async (id, fields) => { calls.push(["update", id, fields]); return { id, ...fields }; },
      deleteDiaryEntry: async (id) => { calls.push(["delete", id]); },
      uploadPhoto: async (file, path) => { calls.push(["upload", path]); return `${path}/x.jpg`; },
      getSitePhotoUrls: async () => new Map(),
      getActionsForDiaryEntry: async () => [],
      createAction: async (projectId, fields) => { calls.push(["createAction", projectId, fields]); return { id: "a1" }; },
      ...overrides,
    },
  };
}

test("my-diary.html: photo upload is hidden until a site is picked, and appears once one is", async () => {
  const { ctx: c } = ctx();
  const { document } = await runPage(PAGE, extractScript(PAGE), c);
  await wait(30);
  assert.equal(document.getElementById("photosField").style.display, "none");
  document.getElementById("entrySite").value = "p1";
  fireEvent(document.getElementById("entrySite"), "change");
  await wait(10);
  assert.equal(document.getElementById("photosField").style.display, "block");
});

test("my-diary.html: saving a plain entry (no site) calls createDiaryEntry with project_id null, no photos possible", async () => {
  const { ctx: c, calls } = ctx();
  const { document } = await runPage(PAGE, extractScript(PAGE), c);
  await wait(30);
  document.getElementById("entryBody").value = "Quiet day, no issues.";
  fireEvent(document.getElementById("entryForm"), "submit");
  await wait(30);
  const created = calls.find((x) => x[0] === "create");
  assert.ok(created, "createDiaryEntry must have been called");
  assert.equal(created[1].project_id, null);
  assert.equal(created[1].body, "Quiet day, no issues.");
  assert.equal(created[1].photos.length, 0);
});

test("my-diary.html: delay_reason is only sent when the delay checkbox is ticked", async () => {
  const { ctx: c, calls } = ctx();
  const { document } = await runPage(PAGE, extractScript(PAGE), c);
  await wait(30);
  document.getElementById("entryBody").value = "No delay today";
  document.getElementById("entryDelayReason").value = "left over text, should be ignored";
  fireEvent(document.getElementById("entryForm"), "submit");
  await wait(30);
  assert.equal(calls[0][1].delay_flag, false);
  assert.equal(calls[0][1].delay_reason, null);
});

test("my-diary.html: editing an existing entry calls updateDiaryEntry, not createDiaryEntry", async () => {
  const entry = { id: "d9", entry_date: "2026-11-01", project_id: null, body: "Original note", weather: null, labour_count: null, visitors: null, delay_flag: false, delay_reason: null, photos: [] };
  const { ctx: c, calls } = ctx({ getMyDiaryEntries: async () => [entry] });
  const { document } = await runPage(PAGE, extractScript(PAGE), c);
  await wait(30);
  document.querySelector('[data-edit="d9"]').click();
  await wait(10);
  assert.equal(document.getElementById("entryBody").value, "Original note");
  document.getElementById("entryBody").value = "Edited note";
  fireEvent(document.getElementById("entryForm"), "submit");
  await wait(30);
  assert.deepEqual(calls.map((x) => x[0]), ["update"]);
  assert.equal(calls[0][1], "d9");
  assert.equal(calls[0][2].body, "Edited note");
});

test("my-diary.html: delete asks for confirmation then calls deleteDiaryEntry", async () => {
  const entry = { id: "d9", entry_date: "2026-11-01", project_id: null, body: "To be deleted", photos: [] };
  const { ctx: c, calls } = ctx({ getMyDiaryEntries: async () => [entry] });
  const { document, window } = await runPage(PAGE, extractScript(PAGE), c);
  await wait(30);
  window.confirm = () => false;
  document.querySelector('[data-delete="d9"]').click();
  await wait(20);
  assert.equal(calls.length, 0);
  window.confirm = () => true;
  document.querySelector('[data-delete="d9"]').click();
  await wait(20);
  assert.deepEqual(calls[0], ["delete", "d9"]);
});

test("my-diary.html: a site-assigned entry shows its follow-up actions and an add-follow-up control; a personal entry shows neither", async () => {
  const siteEntry = { id: "d1", entry_date: "2026-11-01", project_id: "p1", body: "Site note", photos: [] };
  const personalEntry = { id: "d2", entry_date: "2026-11-02", project_id: null, body: "Personal note", photos: [] };
  const { ctx: c } = ctx({
    getMyDiaryEntries: async () => [siteEntry, personalEntry],
    getActionsForDiaryEntry: async (id) => (id === "d1" ? [{ title: "Fix the fence", status: "open" }] : []),
  });
  const { document } = await runPage(PAGE, extractScript(PAGE), c);
  await wait(30);
  const siteCard = document.querySelector('[data-entry="d1"]');
  const personalCard = document.querySelector('[data-entry="d2"]');
  assert.match(siteCard.textContent, /Fix the fence/);
  assert.ok(siteCard.querySelector('[data-add-followup="d1"]'), "a site-assigned entry must show the add-follow-up control");
  assert.ok(!personalCard.querySelector('[data-add-followup="d2"]'), "a personal (no-site) entry must never show the add-follow-up control — Actions require project_id");
  assert.doesNotMatch(personalCard.textContent, /Follow-ups/);
});

test("my-diary.html: adding a follow-up calls createAction with the entry's own project_id and sourceDiaryEntryId — nothing copied from the note itself", async () => {
  const siteEntry = { id: "d1", entry_date: "2026-11-01", project_id: "p1", body: "Site note that must never be copied", photos: [] };
  const { ctx: c, calls } = ctx({ getMyDiaryEntries: async () => [siteEntry] });
  const { document } = await runPage(PAGE, extractScript(PAGE), c);
  await wait(30);
  const wrap = document.querySelector('[data-followup-form="d1"]');
  wrap.querySelector("input").value = "Order more hi-vis";
  document.querySelector('[data-add-followup="d1"]').click();
  await wait(30);
  const created = calls.find((x) => x[0] === "createAction");
  assert.ok(created);
  assert.equal(created[1], "p1");
  assert.equal(created[2].title, "Order more hi-vis", "the title is exactly what the user typed, never the diary note's own body");
  assert.equal(created[2].sourceDiaryEntryId, "d1");
});
