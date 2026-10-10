// Controlled XLSX Programme Import (Priority 11, Phase 3) — performance
// of the transactional import_programme_activities() RPC itself at
// three realistic scales (brief section 20: "test at least 50, 500,
// and 5,000-row workbooks"). Distinct from Phase 2's own
// programme_performance.test.mjs, which measures READING an existing
// activity list — this measures the RPC's own WRITE path: one
// function call processing an entire batch as a single transaction,
// row by row, with a real per-row duplicate/match/ownership check
// against the live database for every row. Not a claim of
// production-scale performance at 100,000 rows — the brief explicitly
// says not to prematurely optimise for that; this proves the batch
// sizes a real construction programme workbook would actually contain
// stay comfortably usable.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_programme_import_performance";
const OWNER = "e0000000-0000-0000-0000-000000000005";

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
  await owner.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

function buildBatch(prefix, n) {
  return Array.from({ length: n }, (_, i) => ({
    client_row_index: i,
    external_id: `${prefix}-${i}`,
    title: `Activity ${prefix}-${i}`,
    planned_start: `2026-${String((i % 12) + 1).padStart(2, "0")}-01`,
    planned_finish: `2026-${String((i % 12) + 1).padStart(2, "0")}-15`,
    is_milestone: i % 50 === 0,
    plot_id: null,
  }));
}

for (const size of [50, 500, 5000]) {
  test(`Performance: importing ${size} new activities in one batch stays usable and creates exactly ${size} rows`, async () => {
    const owner = await userClient(DB, OWNER);
    try {
      const prog = await owner.query("insert into public.programmes (project_id, name) values ($1, $2) returning id", [projectId, `Perf ${size}`]);
      const programmeId = prog.rows[0].id;
      const batch = buildBatch(`P${size}`, size);

      const start = Date.now();
      const { rows } = await owner.query("select public.import_programme_activities($1, $2::jsonb) as result", [programmeId, JSON.stringify(batch)]);
      const elapsedMs = Date.now() - start;
      const result = rows[0].result;

      assert.equal(result.created, size);
      assert.equal(result.rejected.length, 0);
      // Generous ceiling — this proves the batch stays usable within a
      // normal request, not a tight performance guarantee.
      const ceilingMs = size <= 500 ? 5000 : 20000;
      assert.ok(elapsedMs < ceilingMs, `importing ${size} rows took ${elapsedMs}ms — expected under ${ceilingMs}ms`);
    } finally {
      await owner.end();
    }
  });
}

test("Performance: re-importing the SAME 5,000-row batch unchanged is fast and writes nothing new (real diff-detection, not a blind re-write)", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const prog = await owner.query("insert into public.programmes (project_id, name) values ($1, 'Perf Reimport') returning id", [projectId]);
    const programmeId = prog.rows[0].id;
    const batch = buildBatch("REIMPORT", 5000);

    await owner.query("select public.import_programme_activities($1, $2::jsonb) as result", [programmeId, JSON.stringify(batch)]);

    const start = Date.now();
    const { rows } = await owner.query("select public.import_programme_activities($1, $2::jsonb) as result", [programmeId, JSON.stringify(batch)]);
    const elapsedMs = Date.now() - start;
    const result = rows[0].result;

    assert.equal(result.unchanged, 5000);
    assert.equal(result.created, 0);
    assert.equal(result.updated, 0);
    assert.ok(elapsedMs < 20000, `re-importing 5,000 unchanged rows took ${elapsedMs}ms — expected under 20000ms`);

    const { rows: countRows } = await owner.query("select count(*)::int as n from public.programme_activities where programme_id = $1", [programmeId]);
    assert.equal(countRows[0].n, 5000, "the row count must not have doubled or otherwise changed");
  } finally {
    await owner.end();
  }
});

test("Performance: a mixed 5,000-row re-import (some changed, most unchanged) only writes the changed rows", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const prog = await owner.query("insert into public.programmes (project_id, name) values ($1, 'Perf Mixed Reimport') returning id", [projectId]);
    const programmeId = prog.rows[0].id;
    const original = buildBatch("MIXED", 5000);
    await owner.query("select public.import_programme_activities($1, $2::jsonb) as result", [programmeId, JSON.stringify(original)]);

    const revised = original.map((r, i) => (i % 10 === 0 ? { ...r, title: `${r.title} (revised)` } : r));
    const { rows } = await owner.query("select public.import_programme_activities($1, $2::jsonb) as result", [programmeId, JSON.stringify(revised)]);
    const result = rows[0].result;

    assert.equal(result.updated, 500, "exactly the 1-in-10 rows with a changed title must be counted as updates");
    assert.equal(result.unchanged, 4500);
    assert.equal(result.created, 0);
  } finally {
    await owner.end();
  }
});
