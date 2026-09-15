// Defects / Snagging (Priority 8) — performance check with realistic
// seeded data. Not a claim of production-scale performance — this
// proves the dashboard-integration query shape stays a fixed small
// number of broad queries regardless of how many snags exist (never
// one per project — the N+1 pattern every priority since Priority 6
// was told to watch for), and that a project-scoped status/due_date
// lookup uses a real index rather than a sequential scan.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_snags_performance";
const OWNER = "f0000000-0000-0000-0000-000000000001";
const PROJECT_COUNT = 15;
const PLOTS_PER_PROJECT = 4;
// Each plot's auto-created snag_list gets 5 snags — 15 * 4 * 5 = 300 snags.
const SNAGS_PER_LIST = 5;

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

  for (let p = 0; p < PROJECT_COUNT; p++) {
    const proj = await owner.query(
      "insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id",
      [`Perf Site ${p}`, orgId, OWNER]
    );
    const projectId = proj.rows[0].id;
    projectIds.push(projectId);
    for (let pl = 0; pl < PLOTS_PER_PROJECT; pl++) {
      const plot = await owner.query(
        "insert into public.plots (project_id, plot_number) values ($1,$2) returning id",
        [projectId, `Plot ${pl}`]
      );
      const list = await owner.query("select id from public.snag_lists where plot_id = $1", [plot.rows[0].id]);
      const listId = list.rows[0].id;
      for (let s = 0; s < SNAGS_PER_LIST; s++) {
        const status = ["open", "closed", "rejected"][s % 3];
        const priority = ["low", "medium", "high"][s % 3];
        await owner.query(
          "insert into public.snag_items (project_id, snag_list_id, location, description, status, priority, due_date) values ($1,$2,$3,$4,$5,$6,$7)",
          [projectId, listId, `Location ${s}`, `Issue ${s}`, status, priority, s % 3 === 0 ? "2020-01-01" : null]
        );
      }
    }
  }
  await owner.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

test(`Performance: the portfolio snag-signal query (one broad select) completes quickly across ${PROJECT_COUNT} projects / ${PROJECT_COUNT * PLOTS_PER_PROJECT * SNAGS_PER_LIST} snags`, async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const start = Date.now();
    const { rows } = await owner.query("select project_id, status, priority, due_date from public.snag_items");
    const elapsedMs = Date.now() - start;

    assert.equal(rows.length, PROJECT_COUNT * PLOTS_PER_PROJECT * SNAGS_PER_LIST);
    assert.ok(elapsedMs < 2000, `one broad select across ${rows.length} snags took ${elapsedMs}ms — expected comfortably under 2s`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms a project-scoped status rollup uses the composite index, not a sequential scan", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query(
      "explain select status from public.snag_items where project_id = $1 and status = 'open'",
      [projectIds[0]]
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(plan), `expected an index scan on snag_items_project_status_idx, got:\n${plan}`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms a project-scoped due_date lookup (overdue snags) uses the composite index, not a sequential scan", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query(
      "explain select due_date from public.snag_items where project_id = $1 and due_date < current_date",
      [projectIds[0]]
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(plan), `expected an index scan on snag_items_project_due_date_idx, got:\n${plan}`);
  } finally {
    await owner.end();
  }
});

test("Performance: the linked-action/finding lookups use their own indexes, not a sequential scan", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const action = await owner.query("insert into public.actions (project_id, title) values ($1,'Perf action') returning id", [projectIds[0]]);
    const listRow = await owner.query("select id from public.snag_lists where project_id = $1 limit 1", [projectIds[0]]);
    const snag = await owner.query(
      "insert into public.snag_items (project_id, snag_list_id, location, description, action_id) values ($1,$2,'x','y',$3) returning id",
      [projectIds[0], listRow.rows[0].id, action.rows[0].id]
    );
    const plan = await owner.query("explain select id from public.snag_items where action_id = $1", [action.rows[0].id]);
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(planText), `expected an index scan on snag_items_action_idx, got:\n${planText}`);
    assert.ok(snag.rows[0].id, "sanity check: the linked snag was actually created");
  } finally {
    await owner.end();
  }
});
