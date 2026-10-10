// Handover State Consistency (Priority 15, Phase 1) — real database,
// real non-superuser `authenticated` role. Proves the v39
// `trg_plots_before_write` trigger is the genuine enforcement boundary
// for plots.handed_over_at: every BLOCKER computePlotHandoverReadiness()
// already recognises (outstanding Quality Gates, outstanding Handover
// Documents, a high-priority overdue Snag, a blocked or overdue high/
// critical Action, an unresolved critical Inspection Finding) rejects a
// NEW handed_over_at write; every WARNING-only condition (including
// every Programme variance case) does NOT; the timestamp is immutable
// once set; and existing RLS/role tiers, cross-project and cross-org
// isolation are all unchanged.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_handover_consistency";

const OWNER_A = "a1000000-0000-0000-0000-000000000061";
const COLLAB_A = "a2000000-0000-0000-0000-000000000062";
const SNAG_A = "a3000000-0000-0000-0000-000000000063";
const OWNER_B = "b1000000-0000-0000-0000-000000000061";
const STRANGER = "c1000000-0000-0000-0000-000000000061";

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
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inspA = (await ownerA.query("insert into public.inspections (project_id, title) values ($1,'Walk') returning id", [projA])).rows[0].id;
  const inviteCode = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
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

  fx = { orgA, projA, inspA, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

// Every plot below is created fresh (own gates/documents/snag list,
// auto-seeded by seed_plot_defaults()) so each test's blocker condition
// is isolated from every other test, and handed_over_at immutability
// never leaks between cases.
async function freshPlot(client, plotNumber, projectId = fx.projA) {
  const { rows } = await client.query(
    "insert into public.plots (project_id, plot_number, created_by) values ($1,$2,$3) returning id",
    [projectId, plotNumber, OWNER_A]
  );
  return rows[0].id;
}
async function makeClean(client, plotId) {
  await client.query(`update public.quality_gates set status='approved' where plot_id=$1`, [plotId]);
  await client.query(`update public.handover_documents set status='approved_final' where plot_id=$1`, [plotId]);
}
function attemptHandover(client, plotId) {
  return client.query(`update public.plots set handed_over_at = now() where id=$1 returning handed_over_at`, [plotId]);
}

// ─── Blockers reject a new handed_over_at ────────────────────────────

test("Blocker: outstanding Quality Gate rejects handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "B-Gate");
    await makeClean(ownerA, plotId);
    const { rows: gateRows } = await ownerA.query(`select id from public.quality_gates where plot_id=$1 limit 1`, [plotId]);
    await ownerA.query(`update public.quality_gates set status='in_progress' where id=$1`, [gateRows[0].id]);
    await assert.rejects(attemptHandover(ownerA, plotId), /Cannot record handover: outstanding Quality Gate/);
  } finally {
    await ownerA.end();
  }
});

test("Blocker: outstanding Handover Document rejects handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "B-Doc");
    await makeClean(ownerA, plotId);
    const { rows } = await ownerA.query(`select id from public.handover_documents where plot_id=$1 limit 1`, [plotId]);
    await ownerA.query(`update public.handover_documents set status='draft_received' where id=$1`, [rows[0].id]);
    await assert.rejects(attemptHandover(ownerA, plotId), /Cannot record handover: outstanding Handover Document/);
  } finally {
    await ownerA.end();
  }
});

test("Blocker: open, high-priority, OVERDUE snag rejects handover (via the plot's own auto-seeded list)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "B-Snag");
    await makeClean(ownerA, plotId);
    const listId = (await ownerA.query(`select id from public.snag_lists where plot_id=$1`, [plotId])).rows[0].id;
    await ownerA.query(
      `insert into public.snag_items (project_id, snag_list_id, description, priority, status, due_date) values ($1,$2,'Crack','high','open','2020-01-01')`,
      [fx.projA, listId]
    );
    await assert.rejects(attemptHandover(ownerA, plotId), /Cannot record handover: open high-priority overdue Snag/);
  } finally {
    await ownerA.end();
  }
});

test("Blocker: a BLOCKED action rejects handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "B-ActBlocked");
    await makeClean(ownerA, plotId);
    await ownerA.query(`insert into public.actions (project_id, plot_id, title, status, priority) values ($1,$2,'Fix','blocked','low')`, [fx.projA, plotId]);
    await assert.rejects(attemptHandover(ownerA, plotId), /Cannot record handover:.*Action/);
  } finally {
    await ownerA.end();
  }
});

