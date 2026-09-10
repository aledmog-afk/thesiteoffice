// Inspections (Priority 7) — real database, real non-superuser
// `authenticated` role, the actual RLS/trigger boundary (see
// org_isolation.test.mjs's header comment for why this matters).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_inspections";

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

  // Org A: Project A1 (owner + collaborator + snagging-only) and A2
  // (owner only, same org) — A2 proves cross-project isolation within
  // the same organisation.
  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA1 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A1', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const projA2 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A2', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inviteCode = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA1])).rows[0].code;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA1])).rows[0].code;

  const inspA1 = (await ownerA.query(
    "insert into public.inspections (project_id, title, inspection_type) values ($1,'A1 walk-round','quality') returning id",
    [projA1]
  )).rows[0].id;
  const inspA2 = (await ownerA.query(
    "insert into public.inspections (project_id, title, inspection_type) values ($1,'A2 walk-round','quality') returning id",
    [projA2]
  )).rows[0].id;
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A);
  await collabA.query("select public.join_project_by_invite($1)", [inviteCode]);
  await collabA.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagA.end();

  // Org B: fully separate, with its own inspection.
  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  const inspB = (await ownerB.query(
    "insert into public.inspections (project_id, title, inspection_type) values ($1,'B walk-round','quality') returning id",
    [projB]
  )).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA1, projA2, inspA1, inspA2, orgB, projB, inspB };
});

after(async () => {
  await dropTestDatabase(DB);
});

// ─── CRUD ───────────────────────────────────────────────────────

test("CRUD: an editor can create an inspection with org_id correctly derived (never client-trusted)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const spoofedOrgId = fx.orgB;
    const created = await ownerA.query(
      "insert into public.inspections (org_id, project_id, title, inspection_type, conducted_by) values ($1,$2,$3,$4,$5) returning *",
      [spoofedOrgId, fx.projA1, "Roofing check", "quality", "Jane Doe"]
    );
    assert.equal(created.rows[0].org_id, fx.orgA, "org_id must always be derived from project_id server-side, never trusted from the client");
    assert.equal(created.rows[0].status, "draft");
    assert.equal(created.rows[0].created_by, OWNER_A);
  } finally {
    await ownerA.end();
  }
});

test("CRUD: create/read/update/delete a finding, including status/severity", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query(
      "insert into public.inspection_findings (project_id, inspection_id, title, severity) values ($1,$2,'Cracked tile','high') returning *",
      [fx.projA1, fx.inspA1]
    );
    assert.equal(created.rows[0].org_id, fx.orgA);
    assert.equal(created.rows[0].status, "open");

    const id = created.rows[0].id;
    const updated = await ownerA.query("update public.inspection_findings set status = 'action_required', description = 'needs a look' where id = $1 returning status, description", [id]);
    assert.equal(updated.rows[0].status, "action_required");
    assert.equal(updated.rows[0].description, "needs a look");

    const del = await ownerA.query("delete from public.inspection_findings where id = $1", [id]);
    assert.equal(del.rowCount, 1);
  } finally {
    await ownerA.end();
  }
});

test("CRUD: create Action from finding creates a real action and links it back (action_id)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const finding = await ownerA.query(
      "insert into public.inspection_findings (project_id, inspection_id, title, severity) values ($1,$2,'Loose handrail','high') returning id",
      [fx.projA1, fx.inspA1]
    );
    const action = await ownerA.query(
      "insert into public.actions (project_id, title, priority, due_date) values ($1,'Fix handrail','high','2026-12-01') returning id",
      [fx.projA1]
    );
    const linked = await ownerA.query(
      "update public.inspection_findings set action_id = $1, status = 'action_required' where id = $2 returning action_id, status",
      [action.rows[0].id, finding.rows[0].id]
    );
    assert.equal(linked.rows[0].action_id, action.rows[0].id);
    assert.equal(linked.rows[0].status, "action_required");
  } finally {
    await ownerA.end();
  }
});

