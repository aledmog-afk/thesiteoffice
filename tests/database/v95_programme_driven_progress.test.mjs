// v95: Programme-driven progress.
//
// Part 1 — issuing a weekly report raises the programme activities
// linked (v93's programme_activity_id on a progress item) to its
// "Progress this week" items, in the SAME transaction as the issue
// (via the existing trg_weekly_reports_v69_progress AFTER trigger,
// extended in apply_weekly_report_progress() — see sql/schema.sql's
// own (I)/(H) comments). Raise-only on percent_complete; status
// escalates not_started -> in_progress -> complete; actual_start/
// actual_finish fill from the report's own week dates, once, never
// overwritten.
//
// Part 2 — projects.progress_source ('plots' | 'programme', default
// 'plots') steers recalc_project_progress()'s own figure. Switching it
// is editor-only, enforced by a trigger (projects_v69_progress_guard())
// re-checking is_project_editor() itself — not just the table's own
// RLS (which, by the time this migration lands, already narrows
// UPDATE on projects to editors only; the trigger is defence in depth
// and gives a clearer error either way).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v95_programme_progress";
const U = (n) => `a9500000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SNAGGER = U(2);
const EMAIL = { [OWNER]: "owner@x.test", [SNAGGER]: "snagger@x.test" };

const fx = {};

async function as(user, fn) {
  const c = await userClient(DB, user);
  try { return await fn(c); } finally { await c.end(); }
}
async function sql(q, p = []) {
  const a = adminClient(DB); await a.connect();
  try { return await a.query(q, p); } finally { await a.end(); }
}
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);

async function createActivity(overrides = {}) {
  const f = {
    title: "Activity", planned_start: "2026-01-01", planned_finish: "2026-01-11",
    status: "in_progress", percent_complete: 10, is_milestone: false,
    ...overrides,
  };
  return as(OWNER, (c) => one(c, `
    insert into public.programme_activities (programme_id, title, planned_start, planned_finish, status, percent_complete, is_milestone)
    values ($1, $2, $3, $4, $5, $6, $7) returning *
  `, [fx.programmeId, f.title, f.planned_start, f.planned_finish, f.status, f.percent_complete, f.is_milestone]));
}

let reportCounter = 0;
async function issueReport(projectId, progressItems) {
  reportCounter += 1;
  const weekStarting = `2026-0${1 + (reportCounter % 9)}-02`;
  const weekEnding = `2026-0${1 + (reportCounter % 9)}-06`;
  return as(OWNER, async (c) => {
    const rep = await one(c, `
      insert into public.weekly_reports (project_id, week_starting, week_ending, created_by, progress_items)
      values ($1, $2, $3, $4, $5::jsonb) returning id
    `, [projectId, weekStarting, weekEnding, OWNER, JSON.stringify(progressItems)]);
    await c.query("update public.weekly_reports set status = 'reviewed' where id = $1", [rep.id]);
    await c.query("update public.weekly_reports set status = 'approved' where id = $1", [rep.id]);
    await c.query("update public.weekly_reports set status = 'issued' where id = $1", [rep.id]);
    return { id: rep.id, weekStarting, weekEnding };
  });
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.orgId = (await one(c, "select public.create_organisation('Test Org', 'main_contractor') as id")).id;
    fx.projectId = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Site A', $1, $2) returning id", [fx.orgId, OWNER])).id;
    fx.projectId2 = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Site B', $1, $2) returning id", [fx.orgId, OWNER])).id;
    fx.programmeId = (await one(c, "insert into public.programmes (project_id, org_id, name, status, created_by) values ($1,$2,'Programme A','active',$3) returning id", [fx.projectId, fx.orgId, OWNER])).id;
  });
  await sql("insert into public.project_members (project_id, user_id, role) values ($1,$2,'snagging') on conflict do nothing", [fx.projectId, SNAGGER]);
});

after(async () => { await dropTestDatabase(DB); });

// ─── Part 1: issuing raises the linked programme activity ─────────

test("v95: issuing a report with a linked progress item raises percent_complete and moves not_started -> in_progress", async () => {
  const act = await createActivity({ status: "not_started", percent_complete: 0 });
  const rep = await issueReport(fx.projectId, [{ id: "x1", plot: "", text: act.title, percent: 40, programme_activity_id: act.id }]);

  const after_ = await sql("select status, percent_complete, actual_start, actual_finish from public.programme_activities where id = $1", [act.id]);
  const row = after_.rows[0];
  assert.equal(row.status, "in_progress");
  assert.equal(Number(row.percent_complete), 40);
  assert.equal(row.actual_start.toISOString().slice(0, 10), rep.weekStarting, "actual_start fills from the report's own week_starting");
  assert.equal(row.actual_finish, null, "actual_finish stays null until the activity actually reaches 100%");
});

test("v95: a later report with a LOWER percent never lowers percent_complete — the programme keeps its higher figure", async () => {
  const act = await createActivity({ status: "not_started", percent_complete: 0 });
  await issueReport(fx.projectId, [{ id: "x1", plot: "", text: act.title, percent: 70, programme_activity_id: act.id }]);
  await issueReport(fx.projectId, [{ id: "x1", plot: "", text: act.title, percent: 30, programme_activity_id: act.id }]);

  const after_ = await sql("select percent_complete, status from public.programme_activities where id = $1", [act.id]);
  assert.equal(Number(after_.rows[0].percent_complete), 70, "a revised-down report must never lower the programme's own figure");
  assert.equal(after_.rows[0].status, "in_progress");
});

test("v95: reaching 100% completes the activity, sets actual_finish from week_ending, and never overwrites an existing actual_start", async () => {
  const act = await createActivity({ status: "not_started", percent_complete: 0 });
  await issueReport(fx.projectId, [{ id: "x1", plot: "", text: act.title, percent: 50, programme_activity_id: act.id }]);
  const firstStart = (await sql("select actual_start from public.programme_activities where id=$1", [act.id])).rows[0].actual_start;

  const rep2 = await issueReport(fx.projectId, [{ id: "x1", plot: "", text: act.title, percent: 100, programme_activity_id: act.id }]);
  const after_ = await sql("select status, percent_complete, actual_start, actual_finish from public.programme_activities where id = $1", [act.id]);
  const row = after_.rows[0];
  assert.equal(row.status, "complete");
  assert.equal(Number(row.percent_complete), 100);
  assert.equal(row.actual_start.toISOString().slice(0, 10), firstStart.toISOString().slice(0, 10), "actual_start from the FIRST report must survive — never overwritten by a later one");
  assert.equal(row.actual_finish.toISOString().slice(0, 10), rep2.weekEnding, "actual_finish comes from the completing report's own week_ending");
});

test("v95: an activity already complete is never touched again, even by a later report naming it", async () => {
  const act = await createActivity({ status: "complete", percent_complete: 100 });
  await sql("update public.programme_activities set actual_start = '2026-06-01', actual_finish = '2026-06-10' where id = $1", [act.id]);

  await issueReport(fx.projectId, [{ id: "x1", plot: "", text: act.title, percent: 80, programme_activity_id: act.id }]);

  const after_ = await sql("select status, percent_complete, actual_start, actual_finish from public.programme_activities where id = $1", [act.id]);
  const row = after_.rows[0];
  assert.equal(row.status, "complete");
  assert.equal(Number(row.percent_complete), 100);
  assert.equal(row.actual_start.toISOString().slice(0, 10), "2026-06-01", "an already-complete activity's dates must never be touched again");
  assert.equal(row.actual_finish.toISOString().slice(0, 10), "2026-06-10");
});

test("v95: a cancelled activity is silently ignored, never raised", async () => {
  const act = await createActivity({ status: "cancelled", percent_complete: 0 });
  await issueReport(fx.projectId, [{ id: "x1", plot: "", text: act.title, percent: 90, programme_activity_id: act.id }]);

  const after_ = await sql("select status, percent_complete from public.programme_activities where id = $1", [act.id]);
  assert.equal(after_.rows[0].status, "cancelled");
  assert.equal(Number(after_.rows[0].percent_complete), 0);
});

test("v95: an unknown programme_activity_id does nothing and never fails the issue", async () => {
  const fakeId = "00000000-0000-0000-0000-000000000099";
  const rep = await issueReport(fx.projectId, [{ id: "x1", plot: "", text: "Ghost activity", percent: 50, programme_activity_id: fakeId }]);
  const report = (await sql("select status from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.equal(report.status, "issued", "the issue itself must succeed even with a reference to a non-existent activity");
});

test("v95: an activity id belonging to a DIFFERENT project than the report is ignored — only same-project activities are ever raised", async () => {
  const act = await createActivity({ status: "not_started", percent_complete: 0 }); // belongs to fx.projectId
  await issueReport(fx.projectId2, [{ id: "x1", plot: "", text: act.title, percent: 95, programme_activity_id: act.id }]);

  const after_ = await sql("select status, percent_complete from public.programme_activities where id = $1", [act.id]);
  assert.equal(after_.rows[0].status, "not_started", "a cross-project reference must never raise the activity");
  assert.equal(Number(after_.rows[0].percent_complete), 0);
});

test("v95: a DRAFT report's progress items never raise anything — only an issued report does", async () => {
  const act = await createActivity({ status: "not_started", percent_complete: 0 });
  await as(OWNER, async (c) => {
    await c.query(
      "insert into public.weekly_reports (project_id, week_starting, week_ending, created_by, progress_items) values ($1,'2026-07-06','2026-07-10',$2,$3::jsonb)",
      [fx.projectId, OWNER, JSON.stringify([{ id: "x1", plot: "", text: act.title, percent: 80, programme_activity_id: act.id }])]
    );
  });
  const after_ = await sql("select status, percent_complete from public.programme_activities where id = $1", [act.id]);
  assert.equal(after_.rows[0].status, "not_started");
  assert.equal(Number(after_.rows[0].percent_complete), 0);
});

test("v95: a freetext progress item with no programme_activity_id raises no activity and still issues cleanly", async () => {
  const rep = await issueReport(fx.projectId, [{ id: "x1", plot: "", text: "Freetext only, no programme link", percent: 50 }]);
  const report = (await sql("select status from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.equal(report.status, "issued");
});

// ─── Part 2: progress_source ────────────────────────────────────────

test("v95: a project editor CAN switch progress_source, and it defaults to 'plots'", async () => {
  const before_ = (await sql("select progress_source from public.projects where id = $1", [fx.projectId2])).rows[0];
  assert.equal(before_.progress_source, "plots", "a brand-new project always starts on 'plots'");

  await as(OWNER, (c) => c.query("update public.projects set progress_source = 'programme' where id = $1", [fx.projectId2]));
  const after_ = (await sql("select progress_source from public.projects where id = $1", [fx.projectId2])).rows[0];
  assert.equal(after_.progress_source, "programme");

  await as(OWNER, (c) => c.query("update public.projects set progress_source = 'plots' where id = $1", [fx.projectId2])); // reset for other tests
});

test("v95: a snagging-only member CANNOT switch progress_source — the update matches zero rows (RLS), the value is untouched", async () => {
  const r = await as(SNAGGER, (c) => c.query("update public.projects set progress_source = 'programme' where id = $1", [fx.projectId]));
  assert.equal(r.rowCount, 0, "a non-editor's update must affect zero rows");
  const after_ = (await sql("select progress_source from public.projects where id = $1", [fx.projectId])).rows[0];
  assert.equal(after_.progress_source, "plots", "the value must be completely unaffected by a blocked attempt");
});

test("v95: an invalid progress_source value is rejected even for an editor", async () => {
  await assert.rejects(
    as(OWNER, (c) => c.query("update public.projects set progress_source = 'bogus' where id = $1", [fx.projectId])),
    /progress_source must be/
  );
});

test("v95: switching to 'programme' with an active programme recalculates actual_progress_pct to the duration-weighted figure", async () => {
  await sql("delete from public.programme_activities where programme_id = $1", [fx.programmeId]);
  await createActivity({ title: "A", status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-11" }); // 10 days, 100%
  await createActivity({ title: "B", status: "not_started", percent_complete: 0, planned_start: "2026-02-01", planned_finish: "2026-02-11" }); // 10 days, 0%

  await as(OWNER, (c) => c.query("update public.projects set progress_source = 'programme' where id = $1", [fx.projectId]));
  const after_ = (await sql("select progress_source, actual_progress_pct from public.projects where id = $1", [fx.projectId])).rows[0];
  assert.equal(after_.progress_source, "programme");
  assert.equal(Number(after_.actual_progress_pct), 50, "equal 10-day weights, 100% and 0% -> a plain 50% average");
});

test("v95: recalculates again when an activity's percent_complete changes directly (not via a report) while progress_source='programme'", async () => {
  const rows = await sql("select id from public.programme_activities where programme_id = $1 and title = 'B'", [fx.programmeId]);
  await as(OWNER, (c) => c.query("update public.programme_activities set percent_complete = 100, status = 'complete' where id = $1", [rows.rows[0].id]));

  const after_ = (await sql("select actual_progress_pct from public.projects where id = $1", [fx.projectId])).rows[0];
  assert.equal(Number(after_.actual_progress_pct), 100, "both activities now 100% -> 100%");
});

test("v95: archiving the active programme recalculates too — with no active programme left, actual_progress_pct falls back to the plot-based figure", async () => {
  await as(OWNER, (c) => c.query("update public.programmes set status = 'archived' where id = $1", [fx.programmeId]));
  const after_ = (await sql("select actual_progress_pct from public.projects where id = $1", [fx.projectId])).rows[0];
  assert.equal(Number(after_.actual_progress_pct), 0, "no active programme left -> falls back to the plot-based figure (0, no plots on this fixture project)");

  // restore for any tests that might run after this file alphabetically in the same suite run
  await sql("update public.programmes set status = 'active' where id = $1", [fx.programmeId]);
});

test("v95: switching back to 'plots' recalculates immediately, independent of the programme", async () => {
  await as(OWNER, (c) => c.query("update public.projects set progress_source = 'plots' where id = $1", [fx.projectId]));
  const after_ = (await sql("select progress_source, actual_progress_pct from public.projects where id = $1", [fx.projectId])).rows[0];
  assert.equal(after_.progress_source, "plots");
  assert.equal(Number(after_.actual_progress_pct), 0, "plot-based figure for a project with no plots is 0");
});

test("v95: with progress_source='programme' but a programme that has activities and no countable ones (all cancelled), falls back to the plot-based figure rather than showing a misleading 0%", async () => {
  await sql("delete from public.programme_activities where programme_id = $1", [fx.programmeId]);
  await createActivity({ status: "cancelled", percent_complete: 0 });
  await as(OWNER, (c) => c.query("update public.projects set progress_source = 'programme' where id = $1", [fx.projectId]));

  const after_ = (await sql("select actual_progress_pct from public.projects where id = $1", [fx.projectId])).rows[0];
  assert.equal(Number(after_.actual_progress_pct), 0, "falls back to the (also 0, no plots) plot-based figure — never a weighted-over-nothing 0% pretending to be the real programme figure");
});
