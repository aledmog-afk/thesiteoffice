// Programme Control foundation (Priority 11, Phase 2) — real database,
// real non-superuser `authenticated` role, the actual RLS/trigger
// boundary (see org_isolation.test.mjs's header comment for why this
// matters).
//
// Editor-only throughout (brief: "Do not widen access to snagging-only
// users yet") — unlike documents/document_revisions, which are
// member-readable. Covers: programme creation, the one-active-
// programme-per-project constraint, programme_activities creation,
// org/project derivation, plot/assignee validation (the IDOR classes
// this brief explicitly calls out), the status/percent_complete/
// actual_finish coupling, date CHECK constraints, external_id
// uniqueness scoping, RLS across owner/collaborator/snagging-only/
// stranger/cross-org, and audit integration.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_programme";

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
  const plotA1 = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1, 'Plot 1') returning id", [projA1])).rows[0].id;
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
  const plotB = (await ownerB.query("insert into public.plots (project_id, plot_number) values ($1, 'Plot 1') returning id", [projB])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA1, projA2, plotA1, orgB, projB, plotB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createProg(client, projectId = fx.projA1, extra = {}) {
  const fields = { project_id: projectId, name: "Main Programme", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(`insert into public.programmes (${cols.join(",")}) values (${placeholders}) returning *`, params);
  return rows[0];
}

async function createAct(client, programmeId, extra = {}) {
  const fields = { programme_id: programmeId, title: "Groundworks", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(`insert into public.programme_activities (${cols.join(",")}) values (${placeholders}) returning *`, params);
  return rows[0];
}

// ─── Database: programmes ────────────────────────────────────────

test("Database: org_id is derived server-side from project_id, never client-trusted", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1, { org_id: fx.orgB });
    assert.equal(p.org_id, fx.orgA);
  } finally {
    await ownerA.end();
  }
});

test("Database: a new programme defaults to 'draft' when no status is supplied", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    assert.equal(p.status, "draft");
  } finally {
    await ownerA.end();
  }
});

// Deliberately NOT forced to 'draft' on insert (unlike weekly_reports'
// stricter lifecycle) — a client MAY create a programme already
// 'active' by supplying that status directly. This mirrors
// actions_before_write()'s own established looseness (status is only
// transition-checked on UPDATE, never reset on INSERT) rather than
// weekly_reports' explicit "always starts as draft" rule — a
// deliberate choice matching this table's own equally unrestricted
// status field, not an oversight.
test("Database: a client MAY create a programme already 'active' directly (status is not force-reset on insert, unlike weekly_reports)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1, { status: "active", name: "Direct Active" });
    assert.equal(p.status, "active");
    await ownerA.query("update public.programmes set status = 'archived' where id = $1", [p.id]);
  } finally {
    await ownerA.end();
  }
});

test("Database: only one ACTIVE programme is allowed per project — a second is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p1 = await createProg(ownerA, fx.projA1);
    await ownerA.query("update public.programmes set status = 'active' where id = $1", [p1.id]);
    await assert.rejects(
      createProg(ownerA, fx.projA1, { status: "active", name: "Second" }),
      /duplicate key value violates unique constraint/
    );
    await ownerA.query("update public.programmes set status = 'archived' where id = $1", [p1.id]);
  } finally {
    await ownerA.end();
  }
});

test("Database: multiple DRAFT programmes for the same project are allowed", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p1 = await createProg(ownerA, fx.projA1, { name: "Draft 1" });
    const p2 = await createProg(ownerA, fx.projA1, { name: "Draft 2" });
    assert.notEqual(p1.id, p2.id);
  } finally {
    await ownerA.end();
  }
});

test("Database: created_by/created_at are forced server-side and immutable", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const p = await createProg(ownerA, fx.projA1, { created_by: COLLAB_A });
    assert.equal(p.created_by, OWNER_A);
    await collabA.query("update public.programmes set name = 'renamed', created_by = $1 where id = $2", [COLLAB_A, p.id]);
    const { rows } = await collabA.query("select created_by from public.programmes where id = $1", [p.id]);
    assert.equal(rows[0].created_by, OWNER_A);
  } finally {
    await ownerA.end();
    await collabA.end();
  }
});