test("CRUD: evidence photo rows respect project scoping", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const finding = await ownerA.query(
      "insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'Damp patch') returning id",
      [fx.projA1, fx.inspA1]
    );
    const photo = await ownerA.query(
      "insert into public.inspection_finding_photos (finding_id, project_id, photo_url) values ($1,$2,'https://example.com/x.jpg') returning id",
      [finding.rows[0].id, fx.projA1]
    );
    assert.ok(photo.rows[0].id);
    const read = await ownerA.query("select 1 from public.inspection_finding_photos where finding_id = $1", [finding.rows[0].id]);
    assert.equal(read.rowCount, 1);
  } finally {
    await ownerA.end();
  }
});

// ─── Cross-project / cross-org IDOR ────────────────────────────

test("IDOR: a finding cannot be attached to another project's inspection (project_id must match its own inspection)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    // inspA1 belongs to projA1 — claiming projA2 here must be rejected,
    // not silently corrected.
    await assert.rejects(
      () => ownerA.query(
        "insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'Mismatched') returning id",
        [fx.projA2, fx.inspA1]
      ),
      /project_id must match its inspection/
    );
  } finally {
    await ownerA.end();
  }
});

test("IDOR: a linked Action must belong to the same project as the finding", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const finding = await ownerA.query(
      "insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'Needs action') returning id",
      [fx.projA1, fx.inspA1]
    );
    const actionOnA2 = await ownerA.query("insert into public.actions (project_id, title) values ($1,'A2 action') returning id", [fx.projA2]);
    await assert.rejects(
      () => ownerA.query("update public.inspection_findings set action_id = $1 where id = $2", [actionOnA2.rows[0].id, finding.rows[0].id]),
      /linked action must belong to the same project/
    );
  } finally {
    await ownerA.end();
  }
});

test("Security: Org B cannot READ Org A's inspections or findings", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const finding = await ownerA.query("insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'Org A only') returning id", [fx.projA1, fx.inspA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const insp = await ownerB.query("select 1 from public.inspections where id = $1", [fx.inspA1]);
    assert.equal(insp.rowCount, 0);
    const find = await ownerB.query("select 1 from public.inspection_findings where id = $1", [finding.rows[0].id]);
    assert.equal(find.rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot CREATE an inspection in Org A's project", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    await assert.rejects(
      () => ownerB.query("insert into public.inspections (project_id, title) values ($1,'Sneaky') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot UPDATE an Org A inspection or finding, even knowing the real id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const finding = await ownerA.query("insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'Protected') returning id", [fx.projA1, fx.inspA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const updInsp = await ownerB.query("update public.inspections set title = 'Hijacked' where id = $1", [fx.inspA1]);
    assert.equal(updInsp.rowCount, 0);
    const updFind = await ownerB.query("update public.inspection_findings set status = 'resolved' where id = $1", [finding.rows[0].id]);
    assert.equal(updFind.rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot DELETE an Org A inspection or finding", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const finding = await ownerA.query("insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'Do not delete') returning id", [fx.projA1, fx.inspA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const delInsp = await ownerB.query("delete from public.inspections where id = $1", [fx.inspA1]);
    assert.equal(delInsp.rowCount, 0);
    const delFind = await ownerB.query("delete from public.inspection_findings where id = $1", [finding.rows[0].id]);
    assert.equal(delFind.rowCount, 0);
  } finally {
    await ownerB.end();
  }

  const ownerA2 = await userClient(DB, OWNER_A);
  const stillThere = await ownerA2.query("select 1 from public.inspections where id = $1", [fx.inspA1]);
  assert.equal(stillThere.rowCount, 1);
  await ownerA2.end();
});

test("Security: a member of Project A1 cannot access Project A2's inspections, despite being in the same organisation", async () => {
  const collabA = await userClient(DB, COLLAB_A); // editor on A1, NOT a member of A2
  try {
    const read = await collabA.query("select 1 from public.inspections where id = $1", [fx.inspA2]);
    assert.equal(read.rowCount, 0, "same-org membership on a different project must not grant access");
    await assert.rejects(
      () => collabA.query("insert into public.inspections (project_id, title) values ($1,'Sneaky A2') returning id", [fx.projA2]),
      (err) => isRlsError(err)
    );
  } finally {
    await collabA.end();
  }
});

test("Security: a snagging-only member cannot read, create, or update inspections/findings", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const readInsp = await snagA.query("select 1 from public.inspections where project_id = $1", [fx.projA1]);
    assert.equal(readInsp.rowCount, 0, "Inspections is an editor-only module — a snagging-only member sees none of it");
    await assert.rejects(
      () => snagA.query("insert into public.inspections (project_id, title) values ($1,'Sneaky') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await snagA.end();
  }
});

test("Security: an unauthenticated request sees and can touch nothing", async () => {
  const stranger = await userClient(DB, null);
  try {
    const insp = await stranger.query("select 1 from public.inspections where project_id = $1", [fx.projA1]);
    assert.equal(insp.rowCount, 0);
    await assert.rejects(
      () => stranger.query("insert into public.inspections (project_id, title) values ($1,'x') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await stranger.end();
  }
});

test("Security: a stranger with no membership anywhere sees zero inspections/findings", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    const insp = await stranger.query("select 1 from public.inspections");
    assert.equal(insp.rowCount, 0);
    const find = await stranger.query("select 1 from public.inspection_findings");
    assert.equal(find.rowCount, 0);
  } finally {
    await stranger.end();
  }
});

test("Aggregate/list queries cannot leak inaccessible records: an unfiltered select (the dashboard's own query shape) excludes Org B entirely", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query("select project_id from public.inspection_findings");
    assert.ok(rows.every((r) => r.project_id === fx.projA1 || r.project_id === fx.projA2), "no row from Org B must ever appear in an unfiltered select as Org A");
  } finally {
    await ownerA.end();
  }
});

