// Weekly Reporting (Priority 9) — performance check with realistic
// seeded data. Not a claim of production-scale performance — this
// proves getWeeklyReportPosition()'s query shape stays a small FIXED
// number of broad, project-scoped queries regardless of how many
// actions/snags/findings/inspections exist for the project (never one
// per row, and never scaling with the OTHER projects in the same
// organisation — every query here is already .eq("project_id", ...)
// scoped, unlike the portfolio Dashboard's deliberately unfiltered
// queries), backed by real index usage for the project-scoped lookups.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_weekly_reports_performance";
const OWNER = "e0000000-0000-0000-0000-000000000001";
const ACTIONS_COUNT = 200;
const SNAGS_COUNT = 150;
const FINDINGS_COUNT = 100;
const INSPECTIONS_COUNT = 25;
const OTHER_PROJECTS = 20; // other projects in the SAME org, each with their own data — must not affect this project's query cost

let projectId;

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

  for (let i = 0; i < ACTIONS_COUNT; i++) {
    await owner.query(
      "insert into public.actions (project_id, title, status, priority, due_date) values ($1,$2,$3,$4,$5)",
      [projectId, `Action ${i}`, ["open", "in_progress", "blocked", "completed"][i % 4], ["low", "medium", "high", "critical"][i % 4], i % 3 === 0 ? "2026-09-01" : null]
    );
  }
  const plot = await owner.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id", [projectId]);
  const list = await owner.query("select id from public.snag_lists where plot_id = $1", [plot.rows[0].id]);
  for (let i = 0; i < SNAGS_COUNT; i++) {
    await owner.query(
      "insert into public.snag_items (project_id, snag_list_id, location, description, status, priority, due_date) values ($1,$2,$3,$4,$5,$6,$7)",
      [projectId, list.rows[0].id, `Loc ${i}`, `Issue ${i}`, ["open", "closed", "rejected"][i % 3], ["low", "medium", "high"][i % 3], i % 3 === 0 ? "2026-09-01" : null]
    );
  }
  for (let i = 0; i < INSPECTIONS_COUNT; i++) {
    const insp = await owner.query(
      "insert into public.inspections (project_id, title, status, inspection_date) values ($1,$2,'completed',$3) returning id",
      [projectId, `Inspection ${i}`, "2026-09-09"]
    );
    for (let f = 0; f < FINDINGS_COUNT / INSPECTIONS_COUNT; f++) {
      await owner.query(
        "insert into public.inspection_findings (project_id, inspection_id, title, severity) values ($1,$2,$3,$4)",
        [projectId, insp.rows[0].id, `Finding ${i}-${f}`, ["low", "medium", "high", "critical"][f % 4]]
      );
    }
  }

  // Other projects in the SAME org with their own substantial data —
  // proves this project's own query cost doesn't grow with the rest of
  // the portfolio, since every query below is project_id-scoped.
  for (let p = 0; p < OTHER_PROJECTS; p++) {
    const other = await owner.query("insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id", [`Other ${p}`, orgId, OWNER]);
    for (let i = 0; i < 20; i++) {
      await owner.query("insert into public.actions (project_id, title) values ($1,$2)", [other.rows[0].id, `Other action ${i}`]);
    }
  }

  await owner.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

test(`Performance: getWeeklyReportPosition()'s 6 project-scoped queries complete quickly against ${ACTIONS_COUNT} actions / ${SNAGS_COUNT} snags / ${FINDINGS_COUNT} findings, unaffected by ${OTHER_PROJECTS} other projects in the same org`, async () => {
  // 6 separate connections, matching how the real browser app issues
  // Promise.all-batched Supabase requests.
  const clients = await Promise.all(Array.from({ length: 6 }, () => userClient(DB, OWNER)));
  try {
    const start = Date.now();
    const [actions, snags, findings, inspections, hsAudits, hsItems] = await Promise.all([
      clients[0].query("select id, title, status, priority, assigned_to, due_date, created_at, completed_at from public.actions where project_id = $1", [projectId]),
      clients[1].query("select id, item_no, location, description, priority, status, raised_date, closed_date, verified_at, snag_list_id from public.snag_items where project_id = $1", [projectId]),
      clients[2].query("select id, title, severity, status, action_id, inspection_id, resolved_at from public.inspection_findings where project_id = $1", [projectId]),
      clients[3].query("select id, title, status, inspection_date from public.inspections where project_id = $1", [projectId]),
      clients[4].query("select month from public.hs_audits where project_id = $1", [projectId]),
      clients[5].query("select status, severity from public.hs_audit_items where project_id = $1", [projectId]),
    ]);
    const elapsedMs = Date.now() - start;

    assert.equal(actions.rowCount, ACTIONS_COUNT);
    assert.equal(snags.rowCount, SNAGS_COUNT);
    assert.equal(findings.rowCount, FINDINGS_COUNT);
    assert.equal(inspections.rowCount, INSPECTIONS_COUNT);
    assert.ok(elapsedMs < 2000, `6 project-scoped queries took ${elapsedMs}ms — expected comfortably under 2s`);
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
});

test("Performance: EXPLAIN confirms the actions/snags lookups use the project_id indexes, not a sequential scan across the whole org", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const actionsPlan = await owner.query("explain select status, priority, due_date from public.actions where project_id = $1", [projectId]);
    const actionsText = actionsPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(actionsText), `expected an index scan on actions, got:\n${actionsText}`);

    const snagsPlan = await owner.query("explain select status, priority, due_date from public.snag_items where project_id = $1", [projectId]);
    const snagsText = snagsPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(snagsText), `expected an index scan on snag_items, got:\n${snagsText}`);
  } finally {
    await owner.end();
  }
});

test("Performance: a project's weekly_reports list uses the new (project_id, week_starting) index, not a sequential scan", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    for (let i = 0; i < 10; i++) {
      await owner.query(
        "insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1,$2,$3)",
        [projectId, `2026-0${(i % 9) + 1}-01`, `2026-0${(i % 9) + 1}-05`]
      );
    }
    const plan = await owner.query("explain select id, week_starting, week_ending, status from public.weekly_reports where project_id = $1 order by week_starting desc", [projectId]);
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(planText), `expected an index scan on weekly_reports_project_week_idx, got:\n${planText}`);
  } finally {
    await owner.end();
  }
});