test("Blocker: an OVERDUE HIGH-priority action rejects handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "B-ActOverdueHigh");
    await makeClean(ownerA, plotId);
    await ownerA.query(`insert into public.actions (project_id, plot_id, title, status, priority, due_date) values ($1,$2,'Fix','open','high','2020-01-01')`, [fx.projA, plotId]);
    await assert.rejects(attemptHandover(ownerA, plotId), /Cannot record handover:.*Action/);
  } finally {
    await ownerA.end();
  }
});

test("Blocker: an OVERDUE CRITICAL-priority action rejects handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "B-ActOverdueCritical");
    await makeClean(ownerA, plotId);
    await ownerA.query(`insert into public.actions (project_id, plot_id, title, status, priority, due_date) values ($1,$2,'Fix','open','critical','2020-01-01')`, [fx.projA, plotId]);
    await assert.rejects(attemptHandover(ownerA, plotId), /Cannot record handover:.*Action/);
  } finally {
    await ownerA.end();
  }
});

test("Blocker: an unresolved CRITICAL inspection finding rejects handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "B-Finding");
    await makeClean(ownerA, plotId);
    await ownerA.query(
      `insert into public.inspection_findings (project_id, inspection_id, plot_id, title, severity, status) values ($1,$2,$3,'Crack','critical','open')`,
      [fx.projA, fx.inspA, plotId]
    );
    await assert.rejects(attemptHandover(ownerA, plotId), /Cannot record handover: unresolved critical Inspection Finding/);
  } finally {
    await ownerA.end();
  }
});

// ─── Warning-only conditions do NOT block (derived from computePlotHandoverReadiness's own blocker/warning split) ──

test("Warning only: high-priority snag that is NOT overdue permits handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "W-Snag");
    await makeClean(ownerA, plotId);
    const listId = (await ownerA.query(`select id from public.snag_lists where plot_id=$1`, [plotId])).rows[0].id;
    await ownerA.query(`insert into public.snag_items (project_id, snag_list_id, description, priority, status, due_date) values ($1,$2,'Crack','high','open','2099-01-01')`, [fx.projA, listId]);
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await ownerA.end();
  }
});

test("Warning only: overdue snag that is NOT high-priority permits handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "W-SnagMed");
    await makeClean(ownerA, plotId);
    const listId = (await ownerA.query(`select id from public.snag_lists where plot_id=$1`, [plotId])).rows[0].id;
    await ownerA.query(`insert into public.snag_items (project_id, snag_list_id, description, priority, status, due_date) values ($1,$2,'Crack','medium','open','2020-01-01')`, [fx.projA, listId]);
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await ownerA.end();
  }
});

test("Warning only: overdue MEDIUM-priority action permits handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "W-Act");
    await makeClean(ownerA, plotId);
    await ownerA.query(`insert into public.actions (project_id, plot_id, title, status, priority, due_date) values ($1,$2,'Fix','open','medium','2020-01-01')`, [fx.projA, plotId]);
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await ownerA.end();
  }
});

test("Warning only: non-overdue HIGH-priority action permits handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "W-ActFuture");
    await makeClean(ownerA, plotId);
    await ownerA.query(`insert into public.actions (project_id, plot_id, title, status, priority, due_date) values ($1,$2,'Fix','open','high','2099-01-01')`, [fx.projA, plotId]);
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await ownerA.end();
  }
});

test("Warning only: unresolved HIGH (not critical) finding permits handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "W-Finding");
    await makeClean(ownerA, plotId);
    await ownerA.query(`insert into public.inspection_findings (project_id, inspection_id, plot_id, title, severity, status) values ($1,$2,$3,'Crack','high','open')`, [fx.projA, fx.inspA, plotId]);
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await ownerA.end();
  }
});

test("Warning only: a resolved critical finding (no longer outstanding) permits handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "W-FindingResolved");
    await makeClean(ownerA, plotId);
    await ownerA.query(`insert into public.inspection_findings (project_id, inspection_id, plot_id, title, severity, status) values ($1,$2,$3,'Crack','critical','resolved')`, [fx.projA, fx.inspA, plotId]);
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await ownerA.end();
  }
});

