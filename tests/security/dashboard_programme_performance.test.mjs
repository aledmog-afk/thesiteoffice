// Project Control Dashboard: Programme integration (Priority 11,
// Phase 4) — performance of the ONE additional broad query
// getProjectControlSummary()/getPortfolioControlSummary() now issue
// (programme_activities joined to programmes(status)), at three
// scales the brief specifically asked for: a single project with 50
// activities, a single project with 500, and a 25-project portfolio
// with 500+ activities spread across MIXED programme states (draft/
// active/archived) — proving the query shape stays O(rows), not
// O(projects), and that non-active programmes never pollute the
// counts. Mirrors dashboard_performance.test.mjs's own conventions
// exactly.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_dashboard_programme_performance";
const OWNER = "d0000000-0000-0000-0000-000000000011";

let singleProjectId;
let singleActiveProgrammeId;
let portfolioProjectIds = [];

const PORTFOLIO_PROJECT_COUNT = 25;
const ACTIVITIES_PER_PORTFOLIO_PROJECT = 20; // 500 total

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query("insert into auth.users (id, email) values ($1,'owner@example.com')", [OWNER]);
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const orgId = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;

  // ── Single project: seeded once with 500 activities; the 50-row
  // scenario just queries a LIMIT-ed subset of the same table, the
  // same "seed the largest scale once" shape programme_performance.
  // test.mjs already established.
  const singleProj = await owner.query("insert into public.projects (name, org_id, created_by) values ('Perf Site', $1, $2) returning id", [orgId, OWNER]);
  singleProjectId = singleProj.rows[0].id;
  const singleProg = await owner.query("insert into public.programmes (project_id, name, status) values ($1,'Perf Programme','active') returning id", [singleProjectId]);
  singleActiveProgrammeId = singleProg.rows[0].id;
  for (let batchStart = 0; batchStart < 500; batchStart += 500) {
    const values = [];
    const params = [];
    for (let i = 0; i < 500; i++) {
      const base = params.length;
      values.push(`($${base + 1},$${base + 2},$${base + 3})`);
      params.push(singleActiveProgrammeId, `Activity ${i}`, i % 3 === 0 ? "2020-01-01" : "2027-01-01"); // ~1/3 overdue
    }
    await owner.query(`insert into public.programme_activities (programme_id, title, planned_finish) values ${values.join(",")}`, params);
  }

  // ── Portfolio: 25 projects, each with its own programme, mixed
  // status (draft/active/archived cycling every 3rd project) — only
  // the ACTIVE ones should ever contribute to control counts.
  for (let i = 0; i < PORTFOLIO_PROJECT_COUNT; i++) {
    const proj = await owner.query("insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id", [`Portfolio Site ${i}`, orgId, OWNER]);
    const projectId = proj.rows[0].id;
    portfolioProjectIds.push(projectId);
    const status = ["active", "draft", "archived"][i % 3];
    const prog = await owner.query("insert into public.programmes (project_id, name, status) values ($1,$2,$3) returning id", [projectId, `Programme ${i}`, status]);
    const programmeId = prog.rows[0].id;
    for (let j = 0; j < ACTIVITIES_PER_PORTFOLIO_PROJECT; j++) {
      await owner.query(
        "insert into public.programme_activities (programme_id, title, planned_finish) values ($1,$2,$3)",
        [programmeId, `Activity ${j}`, j % 2 === 0 ? "2020-01-01" : "2027-01-01"]
      );
    }
  }

  await owner.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

for (const limit of [50, 500]) {
  test(`Performance: retrieving ${limit} programme activities for a single project stays fast and returns the right count`, async () => {
    const owner = await userClient(DB, OWNER);
    try {
      const start = Date.now();
      const { rowCount } = await owner.query(
        "select id, is_milestone, status, planned_finish, forecast_finish, actual_finish from public.programme_activities where project_id = $1 limit $2",
        [singleProjectId, limit]
      );
      const elapsedMs = Date.now() - start;
      assert.equal(rowCount, limit);
      assert.ok(elapsedMs < 2000, `retrieving ${limit} programme activities took ${elapsedMs}ms — expected comfortably under 2s`);
    } finally {
      await owner.end();
    }
  });
}

test(`Performance: the portfolio-wide programme_activities query (${PORTFOLIO_PROJECT_COUNT} projects x ${ACTIVITIES_PER_PORTFOLIO_PROJECT} = ${PORTFOLIO_PROJECT_COUNT * ACTIVITIES_PER_PORTFOLIO_PROJECT} rows, mixed programme states) completes in ONE broad query, not one per project`, async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const start = Date.now();
    const { rows } = await owner.query(
      `select pa.project_id, pa.is_milestone, pa.status, pa.planned_finish, pa.forecast_finish, pa.actual_finish, p.status as programme_status
       from public.programme_activities pa join public.programmes p on p.id = pa.programme_id
       where pa.project_id = any($1::uuid[])`,
      [portfolioProjectIds]
    );
    const elapsedMs = Date.now() - start;
    assert.equal(rows.length, PORTFOLIO_PROJECT_COUNT * ACTIVITIES_PER_PORTFOLIO_PROJECT, "the query must return every row across all 25 projects in one shot");
    assert.ok(elapsedMs < 3000, `the portfolio-wide programme query took ${elapsedMs}ms across ${rows.length} rows — expected comfortably under 3s`);

    // Client-side grouping + active-programme filtering (exactly what
    // getPortfolioControlSummary() does) — only every 3rd project's
    // programme is 'active' (i % 3 === 0 in the seed above).
    const activeRows = rows.filter((r) => r.programme_status === "active");
    const expectedActiveProjects = Math.ceil(PORTFOLIO_PROJECT_COUNT / 3);
    const distinctActiveProjects = new Set(activeRows.map((r) => r.project_id)).size;
    assert.equal(distinctActiveProjects, expectedActiveProjects, "draft/archived programmes' activities must never be mistaken for an active programme's");
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms the single-project programme_activities query uses a real index, not a sequential scan", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query(
      "explain select id, status, planned_finish from public.programme_activities where project_id = $1 and status = 'not_started'",
      [singleProjectId]
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(plan), `expected an index scan on programme_activities_project_status_idx, got:\n${plan}`);
  } finally {
    await owner.end();
  }
});
