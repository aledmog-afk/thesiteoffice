// Reliability (Priority 2): several status/checklist/percent toggle
// handlers used to discard the write's error and optimistically update
// the UI regardless — a silently-failed save looked identical to a
// successful one. This proves the real plot-detail.html gate-status
// handler now checks the result and reverts the dropdown when the write
// actually fails, instead of leaving a misleading UI state behind.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/plot-detail.html", import.meta.url).pathname;

const PLOT = {
  id: "plot1", plot_number: "Plot 5", progress_pct: 40, project_id: "p1", block_id: null,
  projects: { id: "p1", name: "Site" }, blocks: null,
};
const GATE = { id: "gate1", plot_id: "plot1", project_id: "p1", gate_key: "substructure_drainage", title: "Substructure & Drainage", status: "not_started", checklist: [], sort_order: 1 };

function makeSupabase({ gateUpdateShouldFail = false } = {}) {
  const calls = [];
  const gate = { ...GATE };
  return {
    calls,
    gate,
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        single: async () => (table === "plots" ? { data: PLOT, error: null } : { data: null, error: null }),
        update(payload) {
          calls.push({ table, op: "update", payload });
          return {
            eq: async () => {
              if (table === "quality_gates" && gateUpdateShouldFail) {
                return { error: { message: "network error saving gate" }, data: null };
              }
              if (table === "quality_gates" && payload.status) gate.status = payload.status;
              return { error: null, data: null };
            },
          };
        },
        then(resolve) {
          if (table === "quality_gates") resolve({ data: [gate], error: null });
          else resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
}

async function run(supabase) {
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/plot-detail.html?id=plot1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "plot1",
    escapeHtml: (s) => String(s ?? ""),
    showError: () => {}, clearError: () => {},
    uploadImage: async () => "",
    suggestPlotProgress: async () => 0,
    recalculateActualProgress: async () => {},
    checkAndMarkPlotHandedOver: async () => {},
    alert: () => {},
  });
}

test("plot-detail.html: a successful gate status change persists and updates the badge", async () => {
  const supabase = makeSupabase({ gateUpdateShouldFail: false });
  const { document, window } = await run(supabase);
  await wait(30);

  const select = document.querySelector('select.gate-status-select[data-gate-id="gate1"]');
  assert.ok(select, "expected the gate's status dropdown to have rendered");
  select.value = "in_progress";
  fireEvent(select, "change");
  await wait(30);

  assert.equal(supabase.gate.status, "in_progress", "the write should have gone through");
  const badge = document.querySelector('.gate-card[data-gate-id="gate1"] .badge');
  assert.ok(badge && badge.textContent.toLowerCase().includes("in progress"), "the card should re-render showing the new status");
});

test("plot-detail.html: a FAILED gate status write reverts the dropdown instead of showing a false success", async () => {
  const supabase = makeSupabase({ gateUpdateShouldFail: true });
  let alertMessage = null;
  const { document, window } = await runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/plot-detail.html?id=plot1",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "plot1",
    escapeHtml: (s) => String(s ?? ""),
    showError: () => {}, clearError: () => {},
    uploadImage: async () => "",
    suggestPlotProgress: async () => 0,
    recalculateActualProgress: async () => {},
    checkAndMarkPlotHandedOver: async () => {},
    alert: (msg) => { alertMessage = msg; },
  });
  await wait(30);

  const select = document.querySelector('select.gate-status-select[data-gate-id="gate1"]');
  select.value = "in_progress";
  fireEvent(select, "change");
  await wait(30);

  assert.equal(supabase.gate.status, "not_started", "the underlying data must NOT have changed");
  assert.ok(alertMessage && alertMessage.includes("network error saving gate"), "the user must be told the save failed, not left thinking it worked");
  // The critical regression this guards against: the dropdown reverting to
  // reflect reality, rather than staying on the value the user picked as
  // if it had been saved.
  const reselected = document.querySelector('select.gate-status-select[data-gate-id="gate1"]');
  assert.equal(reselected.value, "not_started", "the dropdown must revert to the last ACTUALLY-SAVED status, not the failed attempt");
});
