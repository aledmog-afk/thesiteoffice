// Project Control Dashboard (Priority 6) — pure calculation logic:
// overdue/due-today/due-soon/blocked/high-critical categorisation and
// the transparent, explainable control-status rules. Extracted via the
// same regex approach as tests/uploads/client.test.mjs (app.js can't be
// imported directly outside a browser). Every test uses a FIXED date
// string, never the real clock, so these never become flaky.
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
  ${extractFunction("aggregateActionCounts")}
  ${extractFunction("countHighSeverityHsIssues")}
  ${extractFunction("isSnagOutstanding")}
  ${extractFunction("categoriseSnag")}
  ${extractFunction("countSnagSignals")}
  ${extractFunction("computeControlStatus")}
  return { categoriseAction, aggregateActionCounts, countHighSeverityHsIssues, categoriseSnag, countSnagSignals, computeControlStatus };
`;
const { categoriseAction, aggregateActionCounts, countHighSeverityHsIssues, categoriseSnag, countSnagSignals, computeControlStatus } = new Function(scope)();

const TODAY = "2026-09-10";

test("categoriseAction: overdue when due_date is before today and status is active", () => {
  const cats = categoriseAction({ status: "open", priority: "medium", due_date: "2026-09-01" }, TODAY);
  assert.equal(cats.overdue, true);
  assert.equal(cats.dueToday, false);
  assert.equal(cats.dueSoon, false);
});

test("categoriseAction: due today when due_date equals today", () => {
  const cats = categoriseAction({ status: "in_progress", priority: "low", due_date: TODAY }, TODAY);
  assert.equal(cats.dueToday, true);
  assert.equal(cats.overdue, false);
});

test("categoriseAction: due soon at exactly the 7-day boundary, not beyond it", () => {
  assert.equal(categoriseAction({ status: "open", due_date: "2026-09-17" }, TODAY).dueSoon, true, "exactly 7 days out counts as due soon");
  assert.equal(categoriseAction({ status: "open", due_date: "2026-09-18" }, TODAY).dueSoon, false, "8 days out is upcoming, not due soon");
});

test("categoriseAction: blocked and high/critical priority are independent, non-exclusive flags", () => {
  const cats = categoriseAction({ status: "blocked", priority: "critical", due_date: null }, TODAY);
  assert.equal(cats.blocked, true);
  assert.equal(cats.highCritical, true);
  assert.equal(cats.overdue, false, "no due_date means it can't be overdue, even while blocked");
});

test("categoriseAction: completed and cancelled actions are never categorised as any exception, regardless of due_date/priority", () => {
  const completed = categoriseAction({ status: "completed", priority: "critical", due_date: "2020-01-01" }, TODAY);
  assert.deepEqual(completed, { overdue: false, dueToday: false, dueSoon: false, blocked: false, highCritical: false });
  const cancelled = categoriseAction({ status: "cancelled", priority: "critical", due_date: "2020-01-01" }, TODAY);
  assert.deepEqual(cancelled, { overdue: false, dueToday: false, dueSoon: false, blocked: false, highCritical: false });
});

test("aggregateActionCounts: correctly tallies a realistic mixed set, excluding completed/cancelled from every count", () => {
  const actions = [
    { status: "open", priority: "medium", due_date: "2026-09-01" }, // overdue
    { status: "in_progress", priority: "critical", due_date: "2026-09-05" }, // overdue + critical
    { status: "open", priority: "low", due_date: TODAY }, // due today
    { status: "blocked", priority: "medium", due_date: null }, // blocked
    { status: "open", priority: "high", due_date: "2026-09-14" }, // due soon + high
    { status: "open", priority: "medium", due_date: "2026-10-01" }, // upcoming, no category
    { status: "completed", priority: "critical", due_date: "2020-01-01" }, // excluded entirely
    { status: "cancelled", priority: "high", due_date: "2020-01-01" }, // excluded entirely
  ];
  const counts = aggregateActionCounts(actions, TODAY);
  assert.equal(counts.openActions, 6, "6 active actions; completed/cancelled excluded");
  assert.equal(counts.overdue, 2);
  assert.equal(counts.overdueCritical, 1, "only the overdue action that is ALSO critical counts here");
  assert.equal(counts.dueToday, 1);
  assert.equal(counts.dueSoon, 1);
  assert.equal(counts.blocked, 1);
  assert.equal(counts.highCritical, 2);
});

test("countHighSeverityHsIssues: only non_compliant + high severity counts", () => {
  const items = [
    { status: "non_compliant", severity: "high" },
    { status: "non_compliant", severity: "low" },
    { status: "compliant", severity: "high" },
    { status: "non_compliant", severity: "high" },
  ];
  assert.equal(countHighSeverityHsIssues(items), 2);
});

test("computeControlStatus: Attention — explains itself with the real counts, not a score", () => {
  const status = computeControlStatus({ openActions: 5, overdue: 2, overdueCritical: 1, dueToday: 0, dueSoon: 0, blocked: 1, highCritical: 0, highSeverityHs: 0 });
  assert.equal(status.level, "attention");
  assert.equal(status.reason, "Attention — 2 overdue actions (1 critical), 1 blocked.");
});

test("computeControlStatus: Attention triggers on unresolved high-severity H&S issues alone", () => {
  const status = computeControlStatus({ openActions: 1, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 2 });
  assert.equal(status.level, "attention");
  assert.equal(status.reason, "Attention — 2 unresolved high-severity H&S issues.");
});

test("computeControlStatus: Watch — due soon / due today / high-critical without overdue or blocked", () => {
  const status = computeControlStatus({ openActions: 3, overdue: 0, overdueCritical: 0, dueToday: 1, dueSoon: 2, blocked: 0, highCritical: 1, highSeverityHs: 0 });
  assert.equal(status.level, "watch");
  assert.equal(status.reason, "Watch — 1 due today, 2 due within 7 days, 1 high/critical priority open.");
});

test("computeControlStatus: On Track with open actions but zero exceptions", () => {
  const status = computeControlStatus({ openActions: 4, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0 });
  assert.equal(status.level, "on_track");
  assert.equal(status.reason, "On track — 4 open actions, no exceptions.");
});

test("computeControlStatus: On Track with no open actions at all is explicitly worded, not just '0 open actions'", () => {
  const status = computeControlStatus({ openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0 });
  assert.equal(status.level, "on_track");
  assert.equal(status.reason, "On track — no open actions.");
});

test("computeControlStatus: Attention outranks Watch even when both kinds of signal are present", () => {
  const status = computeControlStatus({ openActions: 5, overdue: 1, overdueCritical: 0, dueToday: 1, dueSoon: 1, blocked: 0, highCritical: 1, highSeverityHs: 0 });
  assert.equal(status.level, "attention", "a single overdue action must win over any number of watch-level signals");
});

// ─── Snag signals (Priority 8) ─────────────────────────────────────

test("categoriseSnag: overdue/dueToday/dueSoon mirror categoriseAction's own boundaries, on the snag's own due_date", () => {
  assert.equal(categoriseSnag({ status: "open", due_date: "2026-09-01" }, TODAY).overdue, true);
  assert.equal(categoriseSnag({ status: "open", due_date: TODAY }, TODAY).dueToday, true);
  assert.equal(categoriseSnag({ status: "open", due_date: "2026-09-17" }, TODAY).dueSoon, true, "exactly 7 days out counts as due soon");
  assert.equal(categoriseSnag({ status: "open", due_date: "2026-09-18" }, TODAY).dueSoon, false, "8 days out is upcoming, not due soon");
});

test("categoriseSnag: closed and rejected snags are never categorised as any exception, regardless of due_date/priority", () => {
  const closed = categoriseSnag({ status: "closed", priority: "high", due_date: "2020-01-01" }, TODAY);
  assert.deepEqual(closed, { overdue: false, dueToday: false, dueSoon: false, highPriority: false });
  const rejected = categoriseSnag({ status: "rejected", priority: "high", due_date: "2020-01-01" }, TODAY);
  assert.deepEqual(rejected, { overdue: false, dueToday: false, dueSoon: false, highPriority: false });
});

test("categoriseSnag: high priority is its own flag, independent of due_date, but only while outstanding", () => {
  assert.equal(categoriseSnag({ status: "open", priority: "high", due_date: null }, TODAY).highPriority, true, "a high-priority snag with no due date still flags as high priority");
  assert.equal(categoriseSnag({ status: "open", priority: "medium", due_date: null }, TODAY).highPriority, false);
  assert.equal(categoriseSnag({ status: "closed", priority: "high", due_date: null }, TODAY).highPriority, false, "a closed snag is resolved work, not an exception, even at high priority");
});

test("countSnagSignals: correctly tallies a realistic mixed set, excluding closed/rejected from every count", () => {
  const snags = [
    { status: "open", priority: "medium", due_date: "2026-09-01" }, // overdue
    { status: "open", priority: "low", due_date: TODAY }, // due today
    { status: "open", priority: "high", due_date: "2026-09-14" }, // due soon + high priority
    { status: "open", priority: "high", due_date: null }, // high priority only
    { status: "open", priority: "medium", due_date: "2026-10-01" }, // upcoming, no signal
    { status: "closed", priority: "high", due_date: "2020-01-01" }, // excluded entirely
    { status: "rejected", priority: "high", due_date: "2020-01-01" }, // excluded entirely
  ];
  const counts = countSnagSignals(snags, TODAY);
  assert.equal(counts.overdueSnags, 1);
  assert.equal(counts.dueTodaySnags, 1);
  assert.equal(counts.dueSoonSnags, 1);
  assert.equal(counts.highPrioritySnags, 2, "both high-priority open snags count, whether or not they also carry a due date");
});

test("computeControlStatus: an overdue snag alone is Attention, worded like the other exceptions", () => {
  const status = computeControlStatus({ openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0, overdueSnags: 2 });
  assert.equal(status.level, "attention");
  assert.equal(status.reason, "Attention — 2 overdue snags.");
});

test("computeControlStatus: a due-soon or high-priority snag alone is Watch, never Attention on priority alone", () => {
  const dueSoon = computeControlStatus({ openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0, dueSoonSnags: 1 });
  assert.equal(dueSoon.level, "watch");
  assert.equal(dueSoon.reason, "Watch — 1 snag due within 7 days.");

  const highPriority = computeControlStatus({ openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0, highSeverityHs: 0, highPrioritySnags: 3 });
  assert.equal(highPriority.level, "watch", "priority alone, with no due date, never escalates past Watch — never a fabricated numeric score");
  assert.equal(highPriority.reason, "Watch — 3 high-priority snags open.");
});

test("computeControlStatus: an overdue snag outranks a due-soon Action, same as every other Attention/Watch pairing", () => {
  const status = computeControlStatus({ openActions: 2, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 1, blocked: 0, highCritical: 0, highSeverityHs: 0, overdueSnags: 1 });
  assert.equal(status.level, "attention");
});
