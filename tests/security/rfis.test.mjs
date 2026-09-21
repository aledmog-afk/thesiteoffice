// RFI-1 — database/security foundation for Requests For Information.
// Real database, real non-superuser `authenticated` role, the actual
// RLS/trigger boundary (see org_isolation.test.mjs's header comment for
// why this matters). Mirrors tests/security/actions.test.mjs's fixture
// and structure exactly — rfis is deliberately editor-gated the same
// way Actions/Inspection Findings are, not member-gated like snag_items.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_rfis";

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
  const plotA1 = (await ownerA.query(
    "insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id",
    [projA1]
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

  // Org B: a fully separate org/project/owner/plot.
  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query(
    "insert into public.projects (name, org_id, created_by) values ('Org B Site', $1, $2) returning id",
    [orgB, OWNER_B]
  )).rows[0].id;
  const plotB = (await ownerB.query(
    "insert into public.plots (project_id, plot_number) values ($1,'Plot B1') returning id",
    [projB]
  )).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA1, projA2, plotA1, orgB, projB, plotB };
});

after(async () => {
  await dropTestDatabase(DB);
});

// ─── Schema ─────────────────────────────────────────────────────────

test("Schema: rfis table, constraints, foreign keys and indexes exist as designed", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const table = await admin.query("select 1 from information_schema.tables where table_schema = 'public' and table_name = 'rfis'");
    assert.equal(table.rowCount, 1);

    const checks = await admin.query(
      `select conname from pg_constraint where conrelid = 'public.rfis'::regclass and contype = 'c'`
    );
    const checkNames = checks.rows.map((r) => r.conname);
    assert.ok(checkNames.includes("rfis_status_check"));
    assert.ok(checkNames.includes("rfis_priority_check"));

    const unique = await admin.query(
      `select conname from pg_constraint where conrelid = 'public.rfis'::regclass and contype = 'u'`
    );
    assert.ok(unique.rows.some((r) => r.conname === "rfis_project_reference_unique"), "a hard uniqueness backstop on (project_id, reference) must exist");

    const fks = await admin.query(
      `select conname, confrelid::regclass::text as target from pg_constraint where conrelid = 'public.rfis'::regclass and contype = 'f'`
    );
    const fkTargets = fks.rows.map((r) => r.target).sort();
    assert.deepEqual(fkTargets, ["auth.users", "auth.users", "auth.users", "organisations", "plots", "projects"].sort());

    const indexes = await admin.query(
      `select indexname from pg_indexes where tablename = 'rfis'`
    );
    const indexNames = indexes.rows.map((r) => r.indexname);
    for (const expected of ["rfis_project_status_idx", "rfis_project_due_date_idx", "rfis_assigned_status_idx", "rfis_org_id_idx", "rfis_plot_id_idx"]) {
      assert.ok(indexNames.includes(expected), `expected index ${expected}`);
    }

    const triggers = await admin.query(
      `select count(*)::int as n from pg_trigger where tgrelid = 'public.rfis'::regclass and tgname like 'trg_%'`
    );
    assert.equal(triggers.rows[0].n, 2, "exactly 2 triggers on rfis (before-write + audit)");

    const policies = await admin.query(`select policyname, cmd from pg_policies where tablename = 'rfis' order by policyname`);
    assert.equal(policies.rowCount, 3, "select/insert/update only — no delete policy");
    assert.ok(!policies.rows.some((r) => r.cmd === "DELETE"), "no DELETE policy must exist for rfis");
  } finally {
    await admin.end();
  }
});

// ─── CRUD ───────────────────────────────────────────────────────────

test("CRUD: an editor can create an RFI with org_id correctly derived (never client-trusted)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const spoofedOrgId = fx.orgB;
    const created = await ownerA.query(
      "insert into public.rfis (org_id, project_id, title, question) values ($1,$2,$3,$4) returning *",
      [spoofedOrgId, fx.projA1, "Beam detail clash", "Please confirm beam depth at gridline C4."]
    );
    assert.equal(created.rows[0].org_id, fx.orgA, "org_id must always be derived from project_id server-side");
    assert.equal(created.rows[0].status, "open", "new RFIs default to open");
    assert.equal(created.rows[0].priority, "medium", "default priority");
    assert.equal(created.rows[0].created_by, OWNER_A);
    assert.equal(created.rows[0].reference, "RFI-001", "first RFI on this project is RFI-001");
  } finally {
    await ownerA.end();
  }
});

