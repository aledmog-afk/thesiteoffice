// Weekly Reporting (Priority 9) — real database, real non-superuser
// `authenticated` role, the actual RLS/trigger boundary (see
// org_isolation.test.mjs's header comment for why this matters).
//
// weekly_reports itself is NOT new — its rich human-entered content
// (progress, weather, labour, risks, commercial items, photos) already
// existed and is untouched. What's new (v33) is a status lifecycle
// (draft -> reviewed -> approved -> issued, with Revise as the one
// deliberate reopening path) enforced by weekly_reports_before_write(),
// content-locking once approved/issued, and inspection_findings.resolved_at
// (mirroring actions.completed_at). RLS itself is unchanged — editor-only,
// same as it always was.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_weekly_reports";

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

async function createReport(client, projectId = fx.projA1, extra = {}) {
  const fields = { project_id: projectId, week_starting: "2026-09-07", week_ending: "2026-09-11", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(
    `insert into public.weekly_reports (${cols.join(",")}) values (${placeholders}) returning *`,
    params
  );
  return rows[0];
}

// ─── Lifecycle ──────────────────────────────────────────────────────

test("lifecycle: a report always starts as draft, even if the client tries to insert a different status", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { status: "issued" });
    assert.equal(r.status, "draft", "status must be forced to draft on insert regardless of what the client sends");
  } finally {
    await ownerA.end();
  }
});

test("lifecycle: draft -> reviewed -> approved -> issued succeeds one step at a time", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    const issued = await ownerA.query("update public.weekly_reports set status = 'issued' where id = $1 returning status", [r.id]);
    assert.equal(issued.rows[0].status, "issued");
  } finally {
    await ownerA.end();
  }
});

test("lifecycle: skipping a stage (draft -> approved directly) is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await assert.rejects(
      ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]),
      /Invalid weekly report status transition/
    );
  } finally {
    await ownerA.end();
  }
});

test("lifecycle: Revise (any locked status back to draft) is always allowed", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    const revised = await ownerA.query("update public.weekly_reports set status = 'draft' where id = $1 returning status", [r.id]);
    assert.equal(revised.rows[0].status, "draft");
  } finally {
    await ownerA.end();
  }
});

test("lifecycle: a backward jump that isn't Revise (issued -> reviewed) is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'issued' where id = $1", [r.id]);
    await assert.rejects(
      ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]),
      /Invalid weekly report status transition/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Content locking ────────────────────────────────────────────────

test("locking: content cannot be edited while a report is approved", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
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

test("locking: content cannot be edited while a report is issued", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'issued' where id = $1", [r.id]);
    await assert.rejects(
      ownerA.query("update public.weekly_reports set other_comments = 'sneaky edit' where id = $1", [r.id]),
      /its content is locked/
    );
  } finally {
    await ownerA.end();
  }
});

test("locking: attempting to approve WHILE also sneaking in a content edit in the same statement is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await assert.rejects(
      ownerA.query("update public.weekly_reports set status = 'approved', programme_comments = 'smuggled in' where id = $1", [r.id]),
      /its content is locked/,
      "the transition into a locked status must itself be a pure status change, not a vehicle for a bundled edit"
    );
  } finally {
    await ownerA.end();
  }
});

test("locking: content is freely editable again after Revise", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'draft' where id = $1", [r.id]);
    const edited = await ownerA.query("update public.weekly_reports set programme_comments = 'now editable again' where id = $1 returning programme_comments", [r.id]);
    assert.equal(edited.rows[0].programme_comments, "now editable again");
  } finally {
    await ownerA.end();
  }
});

test("locking: system_position itself cannot change while locked, even though it's just another content field", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA, fx.projA1, { system_position: { exceptions: { status: { level: "on_track" } } } });
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await assert.rejects(
      ownerA.query("update public.weekly_reports set system_position = $2 where id = $1", [r.id, JSON.stringify({ exceptions: { status: { level: "attention" } } })]),
      /its content is locked/
    );
  } finally {
    await ownerA.end();
  }
});

test("locking: updated_at itself is exempt from the locked-content check (every write legitimately touches it)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    const approved = await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1 returning updated_at", [r.id]);
    assert.ok(approved.rows[0].updated_at, "a pure status transition into a locked state must still succeed and touch updated_at");
  } finally {
    await ownerA.end();
  }
});

// ─── Access control (unchanged RLS) ─────────────────────────────────

test("access: a snagging-only member cannot read, create, or transition weekly reports (unchanged editor-only RLS)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const r = await createReport(ownerA);

    const read = await snagA.query("select 1 from public.weekly_reports where id = $1", [r.id]);
    assert.equal(read.rows.length, 0, "snagging-only must not be able to read a weekly report");

    await assert.rejects(createReport(snagA), isRlsError, "snagging-only must not be able to create a weekly report");

    const update = await snagA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    assert.equal(update.rowCount, 0, "an inaccessible row must be affected by zero rows, not silently succeed");
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("access: a collaborator (editor) CAN create and transition reports, same as the owner", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const r = await createReport(collabA);
    const reviewed = await collabA.query("update public.weekly_reports set status = 'reviewed' where id = $1 returning status", [r.id]);
    assert.equal(reviewed.rows[0].status, "reviewed");
  } finally {
    await collabA.end();
  }
});