test("Database: a programme must reference a real project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createProg(ownerA, "11111111-1111-1111-1111-111111111111"),
      /project_id must reference an existing project|violates foreign key constraint/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Database: programme_activities ──────────────────────────────

test("Database: project_id/org_id on an activity are derived from the parent programme, never client-trusted", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA2);
    const a = await createAct(ownerA, p.id, { project_id: fx.projA1, org_id: fx.orgB });
    assert.equal(a.project_id, fx.projA2, "project_id must be forced to the parent programme's real project");
    assert.equal(a.org_id, fx.orgA);
  } finally {
    await ownerA.end();
  }
});

test("Database: an activity must reference a real programme", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createAct(ownerA, "11111111-1111-1111-1111-111111111111"),
      /programme_id must reference an existing programme|violates foreign key constraint/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: plot_id must belong to the SAME project as the activity — a cross-project plot is rejected (IDOR)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    await assert.rejects(
      createAct(ownerA, p.id, { plot_id: fx.plotB }),
      /plot_id must belong to the same project/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: a real plot in the SAME project is accepted", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id, { plot_id: fx.plotA1 });
    assert.equal(a.plot_id, fx.plotA1);
  } finally {
    await ownerA.end();
  }
});

test("Database: assigned_to must be a real member of the activity's project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    await assert.rejects(
      createAct(ownerA, p.id, { assigned_to: OWNER_B }),
      /assigned_to must be a member of this project/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: assigned_to accepts a snagging-only member (member-level check, not editor-level) — a legitimate responsible party", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id, { assigned_to: SNAG_A });
    assert.equal(a.assigned_to, SNAG_A);
  } finally {
    await ownerA.end();
  }
});

test("Database: forecast_start/forecast_finish default to planned_start/planned_finish on insert when not supplied", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id, { planned_start: "2026-01-01", planned_finish: "2026-01-15" });
    assert.deepEqual(a.forecast_start, a.planned_start);
    assert.deepEqual(a.forecast_finish, a.planned_finish);
  } finally {
    await ownerA.end();
  }
});

test("Database: an explicitly-supplied forecast is NOT overwritten by the planned-date default", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id, {
      planned_start: "2026-01-01", planned_finish: "2026-01-15",
      forecast_start: "2026-01-03", forecast_finish: "2026-01-20",
    });
    const { rows } = await ownerA.query("select forecast_start, forecast_finish from public.programme_activities where id = $1", [a.id]);
    assert.equal(rows[0].forecast_start.toISOString().slice(0, 10), "2026-01-03");
    assert.equal(rows[0].forecast_finish.toISOString().slice(0, 10), "2026-01-20");
  } finally {
    await ownerA.end();
  }
});

test("Database: status='complete' forces percent_complete to 100 and stamps actual_finish once", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id, { percent_complete: 10 });
    const { rows } = await ownerA.query("update public.programme_activities set status = 'complete' where id = $1 returning *", [a.id]);
    assert.equal(Number(rows[0].percent_complete), 100);
    assert.ok(rows[0].actual_finish, "actual_finish must be auto-stamped");
  } finally {
    await ownerA.end();
  }
});

test("Database: reopening a complete activity (status moves away from complete) preserves the recorded actual_finish", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id, { status: "complete" });
    const before = (await ownerA.query("select actual_finish from public.programme_activities where id = $1", [a.id])).rows[0];
    const after = (await ownerA.query("update public.programme_activities set status = 'in_progress' where id = $1 returning actual_finish", [a.id])).rows[0];
    assert.deepEqual(after.actual_finish, before.actual_finish, "actual_finish must survive reopening — it stays a true historical record");
  } finally {
    await ownerA.end();
  }
});

test("Database: status='not_started' forces percent_complete to 0", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id, { status: "in_progress", percent_complete: 60 });
    const { rows } = await ownerA.query("update public.programme_activities set status = 'not_started' where id = $1 returning percent_complete", [a.id]);
    assert.equal(Number(rows[0].percent_complete), 0);
  } finally {
    await ownerA.end();
  }
});

test("Database: percent_complete is rejected outside 0-100 on a status the trigger doesn't coerce (in_progress)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    await assert.rejects(
      createAct(ownerA, p.id, { status: "in_progress", percent_complete: 150 }),
      /violates check constraint/
    );
    await assert.rejects(
      createAct(ownerA, p.id, { status: "in_progress", percent_complete: -5 }),
      /violates check constraint/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: planned_finish before planned_start is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    await assert.rejects(
      createAct(ownerA, p.id, { planned_start: "2026-02-01", planned_finish: "2026-01-01" }),
      /violates check constraint/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: forecast_finish before forecast_start is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    await assert.rejects(
      createAct(ownerA, p.id, { forecast_start: "2026-02-01", forecast_finish: "2026-01-01" }),
      /violates check constraint/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: actual_finish before actual_start is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    await assert.rejects(
      createAct(ownerA, p.id, { actual_start: "2026-02-01", actual_finish: "2026-01-01" }),
      /violates check constraint/
    );
  } finally {
    await ownerA.end();
  }
});

