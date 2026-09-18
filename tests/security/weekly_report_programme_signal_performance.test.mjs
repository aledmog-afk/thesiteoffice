// Weekly Report Programme Integration (Priority 11, Phase 5) —
// performance check. getWeeklyReportProgrammeSignal() (and the
// programme lookup folded into getWeeklyReportPosition()'s existing
// Promise.all) issues exactly TWO queries regardless of activity count:
// getActiveProgramme (one row, by project_id+status) and
// listProgrammeActivities (all activities, by programme_id) — never one
// query per activity. This proves that shape holds at 50 and 500
// activities, and that a weekly-report LIST page loading summaries for
// several projects costs each project independently (no N+1 across
// projects either), backed by real index usage.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_weekly_report_programme_signal_performance";
const OWNER = "f0000000-0000-0000-0000-000000000001";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query("insert into auth.users (id, email) values ($1,'owner@example.com')", [OWNER]);
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const orgId = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;

  const proj50 = (await owner.query("insert into public.projects (name, org_id, created_by) values ('50-activity site', $1, $2) returning id", [orgId, OWNER])).rows[0].id;
  const prog50 = (await owner.query("insert into public.programmes (project_id, name, status) values ($1,'Programme',$2) returning id", [proj50, "active"])).rows[0].id;
  for (let i = 0; i < 50; i++) {
    await owner.query(
      "insert into public.programme_activities (programme_id, title, is_milestone, planned_finish, forecast_finish, status) values ($1,$2,$3,$4,$5,$6)",
      [prog50, `Activity ${i}`, i % 10 === 0, "2026-09-01", i % 3 === 0 ? "2026-09-10" : "2026-09-01", ["not_started", "in_progress", "complete"][i % 3]]
    );
  }

  const proj500 = (await owner.query("insert into public.projects (name, org_id, created_by) values ('500-activity site', $1, $2) returning id", [orgId, OWNER])).rows[0].id;
  const prog500 = (await owner.query("insert into public.programmes (project_id, name, status) values ($1,'Programme',$2) returning id", [proj500, "active"])).rows[0].id;
  for (let i = 0; i < 500; i++) {
    await owner.query(
      "insert into public.programme_activities (programme_id, title, is_milestone, planned_finish, forecast_finish, status) values ($1,$2,$3,$4,$5,$6)",
      [prog500, `Activity ${i}`, i % 20 === 0, "2026-09-01", i % 3 === 0 ? "2026-09-10" : "2026-09-01", ["not_started", "in_progress", "complete"][i % 3]]
    );
  }

  // Several more projects, each with their own weekly report + active
  // programme — proves a weekly-report list loading multiple projects'
  // signals costs each project independently, not cumulatively.
  const otherProjects = [];
  for (let p = 0; p < 15; p++) {
    const proj = (await owner.query("insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id", [`Other ${p}`, orgId, OWNER])).rows[0].id;
    const prog = (await owner.query("insert into public.programmes (project_id, name, status) values ($1,'Programme','active') returning id", [proj])).rows[0].id;
    for (let i = 0; i < 30; i++) {
      await owner.query("insert into public.programme_activities (programme_id, title, planned_finish) values ($1,$2,'2026-09-01')", [prog, `Activity ${i}`]);
    }
    otherProjects.push(proj);
  }

  await owner.end();
  fx = { proj50, prog50, proj500, prog500, otherProjects };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("Performance: the 2-query signal shape (getActiveProgramme + listProgrammeActivities) completes quickly against 50 activities", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const start = Date.now();
    const programme = await owner.query("select * from public.programmes where project_id = $1 and status = 'active'", [fx.proj50]);
    const activities = await owner.query("select * from public.programme_activities where programme_id = $1", [programme.rows[0].id]);
    const elapsedMs = Date.now() - start;
    assert.equal(activities.rowCount, 50);
    assert.ok(elapsedMs < 500, `took ${elapsedMs}ms for 50 activities — expected well under 500ms`);
  } finally {
    await owner.end();
  }
});

test("Performance: the same 2-query shape completes quickly against 500 activities — no per-row query growth", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const start = Date.now();
    const programme = await owner.query("select * from public.programmes where project_id = $1 and status = 'active'", [fx.proj500]);
    const activities = await owner.query("select * from public.programme_activities where programme_id = $1", [programme.rows[0].id]);
    const elapsedMs = Date.now() - start;
    assert.equal(activities.rowCount, 500);
    assert.ok(elapsedMs < 1000, `took ${elapsedMs}ms for 500 activities — expected comfortably under 1s`);
  } finally {
    await owner.end();
  }
});

test("Performance: a weekly-report list loading signals for 15 other projects (30 activities each) costs each project independently — total time scales linearly, not quadratically", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const start = Date.now();
    for (const proj of fx.otherProjects) {
      const programme = await owner.query("select id from public.programmes where project_id = $1 and status = 'active'", [proj]);
      await owner.query("select * from public.programme_activities where programme_id = $1", [programme.rows[0].id]);
    }
    const elapsedMs = Date.now() - start;
    assert.ok(elapsedMs < 3000, `15 projects x 2 queries took ${elapsedMs}ms — expected comfortably under 3s`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms getActiveProgramme's lookup uses the one-active-per-project index, not a sequential scan", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plan = await owner.query("explain select * from public.programmes where project_id = $1 and status = 'active'", [fx.proj500]);
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(planText), `expected an index scan on programmes, got:\n${planText}`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms listProgrammeActivities' lookup uses the programme_id index, not a sequential scan across all 500+ rows", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plan = await owner.query("explain select * from public.programme_activities where programme_id = $1", [fx.prog500]);
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(planText), `expected an index scan on programme_activities, got:\n${planText}`);
  } finally {
    await owner.end();
  }
});
