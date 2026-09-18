// Weekly Report Programme Integration (Priority 11, Phase 5) — real
// database, real non-superuser `authenticated` role. Two things are
// being proven here that are NOT already covered elsewhere:
//
//   1. Snapshot lifecycle: the programme signal lives inside
//      system_position (a plain jsonb column that already existed —
//      see weekly_reports.test.mjs for the generic locking proof). This
//      file proves that guarantee concretely covers a real
//      `programmeSummary` key end-to-end through the actual lifecycle
//      (draft refresh -> approved immutable -> issued immutable ->
//      revise permits a new snapshot), and that writing/refreshing the
//      signal NEVER touches the human-authored programme_status /
//      programme_comments fields, in either direction.
//
//   2. The two queries getWeeklyReportProgrammeSignal() actually issues
//      (getActiveProgramme: programmes filtered by project_id+status,
//      listProgrammeActivities: programme_activities filtered by
//      programme_id) inherit real RLS isolation — cross-project,
//      cross-org, and snagging-only — exactly as dashboard_programme's
//      unfiltered-select shape already proves for the dashboard's own
//      queries. No new tables, no new RLS policies were added for
//      Phase 5, so this is confirmation, not new plumbing.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_weekly_report_programme_signal";

const OWNER_A = "a1000000-0000-0000-0000-000000000031";
const COLLAB_A = "a2000000-0000-0000-0000-000000000032";
const SNAG_A = "a3000000-0000-0000-0000-000000000033";
const OWNER_B = "b1000000-0000-0000-0000-000000000031";
const STRANGER = "c1000000-0000-0000-0000-000000000031";

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
  await ownerA.query("insert into public.programme_activities (programme_id, title, planned_finish) values ($1,'A1 overdue activity','2020-01-01')", [progA1]);
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

  fx = { orgA, projA1, projA2, progA1, orgB, projB, progB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createReport(client, projectId = fx.projA1, extra = {}) {
  const fields = { project_id: projectId, week_starting: "2026-09-07", week_ending: "2026-09-11", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(`insert into public.weekly_reports (${cols.join(",")}) values (${placeholders}) returning *`, params);
  return rows[0];
}

function positionWithSignal(overdue) {
  return {
    exceptions: { status: { level: "on_track" } },
    programmeSummary: { hasActiveProgramme: true, programmeName: "A1 Programme", asOfDate: "2026-09-11", totalActivities: 5, overdueProgrammeActivities: overdue },
  };
}

// ─── C. Snapshot lifecycle ──────────────────────────────────────────

test("snapshot: system_position (including a programmeSummary key) is freely writable while draft", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    assert.equal(r.system_position.programmeSummary.overdueProgrammeActivities, 1);
    const refreshed = await ownerA.query(
      "update public.weekly_reports set system_position = $2 where id = $1 returning system_position",
      [r.id, JSON.stringify(positionWithSignal(3))]
    );
    assert.equal(refreshed.rows[0].system_position.programmeSummary.overdueProgrammeActivities, 3, "a draft report's signal can be refreshed as many times as needed");
  } finally {
    await ownerA.end();
  }
});

test("snapshot: still refreshable while reviewed (only approved/issued lock content)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    const refreshed = await ownerA.query(
      "update public.weekly_reports set system_position = $2 where id = $1 returning system_position",
      [r.id, JSON.stringify(positionWithSignal(2))]
    );
    assert.equal(refreshed.rows[0].system_position.programmeSummary.overdueProgrammeActivities, 2);
  } finally {
    await ownerA.end();
  }
});

test("snapshot: becomes immutable once approved — the programmeSummary snapshot is frozen, not silently refreshable", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await assert.rejects(
      ownerA.query("update public.weekly_reports set system_position = $2 where id = $1", [r.id, JSON.stringify(positionWithSignal(99))]),
      /its content is locked/,
      "an approved report's programme snapshot must never silently change, even to reflect newer real programme dates"
    );
    const { rows } = await ownerA.query("select system_position from public.weekly_reports where id = $1", [r.id]);
    assert.equal(rows[0].system_position.programmeSummary.overdueProgrammeActivities, 1, "the frozen snapshot must still read the ORIGINAL value, not the rejected one");
  } finally {
    await ownerA.end();
  }
});

test("snapshot: remains immutable once issued", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'issued' where id = $1", [r.id]);
    await assert.rejects(
      ownerA.query("update public.weekly_reports set system_position = $2 where id = $1", [r.id, JSON.stringify(positionWithSignal(99))]),
      /its content is locked/
    );
  } finally {
    await ownerA.end();
  }
});

test("snapshot: Revise (approved -> draft) permits a new snapshot to be generated for the new revision", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'draft' where id = $1", [r.id]);
    const refreshed = await ownerA.query(
      "update public.weekly_reports set system_position = $2 where id = $1 returning system_position",
      [r.id, JSON.stringify(positionWithSignal(7))]
    );
    assert.equal(refreshed.rows[0].system_position.programmeSummary.overdueProgrammeActivities, 7, "revising must allow a fresh snapshot reflecting the current programme state");
  } finally {
    await ownerA.end();
  }
});

