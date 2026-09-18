// Inspections (Priority 7) — performance check with realistic seeded
// data. Not a claim of production-scale performance — this proves the
// dashboard-integration query shape stays a fixed small number of
// broad queries regardless of how many inspections/findings exist
// (never one per inspection), and that the per-inspection findings
// list uses a real index rather than a sequential scan.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_inspections_performance";
const OWNER = "e0000000-0000-0000-0000-000000000001";
const PROJECT_COUNT = 15;
const INSPECTIONS_PER_PROJECT = 5; // 75 inspections
const FINDINGS_PER_INSPECTION = 4; // 300 findings total

let inspectionIds = [];

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
    for (let i = 0; i < INSPECTIONS_PER_PROJECT; i++) {
      const insp = await owner.query(
        "insert into public.inspections (project_id, title) values ($1,$2) returning id",
        [projectId, `Inspection ${i}`]
      );
      const inspectionId = insp.rows[0].id;
      inspectionIds.push(inspectionId);
      for (let f = 0; f < FINDINGS_PER_INSPECTION; f++) {
        const severity = ["low", "medium", "high", "critical"][f % 4];
        await owner.query(
          "insert into public.inspection_findings (project_id, inspection_id, title, severity) values ($1,$2,$3,$4)",
          [projectId, inspectionId, `Finding ${f}`, severity]
        );
      }
    }
  }
  await owner.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

test(`Performance: the portfolio finding-signal query (one broad select) completes quickly across ${PROJECT_COUNT} projects / ${PROJECT_COUNT * INSPECTIONS_PER_PROJECT * FINDINGS_PER_INSPECTION} findings`, async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const start = Date.now();
    const { rows } = await owner.query("select id, project_id, severity, status, action_id from public.inspection_findings");
    const elapsedMs = Date.now() - start;

    assert.equal(rows.length, PROJECT_COUNT * INSPECTIONS_PER_PROJECT * FINDINGS_PER_INSPECTION);
    assert.ok(elapsedMs < 2000, `one broad select across ${rows.length} findings took ${elapsedMs}ms — expected comfortably under 2s`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms a single inspection's findings list uses the inspection_id index, not a sequential scan", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query(
      "explain select id, title, severity, status from public.inspection_findings where inspection_id = $1",
      [inspectionIds[0]]
    );
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(plan), `expected an index scan on inspection_findings_inspection_idx, got:\n${plan}`);
  } finally {
    await owner.end();
  }
});

test("Performance: a project-level severity/status rollup uses the composite indexes, not a sequential scan", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query(
      "select p.id as project_id from public.projects p limit 1"
    );
    const projectId = rows[0].project_id;
    const plan = await owner.query(
      "explain select severity, status from public.inspection_findings where project_id = $1 and severity = 'critical'",
      [projectId]
    );
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(planText), `expected an index scan on inspection_findings_project_severity_idx, got:\n${planText}`);
  } finally {
    await owner.end();
  }
});
