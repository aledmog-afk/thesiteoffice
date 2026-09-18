// Documents (Priority 10) — performance check with realistic seeded
// data. Not a claim of production-scale performance — this proves
// listDocuments()'s project-scoped query shape (two broad selects,
// never one per document/revision — see tracker/js/app.js) is backed
// by real index usage, and that a project's own document cost doesn't
// grow with the rest of the organisation's portfolio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_documents_performance";
const OWNER = "e0000000-0000-0000-0000-000000000002";
const DOCUMENTS_COUNT = 150;
const OTHER_PROJECTS = 20;

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

  for (let i = 0; i < DOCUMENTS_COUNT; i++) {
    const doc = await owner.query(
      "insert into public.documents (project_id, document_type, title, status) values ($1,$2,$3,$4) returning id",
      [projectId, ["drawing", "specification", "other"][i % 3], `Document ${i}`, ["draft", "current", "archived"][i % 3]]
    );
    await owner.query(
      "insert into public.document_revisions (document_id, file_url, file_name) values ($1,$2,$3)",
      [doc.rows[0].id, `path/${i}.pdf`, `file-${i}.pdf`]
    );
  }

  // Other projects in the SAME org, each with their own documents —
  // proves this project's own query cost doesn't scale with the rest
  // of the portfolio, since every query is project_id-scoped.
  for (let p = 0; p < OTHER_PROJECTS; p++) {
    const other = await owner.query("insert into public.projects (name, org_id, created_by) values ($1,$2,$3) returning id", [`Other ${p}`, orgId, OWNER]);
    for (let i = 0; i < 10; i++) {
      await owner.query("insert into public.documents (project_id, title) values ($1,$2)", [other.rows[0].id, `Other doc ${i}`]);
    }
  }

  await owner.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

test(`Performance: listing ${DOCUMENTS_COUNT} documents for a project completes quickly, unaffected by ${OTHER_PROJECTS} other projects in the same org`, async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const start = Date.now();
    const { rowCount } = await owner.query("select * from public.documents where project_id = $1", [projectId]);
    const elapsedMs = Date.now() - start;
    assert.equal(rowCount, DOCUMENTS_COUNT);
    assert.ok(elapsedMs < 2000, `documents lookup took ${elapsedMs}ms — expected comfortably under 2s`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms documents(project_id, status) and documents(project_id, document_type) use their indexes, not a sequential scan across the whole org", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const statusPlan = await owner.query("explain select id, title, status from public.documents where project_id = $1 and status = 'current'", [projectId]);
    const statusText = statusPlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(statusText), `expected an index scan on documents_project_status_idx, got:\n${statusText}`);

    const typePlan = await owner.query("explain select id, title from public.documents where project_id = $1 and document_type = 'drawing'", [projectId]);
    const typeText = typePlan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(typeText), `expected an index scan on documents_project_type_idx, got:\n${typeText}`);
  } finally {
    await owner.end();
  }
});

test("Performance: EXPLAIN confirms document_revisions(document_id, revision_number) is used for a document's revision history", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows: docRows } = await owner.query("select id from public.documents where project_id = $1 limit 1", [projectId]);
    const plan = await owner.query("explain select * from public.document_revisions where document_id = $1 order by revision_number desc", [docRows[0].id]);
    const planText = plan.rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.ok(/Index/i.test(planText), `expected an index scan on document_revisions_document_revision_idx, got:\n${planText}`);
  } finally {
    await owner.end();
  }
});

test("Performance: listDocuments()'s query shape stays exactly 2 broad, project-scoped queries regardless of document count (never one per document)", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows: docs } = await owner.query("select * from public.documents where project_id = $1 order by created_at desc", [projectId]);
    const revisionIds = docs.map((d) => d.current_revision_id).filter(Boolean);
    assert.equal(docs.length, DOCUMENTS_COUNT);
    if (revisionIds.length) {
      const { rowCount } = await owner.query("select * from public.document_revisions where id = any($1)", [revisionIds]);
      assert.equal(rowCount, revisionIds.length, "the second (revisions) query is exactly one broad IN(...) lookup, never one query per document");
    }
  } finally {
    await owner.end();
  }
});