test("CRUD: a second RFI on the same project is numbered RFI-002", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query(
      "insert into public.rfis (project_id, title, question) values ($1,$2,$3) returning reference",
      [fx.projA1, "Second RFI", "Second question"]
    );
    assert.equal(created.rows[0].reference, "RFI-002");
  } finally {
    await ownerA.end();
  }
});

test("CRUD: numbering is scoped per project — a fresh project starts again at RFI-001", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query(
      "insert into public.rfis (project_id, title, question) values ($1,$2,$3) returning reference",
      [fx.projA2, "First RFI on A2", "Question"]
    );
    assert.equal(created.rows[0].reference, "RFI-001", "a different project's numbering must not be affected by projA1's RFIs");
  } finally {
    await ownerA.end();
  }
});

test("CRUD: read returns RFIs for the project", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const { rows } = await collabA.query("select 1 from public.rfis where project_id = $1", [fx.projA1]);
    assert.ok(rows.length >= 1);
  } finally {
    await collabA.end();
  }
});

test("CRUD: update (title/question/priority)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'Original','Q?') returning id", [fx.projA1]);
    const id = created.rows[0].id;
    const updated = await ownerA.query(
      "update public.rfis set title = 'Updated title', priority = 'critical' where id = $1 returning title, priority",
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
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'Assign me','Q?') returning id", [fx.projA1]);
    const assigned = await ownerA.query("update public.rfis set assigned_to = $1 where id = $2 returning assigned_to", [COLLAB_A, created.rows[0].id]);
    assert.equal(assigned.rows[0].assigned_to, COLLAB_A);
  } finally {
    await ownerA.end();
  }
});

test("CRUD: a plot belonging to the same project can be attached", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query(
      "insert into public.rfis (project_id, plot_id, title, question) values ($1,$2,'Plot RFI','Q?') returning plot_id",
      [fx.projA1, fx.plotA1]
    );
    assert.equal(created.rows[0].plot_id, fx.plotA1);
  } finally {
    await ownerA.end();
  }
});

test("CRUD: DELETE is not permitted for any role — RLS has no delete policy", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'Keep me','Q?') returning id", [fx.projA1]);
    const del = await ownerA.query("delete from public.rfis where id = $1", [created.rows[0].id]);
    assert.equal(del.rowCount, 0, "an RFI must never be deletable, even by its own project's editor");
    const stillThere = await ownerA.query("select 1 from public.rfis where id = $1", [created.rows[0].id]);
    assert.equal(stillThere.rowCount, 1);
  } finally {
    await ownerA.end();
  }
});

// ─── Security: cross-organisation ──────────────────────────────────

test("Security: Org B cannot READ Org A's RFIs", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'Org A only','Q?') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rowCount } = await ownerB.query("select 1 from public.rfis where id = $1", [created.rows[0].id]);
    assert.equal(rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot CREATE an RFI in Org A's project", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    await assert.rejects(
      () => ownerB.query("insert into public.rfis (project_id, title, question) values ($1,'Sneaky','Q?') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot UPDATE an Org A RFI, even knowing its real id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'Protected','Q?') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const upd = await ownerB.query("update public.rfis set title = 'Hijacked' where id = $1", [created.rows[0].id]);
    assert.equal(upd.rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

test("Security: an RFI cannot be created with a plot from another organisation", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.rfis (project_id, plot_id, title, question) values ($1,$2,'x','Q?') returning id", [fx.projA1, fx.plotB]),
      /plot_id must belong to the same project/
    );
  } finally {
    await ownerA.end();
  }
});

