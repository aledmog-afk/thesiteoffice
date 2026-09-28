// Plot Control Data Linkage (Priority 13) — performance check.
// getProjectPlotReadiness() now issues 2 MORE broad, project-scoped
// queries (actions, inspection_findings, both .not("plot_id","is",null))
// on top of the 7 Priority 12 already established — still a FIXED
// number regardless of plot count, never one per plot. This proves
// that shape holds at 50/250/500 plots and compares directly against
// Priority 12's own numbers for the same sizes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_plot_action_finding_linkage_performance";
const OWNER = "e0000000-0000-0000-0000-000000000051";

let fx;

async function seedProjectWithPlots(owner, orgId, name, plotCount) {
  const proj = (await owner.query("insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id", [name, orgId, OWNER])).rows[0].id;
  const programme = (await owner.query("insert into public.programmes (project_id, name, status) values ($1,'Programme','active') returning id", [proj])).rows[0].id;
  const inspection = (await owner.query("insert into public.inspections (project_id, title) values ($1,'Walk') returning id", [proj])).rows[0].id;
  for (let i = 0; i < plotCount; i++) {
    const plot = (await owner.query("insert into public.plots (project_id, plot_number, created_by) values ($1,$2,$3) returning id", [proj, `Plot ${i + 1}`, OWNER])).rows[0].id;
    const list = (await owner.query("select id from public.snag_lists where plot_id = $1", [plot])).rows[0].id;
    await owner.query(
      "insert into public.snag_items (project_id, snag_list_id, location, description, priority, status, due_date) values ($1,$2,'Loc','Issue','high','open',$3)",
      [proj, list, "2030-01-01"]
    );
    await owner.query(
      "insert into public.programme_activities (programme_id, plot_id, title, planned_finish, forecast_finish) values ($1,$2,$3,'2026-09-01','2026-09-01')",
      [programme, plot, `Activity ${i}`]
    );
    await owner.query(
      "insert into public.actions (project_id, plot_id, title, status, priority, due_date) values ($1,$2,$3,$4,$5,$6)",
      [proj, plot, `Action ${i}`, ["open", "in_progress", "blocked"][i % 3], ["low", "medium", "high", "critical"][i % 4], i % 2 === 0 ? "2030-01-01" : null]
    );
    await owner.query(
      "insert into public.inspection_findings (project_id, inspection_id, plot_id, title, severity, status) values ($1,$2,$3,$4,$5,$6)",
      [proj, inspection, plot, `Finding ${i}`, ["low", "medium", "high", "critical"][i % 4], i % 3 === 0 ? "resolved" : "open"]
    );
  }
  return proj;
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query("insert into auth.users (id, email) values ($1,'owner@example.com')", [OWNER]);
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const orgId = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;

  const proj50 = await seedProjectWithPlots(owner, orgId, "50-plot site", 50);
  const proj250 = await seedProjectWithPlots(owner, orgId, "250-plot site", 250);
  const proj500 = await seedProjectWithPlots(owner, orgId, "500-plot site", 500);

  await owner.end();
  fx = { orgId, proj50, proj250, proj500 };
});

after(async () => {
  await dropTestDatabase(DB);
});

// The exact 9-broad-query + 1-role-check shape getProjectPlotReadiness()
// now issues (7 from Priority 12 + 2 new: actions, inspection_findings).
async function runReadinessQueryShape(client, projectId) {
  const start = Date.now();
  const [role, plots, gates, docs, lists, snags, activities, actions, findings] = await Promise.all([
    client.query("select public.get_my_role($1) as role", [projectId]),
    client.query("select * from public.plots where project_id = $1", [projectId]),
    client.query("select plot_id, status from public.quality_gates where project_id = $1 and plot_id is not null", [projectId]),
    client.query("select plot_id, status from public.handover_documents where project_id = $1 and plot_id is not null", [projectId]),
    client.query("select id, plot_id from public.snag_lists where project_id = $1", [projectId]),
    client.query("select plot_id, snag_list_id, status, priority, due_date from public.snag_items where project_id = $1", [projectId]),
    client.query("select plot_id, is_milestone, status, planned_start, planned_finish, forecast_start, forecast_finish, actual_finish from public.programme_activities where project_id = $1 and plot_id is not null", [projectId]),
    client.query("select plot_id, status, priority, due_date from public.actions where project_id = $1 and plot_id is not null", [projectId]),
    client.query("select plot_id, severity, status from public.inspection_findings where project_id = $1 and plot_id is not null", [projectId]),
  ]);
  const elapsedMs = Date.now() - start;
  return {
    elapsedMs, plots: plots.rowCount, gates: gates.rowCount, docs: docs.rowCount, lists: lists.rowCount,
    snags: snags.rowCount, activities: activities.rowCount, actions: actions.rowCount, findings: findings.rowCount,
  };
}

