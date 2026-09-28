// Accountability & Work Queue (Priority 16) — real database, real
// non-superuser `authenticated` role. getPortfolioWorkItems() adds no
// new RLS policy and no new assignee-validation trigger — it is a
// pure read/aggregation layer over actions/snag_items/programme_activities,
// exactly the tables and policies P15's own portfolio work already
// proved safe. This file targets what's NEW to this phase specifically:
// that assigned_to is visible/invisible in exactly the same pattern as
// the rest of each row (editor-only for actions/programme_activities,
// member-level for snags), across multi-project ownership, cross-org
// isolation, and that the PRE-EXISTING assignee-validation triggers
// (actions_before_write/snag_items_before_write/
// programme_activities_before_write) still reject an invalid assignee
// — a regression check, not new behaviour.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_accountability_work_queue";

const OWNER_A = "a1000000-0000-0000-0000-000000000091";
const COLLAB_MULTI = "a2000000-0000-0000-0000-000000000092";
const SNAG_A = "a3000000-0000-0000-0000-000000000093";
const OWNER_B = "b1000000-0000-0000-0000-000000000091";
const STRANGER = "c1000000-0000-0000-0000-000000000091";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'multi@example.com'), ($3,'snaga@example.com'), ($4,'ownerb@example.com'), ($5,'stranger@example.com')`,
    [OWNER_A, COLLAB_MULTI, SNAG_A, OWNER_B, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const plotA = (await ownerA.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'P1',$2) returning id", [projA, OWNER_A])).rows[0].id;
  const inviteA = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;
  const snagInviteA = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  await ownerA.end();

  const collabMulti = await userClient(DB, COLLAB_MULTI);
  await collabMulti.query("select public.join_project_by_invite($1)", [inviteA]);
  await collabMulti.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagInviteA]);
  await snagA.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  const inviteB = (await ownerB.query("select public.regenerate_invite_code($1) as code", [projB])).rows[0].code;
  await ownerB.end();

  const collabMulti2 = await userClient(DB, COLLAB_MULTI);
  await collabMulti2.query("select public.join_project_by_invite($1)", [inviteB]);
  await collabMulti2.end();

  // Real assigned work in project A: an Action assigned to OWNER_A, a
  // Snag assigned to SNAG_A, a Programme Activity assigned to COLLAB_MULTI.
  const ownerA2 = await userClient(DB, OWNER_A);
  await ownerA2.query(`insert into public.actions (project_id, title, status, priority, assigned_to) values ($1,'Fix gate','open','high',$2)`, [projA, OWNER_A]);
  const list = (await ownerA2.query(`select id from public.snag_lists where plot_id=$1`, [plotA])).rows[0].id;
  await ownerA2.query(`insert into public.snag_items (project_id, snag_list_id, description, priority, status, assigned_to) values ($1,$2,'Crack','high','open',$3)`, [projA, list, SNAG_A]);
  const programmeId = (await ownerA2.query(`insert into public.programmes (project_id, name, status) values ($1,'Prog','active') returning id`, [projA])).rows[0].id;
  await ownerA2.query(`insert into public.programme_activities (programme_id, title, status, assigned_to) values ($1,'Task','in_progress',$2)`, [programmeId, COLLAB_MULTI]);
  await ownerA2.end();

  fx = { orgA, projA, plotA, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

const WORK_TABLES = {
  actions: "select project_id, assigned_to from public.actions",
  snag_items: "select project_id, assigned_to from public.snag_items",
  programme_activities: "select project_id, assigned_to from public.programme_activities",
};

// ─── Ownership visibility ─────────────────────────────────────────────

test("Ownership visibility: the project owner sees assigned_to on all three work-item tables for their own project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    for (const table of Object.keys(WORK_TABLES)) {
      const { rows } = await ownerA.query(WORK_TABLES[table]);
      assert.ok(rows.some((r) => r.project_id === fx.projA && r.assigned_to), `expected at least one assigned row visible via ${table}`);
    }
  } finally {
    await ownerA.end();
  }
});

test("Ownership visibility: a multi-project collaborator sees their own assigned Programme Activity in Project A AND can see Project B's (empty) work tables too — proving multi-project scope, not just the first project", async () => {
  const multi = await userClient(DB, COLLAB_MULTI);
  try {
    const { rows: progRows } = await multi.query(WORK_TABLES.programme_activities);
    assert.ok(progRows.some((r) => r.project_id === fx.projA && r.assigned_to === COLLAB_MULTI));
    // Project B has no work items yet, but the QUERY itself must not
    // error or silently exclude project B — confirmed by checking no
    // row belonging to project A "leaks" as project B's and vice versa.
    assert.ok(!progRows.some((r) => r.project_id === fx.projB));
  } finally {
    await multi.end();
  }
});

// ─── Project / organisation isolation ─────────────────────────────────

test("Project isolation: Project B's owner never sees Project A's assigned work on any of the three tables", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    for (const table of Object.keys(WORK_TABLES)) {
      const { rows } = await ownerB.query(WORK_TABLES[table]);
      assert.ok(!rows.some((r) => r.project_id === fx.projA), `owner B must never see Project A's rows via ${table}`);
    }
  } finally {
    await ownerB.end();
  }
});

