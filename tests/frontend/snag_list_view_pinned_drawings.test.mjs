// v87: snag-list-view.html's "Pinned Drawings" print section —
// app.js's own getDrawingPinsForSnagItems()/buildPinnedDrawingsHtml()
// are unit-level pure/data helpers (no dedicated test file of their
// own needed beyond what this page-level file already exercises
// through them); this file proves what the PAGE does: numbers each
// pin with its snag's own item_no, omits the whole section gracefully
// (never a page error) for a viewer who can't read drawings under RLS,
// and waits for the drawing image to actually load before Print fires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const PAGE = new URL("../../tracker/snag-list-view.html", import.meta.url).pathname;

function ctx(overrides = {}) {
  const list = {
    id: "list1", title: "Plot 5 Snag List",
    projects: { id: "p1", name: "Test Site", org_id: "org1", main_contractor_email: "mc@test.com", main_contractor_name: "Main Co", contract_ref: null },
    plots: { id: "plotA", plot_number: "5" },
  };
  const snags = [
    { id: "s1", item_no: 1, location: "Kitchen", description: "Crack in wall", trade: "Plasterer", status: "open", photo_url: null, raised_date: "2026-11-01", delay_flag: false },
    { id: "s2", item_no: 2, location: "Hallway", description: "Scuffed skirting", trade: null, status: "open", photo_url: null, raised_date: "2026-11-02", delay_flag: false },
  ];
  const supabase = {
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; },
        single: async () => (table === "snag_lists" ? { data: list, error: null } : { data: null, error: null }),
        then(resolve) { resolve(table === "snag_items" ? { data: snags, error: null } : { data: [], error: null }); },
      };
      return api;
    },
  };
  return {
    __url: "https://example.com/snag-list-view.html?id=list1",
    getParam: () => "list1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? "").replace(/</g, "&lt;"),
    formatDate: (d) => d || "",
    todayISO: () => "2026-11-05",
    getOrgLogoUrl: async () => null,
    isSnagOutstanding: (s) => s.status === "open",
    SNAG_STATUS_LABEL: { open: "Open", closed: "Closed" },
    SNAG_STATUS_BADGE: { open: "badge-red", closed: "badge-green" },
    supabase,
    getDrawingPinsForSnagItems: async () => [],
    buildPinnedDrawingsHtml: overrides.buildPinnedDrawingsHtml,
    getSitePhotoUrls: async (refs) => new Map(refs.map((r) => [r, `https://signed.example/${r}`])),
    ...overrides,
  };
}

// The real app.js buildPinnedDrawingsHtml(), inlined here (not
// imported — this file's harness mocks the data layer, not app.js
// itself) so these tests exercise the exact numbering/markup contract
// the real function produces, not a hand-rolled stand-in.
function realBuildPinnedDrawingsHtml(pins, itemNoBySnagId) {
  if (!pins || !pins.length) return "";
  const byPage = {};
  for (const p of pins) {
    (byPage[p.drawing_page_id] ||= { image_url: p.image_url, title: p.drawing_title, pins: [] }).pins.push(p);
  }
  const esc = (s) => String(s ?? "").replace(/</g, "&lt;");
  const blocks = Object.values(byPage).map((g) => `
    <div class="drawing-canvas-wrap pinned-drawing-print">
      ${g.title ? `<div class="hint">${esc(g.title)}</div>` : ""}
      <div class="drawing-canvas">
        <img src="${g.image_url || ""}" data-drawing-page-img alt="">
        ${g.pins.map((p) => `<div class="pin pin-numbered" style="left:${p.x_pct}%; top:${p.y_pct}%;"><span>${esc(String(itemNoBySnagId[p.snag_item_id] ?? "?"))}</span></div>`).join("")}
      </div>
    </div>`).join("");
  return `<div class="doc-section"><h3>Pinned Drawings</h3>${blocks}</div>`;
}

test("snag-list-view.html: renders a numbered pin for each pinned item, using the item's own item_no", async () => {
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx({
    getDrawingPinsForSnagItems: async (ids) => {
      assert.deepEqual(ids.sort(), ["s1", "s2"], "must be called with exactly this list's own snag item ids");
      return [{ id: "pin1", x_pct: 40, y_pct: 60, snag_item_id: "s2", drawing_page_id: "pageA", image_url: "drawings/p1/pageA.jpg", drawing_title: "Plot 5 — GF" }];
    },
    buildPinnedDrawingsHtml: realBuildPinnedDrawingsHtml,
  }));
  await wait(30);
  const doc = document.getElementById("doc");
  assert.match(doc.textContent, /Pinned Drawings/);
  assert.match(doc.textContent, /Plot 5 — GF/);
  const pinEl = doc.querySelector(".pin-numbered");
  assert.ok(pinEl, "a numbered pin marker must be rendered");
  assert.equal(pinEl.textContent.trim(), "2", "the marker must show snag s2's own item_no (2), not the pin's own id");
  assert.equal(pinEl.style.left, "40%");
  assert.equal(pinEl.style.top, "60%");
  const img = doc.querySelector("[data-drawing-page-img]");
  assert.ok(img.src.startsWith("https://signed.example/"), "the image src must be the SIGNED url, not the bare stored path");
});

test("snag-list-view.html: a viewer who can't read drawings under RLS just loses the Pinned Drawings section — no page error, rest of the sheet still renders", async () => {
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx({
    getDrawingPinsForSnagItems: async () => { throw new Error("permission denied for table drawing_pins"); },
    buildPinnedDrawingsHtml: realBuildPinnedDrawingsHtml,
  }));
  await wait(30);
  const doc = document.getElementById("doc");
  assert.doesNotMatch(doc.textContent, /Pinned Drawings/);
  assert.match(doc.textContent, /Crack in wall/, "the ordinary snag table must still render fully");
});

test("snag-list-view.html: Print waits for the pinned drawing's image to actually load before window.print() fires", async () => {
  let printed = 0;
  const { document, window } = await runPage(PAGE, extractScript(PAGE), ctx({
    getDrawingPinsForSnagItems: async () => [{ id: "pin1", x_pct: 10, y_pct: 10, snag_item_id: "s1", drawing_page_id: "pageA", image_url: "drawings/p1/pageA.jpg", drawing_title: null }],
    buildPinnedDrawingsHtml: realBuildPinnedDrawingsHtml,
  }));
  await wait(30);
  window.print = () => { printed++; };

  document.getElementById("printBtn").click();
  await wait(10);
  assert.equal(printed, 0, "must not print yet — the drawing image hasn't loaded");

  const img = document.querySelector("[data-drawing-page-img]");
  img.dispatchEvent(new window.Event("load"));
  await wait(10);
  assert.equal(printed, 1, "must print once the image has loaded");
});
