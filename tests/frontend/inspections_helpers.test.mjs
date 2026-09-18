// Inspections (Priority 7) — dashboard-integration calculation logic:
// countFindingSignals() and computeControlStatus()'s new
// finding-related rules. Extracted via the same regex approach as
// tests/uploads/client.test.mjs. Every test uses a FIXED date string,
// never the real clock.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
function extractFunction(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

const scope = `
  ${extractFunction("toLocalISODate")}
  ${extractFunction("todayISO")}
  ${extractConst("DUE_SOON_DAYS")}
  ${extractFunction("categoriseAction")}
  ${extractFunction("isFindingOutstanding")}
  ${extractFunction("countFindingSignals")}
  ${extractConst("ACTION_STATUS_TRANSITIONS")}
  ${extractFunction("computeControlStatus")}
  return { isFindingOutstanding, countFindingSignals, computeControlStatus };
`;
const { isFindingOutstanding, countFindingSignals, computeControlStatus } = new Function(scope)();

const TODAY = "2026-09-10";

test("isFindingOutstanding: open/action_required are outstanding; resolved/accepted/cancelled are not", () => {
  assert.equal(isFindingOutstanding({ status: "open" }), true);
  assert.equal(isFindingOutstanding({ status: "action_required" }), true);
  assert.equal(isFindingOutstanding({ status: "resolved" }), false);
  assert.equal(isFindingOutstanding({ status: "accepted" }), false);
  assert.equal(isFindingOutstanding({ status: "cancelled" }), false);
});

test("countFindingSignals: a critical open finding counts regardless of any linked action", () => {
  const findings = [{ severity: "critical", status: "open", action_id: null }];
  const counts = countFindingSignals(findings, new Map(), TODAY);
  assert.equal(counts.criticalOpenFindings, 1);
  assert.equal(counts.highSeverityOverdueLinkedFindings, 0);
  assert.equal(counts.highSeverityDueSoonLinkedFindings, 0);
});

test("countFindingSignals: a resolved critical finding does not count", () => {
  const findings = [{ severity: "critical", status: "resolved", action_id: null }];
  const counts = countFindingSignals(findings, new Map(), TODAY);
  assert.equal(counts.criticalOpenFindings, 0);
});

test("countFindingSignals: a high-severity finding with NO linked action produces no signal at all", () => {
  const findings = [{ severity: "high", status: "open", action_id: null }];
  const counts = countFindingSignals(findings, new Map(), TODAY);
  assert.equal(counts.highSeverityOverdueLinkedFindings, 0);
  assert.equal(counts.highSeverityDueSoonLinkedFindings, 0);
});

test("countFindingSignals: a high-severity finding with an OVERDUE linked action counts as overdue-linked", () => {
  const actionsById = new Map([["a1", { status: "open", due_date: "2026-01-01" }]]);
  const findings = [{ severity: "high", status: "action_required", action_id: "a1" }];
  const counts = countFindingSignals(findings, actionsById, TODAY);
  assert.equal(counts.highSeverityOverdueLinkedFindings, 1);
  assert.equal(counts.highSeverityDueSoonLinkedFindings, 0);
});

test("countFindingSignals: a high-severity finding with a DUE-SOON linked action counts as due-soon-linked, not overdue", () => {
  const actionsById = new Map([["a1", { status: "open", due_date: "2026-09-14" }]]); // 4 days out
  const findings = [{ severity: "high", status: "action_required", action_id: "a1" }];
  const counts = countFindingSignals(findings, actionsById, TODAY);
  assert.equal(counts.highSeverityOverdueLinkedFindings, 0);
  assert.equal(counts.highSeverityDueSoonLinkedFindings, 1);
});

test("countFindingSignals: a high-severity finding with a completed linked action produces no signal", () => {
  const actionsById = new Map([["a1", { status: "completed", due_date: "2020-01-01" }]]);
  const findings = [{ severity: "high", status: "action_required", action_id: "a1" }];
  const counts = countFindingSignals(findings, actionsById, TODAY);
  assert.equal(counts.highSeverityOverdueLinkedFindings, 0, "a completed action is never 'overdue', even with a past due_date");
});

test("computeControlStatus: a critical open finding alone triggers Attention", () => {
  const status = computeControlStatus({ openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0, criticalOpenFindings: 1, highSeverityOverdueLinkedFindings: 0, highSeverityDueSoonLinkedFindings: 0 });
  assert.equal(status.level, "attention");
  assert.equal(status.reason, "Attention — 1 critical open inspection finding.");
});

test("computeControlStatus: a high-severity finding with an overdue Action triggers Attention", () => {
  const status = computeControlStatus({ openActions: 1, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0, criticalOpenFindings: 0, highSeverityOverdueLinkedFindings: 1, highSeverityDueSoonLinkedFindings: 0 });
  assert.equal(status.level, "attention");
  assert.equal(status.reason, "Attention — 1 high-severity finding with an overdue Action.");
});

test("computeControlStatus: a high-severity finding with an Action due soon (no overdue/critical) is Watch, not Attention", () => {
  const status = computeControlStatus({ openActions: 1, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0, criticalOpenFindings: 0, highSeverityOverdueLinkedFindings: 0, highSeverityDueSoonLinkedFindings: 1 });
  assert.equal(status.level, "watch");
  assert.equal(status.reason, "Watch — 1 high-severity finding with an Action due soon.");
});

test("computeControlStatus: with no finding signals at all, behaviour is unchanged from Priority 6 (undefined fields default safely)", () => {
  const status = computeControlStatus({ openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0 });
  assert.equal(status.level, "on_track");
});