test("Security: project_id cannot be reassigned to another organisation's project via UPDATE", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]);
    // Even an editor of Org A cannot see/write Org B's project, so this
    // update must affect zero rows in the WITH CHECK sense — but more
    // importantly, rfis_before_write() itself re-pins project_id/org_id
    // to their OLD values regardless of payload, so even a same-org
    // attempt to move an RFI to a different project must never work.
    const otherProjA = fx.projA2;
    const moved = await ownerA.query("update public.rfis set project_id = $1 where id = $2 returning project_id, org_id", [otherProjA, created.rows[0].id]);
    assert.equal(moved.rows[0].project_id, fx.projA1, "project_id must be immutable on UPDATE, regardless of caller");
    assert.equal(moved.rows[0].org_id, fx.orgA);
  } finally {
    await ownerA.end();
  }
});

// ─── Security: cross-project isolation within the same org ────────

test("Security: a member of Project A1 cannot access Project A2's RFIs, despite being in the same organisation", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'A2 only','Q?') returning id", [fx.projA2]);
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A); // editor on A1, NOT a member of A2
  try {
    const read = await collabA.query("select 1 from public.rfis where id = $1", [created.rows[0].id]);
    assert.equal(read.rowCount, 0);
    await assert.rejects(
      () => collabA.query("insert into public.rfis (project_id, title, question) values ($1,'Sneaky A2','Q?') returning id", [fx.projA2]),
      (err) => isRlsError(err)
    );
  } finally {
    await collabA.end();
  }
});

// ─── Security: role restrictions within a legitimate project ──────

test("Security: a snagging-only member cannot read, create, or be assigned RFIs", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const read = await snagA.query("select 1 from public.rfis where project_id = $1", [fx.projA1]);
    assert.equal(read.rowCount, 0, "RFIs are editor-only — a snagging-only member sees none of it");
    await assert.rejects(
      () => snagA.query("insert into public.rfis (project_id, title, question) values ($1,'Sneaky','Q?') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await snagA.end();
  }

  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.rfis (project_id, title, question, assigned_to) values ($1,'Bad assignment','Q?',$2) returning id", [fx.projA1, SNAG_A]),
      /assigned_to must be a project editor/
    );
  } finally {
    await ownerA.end();
  }
});

test("Security: a stranger with no membership anywhere sees and can touch nothing", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    const read = await stranger.query("select 1 from public.rfis where project_id = $1", [fx.projA1]);
    assert.equal(read.rowCount, 0);
    await assert.rejects(
      () => stranger.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]),
      (err) => isRlsError(err)
    );
  } finally {
    await stranger.end();
  }
});

test("Security: invalid assignee — assigning to someone with no membership on the project at all is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.rfis (project_id, title, question, assigned_to) values ($1,'x','Q?',$2) returning id", [fx.projA1, OWNER_B]),
      /assigned_to must be a project editor/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Lifecycle ──────────────────────────────────────────────────────

test("Lifecycle: open -> answered sets answered_at/answered_by", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]);
    const id = created.rows[0].id;
    const answered = await ownerA.query("update public.rfis set status = 'answered', response = 'See revised drawing A-101' where id = $1 returning status, answered_at, answered_by, response", [id]);
    assert.equal(answered.rows[0].status, "answered");
    assert.ok(answered.rows[0].answered_at, "answered_at must be set");
    assert.equal(answered.rows[0].answered_by, OWNER_A);
    assert.equal(answered.rows[0].response, "See revised drawing A-101");
  } finally {
    await ownerA.end();
  }
});

test("Lifecycle: answered -> closed sets closed_at", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]);
    await ownerA.query("update public.rfis set status = 'answered' where id = $1", [created.rows[0].id]);
    const closed = await ownerA.query("update public.rfis set status = 'closed' where id = $1 returning status, closed_at", [created.rows[0].id]);
    assert.equal(closed.rows[0].status, "closed");
    assert.ok(closed.rows[0].closed_at);
  } finally {
    await ownerA.end();
  }
});

test("Lifecycle: closed -> open reopens, clears closed_at, and keeps the prior answer intact", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]);
    const id = created.rows[0].id;
    await ownerA.query("update public.rfis set status = 'answered', response = 'Old answer' where id = $1", [id]);
    await ownerA.query("update public.rfis set status = 'closed' where id = $1", [id]);
    const reopened = await ownerA.query("update public.rfis set status = 'open' where id = $1 returning status, closed_at, response", [id]);
    assert.equal(reopened.rows[0].status, "open");
    assert.equal(reopened.rows[0].closed_at, null, "reopening must clear closed_at");
    assert.equal(reopened.rows[0].response, "Old answer", "the prior answer must be preserved, not erased, by a reopen");
  } finally {
    await ownerA.end();
  }
});

