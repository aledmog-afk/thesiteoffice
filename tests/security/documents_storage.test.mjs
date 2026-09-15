// Storage security for the 'controlled-documents' bucket (Priority 10).
// Unlike 'site-photos' (public-by-obscurity, unauthenticated read —
// see storage.test.mjs), controlled documents use a genuinely PRIVATE
// bucket: both read and write are authenticated, path-derived, and
// re-check real project membership server-side — see
// controlled_documents_path_project()/read_authorized()/write_authorized()
// in sql/schema.sql v34. Path shape: "<project_id>/<document_id>/...".
//
// What this file CAN and CANNOT prove: tests/lib/mock_setup.sql
// reconstructs storage.objects as a plain table with the real RLS
// policies attached, so every access-control assertion below exercises
// the actual policy logic. It does NOT reconstruct Supabase Storage's
// HTTP API, so bucket-level file_size_limit/allowed_mime_types
// enforcement is checked here by reading the bucket row's config.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_documents_storage";

const OWNER_A = "a1000000-0000-0000-0000-00000000000a";
const SNAG_A = "a3000000-0000-0000-0000-00000000000c";
const OWNER_B = "b1000000-0000-0000-0000-00000000000b";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'a@example.com'), ($2,'snaga@example.com'), ($3,'b@example.com')`,
    [OWNER_A, SNAG_A, OWNER_B]
  );
  await admin.end();

  const a = await userClient(DB, OWNER_A);
  const orgA = (await a.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await a.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const snagCode = (await a.query("select public.regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  await a.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagA.end();

  const b = await userClient(DB, OWNER_B);
  const orgB = (await b.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await b.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  await b.end();

  fx = { orgA, projA, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function tryInsertObject(client, name) {
  return client.query("insert into storage.objects (bucket_id, name) values ('controlled-documents', $1)", [name]);
}

test("Bucket config: private (public=false), 50MB size limit, no SVG/HTML in the MIME allow-list", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query("select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'controlled-documents'");
    assert.equal(rows.length, 1, "the controlled-documents bucket must exist");
    assert.equal(rows[0].public, false, "controlled documents must NOT be a public bucket — public-by-obscurity was explicitly rejected for this bucket");
    assert.equal(Number(rows[0].file_size_limit), 52428800);
    const mimes = rows[0].allowed_mime_types;
    assert.ok(mimes.includes("application/pdf"));
    assert.ok(!mimes.includes("image/svg+xml"));
    assert.ok(!mimes.includes("text/html"));
  } finally {
    await admin.end();
  }
});

test("An editor (owner) can upload into their own project's controlled-documents path", async () => {
  const a = await userClient(DB, OWNER_A);
  try {
    const r = await tryInsertObject(a, `${fx.projA}/doc-1/revisions/rev-1/plan.pdf`);
    assert.equal(r.rowCount, 1);
  } finally {
    await a.end();
  }
});

test("A snagging-only member CANNOT upload to controlled-documents — write is editor-only, unlike drawings/site-photos' snagging write access", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    await assert.rejects(() => tryInsertObject(snagA, `${fx.projA}/doc-1/revisions/rev-1/plan.pdf`), (e) => isRlsError(e));
  } finally {
    await snagA.end();
  }
});

test("A snagging-only member CAN read from controlled-documents — read is member-level, matching documents' own SELECT RLS", async () => {
  const a = await userClient(DB, OWNER_A);
  await tryInsertObject(a, `${fx.projA}/doc-2/revisions/rev-1/readable.pdf`);
  await a.end();

  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rowCount } = await snagA.query("select 1 from storage.objects where bucket_id = 'controlled-documents' and name = $1", [`${fx.projA}/doc-2/revisions/rev-1/readable.pdf`]);
    assert.equal(rowCount, 1);
  } finally {
    await snagA.end();
  }
});

test("Organisation B cannot upload into, or read, Organisation A's controlled-documents path, by any path shape — adversarial cross-org check", async () => {
  const a = await userClient(DB, OWNER_A);
  await tryInsertObject(a, `${fx.projA}/doc-1/revisions/rev-1/plan.pdf`);
  await a.end();

  const b = await userClient(DB, OWNER_B);
  try {
    await assert.rejects(() => tryInsertObject(b, `${fx.projA}/doc-1/revisions/rev-1/hacked.pdf`), (e) => isRlsError(e));

    const { rowCount } = await b.query("select 1 from storage.objects where bucket_id = 'controlled-documents' and name = $1", [`${fx.projA}/doc-1/revisions/rev-1/plan.pdf`]);
    assert.equal(rowCount, 0, "Organisation B must not be able to read Organisation A's controlled document");
  } finally {
    await b.end();
  }
});

test("A fabricated, non-existent project UUID in the path is rejected, not silently treated as accessible", async () => {
  const a = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => tryInsertObject(a, "11111111-1111-1111-1111-111111111111/doc-1/revisions/rev-1/hacked.pdf"),
      (e) => isRlsError(e)
    );
  } finally {
    await a.end();
  }
});

test("A malformed path (no valid UUID as the first segment) is rejected outright", async () => {
  const a = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(() => tryInsertObject(a, "not-a-uuid/plan.pdf"), (e) => isRlsError(e));
  } finally {
    await a.end();
  }
});

test("No client can UPDATE or DELETE a controlled-documents object — revisions are never overwritten or removed", async () => {
  const a = await userClient(DB, OWNER_A);
  try {
    await tryInsertObject(a, `${fx.projA}/doc-1/revisions/rev-1/plan.pdf`);
    const upd = await a.query("update storage.objects set name = 'x' where bucket_id = 'controlled-documents' and name = $1", [`${fx.projA}/doc-1/revisions/rev-1/plan.pdf`]);
    assert.equal(upd.rowCount, 0, "there is no update policy for this bucket at all");
    const del = await a.query("delete from storage.objects where bucket_id = 'controlled-documents' and name = $1", [`${fx.projA}/doc-1/revisions/rev-1/plan.pdf`]);
    assert.equal(del.rowCount, 0, "there is no delete policy for this bucket at all");
  } finally {
    await a.end();
  }
});