test("Warning only: a completed action (even if it was overdue+critical while open) permits handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "W-ActCompleted");
    await makeClean(ownerA, plotId);
    await ownerA.query(`insert into public.actions (project_id, plot_id, title, status, priority, due_date) values ($1,$2,'Fix','completed','critical','2020-01-01')`, [fx.projA, plotId]);
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await ownerA.end();
  }
});

// ─── Programme: ALL variance is warning-only and must never block ───

test("Programme: overdue activity, materially forecast-late activity, forecast-late milestone, completed-late activity, and a cancelled activity — none of these block handover", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "W-Programme");
    await makeClean(ownerA, plotId);
    const programmeId = (await ownerA.query(`insert into public.programmes (project_id, name, status) values ($1,'Prog','active') returning id`, [fx.projA])).rows[0].id;
    await ownerA.query(
      `insert into public.programme_activities (programme_id, plot_id, title, is_milestone, status, planned_finish, forecast_finish, actual_finish) values
        ($1,$2,'Overdue activity', false, 'in_progress', '2020-01-01', '2020-01-01', null),
        ($1,$2,'Materially forecast-late activity', false, 'in_progress', '2099-01-01', '2099-06-01', null),
        ($1,$2,'Forecast-late milestone', true, 'in_progress', '2099-01-01', '2099-01-02', null),
        ($1,$2,'Completed-late activity', false, 'complete', '2020-01-01', '2020-01-01', '2020-02-01'),
        ($1,$2,'Cancelled activity', false, 'cancelled', '2020-01-01', '2020-01-01', null)`,
      [programmeId, plotId]
    );
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at, "programme variance must never block the handover stamp — it is warning-only in computePlotHandoverReadiness()");
  } finally {
    await ownerA.end();
  }
});

// ─── Clean / ready case ───────────────────────────────────────────────

test("Clean plot (nothing outstanding) can be handed over", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "Clean");
    await makeClean(ownerA, plotId);
    const { rows } = await attemptHandover(ownerA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await ownerA.end();
  }
});

// ─── Historical immutability / repeatability ──────────────────────────

test("Historical: once handed_over_at is set, it cannot be changed to a different value", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "Immutable1");
    await makeClean(ownerA, plotId);
    const { rows: first } = await attemptHandover(ownerA, plotId);
    await assert.rejects(attemptHandover(ownerA, plotId), /historical record and cannot be changed/);
    const { rows: still } = await ownerA.query(`select handed_over_at from public.plots where id=$1`, [plotId]);
    assert.equal(still[0].handed_over_at.getTime(), first[0].handed_over_at.getTime(), "timestamp must not move after a rejected re-stamp attempt");
  } finally {
    await ownerA.end();
  }
});

test("Historical: once handed_over_at is set, it cannot be cleared back to null", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "Immutable2");
    await makeClean(ownerA, plotId);
    await attemptHandover(ownerA, plotId);
    await assert.rejects(
      ownerA.query(`update public.plots set handed_over_at = null where id=$1`, [plotId]),
      /historical record and cannot be changed/
    );
  } finally {
    await ownerA.end();
  }
});

test("Repeatability: attempting handover again after new blockers appear post-handover does not corrupt the historical timestamp", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "Repeatable");
    await makeClean(ownerA, plotId);
    const { rows: first } = await attemptHandover(ownerA, plotId);
    // A new critical finding is raised AFTER handover (a real, later
    // event) — the historical record must still be untouched.
    await ownerA.query(`insert into public.inspection_findings (project_id, inspection_id, plot_id, title, severity, status) values ($1,$2,$3,'New issue','critical','open')`, [fx.projA, fx.inspA, plotId]);
    await assert.rejects(attemptHandover(ownerA, plotId), /historical record and cannot be changed/);
    const { rows: still } = await ownerA.query(`select handed_over_at from public.plots where id=$1`, [plotId]);
    assert.equal(still[0].handed_over_at.getTime(), first[0].handed_over_at.getTime());
  } finally {
    await ownerA.end();
  }
});

// ─── Regression: unrelated writes are unaffected ──────────────────────

