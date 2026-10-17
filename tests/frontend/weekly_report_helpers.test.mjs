// Weekly Reporting (Priority 9) — pure calculation logic: period-
// membership, per-module summaries, and the reused Attention/Watch/On
// Track exceptions computation, all anchored on the report's own
// week_ending (never the real clock) so a report about a past period
// always shows the same position. Extracted via the same regex
// approach as every prior priority's own helper tests — app.js can't
// be imported directly outside a browser. Every test uses FIXED date
// strings, never the real clock.
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
  const m = APP_JS.match(new RegExp(`(?:export )?(?:async )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

const scope = `
  ${extractFunction("toLocalISODate")}
  ${extractFunction("todayISO")}
  ${extractFunction("monthStartISO")}
  ${extractConst("DUE_SOON_DAYS")}
  ${extractFunction("categoriseAction")}
  ${extractFunction("aggregateActionCounts")}
  ${extractFunction("countHighSeverityHsIssues")}
  ${extractFunction("isSnagOutstanding")}
  ${extractFunction("categoriseSnag")}
  ${extractFunction("countSnagSignals")}
  ${extractFunction("isFindingOutstanding")}
  ${extractFunction("countFindingSignals")}
  ${extractFunction("computeControlStatus")}
  ${extractFunction("dateOfTimestamp")}
  ${extractFunction("inPeriod")}
  ${extractFunction("isActionOutstanding")}
  ${extractFunction("summariseActionsForReport")}
  ${extractFunction("summariseSnagsForReport")}
  ${extractFunction("summariseInspectionsForReport")}
  ${extractFunction("summariseHsForReport")}
  ${extractFunction("computeReportExceptions")}
  ${extractFunction("computeReportActivity")}
  ${extractConst("WEEKLY_REPORT_STATUSES")}
  return {
    dateOfTimestamp, inPeriod, summariseActionsForReport, summariseSnagsForReport,
    summariseInspectionsForReport, summariseHsForReport, computeReportExceptions,
    computeReportActivity,
  };
`;
const {
  dateOfTimestamp, inPeriod, summariseActionsForReport, summariseSnagsForReport,
  summariseInspectionsForReport, summariseHsForReport, computeReportExceptions,
  computeReportActivity,
} = new Function(scope)();

const PERIOD = { weekStarting: "2026-09-07", weekEnding: "2026-09-11" }; // Mon-Fri

// ─── dateOfTimestamp / inPeriod ─────────────────────────────────────

test("dateOfTimestamp: slices the ISO string directly, ignoring any timezone offset in it", () => {
  assert.equal(dateOfTimestamp("2026-09-08T23:59:59+01:00"), "2026-09-08");
  assert.equal(dateOfTimestamp("2026-09-08T00:00:00Z"), "2026-09-08");
  assert.equal(dateOfTimestamp(null), null);
  assert.equal(dateOfTimestamp(undefined), null);
});

test("inPeriod: boundary-inclusive on both ends, false outside, false for null/empty", () => {
  assert.equal(inPeriod("2026-09-07", PERIOD.weekStarting, PERIOD.weekEnding), true, "the first day of the period counts");
  assert.equal(inPeriod("2026-09-11", PERIOD.weekStarting, PERIOD.weekEnding), true, "the last day of the period counts");
  assert.equal(inPeriod("2026-09-09", PERIOD.weekStarting, PERIOD.weekEnding), true);
  assert.equal(inPeriod("2026-09-06", PERIOD.weekStarting, PERIOD.weekEnding), false, "the day before the period starts must not count");
  assert.equal(inPeriod("2026-09-12", PERIOD.weekStarting, PERIOD.weekEnding), false, "the day after the period ends must not count");
  assert.equal(inPeriod(null, PERIOD.weekStarting, PERIOD.weekEnding), false);
  assert.equal(inPeriod("", PERIOD.weekStarting, PERIOD.weekEnding), false);
});

// ─── Actions ─────────────────────────────────────────────────────────

test("summariseActionsForReport: overdue is anchored on week_ending, not the real clock", () => {
  const actions = [
    { id: "a1", status: "open", priority: "medium", due_date: "2026-09-01", created_at: "2026-08-01T10:00:00Z", completed_at: null },
    { id: "a2", status: "open", priority: "medium", due_date: "2026-09-12", created_at: "2026-08-01T10:00:00Z", completed_at: null },
  ];
  const summary = summariseActionsForReport(actions, PERIOD);
  assert.deepEqual(summary.overdue.map((a) => a.id), ["a1"], "due before week_ending is overdue");
  assert.equal(summary.overdue.some((a) => a.id === "a2"), false, "due after week_ending is not overdue, regardless of today's real date");
});

test("summariseActionsForReport: dueDuringPeriod is a real [weekStarting, weekEnding] range check, independent of overdue", () => {
  const actions = [
    { id: "a1", status: "open", priority: "medium", due_date: "2026-09-09", created_at: "2026-08-01T10:00:00Z", completed_at: null }, // during period
    { id: "a2", status: "completed", priority: "medium", due_date: "2026-09-09", created_at: "2026-08-01T10:00:00Z", completed_at: "2026-09-09T12:00:00Z" }, // during period but completed -> excluded
    { id: "a3", status: "open", priority: "medium", due_date: "2026-09-20", created_at: "2026-08-01T10:00:00Z", completed_at: null }, // outside period
  ];
  const summary = summariseActionsForReport(actions, PERIOD);
  assert.deepEqual(summary.dueDuringPeriod.map((a) => a.id), ["a1"]);
});

test("summariseActionsForReport: blocked / highCriticalOpen reflect current state, not a period event", () => {
  const actions = [
    { id: "a1", status: "blocked", priority: "medium", due_date: null, created_at: "2026-08-01T10:00:00Z", completed_at: null },
    { id: "a2", status: "open", priority: "critical", due_date: null, created_at: "2026-08-01T10:00:00Z", completed_at: null },
    { id: "a3", status: "completed", priority: "critical", due_date: null, created_at: "2026-08-01T10:00:00Z", completed_at: "2026-08-05T10:00:00Z" },
  ];
  const summary = summariseActionsForReport(actions, PERIOD);
  assert.deepEqual(summary.blocked.map((a) => a.id), ["a1"]);
  assert.deepEqual(summary.highCriticalOpen.map((a) => a.id), ["a2"], "a completed critical action is resolved work, not open");
});

test("summariseActionsForReport: createdDuringPeriod / completedDuringPeriod use the UTC date of the timestamp, boundary-inclusive", () => {
  const actions = [
    { id: "a1", status: "open", priority: "medium", due_date: null, created_at: "2026-09-07T00:00:01Z", completed_at: null }, // created right at period start
    { id: "a2", status: "open", priority: "medium", due_date: null, created_at: "2026-09-06T23:59:59Z", completed_at: null }, // created just before
    { id: "a3", status: "completed", priority: "medium", due_date: null, created_at: "2026-08-01T10:00:00Z", completed_at: "2026-09-11T18:00:00Z" }, // completed right at period end
    { id: "a4", status: "completed", priority: "medium", due_date: null, created_at: "2026-08-01T10:00:00Z", completed_at: "2026-09-12T00:00:01Z" }, // completed just after
  ];
  const summary = summariseActionsForReport(actions, PERIOD);
  assert.deepEqual(summary.createdDuringPeriod.map((a) => a.id), ["a1"]);
  assert.deepEqual(summary.completedDuringPeriod.map((a) => a.id), ["a3"]);
});

// ─── Snags ───────────────────────────────────────────────────────────

test("summariseSnagsForReport: overdue anchored on week_ending; raised/closed/verified use their own date fields, boundary-inclusive", () => {
  const snags = [
    { id: "s1", status: "open", priority: "medium", due_date: "2026-09-01", raised_date: "2026-08-20", closed_date: null, verified_at: null },
    { id: "s2", status: "open", priority: "high", due_date: null, raised_date: "2026-09-07", closed_date: null, verified_at: null },
    { id: "s3", status: "closed", priority: "low", due_date: null, raised_date: "2026-08-01", closed_date: "2026-09-11", verified_at: "2026-09-11T09:00:00Z" },
    { id: "s4", status: "closed", priority: "low", due_date: null, raised_date: "2026-08-01", closed_date: "2026-09-12", verified_at: null },
  ];
  const summary = summariseSnagsForReport(snags, PERIOD);
  assert.deepEqual(summary.overdue.map((s) => s.id), ["s1"]);
  assert.deepEqual(summary.highPriorityOpen.map((s) => s.id), ["s2"]);
  assert.deepEqual(summary.raisedDuringPeriod.map((s) => s.id), ["s2"]);
  assert.deepEqual(summary.closedDuringPeriod.map((s) => s.id), ["s3"], "closed the day after the period must not count");
  assert.deepEqual(summary.verifiedDuringPeriod.map((s) => s.id), ["s3"]);
});

// ─── Inspections / Findings ──────────────────────────────────────────

test("summariseInspectionsForReport: open/critical/high reflect current state; resolved/completed use resolved_at/inspection_date, boundary-inclusive", () => {
  const findings = [
    { id: "f1", severity: "critical", status: "open", resolved_at: null },
    { id: "f2", severity: "high", status: "action_required", resolved_at: null },
    { id: "f3", severity: "medium", status: "resolved", resolved_at: "2026-09-10T10:00:00Z" },
    { id: "f4", severity: "low", status: "resolved", resolved_at: "2026-08-01T10:00:00Z" }, // resolved long before period
  ];
  const inspections = [
    { id: "i1", status: "completed", inspection_date: "2026-09-08" },
    { id: "i2", status: "completed", inspection_date: "2026-08-01" },
    { id: "i3", status: "draft", inspection_date: "2026-09-08" },
  ];
  const summary = summariseInspectionsForReport(findings, inspections, PERIOD);
  assert.deepEqual(summary.openFindings.map((f) => f.id).sort(), ["f1", "f2"]);
  assert.deepEqual(summary.criticalFindings.map((f) => f.id), ["f1"]);
  assert.deepEqual(summary.highSeverityFindings.map((f) => f.id), ["f2"]);
  assert.deepEqual(summary.resolvedDuringPeriod.map((f) => f.id), ["f3"], "f4 resolved before the period must not count");
  assert.deepEqual(summary.completedDuringPeriod.map((i) => i.id), ["i1"], "i2 is out of period, i3 isn't completed");
});

// ─── H&S ───────────────────────────────────────────────────────────

test("summariseHsForReport: audit-logged-this-month uses the PERIOD's own month, not the real calendar month", () => {
  const hsAudits = [{ month: "2026-09-01" }];
  const hsItems = [{ status: "non_compliant", severity: "high" }, { status: "non_compliant", severity: "low" }];
  const summary = summariseHsForReport(hsAudits, hsItems, PERIOD);
  assert.equal(summary.auditLoggedThisMonth, true);
  assert.equal(summary.highSeverityOpenCount, 1);
});

test("summariseHsForReport: correctly reports 'not logged' when the period's month has no audit", () => {
  const summary = summariseHsForReport([{ month: "2026-08-01" }], [], PERIOD);
  assert.equal(summary.auditLoggedThisMonth, false);
  assert.equal(summary.highSeverityOpenCount, 0);
});

// ─── Exceptions (reuses computeControlStatus, anchored on week_ending) ─

test("computeReportExceptions: Attention from an overdue action, anchored on week_ending", () => {
  const data = {
    actions: [{ id: "a1", status: "open", priority: "medium", due_date: "2026-09-01" }],
    snags: [], findings: [], hsItems: [],
  };
  const result = computeReportExceptions(data, PERIOD);
  assert.equal(result.status.level, "attention");
  assert.ok(result.status.reason.includes("overdue action"));
});

test("computeReportExceptions: On Track when nothing is outstanding as of week_ending", () => {
  const data = { actions: [], snags: [], findings: [], hsItems: [] };
  const result = computeReportExceptions(data, PERIOD);
  assert.equal(result.status.level, "on_track");
  assert.equal(result.status.reason, "On track — no open actions.");
});

test("computeReportExceptions: never manufactures Attention/a score from mere presence of open, on-time work", () => {
  const data = {
    actions: [{ id: "a1", status: "open", priority: "low", due_date: "2026-09-20" }], // due well after the period, not overdue, not high/critical
    snags: [], findings: [], hsItems: [],
  };
  const result = computeReportExceptions(data, PERIOD);
  assert.equal(result.status.level, "on_track");
});

// ─── Activity ("what changed") ──────────────────────────────────────

test("computeReportActivity: only includes genuinely timestamped events, never 'currently blocked/overdue' state", () => {
  const data = {
    actions: [
      { id: "a1", status: "open", priority: "medium", due_date: null, created_at: "2026-09-08T10:00:00Z", completed_at: null },
      { id: "a2", status: "blocked", priority: "medium", due_date: null, created_at: "2026-08-01T10:00:00Z", completed_at: null },
    ],
    snags: [
      { id: "s1", item_no: 1, location: "Kitchen", status: "open", priority: "medium", due_date: null, raised_date: "2026-09-09", closed_date: null, verified_at: null },
    ],
    findings: [],
    inspections: [],
  };
  const activity = computeReportActivity(data, PERIOD);
  assert.deepEqual(activity.actionsCreated.map((a) => a.id), ["a1"]);
  assert.deepEqual(activity.actionsCompleted, [], "a blocked action is a state, not a during-period event, and must not appear in activity");
  assert.deepEqual(activity.snagsRaised.map((s) => s.id), ["s1"]);
});
