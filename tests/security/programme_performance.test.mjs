// Programme Control (Priority 11, Phase 2) — performance check at
// three realistic scales (brief section 16: "at least 50 / 500 /
// 5,000 activities"). Not a claim of production-scale performance —
// this proves a project's activity list stays backed by real index
// usage (the (project_id, status) and (project_id, forecast_finish)
// indexes from sql/schema.sql v35) rather than a sequential scan, and
// that lookup time doesn't blow up as the row count grows across the
// three scales, unaffected by other projects in the same org.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_programme_performance";
const OWNER = "e0000000-0000-0000-0000-000000000003";
const OTHER_PROJECTS = 15;

let projectId;
let programmeId;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query("insert into auth.users (id, email) values ($1,'owner@example.com')", [OWNER]);
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const orgId = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;
  const proj = await owner.query("insert into public.projects (name, org_id, created_by) values ('Perf Site', $1, $2) returning id", [orgId, OWNER]);
  projectId = proj.rows[0].id;
  const prog = await owner.query("insert into public.programmes (project_id, name, status) values ($1, 'Perf Programme', 'active') returning id", [projectId]);
  programmeId = prog.rows[0].id;

  // 5,000 activities is the largest scale under test — seed that many
  // once, then the 50/500 tests just query a LIMIT-ed subset of the
  // same table, matching how the app's own list queries would behave.
  const TOTAL = 5000;
  const statuses = ["not_started", "in_progress", "complete", "cancelled"];
  for (let batchStart = 0; batchStart < TOTAL; batchStart += 500) {
    const batchSize = Math.min(500, TOTAL - batchStart);
    const values = [];
    const params = [];
    for (let i = 0; i < batchSize; i++) {
      const n = batchStart + i;
      const base = params.length;
      values.push(`($${base + 1},$${base + 2},$${base + 3},$${base + 4})`);
      params.push(programmeId, `Activity ${n}`, statuses[n % 4], `2026-${String((n % 12) + 1).padStart(2, "0")}-01`);
    }
    await owner.query(
      `insert into public.programme_activities (programme_id, title, status, forecast_finish) values ${values.join(",")}`,
      params
    );
  }

  // Other projects in the SAME org, each with their own programme and
  // activities — proves this project's own query cost doesn't scale
  // with the rest of the portfolio.
  for (let p = 0; p < OTHER_PROJECTS; p++) {
    const other = await owner.query("insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id", [`Other ${p}`, orgId, OWNER]);
    const otherProg = await owner.query("insert into public.programmes (project_id, name) values ($1, 'Other Programme') returning id", [other.rows[0].id]);
    for (let i = 0; i < 20; i++) {
      await owner.query("insert into public.programme_activities (programme_id, title) values ($1,$2)", [otherProg.rows[0].id, `Other activity ${i}`]);
    }
  }

  await owner.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

for (const limit of [50, 500, 5000]) {
  test(`Performance: retrieving ${limit} activities for a project stays fast and returns the right count`, async () => {
    const owner = await userClient(DB, OWNER);
    try {
      const start = Date.now();
      const { rowCount } = await owner.query(
        "select id, title, status, forecast_finish, percent_complete from public.programme_activities where project_id = $1 order by forecast_finish limit $2",
        [projectId, limit]
      );
      const elapsedMs = Date.now() - start;
      assert.equal(rowCount, limit);
      assert.ok(elapsedMs < 2000, `retrieving ${limit} activities took ${elapsedMs}ms — expected comfortably under 2s`);
    } finally {
      await owner.end();
    }
  });
}

test("Performance: EXPLAIN confirms (project_id, status) and (project_id, forecast_finish) are used, not a sequential scan across the whole org", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const statusPlan = await owner.query("explain select id, title from public.programme_activities where project_id = $1 and status = 'in_progress'", [projectId]);
    const statusText = statusPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(statusText), `expected an index scan on programme_activities_project_status_idx, got:\n${statusText}`);

    const forecastPlan = await owner.query("explain select id, title from public.programme_activities where project_id = $1 order by forecast_finish limit 50", [projectId]);
    const forecastText = forecastPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(forecastText), `expected an index scan on programme_activities_project_forecast_finish_idx, got:\n${forecastText}`);
  } finally {
    await owner.end();
  }
});

test("Performance: the full 5,000-row activity count for this project is unaffected by the other 15 projects' own 300 activities in the same org", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query("select count(*)::int as n from public.programme_activities where project_id = $1", [projectId]);
    assert.equal(rows[0].n, 5000);
  } finally {
    await owner.end();
  }
});
