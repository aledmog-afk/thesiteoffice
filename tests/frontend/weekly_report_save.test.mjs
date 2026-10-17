// Reliability (Priority 2): weekly-report-form.html's syncCommercialItems()
// used to discard a failed commercial_items UPDATE and mark the item
// "synced" anyway — the report would appear saved successfully while a
// commercial-ledger edit silently never persisted. This tests the real
// function body (extracted, not reimplemented) directly.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const HTML = fs.readFileSync(new URL("../../tracker/weekly-report-form.html", import.meta.url).pathname, "utf8");

const match = HTML.match(/async function syncCommercialItems\(items, weeklyReportId, userId\)[\s\S]*?\n  \}/);
assert.ok(match, "syncCommercialItems not found in weekly-report-form.html");
const body = match[0]
  .replace(/^async function syncCommercialItems\(items, weeklyReportId, userId\)\s*\{/, "")
  .replace(/\}$/, "");
const syncCommercialItems = new Function(
  `return async function syncCommercialItems(items, weeklyReportId, userId, supabase, projectId) {\n${body}\n}`
)();

function makeSupabase({ updateShouldFail = false } = {}) {
  const calls = [];
  return {
    calls,
    from(table) {
      const api = {
        update(payload) {
          calls.push({ op: "update", table, payload });
          return { eq: async () => (updateShouldFail ? { error: { message: "connection reset" } } : { error: null }) };
        },
        insert(payload) {
          calls.push({ op: "insert", table, payload });
          return { select: () => ({ single: async () => ({ data: { id: "new-ledger-id" }, error: null }) }) };
        },
      };
      return api;
    },
  };
}

test("syncCommercialItems(): a successful update marks the item synced", async () => {
  const supabase = makeSupabase({ updateShouldFail: false });
  const items = [{ id: "1", ledger_id: "ledger-1", title: "EW-1", type: "early_warning", cost_impact: 500, time_impact_days: 2 }];
  const synced = await syncCommercialItems(items, "report-1", "user-1", supabase, "proj-1");
  assert.equal(synced.length, 1);
  assert.equal(synced[0].id, "1");
});

test("syncCommercialItems(): a FAILED update throws instead of silently marking the item synced", async () => {
  const supabase = makeSupabase({ updateShouldFail: true });
  const items = [{ id: "1", ledger_id: "ledger-1", title: "EW-1", type: "early_warning", cost_impact: 500, time_impact_days: 2 }];
  await assert.rejects(
    () => syncCommercialItems(items, "report-1", "user-1", supabase, "proj-1"),
    (err) => err.message === "connection reset",
    "a failed ledger update must propagate as a real error, not be swallowed"
  );
});

test("syncCommercialItems(): a brand-new item (no ledger_id) is inserted and gets a ledger_id back", async () => {
  const supabase = makeSupabase({});
  const items = [{ id: "new-1", ledger_id: null, title: "New EW", type: "early_warning", cost_impact: null, time_impact_days: null }];
  const synced = await syncCommercialItems(items, "report-1", "user-1", supabase, "proj-1");
  assert.equal(synced[0].ledger_id, "new-ledger-id");
  const insertCall = supabase.calls.find((c) => c.op === "insert");
  assert.equal(insertCall.payload.project_id, "proj-1");
  assert.equal(insertCall.payload.weekly_report_id, "report-1");
  assert.equal(insertCall.payload.created_by, "user-1");
});
