// Handover State Consistency (Priority 15, Phase 1) — checkAndMarkPlotHandedOver()
// exercised against the REAL app.js source (regex-extracted, never
// reimplemented). getPlotHandoverReadiness() and the network layer are
// deliberately mocked out here rather than re-fetched/re-mocked in
// full — their own correctness is already covered by
// plot_handover_readiness.test.mjs and plot_action_finding_linkage.test.mjs.
// This file's whole job is checkAndMarkPlotHandedOver()'s OWN decision
// logic: does it call readiness, does it gate strictly on
// "ready"/"at_risk", does it avoid writing otherwise, and does it stay
// non-throwing when either the readiness fetch or the write itself
// fails (e.g. the v39 DB trigger rejecting a genuine race).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractFn(name) {
  const m = APP_JS.match(new RegExp(`export (?:async )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

function buildScope() {
  const SCOPE = `
    let __readinessImpl = async () => ({ readiness: { status: "ready", blockers: [], warnings: [] } });
    let __readinessCalls = 0;
    function getPlotHandoverReadiness(plotId) { __readinessCalls++; return __readinessImpl(plotId); }

    let __updateImpl = async () => ({ error: null });
    let __updateCalls = [];
    const supabase = {
      from(table) {
        return {
          update(fields) {
            return {
              eq(col, val) {
                __updateCalls.push({ table, fields, col, val });
                return __updateImpl(table, fields, col, val);
              },
            };
          },
        };
      },
    };

    ${extractFn("checkAndMarkPlotHandedOver")}

    return {
      checkAndMarkPlotHandedOver,
      setReadiness: (fn) => { __readinessImpl = fn; },
      setUpdate: (fn) => { __updateImpl = fn; },
      getReadinessCalls: () => __readinessCalls,
      getUpdateCalls: () => __updateCalls,
    };
  `;
  return new Function(SCOPE)();
}

function readinessOf(status, extra = {}) {
  return async () => ({ readiness: { status, blockers: [], warnings: [], ...extra } });
}

// ─── Permitted statuses stamp the plot ───────────────────────────────

test("status 'ready' -> attempts the write and returns true", async () => {
  const scope = buildScope();
  scope.setReadiness(readinessOf("ready"));
  const result = await scope.checkAndMarkPlotHandedOver("plot-1");
  assert.equal(result, true);
  const calls = scope.getUpdateCalls();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].table, "plots");
  assert.equal(calls[0].col, "id");
  assert.equal(calls[0].val, "plot-1");
  assert.ok(typeof calls[0].fields.handed_over_at === "string" && calls[0].fields.handed_over_at.length > 0);
});

test("status 'at_risk' (warnings only, no blockers) -> STILL attempts the write and returns true — warnings must never prevent the historical handover event", async () => {
  const scope = buildScope();
  scope.setReadiness(readinessOf("at_risk", { warnings: [{ code: "programme_overdue_activity", label: "1 programme activity is overdue" }] }));
  const result = await scope.checkAndMarkPlotHandedOver("plot-1");
  assert.equal(result, true);
  assert.equal(scope.getUpdateCalls().length, 1);
});

// ─── Refused statuses never even attempt the write ───────────────────

test("status 'not_ready' (a blocker exists) -> does NOT attempt the write, returns false", async () => {
  const scope = buildScope();
  scope.setReadiness(readinessOf("not_ready", { blockers: [{ code: "gates_outstanding", label: "1 of 4 Quality Gates not yet approved" }] }));
  const result = await scope.checkAndMarkPlotHandedOver("plot-1");
  assert.equal(result, false);
  assert.equal(scope.getUpdateCalls().length, 0);
});

test("status 'handed_over' (already recorded) -> does NOT attempt a redundant write, returns false", async () => {
  const scope = buildScope();
  scope.setReadiness(readinessOf("handed_over"));
  const result = await scope.checkAndMarkPlotHandedOver("plot-1");
  assert.equal(result, false);
  assert.equal(scope.getUpdateCalls().length, 0);
});

test("status 'restricted' (snagging-only caller) -> does NOT attempt the write, returns false — defence in depth on top of RLS", async () => {
  const scope = buildScope();
  scope.setReadiness(readinessOf("restricted"));
  const result = await scope.checkAndMarkPlotHandedOver("plot-1");
  assert.equal(result, false);
  assert.equal(scope.getUpdateCalls().length, 0);
});

// ─── Failure modes stay non-throwing ──────────────────────────────────

test("readiness fetch throws (e.g. network error) -> swallowed, returns false, no write attempted", async () => {
  const scope = buildScope();
  scope.setReadiness(async () => { throw new Error("network down"); });
  const result = await scope.checkAndMarkPlotHandedOver("plot-1");
  assert.equal(result, false);
  assert.equal(scope.getUpdateCalls().length, 0);
});

test("the write itself is rejected (e.g. the v39 trigger caught a genuine TOCTOU race) -> swallowed, returns false, does not throw", async () => {
  const scope = buildScope();
  scope.setReadiness(readinessOf("ready"));
  scope.setUpdate(async () => ({ error: { message: "Cannot record handover: blocked or overdue high/critical-priority Action(s) for this plot" } }));
  let threw = false;
  let result;
  try {
    result = await scope.checkAndMarkPlotHandedOver("plot-1");
  } catch {
    threw = true;
  }
  assert.equal(threw, false, "checkAndMarkPlotHandedOver must never let a rejected write propagate as an unhandled exception");
  assert.equal(result, false);
});

// ─── Repeatability ─────────────────────────────────────────────────────

test("calling twice in a row on an already-handed-over plot is idempotent — second call still makes no write attempt", async () => {
  const scope = buildScope();
  scope.setReadiness(readinessOf("ready"));
  const first = await scope.checkAndMarkPlotHandedOver("plot-1");
  assert.equal(first, true);
  assert.equal(scope.getUpdateCalls().length, 1);

  // Simulate the plot now being handed_over on the next readiness read
  // (as it would be, once the DB trigger's own immutability guard and
  // the real handed_over_at value are reflected back).
  scope.setReadiness(readinessOf("handed_over"));
  const second = await scope.checkAndMarkPlotHandedOver("plot-1");
  assert.equal(second, false);
  assert.equal(scope.getUpdateCalls().length, 1, "no second write attempt once already handed over");
});