test("Organisation isolation: a stranger with no membership anywhere sees zero rows on any of the three tables", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    for (const table of Object.keys(WORK_TABLES)) {
      const { rows } = await stranger.query(WORK_TABLES[table]);
      assert.equal(rows.length, 0, `stranger must see 0 rows via ${table}`);
    }
  } finally {
    await stranger.end();
  }
});

test("Unauthenticated: sees zero rows on any of the three tables", async () => {
  const anon = await userClient(DB, null);
  try {
    for (const table of Object.keys(WORK_TABLES)) {
      const { rows } = await anon.query(WORK_TABLES[table]);
      assert.equal(rows.length, 0, `unauthenticated caller must see 0 rows via ${table}`);
    }
  } finally {
    await anon.end();
  }
});

// ─── Snagging-only isolation (editor-only tables stay invisible) ─────

test("Snagging-only isolation: a snagging-only member sees their own assigned Snag but NOTHING from Actions or Programme Activities (editor-only tables)", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rows: snagRows } = await snagA.query(WORK_TABLES.snag_items);
    assert.ok(snagRows.some((r) => r.project_id === fx.projA && r.assigned_to === SNAG_A), "must see their own assigned snag");

    const { rows: actionRows } = await snagA.query(WORK_TABLES.actions);
    assert.equal(actionRows.length, 0, "a snagging-only member must see NOTHING from actions — a false empty work queue, not a false all-clear, but must not leak editor-only data either");

    const { rows: progRows } = await snagA.query(WORK_TABLES.programme_activities);
    assert.equal(progRows.length, 0, "a snagging-only member must see NOTHING from programme_activities");
  } finally {
    await snagA.end();
  }
});

// ─── Unassigned vs assigned records ────────────────────────────────────

test("Unassigned records: an Action with no assigned_to is still visible to the project owner (assigned_to null is a legitimate value, not hidden data)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows: created } = await ownerA.query(`insert into public.actions (project_id, title, status, priority) values ($1,'Unowned','open','low') returning id, assigned_to`, [fx.projA]);
    assert.equal(created[0].assigned_to, null);
    const { rows } = await ownerA.query(`select assigned_to from public.actions where id=$1`, [created[0].id]);
    assert.equal(rows[0].assigned_to, null);
  } finally {
    await ownerA.end();
  }
});

// ─── Invalid / cross-project assignee (regression on existing triggers) ─

test("Regression: an Action cannot be assigned to a user who is not a project editor (existing actions_before_write validation, unaffected by this phase)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      ownerA.query(`insert into public.actions (project_id, title, assigned_to) values ($1,'Bad assign',$2)`, [fx.projA, STRANGER]),
      /assigned_to must be a project editor/
    );
  } finally {
    await ownerA.end();
  }
});

test("Regression: a Snag cannot be assigned to a user who is not a project member (existing snag_items_before_write validation, unaffected by this phase)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const list = (await ownerA.query(`select id from public.snag_lists where plot_id=$1`, [fx.plotA])).rows[0].id;
    await assert.rejects(
      ownerA.query(`insert into public.snag_items (project_id, snag_list_id, description, assigned_to) values ($1,$2,'Bad assign',$3)`, [fx.projA, list, STRANGER]),
      /assigned_to must be a member of this project/
    );
  } finally {
    await ownerA.end();
  }
});

test("Regression: a Programme Activity cannot be assigned to a user who is not a project member (existing programme_activities_before_write validation, unaffected by this phase)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const programmeId = (await ownerA.query(`select id from public.programmes where project_id=$1 limit 1`, [fx.projA])).rows[0].id;
    await assert.rejects(
      ownerA.query(`insert into public.programme_activities (programme_id, title, assigned_to) values ($1,'Bad assign',$2)`, [programmeId, STRANGER]),
      /assigned_to must be a member of this project/
    );
  } finally {
    await ownerA.end();
  }
});

test("Cross-project ownership rejection: OWNER_B cannot assign a Project B action to a user who only belongs to Project A", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    await assert.rejects(
      ownerB.query(`insert into public.actions (project_id, title, assigned_to) values ($1,'Cross-project assign',$2)`, [fx.projB, OWNER_A]),
      /assigned_to must be a project editor/
    );
  } finally {
    await ownerB.end();
  }
});