test("cross-org: a stranger cannot read, create, or transition Org A's weekly reports", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    const r = await createReport(ownerA);
    const read = await stranger.query("select 1 from public.weekly_reports where id = $1", [r.id]);
    assert.equal(read.rows.length, 0);
    await assert.rejects(createReport(stranger), isRlsError);
    const update = await stranger.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    assert.equal(update.rowCount, 0);
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

test("cross-project: a member of A1 only cannot see A2's weekly reports, even within the same org", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const collabA = await userClient(DB, COLLAB_A);
  try {
    await createReport(ownerA, fx.projA2);
    const { rows } = await collabA.query("select 1 from public.weekly_reports where project_id = $1", [fx.projA2]);
    assert.equal(rows.length, 0, "a member of A1 only must not see A2's weekly reports");
  } finally {
    await ownerA.end();
    await collabA.end();
  }
});

test("cross-project: the underlying position data (actions/snags/findings) cannot leak across projects through report aggregation", async () => {
  // Even though getWeeklyReportPosition() issues broad, unfiltered-by-
  // caller-identity (but .eq("project_id", projectId)) queries, RLS is
  // still the real boundary underneath every one of them — prove a
  // stranger's identical query against Org A's project returns nothing.
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    await ownerA.query("insert into public.actions (project_id, title) values ($1,'A1 action')", [fx.projA1]);
    const { rows } = await stranger.query("select 1 from public.actions where project_id = $1", [fx.projA1]);
    assert.equal(rows.length, 0, "a stranger's position query against Org A's project must return zero rows, not an error masking real data");
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

// ─── Audit trail (reused, not reinvented) ───────────────────────────

test("audit: weekly_reports lifecycle transitions are already captured by the existing generic audit trigger", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);

    const audit = await ownerA.query(
      "select action, old_data->>'status' as old_status, new_data->>'status' as new_status from public.audit_log where table_name = 'weekly_reports' and record_id = $1 order by created_at",
      [r.id]
    );
    assert.equal(audit.rows.length, 3, "insert + reviewed + approved = 3 audited writes");
    assert.equal(audit.rows[0].action, "INSERT");
    assert.equal(audit.rows[1].new_status, "reviewed");
    assert.equal(audit.rows[2].new_status, "approved");
  } finally {
    await ownerA.end();
  }
});

test("audit: a rejected locked-content edit fabricates no audit row", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const r = await createReport(ownerA);
    await ownerA.query("update public.weekly_reports set status = 'reviewed' where id = $1", [r.id]);
    await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1", [r.id]);
    await assert.rejects(ownerA.query("update public.weekly_reports set programme_comments = 'nope' where id = $1", [r.id]));
    const audit = await ownerA.query(
      "select 1 from public.audit_log where table_name = 'weekly_reports' and record_id = $1 and action = 'UPDATE' and new_data->>'programme_comments' = 'nope'",
      [r.id]
    );
    assert.equal(audit.rows.length, 0, "a write rejected server-side must never leave an audit trail behind, as if it had happened");
  } finally {
    await ownerA.end();
  }
});

test("audit: a snagging-only member cannot read Org A's weekly_reports audit history (editor-level bucket, matching the table's own RLS)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const r = await createReport(ownerA);
    const { rows } = await snagA.query("select 1 from public.audit_log where table_name = 'weekly_reports' and record_id = $1", [r.id]);
    assert.equal(rows.length, 0);
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

// ─── inspection_findings.resolved_at ────────────────────────────────

test("resolved_at: set on transition into 'resolved', cleared on transition out (mirrors actions.completed_at)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const insp = (await ownerA.query("insert into public.inspections (project_id, title) values ($1,'Walk-round') returning id", [fx.projA1])).rows[0].id;
    const finding = (await ownerA.query(
      "insert into public.inspection_findings (project_id, inspection_id, title) values ($1,$2,'Crack') returning id, resolved_at",
      [fx.projA1, insp]
    )).rows[0];
    assert.equal(finding.resolved_at, null, "a freshly created finding must not have a resolved_at");

    const resolved = await ownerA.query("update public.inspection_findings set status = 'resolved' where id = $1 returning resolved_at", [finding.id]);
    assert.ok(resolved.rows[0].resolved_at, "resolving a finding must set resolved_at");

    const reopened = await ownerA.query("update public.inspection_findings set status = 'open' where id = $1 returning resolved_at", [finding.id]);
    assert.equal(reopened.rows[0].resolved_at, null, "reopening a finding must clear resolved_at");
  } finally {
    await ownerA.end();
  }
});

test("resolved_at: a finding inserted directly as 'resolved' still gets a real resolved_at, never client-suppliable", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const insp = (await ownerA.query("insert into public.inspections (project_id, title) values ($1,'Walk-round') returning id", [fx.projA1])).rows[0].id;
    const finding = await ownerA.query(
      "insert into public.inspection_findings (project_id, inspection_id, title, status, resolved_at) values ($1,$2,'Crack','resolved','2020-01-01') returning resolved_at",
      [fx.projA1, insp]
    );
    const resolvedAt = new Date(finding.rows[0].resolved_at);
    assert.notEqual(resolvedAt.getFullYear(), 2020, "a client-supplied resolved_at must be overridden by the real server time");
  } finally {
    await ownerA.end();
  }
});