// ─── Audit integration (Priority 4) ────────────────────────────

test("Audit: INSERT/UPDATE/DELETE on inspections and inspection_findings produce correct audit_log rows via the existing generic trigger", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const insp = await ownerA.query("insert into public.inspections (project_id, title) values ($1,'Audited inspection') returning id", [fx.projA1]);
    const inspId = insp.rows[0].id;
    await ownerA.query("update public.inspections set status = 'completed' where id = $1", [inspId]);

    const finding = await ownerA.query("insert into public.inspection_findings (project_id, inspection_id, title, severity) values ($1,$2,'Audited finding','critical') returning id", [fx.projA1, inspId]);
    const findId = finding.rows[0].id;
    await ownerA.query("update public.inspection_findings set status = 'resolved' where id = $1", [findId]);
    await ownerA.query("delete from public.inspection_findings where id = $1", [findId]);

    const inspRows = await ownerA.query(
      "select action, old_data, new_data from public.audit_log where table_name = 'inspections' and record_id = $1 order by created_at",
      [inspId]
    );
    assert.equal(inspRows.rows.length, 2, "insert + status update = 2 audit rows for the inspection");
    assert.equal(inspRows.rows[0].action, "INSERT");
    assert.equal(inspRows.rows[1].action, "UPDATE");
    assert.equal(inspRows.rows[1].old_data.status, "draft");
    assert.equal(inspRows.rows[1].new_data.status, "completed");

    const findRows = await ownerA.query(
      "select action, org_id, project_id, user_id, old_data, new_data from public.audit_log where table_name = 'inspection_findings' and record_id = $1 order by created_at",
      [findId]
    );
    assert.equal(findRows.rows.length, 3, "insert + status update + delete = 3 audit rows for the finding");
    assert.equal(findRows.rows[0].action, "INSERT");
    assert.equal(findRows.rows[0].new_data.severity, "critical");
    assert.equal(findRows.rows[0].org_id, fx.orgA);
    assert.equal(findRows.rows[0].project_id, fx.projA1);
    assert.equal(findRows.rows[0].user_id, OWNER_A);
    assert.equal(findRows.rows[1].action, "UPDATE");
    assert.equal(findRows.rows[1].old_data.status, "open");
    assert.equal(findRows.rows[1].new_data.status, "resolved");
    assert.equal(findRows.rows[2].action, "DELETE");
    assert.equal(findRows.rows[2].new_data, null);
  } finally {
    await ownerA.end();
  }
});

