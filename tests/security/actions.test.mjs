// Actions Engine (Priority 5) — real database, real non-superuser
// `authenticated` role, the actual RLS/trigger boundary (see
// org_isolation.test.mjs's header comment for why this matters).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_actions";

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

  // Org A: Project A1 (owner + collaborator + snagging-only member) and
  // Project A2, same org, but COLLAB_A is deliberately NOT a member of
  // A2 — proves cross-PROJECT isolation within the same organisation.
  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA1 = (await ownerA.query(
    "insert into public.projects (name, org_id, created_by) values ('Org A Site 1', $1, $2) returning id",
    [orgA, OWNER_A]
  )).rows[0].id;
  const projA2 = (await ownerA.query(
    "insert into public.projects (name, org_id, created_by) values ('Org A Site 2', $1, $2) returning id",
    [orgA, OWNER_A]
  )).rows[0].id;
  const inviteCode = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA1])).rows[0].code;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA1])).rows[0].code;
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A);
  await collabA.query("select public.join_project_by_invite($1)", [inviteCode]);
  await collabA.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagA.end();

  // Org B: a fully separate org/project/owner.
  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query(
    "insert into public.projects (name, org_id, created_by) values ('Org B Site', $1, $2) returning id",
    [orgB, OWNER_B]
  )).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA1, projA2, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

// ─── CRUD ───────────────────────────────────────────────────────

test("CRUD: an editor can create an action with org_id correctly derived (never client-trusted)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const spoofedOrgId = fx.orgB; // attempt to claim Org B as the action's org
    const created = await ownerA.query(
      "insert into public.actions (org_id, project_id, title, priority, due_date) values ($1,$2,$3,$4,$5) returning *",
      [spoofedOrgId, fx.projA1, "Chase Building Control", "high", "2026-12-01"]
    );
    assert.equal(created.rows[0].org_id, fx.orgA, "org_id must always be derived from project_id server-side, never trusted from the client, even when the client supplies a different one");
    assert.equal(created.rows[0].status, "open", "new actions default to open");
    assert.equal(created.rows[0].created_by, OWNER_A, "created_by must be the real authenticated actor");
  } finally {
    await ownerA.end();
  }
});

test("CRUD: read returns actions for the project", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const { rows } = await collabA.query("select 1 from public.actions where project_id = $1", [fx.projA1]);
    assert.ok(rows.length >= 1, "a project editor should be able to read the project's actions");
  } finally {
    await collabA.end();
  }
});

test("CRUD: update (title/description/priority)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query(
      "insert into public.actions (project_id, title) values ($1,'Original title') returning id",
      [fx.projA1]
    );
    const id = created.rows[0].id;
    const updated = await ownerA.query(
      "update public.actions set title = 'Updated title', priority = 'critical' where id = $1 returning title, priority",
      [id]
    );
    assert.equal(updated.rows[0].title, "Updated title");
    assert.equal(updated.rows[0].priority, "critical");
  } finally {
    await ownerA.end();
  }
});

test("CRUD: assignment to a legitimate project editor succeeds", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'Assign me') returning id", [fx.projA1]);
    const assigned = await ownerA.query("update public.actions set assigned_to = $1 where id = $2 returning assigned_to", [COLLAB_A, created.rows[0].id]);
    assert.equal(assigned.rows[0].assigned_to, COLLAB_A);
  } finally {
    await ownerA.end();
  }
});

test("CRUD: status changes and completion set/clear completed_at", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'Complete me') returning id", [fx.projA1]);
    const id = created.rows[0].id;
    await ownerA.query("update public.actions set status = 'in_progress' where id = $1", [id]);
    const completed = await ownerA.query("update public.actions set status = 'completed' where id = $1 returning status, completed_at", [id]);
    assert.equal(completed.rows[0].status, "completed");
    assert.ok(completed.rows[0].completed_at, "completing an action must set completed_at");

    const reopened = await ownerA.query("update public.actions set status = 'open' where id = $1 returning status, completed_at", [id]);
    assert.equal(reopened.rows[0].status, "open");
    assert.equal(reopened.rows[0].completed_at, null, "moving away from completed must clear completed_at");
  } finally {
    await ownerA.end();
  }
});

test("CRUD: delete removes the action", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'Delete me') returning id", [fx.projA1]);
    const del = await ownerA.query("delete from public.actions where id = $1", [created.rows[0].id]);
    assert.equal(del.rowCount, 1);
    const gone = await ownerA.query("select 1 from public.actions where id = $1", [created.rows[0].id]);
    assert.equal(gone.rowCount, 0);
  } finally {
    await ownerA.end();
  }
});

// ─── Security: cross-organisation ──────────────────────────────

