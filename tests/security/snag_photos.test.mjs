// snag_photos (v52) — real database, real non-superuser `authenticated`
// role, the actual RLS/trigger boundary (see org_isolation.test.mjs's
// header comment for why this matters).
//
// Multiple photos per snag, both additional problem photos (beyond the
// single legacy photo_url column on snag_items, which stays untouched)
// and completion evidence (one or more photos, whose mere existence is
// what snag_items_before_write() checks before allowing a direct close
// — see tests/security/snags.test.mjs's own "completion evidence"
// section for that gate's behaviour). This file covers snag_photos
// itself: RLS (member-level, matching snag_items exactly), project_id
// trigger-derivation (a deliberate hardening over
// inspection_finding_photos' own looser client-trusted project_id —
// see this table's schema.sql comment), the kind constraint, and
// cross-project/cross-org isolation.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_snag_photos";

const OWNER_A = "a1000000-0000-0000-0000-000000000001";
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
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'snaga@example.com'), ($3,'ownerb@example.com'), ($4,'stranger@example.com')`,
    [OWNER_A, SNAG_A, OWNER_B, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA1 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A1', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const projA2 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A2', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA1])).rows[0].code;
  const plotA1 = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id", [projA1])).rows[0].id;
  const listA1 = (await ownerA.query("select id from public.snag_lists where plot_id = $1", [plotA1])).rows[0].id;
  const snagA1 = (await ownerA.query("insert into public.snag_items (project_id, snag_list_id, location, description) values ($1,$2,'Kitchen','Cracked tile') returning id", [projA1, listA1])).rows[0].id;

  const plotA2 = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id", [projA2])).rows[0].id;
  const listA2 = (await ownerA.query("select id from public.snag_lists where plot_id = $1", [plotA2])).rows[0].id;
  const snagA2 = (await ownerA.query("insert into public.snag_items (project_id, snag_list_id, location, description) values ($1,$2,'Kitchen','Cracked tile') returning id", [projA2, listA2])).rows[0].id;
  await ownerA.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagA.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  const plotB = (await ownerB.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id", [projB])).rows[0].id;
  const listB = (await ownerB.query("select id from public.snag_lists where plot_id = $1", [plotB])).rows[0].id;
  const snagB = (await ownerB.query("insert into public.snag_items (project_id, snag_list_id, location, description) values ($1,$2,'Kitchen','Cracked tile') returning id", [projB, listB])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA1, projA2, listA1, snagA1, snagA2, orgB, projB, snagB };
});

after(async () => {
  await dropTestDatabase(DB);
});

// A dedicated fresh snag per test that cares about exact row counts —
// fx.snagA1 is shared across the whole file and accumulates photos from
// every earlier test that used it, so any test asserting on a precise
// count needs its own snag instead.
async function createSnag(client) {
  return (await client.query(
    "insert into public.snag_items (project_id, snag_list_id, location, description) values ($1,$2,'Kitchen','Cracked tile') returning id",
    [fx.projA1, fx.listA1]
  )).rows[0].id;
}

async function addPhoto(client, snagId, kind = "problem", photoUrl = "https://example.com/y.jpg", extra = {}) {
  const fields = { snag_id: snagId, kind, photo_url: photoUrl, ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  return client.query(`insert into public.snag_photos (${cols.join(",")}) values (${placeholders}) returning *`, params);
}

// ─── Shape / server-side authority ───────────────────────────────────

test("kind: only 'problem' and 'completion' are accepted", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      addPhoto(ownerA, fx.snagA1, "not_a_real_kind"),
      /snag_photos_kind_check|violates check constraint/
    );
  } finally {
    await ownerA.end();
  }
});

test("snag_id: must reference an existing snag", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      addPhoto(ownerA, "99999999-9999-9999-9999-999999999999"),
      /must reference an existing snag/
    );
  } finally {
    await ownerA.end();
  }
});

test("project_id: server-derived from snag_id regardless of what the client sends — the exact IDOR pattern this table's own schema comment documents closing", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await addPhoto(ownerA, fx.snagA1, "problem", "https://example.com/y.jpg", { project_id: fx.projA2 });
    assert.equal(r.rows[0].project_id, fx.projA1, "the real project_id (derived from snag_id) must win, never the client-supplied one");
  } finally {
    await ownerA.end();
  }
});

test("created_by/created_at: server-derived, not client-trusted", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await addPhoto(ownerA, fx.snagA1, "problem", "https://example.com/y.jpg", { created_by: OWNER_B, created_at: "2020-01-01" });
    assert.equal(r.rows[0].created_by, OWNER_A, "created_by must be the real authenticated actor");
    assert.notEqual(r.rows[0].created_at.toISOString().slice(0, 4), "2020", "created_at must be the real write time");
  } finally {
    await ownerA.end();
  }
});

// ─── RLS: member-level, matching snag_items exactly ──────────────────

test("RLS: a snagging-only member can add and read photos of both kinds — same member-level access snag_items itself already grants", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const snagId = await createSnag(ownerA);
    await addPhoto(snagA, snagId, "problem");
    await addPhoto(snagA, snagId, "completion");
    const { rows } = await snagA.query("select kind from public.snag_photos where snag_id = $1 order by kind", [snagId]);
    assert.deepEqual(rows.map((r) => r.kind), ["completion", "problem"]);
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("RLS: a snagging-only member can delete a photo they didn't add themselves — matches snag_items' own loose member-level model, not an owner-only restriction", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rows } = await addPhoto(ownerA, fx.snagA1, "problem");
    const del = await snagA.query("delete from public.snag_photos where id = $1", [rows[0].id]);
    assert.equal(del.rowCount, 1);
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("RLS: no update policy — a photo is replaced by delete + re-add, not edited in place", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await addPhoto(ownerA, fx.snagA1);
    const updated = await ownerA.query("update public.snag_photos set photo_url = 'https://example.com/changed.jpg' where id = $1", [rows[0].id]);
    assert.equal(updated.rowCount, 0, "RLS must silently affect zero rows for an update, not error and not succeed");
  } finally {
    await ownerA.end();
  }
});

// ─── Cross-project / cross-org isolation ─────────────────────────────

test("cross-project: within the same org, SNAG_A (a member of A1 only, never joined A2) cannot see or add photos on A2's snag", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    await addPhoto(ownerA, fx.snagA2, "problem");
    const { rows } = await snagA.query("select 1 from public.snag_photos where snag_id = $1", [fx.snagA2]);
    assert.equal(rows.length, 0, "A1-only membership must not leak visibility into A2's photos, even within the same organisation");
    await assert.rejects(addPhoto(snagA, fx.snagA2, "problem"), isRlsError);
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("cross-org: a stranger cannot read, add, or delete Org A's snag photos", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    const { rows } = await addPhoto(ownerA, fx.snagA1);
    const photoId = rows[0].id;

    const read = await stranger.query("select 1 from public.snag_photos where id = $1", [photoId]);
    assert.equal(read.rows.length, 0, "RLS must return zero rows, not an error, for an inaccessible photo");

    await assert.rejects(
      addPhoto(stranger, fx.snagA1),
      isRlsError,
      "a stranger must not be able to attach a photo to a snag in a project they aren't a member of"
    );

    const del = await stranger.query("delete from public.snag_photos where id = $1", [photoId]);
    assert.equal(del.rowCount, 0, "a delete on an inaccessible row must affect zero rows, not silently succeed");
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

test("cross-org: a member of Org A cannot attach a photo to a real snag belonging to Org B, even knowing its id — the trigger's project_id lookup is server-side truth, but RLS on the resulting insert still requires membership of that real project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      addPhoto(ownerA, fx.snagB),
      isRlsError
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Cascade delete ───────────────────────────────────────────────────

test("cascade: deleting a snag deletes its photos too", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = (await ownerA.query(
      "insert into public.snag_items (project_id, snag_list_id, location, description) values ($1,$2,'Hall','Scuff') returning id",
      [fx.projA1, (await ownerA.query("select id from public.snag_lists where plot_id = (select id from public.plots where project_id = $1 limit 1)", [fx.projA1])).rows[0].id]
    )).rows[0];
    await addPhoto(ownerA, snag.id, "problem");
    await addPhoto(ownerA, snag.id, "completion");
    await ownerA.query("delete from public.snag_items where id = $1", [snag.id]);
    const { rows } = await ownerA.query("select 1 from public.snag_photos where snag_id = $1", [snag.id]);
    assert.equal(rows.length, 0, "orphaned snag_photos rows must never survive their parent snag's deletion");
  } finally {
    await ownerA.end();
  }
});

// ─── Audit (deliberately none) ────────────────────────────────────────

test("audit: snag_photos writes are NOT captured — same deliberate exclusion as inspection_finding_photos, a supplementary attachment rather than a formal evidence record", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await addPhoto(ownerA, fx.snagA1);
    const audit = await ownerA.query("select 1 from public.audit_log where table_name = 'snag_photos' and record_id = $1", [rows[0].id]);
    assert.equal(audit.rows.length, 0);
  } finally {
    await ownerA.end();
  }
});