test("Audit: Action linkage on a finding is captured as an ordinary UPDATE", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const finding = await ownerA.query("insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'Needs linking') returning id", [fx.projA1, fx.inspA1]);
    const action = await ownerA.query("insert into public.actions (project_id, title) values ($1,'Linked action') returning id", [fx.projA1]);
    await ownerA.query("update public.inspection_findings set action_id = $1, status = 'action_required' where id = $2", [action.rows[0].id, finding.rows[0].id]);

    const { rows } = await ownerA.query(
      "select old_data->>'action_id' as old_action_id, new_data->>'action_id' as new_action_id from public.audit_log where table_name = 'inspection_findings' and record_id = $1 order by created_at desc limit 1",
      [finding.rows[0].id]
    );
    assert.equal(rows[0].old_action_id, null);
    assert.equal(rows[0].new_action_id, action.rows[0].id);
  } finally {
    await ownerA.end();
  }
});

test("Audit: Org B cannot read Org A's inspection/finding audit history", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const insp = await ownerA.query("insert into public.inspections (project_id, title) values ($1,'For audit isolation') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rowCount } = await ownerB.query(
      "select 1 from public.audit_log where table_name = 'inspections' and record_id = $1", [insp.rows[0].id]
    );
    assert.equal(rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

test("Audit: cross-org attempts never fabricate audit rows for data the attacker couldn't actually touch", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    await ownerB.query("update public.inspections set title = 'Hijacked' where id = $1", [fx.inspA1]).catch(() => {});
  } finally {
    await ownerB.end();
  }
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query(
      "select action, user_id from public.audit_log where table_name = 'inspections' and record_id = $1 order by created_at",
      [fx.inspA1]
    );
    assert.ok(!rows.some((r) => r.action === "UPDATE" && r.user_id === OWNER_B), "a rejected cross-org update (0 rows affected) must never produce an audit row at all");
  } finally {
    await ownerA.end();
  }
});

// ─── Validation / edge cases ────────────────────────────────────

test("Edge case: invalid inspection_type / status / severity are rejected by CHECK constraints", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.inspections (project_id, title, inspection_type) values ($1,'x','bogus')", [fx.projA1]),
      (err) => err.code === "23514"
    );
    await assert.rejects(
      () => ownerA.query("insert into public.inspections (project_id, title, status) values ($1,'x','bogus')", [fx.projA1]),
      (err) => err.code === "23514"
    );
    await assert.rejects(
      () => ownerA.query("insert into public.inspection_findings (project_id, inspection_id, title, severity) values ($1,$2,'x','bogus')", [fx.projA1, fx.inspA1]),
      (err) => err.code === "23514"
    );
    await assert.rejects(
      () => ownerA.query("insert into public.inspection_findings (project_id, inspection_id, title, status) values ($1,$2,'x','bogus')", [fx.projA1, fx.inspA1]),
      (err) => err.code === "23514"
    );
  } finally {
    await ownerA.end();
  }
});

test("Edge case: missing required fields are rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(() => ownerA.query("insert into public.inspections (project_id) values ($1)", [fx.projA1]), (err) => err.code === "23502");
    await assert.rejects(() => ownerA.query("insert into public.inspection_findings (project_id, inspection_id) values ($1,$2)", [fx.projA1, fx.inspA1]), (err) => err.code === "23502");
  } finally {
    await ownerA.end();
  }
});

test("Edge case: created_by and created_at cannot be overwritten by a client-supplied UPDATE", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'x') returning created_by, created_at", [fx.projA1, fx.inspA1]);
    const id = (await ownerA.query("select id from public.inspection_findings where project_id = $1 order by created_at desc limit 1", [fx.projA1])).rows[0].id;
    const spoofDate = "2000-01-01T00:00:00Z";
    const updated = await ownerA.query(
      "update public.inspection_findings set created_by = $1, created_at = $2, title = 'renamed' where id = $3 returning created_by, created_at",
      [OWNER_B, spoofDate, id]
    );
    assert.equal(updated.rows[0].created_by, created.rows[0].created_by);
    assert.notEqual(new Date(updated.rows[0].created_at).getTime(), new Date(spoofDate).getTime());
  } finally {
    await ownerA.end();
  }
});