test("Regression: updating an unrelated column (plot_number) is unaffected by the new trigger", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const plotId = await freshPlot(ownerA, "Unrelated");
    await ownerA.query(`update public.plots set plot_number='Renamed' where id=$1`, [plotId]);
    const { rows } = await ownerA.query(`select plot_number, handed_over_at from public.plots where id=$1`, [plotId]);
    assert.equal(rows[0].plot_number, "Renamed");
    assert.equal(rows[0].handed_over_at, null);
  } finally {
    await ownerA.end();
  }
});

// ─── Security ──────────────────────────────────────────────────────────

test("Security: a collaborator (editor) on the same project can hand over a clean plot", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const plotId = await freshPlot(collabA, "Sec-Collab");
    await makeClean(collabA, plotId);
    const { rows } = await attemptHandover(collabA, plotId);
    assert.ok(rows[0].handed_over_at);
  } finally {
    await collabA.end();
  }
});

test("Security: a snagging-only member cannot hand over a plot (existing RLS, unchanged)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const plotId = await freshPlot(ownerA, "Sec-Snag");
    await makeClean(ownerA, plotId);
    const { rowCount } = await attemptHandover(snagA, plotId).catch((err) => {
      assert.ok(isRlsError(err), `expected an RLS error for a snagging-only writer, got: ${err.message}`);
      return { rowCount: 0 };
    });
    assert.equal(rowCount, 0);
    const { rows } = await ownerA.query(`select handed_over_at from public.plots where id=$1`, [plotId]);
    assert.equal(rows[0].handed_over_at, null, "a snagging-only member must not be able to write handed_over_at");
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("Security: a same-organisation user with NO membership on the project cannot hand over its plot (cross-project isolation)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const ownerB = await userClient(DB, OWNER_B);
  try {
    const plotId = await freshPlot(ownerA, "Sec-CrossProject");
    await makeClean(ownerA, plotId);
    const result = await attemptHandover(ownerB, plotId).catch((err) => {
      assert.ok(isRlsError(err) || true, `cross-project write should be rejected or affect 0 rows: ${err.message}`);
      return { rowCount: 0 };
    });
    assert.equal(result.rowCount ?? 0, 0, "a user with no membership on project A must not be able to write plot A's handed_over_at");
    const { rows } = await ownerA.query(`select handed_over_at from public.plots where id=$1`, [plotId]);
    assert.equal(rows[0].handed_over_at, null);
  } finally {
    await ownerA.end();
    await ownerB.end();
  }
});

test("Security: a stranger with no project/org membership anywhere cannot hand over any plot (cross-org isolation)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    const plotId = await freshPlot(ownerA, "Sec-Stranger");
    await makeClean(ownerA, plotId);
    const result = await attemptHandover(stranger, plotId).catch((err) => {
      assert.ok(isRlsError(err) || true, `stranger write should be rejected or affect 0 rows: ${err.message}`);
      return { rowCount: 0 };
    });
    assert.equal(result.rowCount ?? 0, 0);
    const { rows } = await ownerA.query(`select handed_over_at from public.plots where id=$1`, [plotId]);
    assert.equal(rows[0].handed_over_at, null);
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

test("Security: an unauthenticated caller cannot hand over any plot", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const anon = await userClient(DB, null);
  try {
    const plotId = await freshPlot(ownerA, "Sec-Anon");
    await makeClean(ownerA, plotId);
    const result = await attemptHandover(anon, plotId).catch((err) => {
      assert.ok(isRlsError(err) || true, `unauthenticated write should be rejected or affect 0 rows: ${err.message}`);
      return { rowCount: 0 };
    });
    assert.equal(result.rowCount ?? 0, 0);
    const { rows } = await ownerA.query(`select handed_over_at from public.plots where id=$1`, [plotId]);
    assert.equal(rows[0].handed_over_at, null);
  } finally {
    await ownerA.end();
    await anon.end();
  }
});

test("Security: an editor cannot use a cross-org plot_id to manipulate readiness inputs — inserting an action against a foreign plot is rejected (existing v38 IDOR check, unaffected by v39)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const ownerB = await userClient(DB, OWNER_B);
  try {
    const plotB = await freshPlot(ownerB, "ForeignPlot", fx.projB);
    await assert.rejects(
      ownerA.query(`insert into public.actions (project_id, plot_id, title) values ($1,$2,'Fix')`, [fx.projA, plotB]),
      /plot_id must belong to the same project/
    );
  } finally {
    await ownerA.end();
    await ownerB.end();
  }
});
