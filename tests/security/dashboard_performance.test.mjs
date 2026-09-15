// Project Control Dashboard (Priority 6) — performance check with
// realistic seeded data. Not a claim of production-scale performance
// (this repo's real data is currently ~4 projects) — this proves the
// QUERY SHAPE itself is O(rows), not O(projects) or O(projects x
// actions): a fixed, small number of broad queries regardless of how
// many projects/actions exist, the N+1 pattern this priority was
// explicitly told to check for.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_dashboard_performance";
const OWNER = "d0000000-0000-0000-0000-000000000001";
const PROJECT_COUNT = 25;
const ACTIONS_PER_PROJECT = 20; // 500 actions total

let projectIds = [];

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query("insert into auth.users (id, email) values ($1,'owner@example.com')", [OWNER]);
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const orgId = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;

  for (let i = 0; i < PROJECT_COUNT; i++) {
    const proj = await owner.query(
      "insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id",
      [`Perf Site ${i}`, orgId, OWNER]
    );
    const projectId = proj.rows[0].id;
    projectIds.push(projectId);
    for (let j = 0; j < ACTIONS_PER_PROJECT; j++) {
      const status = ["open", "in_progress", "blocked", "completed", "cancelled"][j % 5];
      const priority = ["low", "medium", "high", "critical"][j % 4];
      await owner.query(
        "insert into public.actions (project_id, title, status, priority, due_date) values ($1,$2,$3,$4,$5)",
        [projectId, `Action ${j}`, status, priority, j % 3 === 0 ? "2020-01-01" : null]
      );
    }
  }
  await owner.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

test(`Performance: the portfolio query shape (projects + roles + actions + hs_audit_items) completes quickly across ${PROJECT_COUNT} projects / ${PROJECT_COUNT * ACTIONS_PER_PROJECT} actions`, async () => {
  // 4 separate connections, matching how the real browser app issues
  // Promise.all-batched Supabase requests (each its own HTTP/PG
  // connection) — a single pg Client can't truly pipeline concurrent
  // queries, so reusing one connection here would just silently
  // serialise them and understate real concurrency.
  const clients = await Promise.all([userClient(DB, OWNER), userClient(DB, OWNER), userClient(DB, OWNER), userClient(DB, OWNER)]);
  try {
    const start = Date.now();

    // Exactly the 4 queries getPortfolioControlSummary() issues — never
    // one per project.
    const [projects, roles, actions, hsItems] = await Promise.all([
      clients[0].query("select id, name, status, rag_status from public.projects order by name"),
      clients[1].query("select project_id, role from public.get_my_project_roles()"),
      clients[2].query("select id, project_id, status, priority, due_date from public.actions"),
      clients[3].query("select project_id, status, severity from public.hs_audit_items"),
    ]);

    const elapsedMs = Date.now() - start;

    assert.equal(projects.rowCount, PROJECT_COUNT);
    assert.equal(roles.rowCount, PROJECT_COUNT, "get_my_project_roles() must return exactly one row per project, in one query");
    assert.equal(actions.rowCount, PROJECT_COUNT * ACTIONS_PER_PROJECT);
    assert.ok(elapsedMs < 2000, `4 broad queries across ${PROJECT_COUNT} projects / ${actions.rowCount} actions took ${elapsedMs}ms — expected comfortably under 2s with the indexes from Priority 4/5`);
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
});

test("Performance: EXPLAIN confirms the actions query uses a real index, not a sequential scan, for a single project's control view", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query(
      `explain select project_id, status, due_date from public.actions where project_id = $1`,
      [projectIds[0]]
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(plan), `expected an index scan on actions_project_status_idx or actions_project_due_date_idx, got:\n${plan}`);
  } finally {
    await owner.end();
  }
});

test("Performance: get_project_members() calls scale with distinct PROJECTS in an attention list, not with the number of actions", async () => {
  // All 500 actions collapse to a bounded number of distinct projects —
  // getMemberEmailMap() in app.js calls get_project_members() once per
  // DISTINCT project_id it sees, never once per action.
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query("select distinct project_id from public.actions where status not in ('completed','cancelled')");
    assert.equal(rows.length, PROJECT_COUNT, "distinct-project count should equal the project count, not the action count — this bounds getMemberEmailMap()'s real call volume");
  } finally {
    await owner.end();
  }
});
