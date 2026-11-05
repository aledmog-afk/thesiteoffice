// v85: tracker/site-diary.html — the "site diary" is just everyone's
// personal_diary_entries filtered to one project. The real visibility
// rule (contractor-side editor / owner-side excluded) is enforced at
// the database layer (see tests/database/v85_personal_diary_entries.test.mjs)
// and getSiteDiaryEntries() is a plain query with no extra client-side
// filtering — this just proves the page renders whatever comes back.
//
// Author emails come from getMemberEmailMap(), same pattern as every
// other page that shows one (toolbox talks, dayworks/variations,
// documents, my-work) — NOT a PostgREST embed into auth.users, which
// this briefly shipped as and which can never work in this app (see
// app.js's own getSiteDiaryEntries() comment for why).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const PAGE = new URL("../../tracker/site-diary.html", import.meta.url).pathname;

function ctx(overrides = {}) {
  const supabase = {
    from(table) {
      const api = { select() { return api; }, eq() { return api; }, single: async () => ({ data: { name: "County Flats" }, error: null }) };
      return api;
    },
  };
  return {
    __url: "https://example.com/site-diary.html?project=p1",
    getParam: (n) => (n === "project" ? "p1" : null),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? "").replace(/</g, "&lt;"),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    supabase,
    getSiteDiaryEntries: async () => [],
    getSitePhotoUrls: async () => new Map(),
    getMemberEmailMap: async () => ({}),
    ...overrides,
  };
}

test("site-diary.html: renders entries from everyone the server chose to return, resolving authors via getMemberEmailMap and marking the viewer's own", async () => {
  const entries = [
    { id: "d1", entry_date: "2026-11-01", user_id: "other-user", body: "Steel delivery today.", photos: [] },
    { id: "d2", entry_date: "2026-11-02", user_id: "u1", body: "My own note.", photos: [] },
  ];
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx({
    getSiteDiaryEntries: async () => entries,
    getMemberEmailMap: async () => ({ "other-user": "mc@main.test", u1: "me@x.test" }),
  }));
  await wait(30);
  const text = document.getElementById("entryList").textContent;
  assert.match(text, /Steel delivery today/);
  assert.match(text, /mc@main\.test/, "another author's email, resolved via getMemberEmailMap, must render — not a broken auth.users embed");
  assert.match(text, /My own note/);
  assert.match(text, /\(you\)/);
  assert.equal(document.getElementById("noEntries").style.display, "none");
});

test("site-diary.html: an empty result (nothing visible to this viewer yet) shows the empty state, not an error", async () => {
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx());
  await wait(30);
  assert.equal(document.getElementById("noEntries").style.display, "block");
  assert.equal(document.getElementById("errorBox").textContent, "");
});

test("site-diary.html: a thrown error (e.g. a genuine failure, not just an empty/restricted result) shows as a page error", async () => {
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx({ getSiteDiaryEntries: async () => { throw new Error("network down"); } }));
  await wait(30);
  assert.match(document.getElementById("errorBox").textContent, /network down/);
});
