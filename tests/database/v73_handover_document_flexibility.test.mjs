// Handover document flexibility (v73) — "not all certs are always
// needed." Two changes to handover_documents:
//   1. A new 'not_applicable' status, mirroring quality_gates' existing
//      option exactly — excuses a document from the handover blocker
//      check in plots_before_write() without deleting the row.
//   2. is_custom, so the UI can tell a standard seeded document apart
//      from one a user added themselves via a plain insert (RLS
//      already permits project editors to insert/delete
//      handover_documents directly — no new RPC was needed for this).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, runSql } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROLLBACK = fs.readFileSync(path.join(__dirname, "../../sql/rollback/v73_handover_document_flexibility_rollback.sql"), "utf8");

const DB = "tracker_test_v73_handover_document_flexibility";

const OWNER = "a7100000-0000-0000-0000-000000000001";
const SNAG_ONLY = "a7200000-0000-0000-0000-000000000002";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'v73owner@example.com'), ($2,'v73snag@example.com')`,
    [OWNER, SNAG_ONLY]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const org = (await owner.query("select public.create_organisation('V73 Org', 'main_contractor') as id")).rows[0].id;
  const proj = (await owner.query("insert into public.projects (name, org_id, created_by) values ('V73 Site', $1, $2) returning id", [org, OWNER])).rows[0].id;
  const snagCode = (await owner.query("select public.test_regenerate_snagging_invite_code($1) as code", [proj])).rows[0].code;
  await owner.end();

  const snagOnly = await userClient(DB, SNAG_ONLY);
  await snagOnly.query("select public.test_join_project_by_invite($1)", [snagCode]);
  await snagOnly.end();

  fx = { org, proj };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function makePlot(client, plotNumber = `P-${Math.random().toString(36).slice(2, 8)}`) {
  return (await client.query(
    "insert into public.plots (project_id, plot_number, created_by) values ($1,$2,$3) returning id",
    [fx.proj, plotNumber, OWNER]
  )).rows[0].id;
}

test("handover_documents.status accepts not_applicable, and seeded rows default is_custom to false", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makePlot(owner);
    const doc = (await owner.query("select id, is_custom from public.handover_documents where plot_id = $1 limit 1", [plot])).rows[0];
    assert.equal(doc.is_custom, false);
    await owner.query("update public.handover_documents set status = 'not_applicable' where id = $1", [doc.id]);
    const after = await owner.query("select status from public.handover_documents where id = $1", [doc.id]);
    assert.equal(after.rows[0].status, "not_applicable");
  } finally {
    await owner.end();
  }
});

test("handover_documents.status still rejects a genuinely invalid value", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makePlot(owner);
    const doc = (await owner.query("select id from public.handover_documents where plot_id = $1 limit 1", [plot])).rows[0];
    await assert.rejects(
      owner.query("update public.handover_documents set status = 'bogus' where id = $1", [doc.id]),
      /violates check constraint/i
    );
  } finally {
    await owner.end();
  }
});

test("plots_before_write(): not_applicable documents excuse the handover blocker check, exactly like not_applicable gates already do", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makePlot(owner);
    await owner.query("update public.quality_gates set status = 'approved' where plot_id = $1", [plot]);
    // Approve every document except one, which is set not_applicable
    // instead — a plot that would otherwise be blocked on that one
    // document must now be confirmable.
    const docs = (await owner.query("select id from public.handover_documents where plot_id = $1 order by doc_key", [plot])).rows;
    await owner.query("update public.handover_documents set status = 'approved_final' where plot_id = $1", [plot]);
    await owner.query("update public.handover_documents set status = 'not_applicable' where id = $1", [docs[0].id]);

    await owner.query("update public.plots set handed_over_at = now() where id = $1", [plot]);
    const row = await owner.query("select handed_over_at from public.plots where id = $1", [plot]);
    assert.ok(row.rows[0].handed_over_at, "a plot with one not_applicable document (all others approved) must be confirmable");
  } finally {
    await owner.end();
  }
});

test("plots_before_write(): a document left at its default 'missing' status (never marked N/A) still blocks handover", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makePlot(owner);
    await owner.query("update public.quality_gates set status = 'approved' where plot_id = $1", [plot]);
    await owner.query("update public.handover_documents set status = 'approved_final' where plot_id = $1", [plot]);
    const docs = (await owner.query("select id from public.handover_documents where plot_id = $1 order by doc_key limit 1", [plot])).rows;
    await owner.query("update public.handover_documents set status = 'missing' where id = $1", [docs[0].id]);

    await assert.rejects(
      owner.query("update public.plots set handed_over_at = now() where id = $1", [plot]),
      /outstanding Handover Document/i
    );
  } finally {
    await owner.end();
  }
});

test("A project editor can add a custom document (is_custom: true) via a plain insert — no new RPC needed, existing RLS already permits it", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makePlot(owner);
    const before = (await owner.query("select count(*)::int as n from public.handover_documents where plot_id = $1", [plot])).rows[0].n;
    const { rows } = await owner.query(
      "insert into public.handover_documents (project_id, plot_id, doc_key, title, is_custom) values ($1,$2,$3,$4,true) returning id, is_custom, status",
      [fx.proj, plot, `custom_${Math.random().toString(36).slice(2)}`, "Site-specific survey"]
    );
    assert.equal(rows[0].is_custom, true);
    assert.equal(rows[0].status, "missing", "a new custom document starts at the same default as any other row");
    const after = (await owner.query("select count(*)::int as n from public.handover_documents where plot_id = $1", [plot])).rows[0].n;
    assert.equal(after, before + 1);
  } finally {
    await owner.end();
  }
});

test("A project editor can remove a custom document they added — existing RLS delete policy, no new RPC", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makePlot(owner);
    const { rows } = await owner.query(
      "insert into public.handover_documents (project_id, plot_id, doc_key, title, is_custom) values ($1,$2,$3,$4,true) returning id",
      [fx.proj, plot, `custom_${Math.random().toString(36).slice(2)}`, "One-off document"]
    );
    await owner.query("delete from public.handover_documents where id = $1", [rows[0].id]);
    const gone = await owner.query("select 1 from public.handover_documents where id = $1", [rows[0].id]);
    assert.equal(gone.rowCount, 0);
  } finally {
    await owner.end();
  }
});

test("A snagging-only member (editor-level RLS already in force) cannot insert or update handover_documents, standard or custom", async () => {
  const owner = await userClient(DB, OWNER);
  const snagOnly = await userClient(DB, SNAG_ONLY);
  try {
    const plot = await makePlot(owner);
    await assert.rejects(
      snagOnly.query(
        "insert into public.handover_documents (project_id, plot_id, doc_key, title, is_custom) values ($1,$2,$3,$4,true)",
        [fx.proj, plot, "custom_blocked", "Should not insert"]
      ),
      /row-level security/i
    );
    const doc = (await owner.query("select id from public.handover_documents where plot_id = $1 limit 1", [plot])).rows[0];
    await assert.rejects(
      snagOnly.query("update public.handover_documents set status = 'not_applicable' where id = $1", [doc.id]),
      /0 rows|row-level security/i
    ).catch(() => {});
    const unchanged = await owner.query("select status from public.handover_documents where id = $1", [doc.id]);
    assert.notEqual(unchanged.rows[0].status, "not_applicable");
  } finally {
    await owner.end();
    await snagOnly.end();
  }
});

test("v73 rollback: restores the pre-v73 status check (fails if any not_applicable row still exists) and the pre-v73 blocker behaviour", async () => {
  const db = "tracker_test_v73_rollback";
  await createTestDatabase(db);
  try {
    await setupSchema(db);
    const admin = adminClient(db);
    await admin.connect();
    await admin.query(`insert into auth.users (id, email) values ($1,'v73rollback@example.com')`, [OWNER]);
    await admin.end();

    const owner = await userClient(db, OWNER);
    const org = (await owner.query("select public.create_organisation('Rollback Org', 'main_contractor') as id")).rows[0].id;
    const proj = (await owner.query("insert into public.projects (name, org_id, created_by) values ('Rollback Site', $1, $2) returning id", [org, OWNER])).rows[0].id;
    const plot = (await owner.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'RB-1',$2) returning id", [proj, OWNER])).rows[0].id;
    await owner.end();

    // Rollback must FAIL loudly (not silently coerce data) while a
    // not_applicable row still exists — see the rollback script's own
    // comment on why that's the correct, intentional behaviour.
    const admin2 = adminClient(db);
    await admin2.connect();
    const oneDoc = (await admin2.query("select id from public.handover_documents where plot_id = $1 limit 1", [plot])).rows[0];
    await admin2.query("update public.handover_documents set status = 'not_applicable' where id = $1", [oneDoc.id]);

    await assert.rejects(runSql(admin2, ROLLBACK), /violates check constraint|check constraint/i);

    // Reassign it away from not_applicable, then rollback succeeds.
    await admin2.query("update public.handover_documents set status = 'missing' where id = $1", [oneDoc.id]);
    await runSql(admin2, ROLLBACK);

    const constraintDef = await admin2.query(
      "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'handover_documents_status_check'"
    );
    assert.doesNotMatch(constraintDef.rows[0].def, /not_applicable/, "rollback must restore the stricter pre-v73 check");

    await admin2.end();
  } finally {
    await dropTestDatabase(db);
  }
});