test("Database: a not_started activity CAN carry an actual_finish (soft rule — not blocked, e.g. correcting real-world data ahead of formally marking complete)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id, { status: "not_started", actual_finish: "2026-01-05" });
    assert.deepEqual(a.actual_finish.toISOString().slice(0, 10), "2026-01-05");
  } finally {
    await ownerA.end();
  }
});

test("Database: external_id must be unique WITHIN a programme, but the same external_id is allowed across different programmes", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p1 = await createProg(ownerA, fx.projA1, { name: "P1" });
    const p2 = await createProg(ownerA, fx.projA1, { name: "P2" });
    await createAct(ownerA, p1.id, { external_id: "EXT-01" });
    await assert.rejects(
      createAct(ownerA, p1.id, { external_id: "EXT-01", title: "Different title" }),
      /duplicate key value violates unique constraint/
    );
    // Same external_id, different programme -> fine.
    const a2 = await createAct(ownerA, p2.id, { external_id: "EXT-01" });
    assert.equal(a2.external_id, "EXT-01");
  } finally {
    await ownerA.end();
  }
});

test("Database: multiple activities with external_id = null are allowed (the unique index is a PARTIAL index)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a1 = await createAct(ownerA, p.id, { title: "No external id 1" });
    const a2 = await createAct(ownerA, p.id, { title: "No external id 2" });
    assert.equal(a1.external_id, null);
    assert.equal(a2.external_id, null);
  } finally {
    await ownerA.end();
  }
});

test("Database: created_by/created_at/project_id are immutable on programme_activities", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id);
    await ownerA.query(
      "update public.programme_activities set title = 'renamed', created_by = $1, project_id = $2 where id = $3",
      [OWNER_B, fx.projB, a.id]
    );
    const { rows } = await ownerA.query("select created_by, project_id, title from public.programme_activities where id = $1", [a.id]);
    assert.equal(rows[0].created_by, OWNER_A);
    assert.equal(rows[0].project_id, fx.projA1, "project_id must not be hijackable via client update");
    assert.equal(rows[0].title, "renamed");
  } finally {
    await ownerA.end();
  }
});

test("Database: an editor can DELETE an activity (unlike documents, activities have no protected revision history)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id);
    const del = await ownerA.query("delete from public.programme_activities where id = $1", [a.id]);
    assert.equal(del.rowCount, 1);
  } finally {
    await ownerA.end();
  }
});

// ─── RLS ──────────────────────────────────────────────────────────

test("RLS: an owner and a collaborator can both create programmes and activities", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const p = await createProg(collabA, fx.projA1, { name: "Collab Programme" });
    const a = await createAct(collabA, p.id);
    assert.ok(p.id && a.id);
  } finally {
    await collabA.end();
  }
});

test("RLS: a snagging-only member CANNOT read programmes or activities — editor-only throughout, unlike Documents", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA, fx.projA1);
  const a = await createAct(ownerA, p.id);
  await ownerA.end();

  const snagA = await userClient(DB, SNAG_A);
  try {
    const progRead = await snagA.query("select * from public.programmes where id = $1", [p.id]);
    assert.equal(progRead.rowCount, 0, "snagging-only member must see zero programme rows");
    const actRead = await snagA.query("select * from public.programme_activities where id = $1", [a.id]);
    assert.equal(actRead.rowCount, 0, "snagging-only member must see zero activity rows, even one they're assigned to");
  } finally {
    await snagA.end();
  }
});

test("RLS: a snagging-only member CANNOT create, update, or delete a programme or activity", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA, fx.projA1);
  const a = await createAct(ownerA, p.id);
  await ownerA.end();

  const snagA = await userClient(DB, SNAG_A);
  try {
    await assert.rejects(() => createProg(snagA, fx.projA1), (e) => isRlsError(e));
    await assert.rejects(() => createAct(snagA, p.id), (e) => isRlsError(e));
    const upd = await snagA.query("update public.programme_activities set status = 'complete' where id = $1", [a.id]);
    assert.equal(upd.rowCount, 0);
    const del = await snagA.query("delete from public.programme_activities where id = $1", [a.id]);
    assert.equal(del.rowCount, 0);
  } finally {
    await snagA.end();
  }
});

