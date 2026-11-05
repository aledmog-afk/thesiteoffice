// v87: snagging-report.html's "Pinned Drawings" print section — the
// site-wide sheet re-fetches pins scoped to whatever the CURRENT status
// filter shows (render() is async and re-runs on every filter change),
// so this file proves: pins are fetched for exactly the filtered set
// (not all project items), numbered with each item's own item_no, the
// section is omitted gracefully (never a page error) for a viewer who
// can't read drawings under RLS, and Print waits for every pinned
// drawing image to actually load before window.print() fires.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const PAGE = new URL("../../tracker/snagging-report.html", import.meta.url).pathname;

const SNAG_STATUS_LABEL = { open: "Open", pending_review: "Pending Review", closed: "Closed", rejected: "Rejected" };

function snag(id, overrides = {}) {
  return {
    id, item_no: 1, location: "Kitchen", description: "Crack in wall", trade: "Plasterer",
    status: "open", photo_url: null, raised_date: "2026-11-01", delay_flag: false,
    snag_lists: { title: "General Snags", plot_id: null, plots: null }, ...overrides,
  };
}

function ctx(store, overrides = {}) {
  const supabase = {
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; },
        single: async () => (table === "projects" ? { data: store.project, error: null } : { data: null, error: null }),
        then(resolve) { resolve(table === "snag_items" ? { data: store.snags, error: null } : { data: [], error: null }); },
      };
      return api;
    },
  };
  return {
    __url: "https://example.com/snagging-report.html?project=p1",
    getParam: () => "p1",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? "").replace(/</g, "&lt;"),
    formatDate: (d) => d || "",
    todayISO: () => "2026-11-05",
    getOrgLogoUrl: async () => null,
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }),
    SNAG_STATUS_LABEL,
    supabase,
    getDrawingPinsForSnagItems: async () => [],
    buildPinnedDrawingsHtml: overrides.buildPinnedDrawingsHtml,
    getSitePhotoUrls: async (refs) => new Map(refs.map((r) => [r, `https://signed.example/${r}`])),
    ...overrides,
  };
}

// Real app.js buildPinnedDrawingsHtml(), inlined (not imported — this
// harness mocks the data layer the page imports, not app.js itself).
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

test("snagging-report.html: pins are fetched for exactly the currently-filtered items, numbered with each item's own item_no", async () => {
  const store = {
    project: { id: "p1", name: "Test Site", org_id: "org1", main_contractor_email: "mc@test.com", contract_ref: null },
    snags: [
      snag("s1", { item_no: 1, status: "open", snag_lists: { title: "List A", plot_id: null, plots: null } }),
      snag("s2", { item_no: 7, status: "closed", snag_lists: { title: "List A", plot_id: null, plots: null } }),
    ],
  };
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx(store, {
    getDrawingPinsForSnagItems: async (ids) => {
      assert.deepEqual(ids, ["s1"], "default filter is Open only — must only request pins for the open item, not the closed one");
      return [{ id: "pin1", x_pct: 25, y_pct: 75, snag_item_id: "s1", drawing_page_id: "pageA", image_url: "drawings/p1/pageA.jpg", drawing_title: "Site Plan" }];
    },
    buildPinnedDrawingsHtml: realBuildPinnedDrawingsHtml,
  }));
  await wait(30);
  const doc = document.getElementById("doc");
  assert.match(doc.textContent, /Pinned Drawings/);
  assert.match(doc.textContent, /Site Plan/);
  const pinEl = doc.querySelector(".pin-numbered");
  assert.ok(pinEl, "a numbered pin marker must be rendered");
  assert.equal(pinEl.textContent.trim(), "1", "the marker must show snag s1's own item_no");
  const img = doc.querySelector("[data-drawing-page-img]");
  assert.ok(img.src.startsWith("https://signed.example/"), "the image src must be the SIGNED url, not the bare stored path");
});

test("snagging-report.html: re-fetches pins scoped to the new filter when the status filter changes", async () => {
  const store = {
    project: { id: "p1", name: "Test Site", org_id: "org1", main_contractor_email: "mc@test.com", contract_ref: null },
    snags: [
      snag("s1", { item_no: 1, status: "open", snag_lists: { title: "List A", plot_id: null, plots: null } }),
      snag("s2", { item_no: 7, status: "closed", snag_lists: { title: "List A", plot_id: null, plots: null } }),
    ],
  };
  const calls = [];
  const { document, window } = await runPage(PAGE, extractScript(PAGE), ctx(store, {
    getDrawingPinsForSnagItems: async (ids) => { calls.push(ids.slice().sort()); return []; },
    buildPinnedDrawingsHtml: realBuildPinnedDrawingsHtml,
  }));
  await wait(30);
  assert.deepEqual(calls[0], ["s1"], "initial render (Open only) must request pins for s1 only");

  document.getElementById("statusFilter").value = "all";
  document.getElementById("statusFilter").dispatchEvent(new window.Event("change"));
  await wait(30);
  assert.deepEqual(calls[1], ["s1", "s2"], "switching to All must re-request pins for both items");
});

test("snagging-report.html: a viewer who can't read drawings under RLS just loses the Pinned Drawings section — no page error, rest of the sheet still renders", async () => {
  const store = {
    project: { id: "p1", name: "Test Site", org_id: "org1", main_contractor_email: "mc@test.com", contract_ref: null },
    snags: [snag("s1", { item_no: 1, status: "open", description: "Crack in wall", snag_lists: { title: "List A", plot_id: null, plots: null } })],
  };
  const { document } = await runPage(PAGE, extractScript(PAGE), ctx(store, {
    getDrawingPinsForSnagItems: async () => { throw new Error("permission denied for table drawing_pins"); },
    buildPinnedDrawingsHtml: realBuildPinnedDrawingsHtml,
  }));
  await wait(30);
  const doc = document.getElementById("doc");
  assert.doesNotMatch(doc.textContent, /Pinned Drawings/);
  assert.match(doc.textContent, /Crack in wall/, "the ordinary snag table must still render fully");
});

test("snagging-report.html: Print waits for the pinned drawing's image to actually load before window.print() fires", async () => {
  let printed = 0;
  const store = {
    project: { id: "p1", name: "Test Site", org_id: "org1", main_contractor_email: "mc@test.com", contract_ref: null },
    snags: [snag("s1", { item_no: 1, status: "open", snag_lists: { title: "List A", plot_id: null, plots: null } })],
  };
  const { document, window } = await runPage(PAGE, extractScript(PAGE), ctx(store, {
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