test("Lifecycle: open -> closed directly is rejected (must go through answered)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]);
    await assert.rejects(
      () => ownerA.query("update public.rfis set status = 'closed' where id = $1", [created.rows[0].id]),
      /Invalid RFI status transition/
    );
  } finally {
    await ownerA.end();
  }
});

test("Lifecycle: answered -> open directly is rejected (only closed -> open reopens)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]);
    await ownerA.query("update public.rfis set status = 'answered' where id = $1", [created.rows[0].id]);
    await assert.rejects(
      () => ownerA.query("update public.rfis set status = 'open' where id = $1", [created.rows[0].id]),
      /Invalid RFI status transition/
    );
  } finally {
    await ownerA.end();
  }
});

test("Lifecycle: re-saving an RFI without changing its status is always allowed", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]);
    await ownerA.query("update public.rfis set status = 'answered' where id = $1", [created.rows[0].id]);
    const upd = await ownerA.query("update public.rfis set title = 'renamed' where id = $1 returning status", [created.rows[0].id]);
    assert.equal(upd.rows[0].status, "answered");
  } finally {
    await ownerA.end();
  }
});

test("Edge case: created_by, created_at and reference cannot be overwritten by a client-supplied UPDATE", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id, created_by, created_at, reference", [fx.projA1]);
    const id = created.rows[0].id;
    const updated = await ownerA.query(
      "update public.rfis set created_by = $1, created_at = '2000-01-01T00:00:00Z', reference = 'RFI-999', title = 'renamed' where id = $2 returning created_by, created_at, reference",
      [OWNER_B, id]
    );
    assert.equal(updated.rows[0].created_by, created.rows[0].created_by);
    assert.equal(updated.rows[0].reference, created.rows[0].reference, "reference must be immutable on UPDATE, even if a client supplies a different one");
    assert.notEqual(new Date(updated.rows[0].created_at).getTime(), new Date("2000-01-01T00:00:00Z").getTime());
  } finally {
    await ownerA.end();
  }
});

test("Edge case: invalid priority is rejected by the CHECK constraint", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.rfis (project_id, title, question, priority) values ($1,'x','Q?','urgent')", [fx.projA1]),
      (err) => err.code === "23514"
    );
  } finally {
    await ownerA.end();
  }
});

// status has no equivalent direct-insert test: rfis_before_write()
// unconditionally forces status to 'open' on INSERT (see "Lifecycle: a
// new RFI always starts open" below), so an invalid status value on
// insert never reaches the CHECK constraint at all — and on UPDATE,
// valid_rfi_status_transition() rejects any unrecognised value with
// its own specific error before the constraint would matter either
// (see the "directly is rejected" lifecycle tests above). The
// constraint's presence is still verified directly in the Schema test.

test("Lifecycle: a new RFI always starts open, even if the client tries to insert a different (valid) status", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question, status) values ($1,'x','Q?','answered') returning status", [fx.projA1]);
    assert.equal(created.rows[0].status, "open", "status must be forced to open on insert regardless of what the client sends");
  } finally {
    await ownerA.end();
  }
});

test("Edge case: an explicitly-supplied reference is respected, never silently overwritten", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query(
      "insert into public.rfis (project_id, title, question, reference) values ($1,'x','Q?','RFI-CUSTOM') returning reference",
      [fx.projA1]
    );
    assert.equal(created.rows[0].reference, "RFI-CUSTOM");
  } finally {
    await ownerA.end();
  }
});

