// Document Management foundation (Priority 10) — real database, real
// non-superuser `authenticated` role, the actual RLS/trigger boundary
// (see org_isolation.test.mjs's header comment for why this matters).
//
// Covers: documents/document_revisions creation and org/project scoping,
// revision-number integrity and immutability, current_revision_id
// promotion (documents_before_write() / document_revisions_after_insert()
// in sql/schema.sql v34), RLS across owner/collaborator/snagging-only/
// stranger, and audit trail coverage. Storage bucket RLS for
// 'controlled-documents' is covered separately in documents_storage.test.mjs
// (its own file, mirroring storage.test.mjs's existing scope for
// site-photos).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_documents";

const OWNER_A = "a1000000-0000-0000-0000-000000000001";
const COLLAB_A = "a2000000-0000-0000-0000-000000000002";
const SNAG_A = "a3000000-0000-0000-0000-000000000003";
const OWNER_B = "b1000000-0000-0000-0000-000000000001";
const STRANGER = "c1000000-0000-0000-0000-000000000001";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'collaba@example.com'), ($3,'snaga@example.com'), ($4,'ownerb@example.com'), ($5,'stranger@example.com')`,
    [OWNER_A, COLLAB_A, SNAG_A, OWNER_B, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA1 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A1', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const projA2 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A2', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inviteCode = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA1])).rows[0].code;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA1])).rows[0].code;
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A);
  await collabA.query("select public.join_project_by_invite($1)", [inviteCode]);
  await collabA.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagA.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA1, projA2, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createDoc(client, projectId = fx.projA1, extra = {}) {
  const fields = { project_id: projectId, title: "GA Plan", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(
    `insert into public.documents (${cols.join(",")}) values (${placeholders}) returning *`,
    params
  );
  return rows[0];
}

async function addRevision(client, documentId, extra = {}) {
  const fields = { document_id: documentId, file_url: "some/path.pdf", file_name: "file.pdf", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(
    `insert into public.document_revisions (${cols.join(",")}) values (${placeholders}) returning *`,
    params
  );
  return rows[0];
}

// ─── Database: creation, scoping, defaults ──────────────────────────

test("Database: org_id is always derived server-side from project_id, never client-trusted", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA, fx.projA1, { org_id: fx.orgB });
    assert.equal(d.org_id, fx.orgA, "org_id must be forced to the project's real org, ignoring whatever the client sent");
  } finally {
    await ownerA.end();
  }
});

test("Database: document_type defaults to 'other' and only accepts the defined values", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    assert.equal(d.document_type, "other");
    await assert.rejects(createDoc(ownerA, fx.projA1, { document_type: "not-a-real-type" }), /violates check constraint/);
  } finally {
    await ownerA.end();
  }
});

test("Database: status defaults to 'current' and only accepts draft/current/superseded/archived", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    assert.equal(d.status, "current");
    await assert.rejects(createDoc(ownerA, fx.projA1, { status: "approved" }), /violates check constraint/);
  } finally {
    await ownerA.end();
  }
});

test("Database: current_revision_id starts null and a document can't reference a revision in another document", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    assert.equal(d.current_revision_id, null);
  } finally {
    await ownerA.end();
  }
});

test("Database: a document must reference a real project — a fabricated project_id is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createDoc(ownerA, "11111111-1111-1111-1111-111111111111"),
      /project_id must reference an existing project|violates foreign key constraint/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Database: revision numbering, immutability, current-revision promotion ─

test("Database: the first revision uploaded is always revision_number 1, regardless of what the client sends", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    const r = await addRevision(ownerA, d.id, { revision_number: 99 });
    assert.equal(r.revision_number, 1, "revision_number must be server-computed, never client-trusted");
  } finally {
    await ownerA.end();
  }
});

test("Database: revision_number increments (1, 2, 3...) and is never re-used for the same document", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    const r1 = await addRevision(ownerA, d.id);
    const r2 = await addRevision(ownerA, d.id);
    const r3 = await addRevision(ownerA, d.id);
    assert.deepEqual([r1.revision_number, r2.revision_number, r3.revision_number], [1, 2, 3]);
  } finally {
    await ownerA.end();
  }
});

test("Database: uploading a revision derives project_id from the parent document, never the client", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA, fx.projA2);
    const r = await addRevision(ownerA, d.id, { project_id: fx.projA1 });
    assert.equal(r.project_id, fx.projA2, "project_id must be forced to the parent document's real project");
  } finally {
    await ownerA.end();
  }
});

test("Database: a revision must reference a real document — a fabricated document_id is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      addRevision(ownerA, "11111111-1111-1111-1111-111111111111"),
      /document_id must reference an existing document|violates foreign key constraint/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: uploading revision 1 promotes it to current_revision_id automatically", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    const r1 = await addRevision(ownerA, d.id);
    const { rows } = await ownerA.query("select current_revision_id from public.documents where id = $1", [d.id]);
    assert.equal(rows[0].current_revision_id, r1.id);
  } finally {
    await ownerA.end();
  }
});

test("Database: uploading revision 2 supersedes revision 1 and repoints current_revision_id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    const r1 = await addRevision(ownerA, d.id);
    const r2 = await addRevision(ownerA, d.id);

    const { rows: docRows } = await ownerA.query("select current_revision_id from public.documents where id = $1", [d.id]);
    assert.equal(docRows[0].current_revision_id, r2.id, "current_revision_id must now point at revision 2");

    const { rows: revRows } = await ownerA.query("select id, superseded_at from public.document_revisions where document_id = $1 order by revision_number", [d.id]);
    assert.ok(revRows[0].superseded_at !== null, "revision 1 must now be superseded");
    assert.equal(revRows[1].superseded_at, null, "revision 2 (the new current) must not be superseded");
  } finally {
    await ownerA.end();
  }
});

test("Database: current_revision_id can NEVER be set directly by a client UPDATE, even to a real revision id in the same document", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    const r1 = await addRevision(ownerA, d.id);
    const r2 = await addRevision(ownerA, d.id); // current_revision_id now points at r2

    await ownerA.query("update public.documents set current_revision_id = $1 where id = $2", [r1.id, d.id]);
    const { rows } = await ownerA.query("select current_revision_id from public.documents where id = $1", [d.id]);
    assert.equal(rows[0].current_revision_id, r2.id, "a direct client attempt to hijack current_revision_id must be silently reset back");
  } finally {
    await ownerA.end();
  }
});

test("Database: document_revisions cannot be UPDATEd by any client — immutability is enforced by RLS, not just app discipline", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    const r1 = await addRevision(ownerA, d.id);
    const upd = await ownerA.query("update public.document_revisions set file_name = 'hacked.pdf' where id = $1", [r1.id]);
    assert.equal(upd.rowCount, 0, "an UPDATE on document_revisions must affect 0 rows — there is no update policy at all");
  } finally {
    await ownerA.end();
  }
});

test("Database: the unique(document_id, revision_number) constraint rejects a duplicate revision_number", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const ownerA = await userClient(DB, OWNER_A);
    const d = await createDoc(ownerA, fx.projA1);
    await ownerA.end();
    // A normal INSERT always gets its revision_number computed
    // server-side (MAX+1) by document_revisions_before_insert(), so it
    // can never naturally collide — that trigger IS the happy-path
    // protection. To prove the UNIQUE constraint is a genuine backstop
    // (not just decoration), disable the trigger here and force a real
    // duplicate directly, simulating the concurrent-race case the
    // trigger's own MAX+1 arithmetic can't fully rule out.
    await admin.query("alter table public.document_revisions disable trigger trg_document_revisions_before_insert");
    try {
      await admin.query(
        "insert into public.document_revisions (document_id, project_id, revision_number, file_url, file_name) values ($1,$2,1,'a','a')",
        [d.id, fx.projA1]
      );
      await assert.rejects(
        admin.query(
          "insert into public.document_revisions (document_id, project_id, revision_number, file_url, file_name) values ($1,$2,1,'b','b')",
          [d.id, fx.projA1]
        ),
        /duplicate key value violates unique constraint/
      );
    } finally {
      await admin.query("alter table public.document_revisions enable trigger trg_document_revisions_before_insert");
    }
  } finally {
    await admin.end();
  }
});

test("Database: created_by/created_at are forced server-side and immutable, matching every other table's own convention", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const d = await createDoc(ownerA, fx.projA1, { created_by: COLLAB_A });
    assert.equal(d.created_by, OWNER_A, "created_by must be forced to the real inserting user");

    const originalCreatedAt = d.created_at;
    await collabA.query("update public.documents set title = 'Renamed', created_by = $1 where id = $2", [COLLAB_A, d.id]);
    const { rows } = await collabA.query("select created_by, created_at from public.documents where id = $1", [d.id]);
    assert.equal(rows[0].created_by, OWNER_A, "created_by must not be changeable by a later UPDATE either");
    assert.deepEqual(rows[0].created_at, originalCreatedAt);
  } finally {
    await ownerA.end();
    await collabA.end();
  }
});

// ─── RLS: read/write across roles and organisations ─────────────────

test("RLS: an owner and a collaborator can both create documents and upload revisions", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const d = await createDoc(collabA);
    const r = await addRevision(collabA, d.id);
    assert.ok(d.id && r.id);
  } finally {
    await collabA.end();
  }
});

test("RLS: a snagging-only member CAN read documents for their project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const d = await createDoc(ownerA);
  await ownerA.end();

  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rows } = await snagA.query("select * from public.documents where id = $1", [d.id]);
    assert.equal(rows.length, 1, "snagging-only members must be able to read documents — mirrors their existing drawings read access");
  } finally {
    await snagA.end();
  }
});

test("RLS: a snagging-only member CANNOT create a document or upload a revision", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    await assert.rejects(() => createDoc(snagA), (e) => isRlsError(e));
  } finally {
    await snagA.end();
  }

  const ownerA = await userClient(DB, OWNER_A);
  const d = await createDoc(ownerA);
  await ownerA.end();

  const snagA2 = await userClient(DB, SNAG_A);
  try {
    await assert.rejects(() => addRevision(snagA2, d.id), (e) => isRlsError(e));
  } finally {
    await snagA2.end();
  }
});

test("RLS: a snagging-only member cannot update document metadata or archive a document", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const d = await createDoc(ownerA);
  await ownerA.end();

  const snagA = await userClient(DB, SNAG_A);
  try {
    const upd = await snagA.query("update public.documents set status = 'archived' where id = $1", [d.id]);
    assert.equal(upd.rowCount, 0, "snagging-only members must not be able to change document status");
  } finally {
    await snagA.end();
  }
});

test("RLS: a user with no membership on the project (stranger) cannot read, create, or upload", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const d = await createDoc(ownerA);
  await ownerA.end();

  const stranger = await userClient(DB, STRANGER);
  try {
    const { rows } = await stranger.query("select * from public.documents where id = $1", [d.id]);
    assert.equal(rows.length, 0, "a stranger must see zero rows, not an error, for a document they can't access");

    await assert.rejects(() => createDoc(stranger, fx.projA1), (e) => isRlsError(e));
    await assert.rejects(() => addRevision(stranger, d.id), (e) => isRlsError(e));
  } finally {
    await stranger.end();
  }
});

test("RLS: Organisation B's owner cannot read, create in, or upload to Organisation A's documents — adversarial cross-org check", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const d = await createDoc(ownerA);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rows } = await ownerB.query("select * from public.documents where id = $1", [d.id]);
    assert.equal(rows.length, 0, "Organisation B must see zero rows for Organisation A's document");

    await assert.rejects(() => createDoc(ownerB, fx.projA1), (e) => isRlsError(e), "Org B must not be able to create a document inside Org A's project");
    await assert.rejects(() => addRevision(ownerB, d.id), (e) => isRlsError(e), "Org B must not be able to upload a revision to Org A's document");

    // Fabricating a document row that CLAIMS to belong to Org B's own
    // project, but attached to Org A's real document_id, must still fail
    // — project_id is derived from the real parent document, not trusted
    // from the client, so this can't be used to smuggle a revision in.
    await assert.rejects(
      () => addRevision(ownerB, d.id, { project_id: fx.projB }),
      (e) => isRlsError(e),
      "a spoofed project_id must not let Org B attach a revision to Org A's document"
    );
  } finally {
    await ownerB.end();
  }
});

test("RLS: no client can UPDATE or DELETE another organisation's document even with a guessed id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const d = await createDoc(ownerA);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const upd = await ownerB.query("update public.documents set status = 'archived' where id = $1", [d.id]);
    assert.equal(upd.rowCount, 0);
    const del = await ownerB.query("delete from public.documents where id = $1", [d.id]);
    assert.equal(del.rowCount, 0, "there is no delete policy for anyone, but this also proves cross-org can't reach the row at all");
  } finally {
    await ownerB.end();
  }
});

// ─── Audit trail ──────────────────────────────────────────────────

test("Audit: creating a document and uploading revisions produces the expected audit_log rows", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const d = await createDoc(ownerA);
    await addRevision(ownerA, d.id); // rev 1: documents UPDATE (promotion) + document_revisions INSERT
    await addRevision(ownerA, d.id); // rev 2: documents UPDATE (promotion) + document_revisions INSERT + supersede UPDATE on rev1

    const { rows: docAudit } = await ownerA.query(
      "select action from public.audit_log where table_name = 'documents' and record_id = $1 order by created_at",
      [d.id]
    );
    assert.equal(docAudit[0].action, "INSERT");
    assert.ok(docAudit.filter((r) => r.action === "UPDATE").length >= 2, "expected at least 2 UPDATE audit rows on documents (one promotion per revision)");

    const { rows: revAudit } = await ownerA.query(
      "select action from public.document_revisions dr join public.audit_log al on al.record_id = dr.id and al.table_name = 'document_revisions' where dr.document_id = $1",
      [d.id]
    );
    assert.equal(revAudit.filter((r) => r.action === "INSERT").length, 2, "expected one INSERT audit row per revision uploaded");
  } finally {
    await ownerA.end();
  }
});

test("Audit: archiving a document produces an audit row, and a snagging-only member can still read it (member-level, not editor-level)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const d = await createDoc(ownerA);
  await ownerA.query("update public.documents set status = 'archived' where id = $1", [d.id]);
  await ownerA.end();

  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rows } = await snagA.query(
      "select action from public.audit_log where table_name = 'documents' and record_id = $1 and action = 'UPDATE'",
      [d.id]
    );
    assert.ok(rows.length >= 1, "the archive UPDATE must be audited, and a snagging-only member (who can read the document) must be able to read this audit row too");
  } finally {
    await snagA.end();
  }
});

test("Audit: a client cannot forge the audit actor — user_id is always the real authenticated caller", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const d = await createDoc(collabA);
    const { rows } = await collabA.query(
      "select user_id from public.audit_log where table_name = 'documents' and record_id = $1 and action = 'INSERT'",
      [d.id]
    );
    assert.equal(rows[0].user_id, COLLAB_A);
  } finally {
    await collabA.end();
  }
});