test("Security: Org B cannot READ Org A's actions", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'Org A only') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rowCount } = await ownerB.query("select 1 from public.actions where id = $1", [created.rows[0].id]);
    assert.equal(rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot CREATE an action in Org A's project", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    await assert.rejects(
      () => ownerB.query("insert into public.actions (project_id, title) values ($1,'Sneaky') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot UPDATE an Org A action, even knowing its real id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'Protected') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const upd = await ownerB.query("update public.actions set title = 'Hijacked' where id = $1", [created.rows[0].id]);
    assert.equal(upd.rowCount, 0, "the update must silently affect zero rows — Org B can't even see the row to update it");
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot DELETE an Org A action", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'Do not delete') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const del = await ownerB.query("delete from public.actions where id = $1", [created.rows[0].id]);
    assert.equal(del.rowCount, 0);
  } finally {
    await ownerB.end();
  }

  const ownerA2 = await userClient(DB, OWNER_A);
  const stillThere = await ownerA2.query("select 1 from public.actions where id = $1", [created.rows[0].id]);
  assert.equal(stillThere.rowCount, 1, "the action must still exist");
  await ownerA2.end();
});

test("Security: Org B cannot ASSIGN an Org A action to themselves", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'Assign attempt') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const upd = await ownerB.query("update public.actions set assigned_to = $1 where id = $2", [OWNER_B, created.rows[0].id]);
    assert.equal(upd.rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

// ─── Security: cross-project isolation within the same org ────

test("Security: a member of Project A1 cannot access Project A2's actions, despite being in the same organisation", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'A2 only') returning id", [fx.projA2]);
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A); // editor on A1, NOT a member of A2
  try {
    const read = await collabA.query("select 1 from public.actions where id = $1", [created.rows[0].id]);
    assert.equal(read.rowCount, 0, "same-org membership on a different project must not grant access");
    await assert.rejects(
      () => collabA.query("insert into public.actions (project_id, title) values ($1,'Sneaky A2') returning id", [fx.projA2]),
      (err) => isRlsError(err)
    );
  } finally {
    await collabA.end();
  }
});

// ─── Security: role restrictions within a legitimate project ──

test("Security: a snagging-only member cannot read, create, or be assigned actions", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const read = await snagA.query("select 1 from public.actions where project_id = $1", [fx.projA1]);
    assert.equal(read.rowCount, 0, "Actions is an editor-only module — a snagging-only member sees none of it");
    await assert.rejects(
      () => snagA.query("insert into public.actions (project_id, title) values ($1,'Sneaky') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await snagA.end();
  }

  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.actions (project_id, title, assigned_to) values ($1,'Bad assignment',$2) returning id", [fx.projA1, SNAG_A]),
      /assigned_to must be a project editor/,
      "a legitimate editor still can't assign an action to a snagging-only member — they're not an eligible owner"
    );
  } finally {
    await ownerA.end();
  }
});

test("Security: a stranger with no membership anywhere sees and can touch nothing", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    const read = await stranger.query("select 1 from public.actions where project_id = $1", [fx.projA1]);
    assert.equal(read.rowCount, 0);
    await assert.rejects(
      () => stranger.query("insert into public.actions (project_id, title) values ($1,'x') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await stranger.end();
  }
});

test("Security: invalid owner — assigning to someone with no membership on the project at all is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.actions (project_id, title, assigned_to) values ($1,'x',$2) returning id", [fx.projA1, OWNER_B]),
      /assigned_to must be a project editor/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Audit integration (Priority 4) ────────────────────────────

test("Audit: INSERT/UPDATE/DELETE on actions all produce correct audit_log rows via the existing generic trigger", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query(
      "insert into public.actions (project_id, title, priority) values ($1,'Audited action','low') returning id",
      [fx.projA1]
    );
    const id = created.rows[0].id;

    await ownerA.query("update public.actions set status = 'in_progress', assigned_to = $1 where id = $2", [COLLAB_A, id]);
    await ownerA.query("update public.actions set due_date = '2026-11-01' where id = $1", [id]);
    await ownerA.query("delete from public.actions where id = $1", [id]);

    const { rows } = await ownerA.query(
      `select action, table_name, record_id, org_id, project_id, user_id, old_data, new_data
       from public.audit_log where table_name = 'actions' and record_id = $1 order by created_at`,
      [id]
    );
    assert.equal(rows.length, 4, "insert + 2 updates + delete = 4 audit rows");

    assert.equal(rows[0].action, "INSERT");
    assert.equal(rows[0].old_data, null);
    assert.equal(rows[0].new_data.title, "Audited action");
    assert.equal(rows[0].org_id, fx.orgA);
    assert.equal(rows[0].project_id, fx.projA1);
    assert.equal(rows[0].user_id, OWNER_A, "the actor must be the real authenticated user");

    assert.equal(rows[1].action, "UPDATE");
    assert.equal(rows[1].old_data.status, "open");
    assert.equal(rows[1].new_data.status, "in_progress", "status changes are captured");
    assert.equal(rows[1].old_data.assigned_to, null);
    assert.equal(rows[1].new_data.assigned_to, COLLAB_A, "ownership/assignment changes are captured");

    assert.equal(rows[2].action, "UPDATE");
    assert.equal(rows[2].old_data.due_date, null);
    assert.equal(rows[2].new_data.due_date, "2026-11-01", "due-date changes are captured");

    assert.equal(rows[3].action, "DELETE");
    assert.equal(rows[3].new_data, null);
    assert.equal(rows[3].old_data.title, "Audited action");
  } finally {
    await ownerA.end();
  }
});

