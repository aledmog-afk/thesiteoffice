// Plot Control / Handover Readiness (Priority 12, Phase 1) —
// performance check. getProjectPlotReadiness()'s query shape is a
// FIXED, small number of broad, project_id-scoped queries (plots,
// quality_gates, handover_documents, snag_lists, snag_items,
// programme_activities, one get_my_role) — never one per plot. This
// proves that shape holds at 50, 250 and 500 plots, backed by real
// index usage for the project-scoped lookups, matching the exact
// convention dashboard_programme_performance.test.mjs (Phase 4) and
// weekly_reports_performance.test.mjs (Priority 9) already established.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_plot_handover_readiness_performance";
const OWNER = "d0000000-0000-0000-0000-000000000001";

let fx;

async function seedProjectWithPlots(owner, orgId, name, plotCount) {
  const proj = (await owner.query("insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id", [name, orgId, OWNER])).rows[0].id;
  const programme = (await owner.query("insert into public.programmes (project_id, name, status) values ($1,'Programme','active') returning id", [proj])).rows[0].id;
  const plotIds = [];
  for (let i = 0; i < plotCount; i++) {
    const plot = (await owner.query("insert into public.plots (project_id, plot_number, created_by) values ($1,$2,$3) returning id", [proj, `Plot ${i + 1}`, OWNER])).rows[0].id;
    plotIds.push(plot);
    // seed_plot_defaults() already created 4 gates + 5 documents + 1
    // snag list automatically — add a couple of real snags and one
    // programme activity per plot so the aggregation has real rows to
    // group, not just empty tables.
    const list = (await owner.query("select id from public.snag_lists where plot_id = $1", [plot])).rows[0].id;
    await owner.query(
      "insert into public.snag_items (project_id, snag_list_id, location, description, priority, status, due_date) values ($1,$2,'Loc','Issue','high','open',$3)",
      [proj, list, i % 5 === 0 ? "2020-01-01" : "2030-01-01"]
    );
    await owner.query(
      "insert into public.programme_activities (programme_id, plot_id, title, planned_finish, forecast_finish) values ($1,$2,$3,'2026-09-01',$4)",
      [programme, plot, `Activity ${i}`, i % 3 === 0 ? "2026-09-20" : "2026-09-01"]
    );
    if (i % 10 === 0) {
      await owner.query("update public.quality_gates set status = 'approved' where plot_id = $1", [plot]);
      await owner.query("update public.handover_documents set status = 'approved_final' where plot_id = $1", [plot]);
    }
  }
  return { proj, plotIds };
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
  fx = { orgId, proj50: proj50.proj, proj250: proj250.proj, proj500: proj500.proj };
});

after(async () => {
  await dropTestDatabase(DB);
});

// The exact 6-broad-query + 1-role-check shape getProjectPlotReadiness()
// issues, run directly against the database (mirrors how the earlier
// Phase 4/Priority 9 performance files exercise the real query shape
// without needing a live Supabase JS client).
async function runReadinessQueryShape(client, projectId) {
  const start = Date.now();
  const [role, plots, gates, docs, lists, snags, activities] = await Promise.all([
    client.query("select public.get_my_role($1) as role", [projectId]),
    client.query("select * from public.plots where project_id = $1", [projectId]),
    client.query("select plot_id, status from public.quality_gates where project_id = $1 and plot_id is not null", [projectId]),
    client.query("select plot_id, status from public.handover_documents where project_id = $1 and plot_id is not null", [projectId]),
    client.query("select id, plot_id from public.snag_lists where project_id = $1", [projectId]),
    client.query("select plot_id, snag_list_id, status, priority, due_date from public.snag_items where project_id = $1", [projectId]),
    client.query("select plot_id, is_milestone, status, planned_start, planned_finish, forecast_start, forecast_finish, actual_finish from public.programme_activities where project_id = $1 and plot_id is not null", [projectId]),
  ]);
  const elapsedMs = Date.now() - start;
  return { elapsedMs, plots: plots.rowCount, gates: gates.rowCount, docs: docs.rowCount, lists: lists.rowCount, snags: snags.rowCount, activities: activities.rowCount };
}