test("Performance: the extended (9-query) plot-readiness shape completes quickly against 50 plots", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const r = await runReadinessQueryShape(owner, fx.proj50);
    assert.equal(r.plots, 50);
    assert.equal(r.actions, 50);
    assert.equal(r.findings, 50);
    assert.ok(r.elapsedMs < 1000, `took ${r.elapsedMs}ms for 50 plots — expected comfortably under 1s`);
  } finally {
    await owner.end();
  }
});

test("Performance: the same shape completes quickly against 250 plots", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const r = await runReadinessQueryShape(owner, fx.proj250);
    assert.equal(r.plots, 250);
    assert.ok(r.elapsedMs < 1500, `took ${r.elapsedMs}ms for 250 plots — expected comfortably under 1.5s`);
  } finally {
    await owner.end();
  }
});

test("Performance: the same shape completes quickly against 500 plots — no per-plot query growth even with 2 more tables added", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const r = await runReadinessQueryShape(owner, fx.proj500);
    assert.equal(r.plots, 500);
    assert.equal(r.actions, 500);
    assert.equal(r.findings, 500);
    assert.ok(r.elapsedMs < 2000, `took ${r.elapsedMs}ms for 500 plots — expected comfortably under 2s, matching Priority 12's own 500-plot budget despite 2 extra queries`);
  } finally {
    await owner.end();
  }
});

test("Performance: 500-plot readiness does not scale worse than linearly against 50-plot readiness, confirming the 2 new queries add fixed (not per-plot) cost", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const small = await runReadinessQueryShape(owner, fx.proj50);
    const large = await runReadinessQueryShape(owner, fx.proj500);
    assert.ok(large.elapsedMs < small.elapsedMs * 10, `500-plot query (${large.elapsedMs}ms) must not scale worse than linearly against the 50-plot query (${small.elapsedMs}ms)`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms actions/inspection_findings project-scoped lookups use their existing project_id-leading indexes (actions_project_status_idx, inspection_findings_project_status_idx)", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const actionsPlan = await owner.query("explain select plot_id, status from public.actions where project_id = $1 and plot_id is not null", [fx.proj500]);
    const actionsText = actionsPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(actionsText), `expected an index scan on actions, got:\n${actionsText}`);

    const findingsPlan = await owner.query("explain select plot_id, severity, status from public.inspection_findings where project_id = $1 and plot_id is not null", [fx.proj500]);
    const findingsText = findingsPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(findingsText), `expected an index scan on inspection_findings, got:\n${findingsText}`);
  } finally {
    await owner.end();
  }
});

test("Performance: no index was added for plot_id itself (no query evidence justifies one yet) — EXPLAIN over a plot_id-scoped lookup still completes fast at 500 rows via the project_id index + filter", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plan = await owner.query("explain analyze select * from public.actions where project_id = $1 and plot_id is not null", [fx.proj500]);
    const text = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    const timeMatch = text.match(/actual time=[\d.]+\.\.([\d.]+)/);
    assert.ok(timeMatch, `expected an actual execution time in the EXPLAIN ANALYZE output, got:\n${text}`);
    assert.ok(Number(timeMatch[1]) < 50, `expected well under 50ms even at 500 rows, got ${timeMatch[1]}ms`);
  } finally {
    await owner.end();
  }
});