test("Audit: Org B cannot read Org A's actions audit history", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'For audit isolation') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rowCount } = await ownerB.query(
      "select 1 from public.audit_log where table_name = 'actions' and record_id = $1", [created.rows[0].id]
    );
    assert.equal(rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

// ─── Edge cases / validation ────────────────────────────────────

test("Edge case: invalid status is rejected by the CHECK constraint", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.actions (project_id, title, status) values ($1,'x','done')", [fx.projA1]),
      (err) => err.code === "23514"
    );
  } finally {
    await ownerA.end();
  }
});

test("Edge case: invalid priority is rejected by the CHECK constraint", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.actions (project_id, title, priority) values ($1,'x','urgent')", [fx.projA1]),
      (err) => err.code === "23514"
    );
  } finally {
    await ownerA.end();
  }
});

test("Edge case: missing title is rejected (NOT NULL)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.actions (project_id) values ($1)", [fx.projA1]),
      (err) => err.code === "23502"
    );
  } finally {
    await ownerA.end();
  }
});

test("Edge case: missing project_id is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    // The actions_before_write() trigger's own project lookup runs before
    // the NOT NULL constraint would even be checked (BEFORE triggers run
    // ahead of constraint validation) — a null project_id fails to
    // resolve any project, so it's rejected there first, with a more
    // specific message than a bare NOT NULL violation would give.
    await assert.rejects(
      () => ownerA.query("insert into public.actions (title) values ('x')"),
      /actions\.project_id must reference an existing project/
    );
  } finally {
    await ownerA.end();
  }
});

test("Edge case: an invalid status transition (e.g. blocked -> completed) is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.actions (project_id, title, status) values ($1,'x','blocked') returning id", [fx.projA1]);
    await assert.rejects(
      () => ownerA.query("update public.actions set status = 'completed' where id = $1", [created.rows[0].id]),
      /Invalid action status transition/
    );
  } finally {
    await ownerA.end();
  }
});

test("Edge case: cancelled is terminal — no transition out of it is allowed", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.actions (project_id, title, status) values ($1,'x','cancelled') returning id", [fx.projA1]);
    await assert.rejects(
      () => ownerA.query("update public.actions set status = 'open' where id = $1", [created.rows[0].id]),
      /Invalid action status transition/
    );
  } finally {
    await ownerA.end();
  }
});

test("Edge case: re-saving an action without changing its status is always allowed", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.actions (project_id, title, status) values ($1,'x','blocked') returning id", [fx.projA1]);
    const upd = await ownerA.query("update public.actions set description = 'still blocked, adding a note' where id = $1 returning status", [created.rows[0].id]);
    assert.equal(upd.rows[0].status, "blocked");
  } finally {
    await ownerA.end();
  }
});

test("Edge case: created_by and created_at cannot be overwritten by a client-supplied UPDATE", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.actions (project_id, title) values ($1,'x') returning created_by, created_at", [fx.projA1]);
    const id = (await ownerA.query("select id from public.actions where project_id = $1 order by created_at desc limit 1", [fx.projA1])).rows[0].id;
    const spoofDate = "2000-01-01T00:00:00Z";
    const updated = await ownerA.query(
      "update public.actions set created_by = $1, created_at = $2, title = 'renamed' where id = $3 returning created_by, created_at",
      [OWNER_B, spoofDate, id]
    );
    assert.equal(updated.rows[0].created_by, created.rows[0].created_by, "created_by must stay whoever really created it");
    assert.notEqual(new Date(updated.rows[0].created_at).getTime(), new Date(spoofDate).getTime(), "created_at must not be spoofable via UPDATE");
  } finally {
    await ownerA.end();
  }
});