test("snapshot: refreshing the programme signal NEVER overwrites the human programme_status/programme_comments fields", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, {
      system_position: positionWithSignal(1),
      programme_status: "behind",
      programme_comments: "Groundworks running late — human judgement.",
    });
    const refreshed = await ownerA.query(
      "update public.weekly_reports set system_position = $2 where id = $1 returning programme_status, programme_comments",
      [r.id, JSON.stringify(positionWithSignal(9))]
    );
    assert.equal(refreshed.rows[0].programme_status, "behind", "a system_position refresh must never touch the human field");
    assert.equal(refreshed.rows[0].programme_comments, "Groundworks running late — human judgement.");
  } finally {
    await ownerA.end();
  }
});

test("snapshot: editing the human programme_status/programme_comments fields NEVER touches the stored system snapshot", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(4), programme_status: "on-track" });
    const edited = await ownerA.query(
      "update public.weekly_reports set programme_status = 'behind', programme_comments = 'Updated human view' where id = $1 returning system_position",
      [r.id]
    );
    assert.equal(edited.rows[0].system_position.programmeSummary.overdueProgrammeActivities, 4, "a human-field edit must never mutate the system-generated snapshot");
  } finally {
    await ownerA.end();
  }
});

// ─── D. Security ────────────────────────────────────────────────────

test("security: getActiveProgramme's query shape (project_id + status='active') never returns another organisation's programme", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query("select id, name from public.programmes where project_id = $1 and status = 'active'", [fx.projB]);
    assert.equal(rows.length, 0, "Org A must never see Org B's active programme, even by guessing/reusing Org B's project id");
  } finally {
    await ownerA.end();
  }
});

test("security: listProgrammeActivities's query shape (programme_id only) never returns another organisation's activities, since RLS scopes the programme_id itself", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query("select id, title from public.programme_activities where programme_id = $1", [fx.progB]);
    assert.equal(rows.length, 0, "Org A must never see Org B's activities, even when supplying Org B's real programme_id directly");
  } finally {
    await ownerA.end();
  }
});

test("security: a member of A1 only cannot read A2's weekly report programme signal context (weekly_reports itself, cross-project within the same org)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const collabA = await userClient(DB, COLLAB_A);
  try {
    await createReport(ownerA, fx.projA2, { system_position: positionWithSignal(2) });
    const { rows } = await collabA.query("select 1 from public.weekly_reports where project_id = $1", [fx.projA2]);
    assert.equal(rows.length, 0, "a project A1 editor must not see project A2's weekly reports, snapshot included");
  } finally {
    await ownerA.end();
    await collabA.end();
  }
});

test("security: a snagging-only member cannot read or write a weekly report's system_position at all (editor-only, unchanged RLS)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    const read = await snagA.query("select system_position from public.weekly_reports where id = $1", [r.id]);
    assert.equal(read.rows.length, 0);
    const write = await snagA.query("update public.weekly_reports set system_position = $2 where id = $1", [r.id, JSON.stringify(positionWithSignal(999))]);
    assert.equal(write.rowCount, 0, "an inaccessible row must be affected by zero rows, never silently spoofable");
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("security: a stranger cannot read, create, or forge a system_position on Org A's weekly reports", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    const read = await stranger.query("select 1 from public.weekly_reports where id = $1", [r.id]);
    assert.equal(read.rows.length, 0);
    await assert.rejects(createReport(stranger, fx.projA1), isRlsError, "a stranger must not be able to insert a report (with a forged snapshot) into Org A's project");
    const write = await stranger.query("update public.weekly_reports set system_position = $2 where id = $1", [r.id, JSON.stringify(positionWithSignal(999))]);
    assert.equal(write.rowCount, 0);
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

test("security: an editor CAN free-write arbitrary JSON into system_position while draft — it is document content they own, not a validated server computation; the real guarantee is that it locks once approved/issued (proven above), not that its shape is enforced", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    // system_position is deliberately schema-less jsonb — the actual
    // programme numbers always come from the real, RLS-scoped
    // programme_activities query in getWeeklyReportProgrammeSignal(),
    // never from client-trusted input at the database layer. This test
    // documents that boundary rather than asserting a validation that
    // was never part of the design.
    const r = await createReport(ownerA, fx.projA1, { system_position: { programmeSummary: { overdueProgrammeActivities: 12345 } } });
    assert.equal(r.system_position.programmeSummary.overdueProgrammeActivities, 12345);
  } finally {
    await ownerA.end();
  }
});

// ─── E. Regression ──────────────────────────────────────────────────

test("regression: the pre-existing whole-row locking behaviour (any content field, not just system_position) is unaffected by Phase 5", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await assert.rejects(
      ownerA.query("update public.weekly_reports set programme_comments = 'sneaky edit' where id = $1", [r.id]),
      /its content is locked/
    );
  } finally {
    await ownerA.end();
  }
});

test("regression: audit trail still captures snapshot writes exactly like any other weekly_reports write (no special-casing introduced for system_position)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: positionWithSignal(1) });
    await ownerA.query("update public.weekly_reports set system_position = $2 where id = $1", [r.id, JSON.stringify(positionWithSignal(2))]);
    const { rows } = await ownerA.query(
      "select action from public.audit_log where table_name = 'weekly_reports' and record_id = $1 order by created_at",
      [r.id]
    );
    assert.deepEqual(rows.map((x) => x.action), ["INSERT", "UPDATE"]);
  } finally {
    await ownerA.end();
  }
});
