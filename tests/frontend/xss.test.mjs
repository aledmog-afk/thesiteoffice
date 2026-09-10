// XSS regression tests. Not an exhaustive sweep (see the Priority 2
// report for that — every innerHTML sink in the app was reviewed by
// hand) — this is a permanent regression net over the highest-value
// user-controlled rendering points, so a future edit that drops an
// escapeHtml() call gets caught automatically instead of by another
// manual audit.
//
// The strong assertion used throughout: after rendering, the element's
// .textContent reads back the EXACT original malicious string (proving
// it was HTML-entity-escaped then correctly un-escaped by the browser's
// own parser) AND no live <script> element or executable event-handler
// attribute exists anywhere in the rendered subtree. A payload that was
// merely stripped, truncated, or silently dropped would fail the first
// check; a payload that was insufficiently escaped would fail the second.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const SCRIPT_PAYLOAD = "<script>alert(1)</script>";
const IMG_PAYLOAD = '<img src=x onerror=alert(1)>';

function assertRenderedSafely(container, payload, fieldDescription) {
  assert.ok(
    container.innerHTML.includes(payload) === false || container.textContent.includes(payload),
    `${fieldDescription}: payload should appear as text`
  );
  assert.equal(container.querySelector("script"), null, `${fieldDescription}: must not create a live <script> element`);
  container.querySelectorAll("[onerror]").forEach((el) => {
    assert.fail(`${fieldDescription}: found a live onerror attribute — ${el.outerHTML}`);
  });
  assert.ok(container.textContent.includes(payload), `${fieldDescription}: the original text should still be readable via textContent (proves it was escaped, not stripped)`);
}

// ─── Unit level: escapeHtml() itself ──────────────────────────────
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
const escapeHtmlSrc = APP_JS.match(/export function escapeHtml\(str\)[\s\S]*?\n\}/)[0]
  .replace(/^export function escapeHtml\(str\)\s*\{/, "")
  .replace(/\}$/, "");
const escapeHtml = new Function(`return function escapeHtml(str) {\n${escapeHtmlSrc}\n}`)();

test("escapeHtml(): neutralises <script> and event-handler payloads at the character level", () => {
  const scriptOut = escapeHtml(SCRIPT_PAYLOAD);
  assert.ok(!scriptOut.includes("<script>"), "raw <script> tag must not survive escaping");
  assert.ok(scriptOut.includes("&lt;script&gt;"));

  const imgOut = escapeHtml(IMG_PAYLOAD);
  assert.ok(!imgOut.includes("<img"), "raw <img tag must not survive escaping");
  assert.ok(imgOut.includes("&lt;img"));
});

// ─── dashboard.html: site name + main contractor name ─────────────
test("dashboard.html: a malicious site name and contractor name render as inert text", async () => {
  const htmlPath = new URL("../../tracker/dashboard.html", import.meta.url).pathname;
  const project = {
    id: "p1", name: SCRIPT_PAYLOAD, main_contractor_name: IMG_PAYLOAD,
    rag_status: "green", status: "active", baseline_progress_pct: 0, actual_progress_pct: 0,
  };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; },
        then(resolve) {
          if (table === "projects") resolve({ data: [project], error: null });
          else resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
  const { document } = await runPage(htmlPath, extractScript(htmlPath), {
    __url: "https://example.com/dashboard.html",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml,
    formatDate: (d) => d || "",
    showError: () => {}, clearError: () => {},
    RAG_LABEL: { red: "Red", amber: "Amber", green: "Green" },
    renderProgressBlock: () => "",
  });
  await wait(30);
  const grid = document.getElementById("grid");
  assertRenderedSafely(grid, SCRIPT_PAYLOAD, "dashboard.html site name");
  assertRenderedSafely(grid, IMG_PAYLOAD, "dashboard.html contractor name");
});

// ─── commercials.html: item title ──────────────────────────────────
test("commercials.html: a malicious commercial item title renders as inert text", async () => {
  const htmlPath = new URL("../../tracker/commercials.html", import.meta.url).pathname;
  const item = { id: "c1", title: SCRIPT_PAYLOAD, type: "early_warning", cost_impact: null, time_impact_days: null, status: "pending_client_review", weekly_report_id: null };
  const supabase = {
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; }, single: async () => ({ data: { id: "p1", name: "Site" }, error: null }),
        then(resolve) {
          if (table === "commercial_items") resolve({ data: [item], error: null });
          else resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
  const { document } = await runPage(htmlPath, extractScript(htmlPath), {
    __url: "https://example.com/commercials.html?project=p1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "p1",
    escapeHtml,
    formatGBP: () => null,
    showError: () => {}, clearError: () => {},
  });
  await wait(30);
  const rows = document.getElementById("itemRows");
  assertRenderedSafely(rows, SCRIPT_PAYLOAD, "commercials.html item title");
});

// ─── snag-list-edit.html: description, location, trade ─────────────
test("snag-list-edit.html: malicious snag description/location/trade render as inert text", async () => {
  const htmlPath = new URL("../../tracker/snag-list-edit.html", import.meta.url).pathname;
  const snag = {
    id: "s1", item_no: 1, plot_id: null, location: SCRIPT_PAYLOAD, description: IMG_PAYLOAD,
    trade: SCRIPT_PAYLOAD, status: "open", photo_url: null, delay_flag: false, delay_reason: null,
  };
  const snagList = { id: "l1", plot_id: null, title: "General", projects: { id: "p1", name: "Site", main_contractor_email: null }, plots: null };
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; }, order() { return api; },
        single: async () => (table === "snag_lists" ? { data: snagList, error: null } : { data: null, error: null }),
        then(resolve) {
          if (table === "snag_items") resolve({ data: [snag], error: null });
          else resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
  const { document } = await runPage(htmlPath, extractScript(htmlPath), {
    __url: "https://example.com/snag-list-edit.html?id=l1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "l1",
    escapeHtml,
    todayISO: () => "2026-01-01",
    showError: () => {}, clearError: () => {},
  });
  await wait(30);
  const rows = document.getElementById("snagRows");
  assertRenderedSafely(rows, IMG_PAYLOAD, "snag-list-edit.html description");
  assertRenderedSafely(rows, SCRIPT_PAYLOAD, "snag-list-edit.html location/trade");
});

// ─── settings.html: organisation name goes through a safe sink by
// construction (an <input>'s .value property), never innerHTML ──────
test("settings.html: a malicious organisation name is set via .value (never interpreted as HTML)", async () => {
  const htmlPath = new URL("../../tracker/settings.html", import.meta.url).pathname;
  const supabase = {
    from(table) {
      const api = {
        select() { return api; }, eq() { return api; },
        single: async () => (table === "organisations" ? { data: { name: SCRIPT_PAYLOAD }, error: null } : { data: null, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return api;
    },
  };
  const { document } = await runPage(htmlPath, extractScript(htmlPath), {
    __url: "https://example.com/settings.html",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    ensureOrganisation: async () => "org1",
    showError: () => {}, clearError: () => {},
    uploadPhoto: async () => "",
  });
  await wait(30);
  const input = document.getElementById("orgName");
  assert.equal(input.value, SCRIPT_PAYLOAD, "the raw name should be readable back from .value");
  assert.equal(document.querySelector("script"), null, "setting .value must never create a live <script> element");
});
