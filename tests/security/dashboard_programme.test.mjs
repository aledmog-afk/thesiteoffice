// Project Control Dashboard: Programme integration (Priority 11,
// Phase 4) — real database, real non-superuser `authenticated` role.
// getProjectControlSummary()/getPortfolioControlSummary() now issue
// ONE additional unfiltered select — `programme_activities` joined to
// its parent `programmes(status)` — exactly the same "broad select,
// let RLS do the real scoping" shape dashboard.test.mjs already proves
// for actions/hs_audit_items; this file proves that same guarantee
// holds for the new query. Also covers the v37 action_id link's own
// IDOR check (mirrors snag_items.action_id/inspection_findings.action_id
// exactly) and its audit trail.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_dashboard_programme";

const OWNER_A = "a1000000-0000-0000-0000-000000000021";
const COLLAB_A = "a2000000-0000-0000-0000-000000000022";
const SNAG_A = "a3000000-0000-0000-0000-000000000023";
const OWNER_B = "b1000000-0000-0000-0000-000000000021";
const STRANGER = "c1000000-0000-0000-0000-000000000021";

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
  const progA1 = (await ownerA.query("insert into public.programmes (project_id, name, status) values ($1,'A1 Programme','active') returning id", [projA1])).rows[0].id;
  const progA2 = (await ownerA.query("insert into public.programmes (project_id, name, status) values ($1,'A2 Programme','active') returning id", [projA2])).rows[0].id;
  await ownerA.query("insert into public.programme_activities (programme_id, title, planned_finish) values ($1,'A1 overdue activity','2020-01-01')", [progA1]);
  await ownerA.query("insert into public.programme_activities (programme_id, title, planned_finish) values ($1,'A2 overdue activity','2020-01-01')", [progA2]);
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
  const progB = (await ownerB.query("insert into public.programmes (project_id, name, status) values ($1,'B Programme','active') returning id", [projB])).rows[0].id;
  await ownerB.query("insert into public.programme_activities (programme_id, title, planned_finish) values ($1,'B overdue activity','2020-01-01')", [progB]);
  await ownerB.end();

  fx = { orgA, projA1, projA2, progA1, progA2, orgB, projB, progB };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("Dashboard query shape: an unfiltered programme_activities select never returns another organisation's rows", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query("select project_id, title from public.programme_activities");
    assert.ok(rows.length >= 2, "sanity check: Org A's own activities should be present");
    assert.ok(rows.every((r) => r.project_id === fx.projA1 || r.project_id === fx.projA2), "no row from Org B's project must ever appear in an unfiltered select as Org A");
    assert.ok(!rows.some((r) => r.title === "B overdue activity"), "Org B's activity title must never leak through");
  } finally {
    await ownerA.end();
  }
});

test("Dashboard query shape: cross-project isolation holds even without an explicit project_id filter", async () => {
  // COLLAB_A is an editor on A1 but has no membership on A2 at all —
  // an unfiltered select must still only ever return A1's rows.
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const { rows } = await collabA.query("select project_id from public.programme_activities");
    assert.ok(rows.length >= 1, "sanity check: should see A1's own activity");
    assert.ok(rows.every((r) => r.project_id === fx.projA1), "a project A1 editor must never see project A2's programme rows via the same unfiltered dashboard query shape");
  } finally {
    await collabA.end();
  }
});

test("Dashboard query shape: a snagging-only member's unfiltered programme_activities select returns zero rows (editor-only, matching Programme Control's own RLS tier)", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rowCount } = await snagA.query("select 1 from public.programme_activities");
    assert.equal(rowCount, 0);
  } finally {
    await snagA.end();
  }
});

test("Dashboard query shape: a stranger with no membership anywhere sees zero programme_activities rows", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    const { rowCount } = await stranger.query("select 1 from public.programme_activities");
    assert.equal(rowCount, 0);
  } finally {
    await stranger.end();
  }
});

test("Dashboard query shape: the embedded programmes(status) relationship never exposes another project's programme", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const { rows } = await collabA.query(
      "select pa.project_id, p.project_id as programme_project_id from public.programme_activities pa join public.programmes p on p.id = pa.programme_id"
    );
    assert.ok(rows.length >= 1);
    assert.ok(rows.every((r) => r.project_id === r.programme_project_id), "an activity's embedded programme must always belong to the SAME project as the activity itself");
  } finally {
    await collabA.end();
  }
});

// ─── programme_activities.action_id (v37) ──────────────────────────

async function createAct(client, programmeId, extra = {}) {
  const fields = { programme_id: programmeId, title: "Groundworks", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(`insert into public.programme_activities (${cols.join(",")}) values (${placeholders}) returning *`, params);
  return rows[0];
}

test("Database: programme_activities.action_id accepts a real action in the same project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const action = (await ownerA.query("insert into public.actions (project_id, title) values ($1,'Resolve delay') returning id", [fx.projA1])).rows[0];
    const a = await createAct(ownerA, fx.progA1, { action_id: action.id });
    assert.equal(a.action_id, action.id);
  } finally {
    await ownerA.end();
  }
});

test("Database: a cross-project action_id (IDOR) is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const otherProjectAction = (await ownerA.query("insert into public.actions (project_id, title) values ($1,'A2 action') returning id", [fx.projA2])).rows[0];
    await assert.rejects(
      createAct(ownerA, fx.progA1, { action_id: otherProjectAction.id }),
      /a linked action must belong to the same project as the programme activity/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: a nonexistent action_id is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createAct(ownerA, fx.progA1, { action_id: "11111111-1111-1111-1111-111111111111" }),
      /programme_activities\.action_id must reference an existing action/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: a snagging-only member cannot link an activity to an action (write is editor-only, matching the rest of Programme Control)", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const a = (await snagA.query("select id from public.programme_activities where project_id = $1 limit 1", [fx.projA1])).rows;
    // Snagging-only can't even SELECT the row to get its id (already
    // proven above) — confirm the write itself is independently
    // blocked too, using the id from an editor connection.
    const ownerA = await userClient(DB, OWNER_A);
    const activityId = (await ownerA.query("select id from public.programme_activities where project_id = $1 limit 1", [fx.projA1])).rows[0].id;
    const action = (await ownerA.query("insert into public.actions (project_id, title) values ($1,'X') returning id", [fx.projA1])).rows[0];
    await ownerA.end();

    const upd = await snagA.query("update public.programme_activities set action_id = $1 where id = $2", [action.id, activityId]);
    assert.equal(upd.rowCount, 0, "RLS must silently affect zero rows for a non-editor, not error");
  } finally {
    await snagA.end();
  }
});

test("Audit: linking an activity to an action produces a normal UPDATE audit row attributed to the real user", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const a = await createAct(ownerA, fx.progA1, { title: "Audited link" });
    const action = (await ownerA.query("insert into public.actions (project_id, title) values ($1,'Resolve') returning id", [fx.projA1])).rows[0];
    await ownerA.query("update public.programme_activities set action_id = $1 where id = $2", [action.id, a.id]);

    const { rows: audit } = await ownerA.query(
      "select action, user_id from public.audit_log where table_name = 'programme_activities' and record_id = $1 order by created_at",
      [a.id]
    );
    assert.deepEqual(audit.map((r) => r.action), ["INSERT", "UPDATE"]);
    assert.ok(audit.every((r) => r.user_id === OWNER_A));
  } finally {
    await ownerA.end();
  }
});