test("RLS: a stranger with no project membership sees zero rows and cannot write", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA, fx.projA1);
  await ownerA.end();

  const stranger = await userClient(DB, STRANGER);
  try {
    const { rows } = await stranger.query("select * from public.programmes where id = $1", [p.id]);
    assert.equal(rows.length, 0);
    await assert.rejects(() => createProg(stranger, fx.projA1), (e) => isRlsError(e));
    await assert.rejects(() => createAct(stranger, p.id), (e) => isRlsError(e));
  } finally {
    await stranger.end();
  }
});

test("RLS: Organisation B cannot read, create in, or attach an activity to Organisation A's programme — adversarial cross-org check", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA, fx.projA1);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rows } = await ownerB.query("select * from public.programmes where id = $1", [p.id]);
    assert.equal(rows.length, 0);

    await assert.rejects(() => createProg(ownerB, fx.projA1), (e) => isRlsError(e));
    await assert.rejects(() => createAct(ownerB, p.id), (e) => isRlsError(e));

    // A spoofed project_id claiming to be Org B's own project, attached
    // to Org A's real programme_id, must still fail — project_id is
    // derived from the real parent programme, never trusted from the
    // client, so this can't be used to smuggle an activity in.
    await assert.rejects(
      () => createAct(ownerB, p.id, { project_id: fx.projB }),
      (e) => isRlsError(e),
      "a spoofed project_id must not let Org B attach an activity to Org A's programme"
    );
  } finally {
    await ownerB.end();
  }
});

test("RLS: no client can UPDATE or DELETE another organisation's programme, even with a guessed id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA, fx.projA1);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const upd = await ownerB.query("update public.programmes set status = 'active' where id = $1", [p.id]);
    assert.equal(upd.rowCount, 0);
    const del = await ownerB.query("delete from public.programmes where id = $1", [p.id]);
    assert.equal(del.rowCount, 0, "there is no delete policy for anyone, but this also proves cross-org can't reach the row at all");
  } finally {
    await ownerB.end();
  }
});

test("RLS: there is no delete policy for programmes at all — even the owning editor cannot delete one (archive-only)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const del = await ownerA.query("delete from public.programmes where id = $1", [p.id]);
    assert.equal(del.rowCount, 0, "programmes are retired via status='archived', never deleted");
  } finally {
    await ownerA.end();
  }
});

// ─── Audit ────────────────────────────────────────────────────────

test("Audit: creating a programme and an activity, then updating/deleting the activity, produces the expected audit_log rows", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1);
    const a = await createAct(ownerA, p.id);
    await ownerA.query("update public.programme_activities set status = 'complete' where id = $1", [a.id]);
    await ownerA.query("delete from public.programme_activities where id = $1", [a.id]);

    const { rows: progAudit } = await ownerA.query(
      "select action from public.audit_log where table_name = 'programmes' and record_id = $1",
      [p.id]
    );
    assert.equal(progAudit.length, 1);
    assert.equal(progAudit[0].action, "INSERT");

    const { rows: actAudit } = await ownerA.query(
      "select action from public.audit_log where table_name = 'programme_activities' and record_id = $1 order by created_at",
      [a.id]
    );
    assert.deepEqual(actAudit.map((r) => r.action), ["INSERT", "UPDATE", "DELETE"]);
  } finally {
    await ownerA.end();
  }
});

test("Audit: a snagging-only member CANNOT read programme/activity audit rows — matches their own editor-only SELECT RLS (unlike Documents' member-level audit exception)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA, fx.projA1);
  await ownerA.end();

  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rows } = await snagA.query(
      "select * from public.audit_log where table_name = 'programmes' and record_id = $1",
      [p.id]
    );
    assert.equal(rows.length, 0);
  } finally {
    await snagA.end();
  }
});

test("Audit: a client cannot forge the audit actor — user_id is always the real authenticated caller", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const p = await createProg(collabA, fx.projA1);
    const { rows } = await collabA.query(
      "select user_id from public.audit_log where table_name = 'programmes' and record_id = $1 and action = 'INSERT'",
      [p.id]
    );
    assert.equal(rows[0].user_id, COLLAB_A);
  } finally {
    await collabA.end();
  }
});