test("Edge case: a duplicate explicit reference on the same project is rejected by the unique constraint", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await ownerA.query("insert into public.rfis (project_id, title, question, reference) values ($1,'x','Q?','RFI-DUP') returning id", [fx.projA1]);
    await assert.rejects(
      () => ownerA.query("insert into public.rfis (project_id, title, question, reference) values ($1,'y','Q2?','RFI-DUP') returning id", [fx.projA1]),
      (err) => err.code === "23505"
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Numbering: concurrency ─────────────────────────────────────────

test("Numbering: 10 concurrent inserts on the SAME project each get a unique, sequential reference — no duplicates", async () => {
  const before = await (async () => {
    const c = await userClient(DB, OWNER_A);
    try {
      const { rows } = await c.query(
        "select coalesce(max(substring(reference from '(\\d+)$')::int), 0) as n from public.rfis where project_id = $1",
        [fx.projA2]
      );
      return rows[0].n;
    } finally {
      await c.end();
    }
  })();

  const clients = await Promise.all(Array.from({ length: 10 }, () => userClient(DB, OWNER_A)));
  try {
    const results = await Promise.all(
      clients.map((c, i) => c.query(
        "insert into public.rfis (project_id, title, question) values ($1,$2,'Q?') returning reference",
        [fx.projA2, `Concurrent RFI ${i}`]
      ))
    );
    const refs = results.map((r) => r.rows[0].reference).sort();
    const uniqueRefs = new Set(refs);
    assert.equal(uniqueRefs.size, 10, `all 10 references must be unique, got: ${refs.join(", ")}`);
    // Whatever projA2's numbering stood at before this batch (other
    // tests in this file may also use projA2), the 10 concurrent
    // inserts must produce exactly the next 10 sequential numbers —
    // no gaps, no repeats, proving the advisory-lock serialisation
    // actually works under real concurrent connections, not just
    // sequential calls on one connection.
    assert.deepEqual(refs, Array.from({ length: 10 }, (_, i) => `RFI-${String(before + i + 1).padStart(3, "0")}`));
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
});

// ─── Audit integration ──────────────────────────────────────────────

test("Audit: INSERT/UPDATE on rfis produce correct audit_log rows via the existing generic trigger", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query(
      "insert into public.rfis (project_id, title, question, priority) values ($1,'Audited RFI','Q?','low') returning id",
      [fx.projA1]
    );
    const id = created.rows[0].id;

    await ownerA.query("update public.rfis set status = 'answered', response = 'Answer', assigned_to = $1 where id = $2", [COLLAB_A, id]);
    await ownerA.query("update public.rfis set status = 'closed' where id = $1", [id]);

    const { rows } = await ownerA.query(
      `select action, table_name, record_id, org_id, project_id, user_id, old_data, new_data
       from public.audit_log where table_name = 'rfis' and record_id = $1 order by created_at`,
      [id]
    );
    assert.equal(rows.length, 3, "insert + 2 updates = 3 audit rows");

    assert.equal(rows[0].action, "INSERT");
    assert.equal(rows[0].old_data, null);
    assert.equal(rows[0].new_data.title, "Audited RFI");
    assert.equal(rows[0].org_id, fx.orgA);
    assert.equal(rows[0].project_id, fx.projA1);
    assert.equal(rows[0].user_id, OWNER_A);

    assert.equal(rows[1].action, "UPDATE");
    assert.equal(rows[1].old_data.status, "open");
    assert.equal(rows[1].new_data.status, "answered");

    assert.equal(rows[2].action, "UPDATE");
    assert.equal(rows[2].old_data.status, "answered");
    assert.equal(rows[2].new_data.status, "closed");
  } finally {
    await ownerA.end();
  }
});

test("Audit: DELETE is never captured for rfis, because DELETE is never possible for any client role", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'x','Q?') returning id", [fx.projA1]);
    await ownerA.query("delete from public.rfis where id = $1", [created.rows[0].id]); // no-op, denied by RLS
    const { rows } = await ownerA.query(
      "select action from public.audit_log where table_name = 'rfis' and record_id = $1 order by created_at",
      [created.rows[0].id]
    );
    assert.ok(!rows.some((r) => r.action === "DELETE"));
  } finally {
    await ownerA.end();
  }
});

test("Audit: Org B cannot read Org A's RFI audit history", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'For audit isolation','Q?') returning id", [fx.projA1]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rowCount } = await ownerB.query(
      "select 1 from public.audit_log where table_name = 'rfis' and record_id = $1", [created.rows[0].id]
    );
    assert.equal(rowCount, 0);
  } finally {
    await ownerB.end();
  }
});