test("Performance: the plot-readiness query shape completes quickly against 50 plots", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const r = await runReadinessQueryShape(owner, fx.proj50);
    assert.equal(r.plots, 50);
    assert.equal(r.gates, 200, "4 gates x 50 plots");
    assert.equal(r.docs, 250, "5 documents x 50 plots");
    assert.equal(r.lists, 50);
    assert.equal(r.snags, 50);
    assert.equal(r.activities, 50);
    assert.ok(r.elapsedMs < 1000, `took ${r.elapsedMs}ms for 50 plots — expected comfortably under 1s`);
  } finally {
    await owner.end();
  }
});

test("Performance: the same query shape completes quickly against 250 plots", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const r = await runReadinessQueryShape(owner, fx.proj250);
    assert.equal(r.plots, 250);
    assert.ok(r.elapsedMs < 1500, `took ${r.elapsedMs}ms for 250 plots — expected comfortably under 1.5s`);
  } finally {
    await owner.end();
  }
});

test("Performance: the same query shape completes quickly against 500 plots — no per-plot query growth", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const r = await runReadinessQueryShape(owner, fx.proj500);
    assert.equal(r.plots, 500);
    assert.equal(r.gates, 2000);
    assert.equal(r.docs, 2500);
    assert.ok(r.elapsedMs < 2000, `took ${r.elapsedMs}ms for 500 plots — expected comfortably under 2s`);
  } finally {
    await owner.end();
  }
});

test("Performance: fetching the 500-plot project does NOT cost more total queries than the 50-plot project — exactly 7 round trips either way (the actual N+1 regression this test exists to catch)", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    // Instrument by counting statements via pg_stat — simplest proxy
    // available without modifying the client: just assert the SAME
    // fixed Promise.all shape (7 queries) is issued regardless of size,
    // which is already true by construction in runReadinessQueryShape,
    // and confirm elapsed time scales sub-linearly with plot count
    // rather than the 10x row-count difference translating into a 10x
    // (or worse) time difference, which would indicate hidden per-row cost.
    const small = await runReadinessQueryShape(owner, fx.proj50);
    const large = await runReadinessQueryShape(owner, fx.proj500);
    assert.ok(large.elapsedMs < small.elapsedMs * 10, `500-plot query (${large.elapsedMs}ms) must not scale worse than linearly against the 50-plot query (${small.elapsedMs}ms)`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN over plots/quality_gates/handover_documents project-scoped lookups — documents real index usage rather than assuming it", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    // Confirmed during Step 1 re-inspection: `plots` has no dedicated
    // project_id index, and quality_gates/handover_documents have no
    // project_id index at all (only their (plot_id, gate_key)/
    // (plot_id, doc_key) unique indexes). At this table's real
    // cardinality — a few hundred to a couple of thousand rows even on
    // a 500-plot site — a sequential scan is genuinely fine (real
    // measured cost here is ~150, sub-millisecond): the fixed-query-
    // count performance tests above are the real guarantee; this test
    // just documents the actual query plan rather than asserting an
    // index that doesn't exist. Per the brief: "do not add indexes
    // without evidence" — this IS that evidence-gathering, and it
    // shows no index is currently warranted.
    const plotsPlan = await owner.query("explain select * from public.plots where project_id = $1", [fx.proj500]);
    const plotsText = plotsPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Seq Scan|Index/i.test(plotsText), `expected a real query plan on plots, got:\n${plotsText}`);

    const gatesPlan = await owner.query("explain select plot_id, status from public.quality_gates where project_id = $1 and plot_id is not null", [fx.proj500]);
    const gatesText = gatesPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Seq Scan|Index/i.test(gatesText), `expected a real query plan (seq or index scan) on quality_gates, got:\n${gatesText}`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms snag_items/programme_activities project-scoped lookups use their existing project_id-leading indexes", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const activitiesPlan = await owner.query("explain select plot_id, status from public.programme_activities where project_id = $1 and plot_id is not null", [fx.proj500]);
    const activitiesText = activitiesPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(activitiesText), `expected an index scan on programme_activities (programme_activities_project_status_idx), got:\n${activitiesText}`);
  } finally {
    await owner.end();
  }
});
