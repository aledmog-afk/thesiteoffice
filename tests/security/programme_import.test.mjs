// Controlled XLSX Programme Import (Priority 11, Phase 3) — the
// transactional import_programme_activities() RPC (sql/schema.sql,
// v36 ADDITIONS), against a real database and the real non-superuser
// `authenticated` role (see org_isolation.test.mjs's header comment
// for why this matters, and programme.test.mjs for the Phase 2
// foundation this builds on, left completely unmodified).
//
// This is the ONLY code path that actually writes an import's rows —
// everything in app.js (buildImportReconciliation etc., covered in
// tests/frontend/programme_import_workflow.test.mjs) is a client-side
// PREVIEW; the real authority, and the real security boundary, is
// here. Covers: create/update/unchanged reconciliation at the
// database level, that an import can NEVER touch a forecast/actual/
// status/percent_complete/assigned_to field even when it updates a
// matched row (the brief's central data-ownership guarantee, proven
// structurally — not merely by convention), that an activity absent
// from the payload is left completely untouched (never deleted), the
// external_id/fallback matching rules re-enforced server-side,
// row-level rejection vs. whole-batch rollback (section 12's
// "anticipated problem" vs. "genuinely unexpected failure"
// distinction), and the full RLS/authorization adversarial suite
// (editor-only, cross-org, cross-project IDOR, forged programme_id).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_programme_import";

const OWNER_A = "a1000000-0000-0000-0000-000000000011";
const COLLAB_A = "a2000000-0000-0000-0000-000000000012";
const SNAG_A = "a3000000-0000-0000-0000-000000000013";
const OWNER_B = "b1000000-0000-0000-0000-000000000011";
const STRANGER = "c1000000-0000-0000-0000-000000000011";

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
  const plotA1 = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1, 'Plot 4') returning id", [projA1])).rows[0].id;
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

  fx = { orgA, projA1, plotA1, orgB, projB, plotB };
});

after(async () => {
  await dropTestDatabase(DB);
});

// Status is deliberately left at its default ('draft') here — the RPC
// itself has no status gate (proven below), and using 'draft'
// throughout means many tests can each create their own fresh
// programme for the same project without tripping the Phase 2
// one-ACTIVE-programme-per-project constraint.
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

async function importRows(client, programmeId, rows) {
  const { rows: r } = await client.query(
    "select public.import_programme_activities($1, $2::jsonb) as result",
    [programmeId, JSON.stringify(rows)]
  );
  return r[0].result;
}

function row(i, fields) {
  return { client_row_index: i, title: null, external_id: null, planned_start: null, planned_finish: null, is_milestone: false, plot_id: null, ...fields };
}

// ─── Create / update / unchanged reconciliation ──────────────────

test("Database: import_programme_activities creates new activities for rows with no existing match", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const result = await importRows(ownerA, p.id, [
      row(0, { external_id: "A-1", title: "Groundworks", planned_start: "2026-01-01", planned_finish: "2026-01-15" }),
      row(1, { external_id: "A-2", title: "Frame", planned_start: "2026-01-16", planned_finish: "2026-02-01" }),
    ]);
    assert.equal(result.created, 2);
    assert.equal(result.updated, 0);
    assert.equal(result.unchanged, 0);
    assert.equal(result.rejected.length, 0);
    assert.equal(result.created_ids.length, 2);

    const { rows: acts } = await ownerA.query("select * from public.programme_activities where programme_id = $1 order by external_id", [p.id]);
    assert.equal(acts.length, 2);
    assert.equal(acts[0].title, "Groundworks");
    assert.equal(acts[0].planned_start.toISOString().slice(0, 10), "2026-01-01");
  } finally {
    await ownerA.end();
  }
});

test("Database: a matching external_id with a changed title is updated; app-owned fields (forecast/actual/status/percent/assigned_to) are UNTOUCHED", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const a = await createAct(ownerA, p.id, {
      external_id: "A-1", title: "Old title", planned_start: "2026-01-01", planned_finish: "2026-01-15",
      forecast_start: "2026-01-05", forecast_finish: "2026-01-20",
      status: "in_progress", percent_complete: 40, assigned_to: SNAG_A,
    });
    await ownerA.query("update public.programme_activities set actual_start = '2026-01-06' where id = $1", [a.id]);

    const result = await importRows(ownerA, p.id, [
      row(0, { external_id: "A-1", title: "New title (from re-import)", planned_start: "2026-01-01", planned_finish: "2026-01-15" }),
    ]);
    assert.equal(result.updated, 1);
    assert.equal(result.created, 0);
    assert.deepEqual(result.updated_ids, [a.id]);

    const { rows: after } = await ownerA.query("select * from public.programme_activities where id = $1", [a.id]);
    const updated = after[0];
    assert.equal(updated.title, "New title (from re-import)", "the import-owned field WAS updated");
    assert.equal(updated.forecast_start.toISOString().slice(0, 10), "2026-01-05", "forecast_start must survive a re-import untouched");
    assert.equal(updated.forecast_finish.toISOString().slice(0, 10), "2026-01-20", "forecast_finish must survive a re-import untouched");
    assert.equal(updated.actual_start.toISOString().slice(0, 10), "2026-01-06", "actual_start must survive a re-import untouched");
    assert.equal(updated.status, "in_progress", "status must survive a re-import untouched");
    assert.equal(Number(updated.percent_complete), 40, "percent_complete must survive a re-import untouched");
    assert.equal(updated.assigned_to, SNAG_A, "assigned_to must survive a re-import untouched");
  } finally {
    await ownerA.end();
  }
});

test("Database: a row identical to the existing activity is 'unchanged' — no write happens at all (no audit UPDATE row)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const a = await createAct(ownerA, p.id, { external_id: "A-1", title: "Groundworks", planned_start: "2026-01-01", planned_finish: "2026-01-15" });

    const result = await importRows(ownerA, p.id, [
      row(0, { external_id: "A-1", title: "Groundworks", planned_start: "2026-01-01", planned_finish: "2026-01-15" }),
    ]);
    assert.equal(result.unchanged, 1);
    assert.equal(result.updated, 0);
    assert.equal(result.created, 0);

    const { rows: audit } = await ownerA.query(
      "select action from public.audit_log where table_name = 'programme_activities' and record_id = $1 order by created_at",
      [a.id]
    );
    assert.deepEqual(audit.map((r) => r.action), ["INSERT"], "an unchanged row must produce no UPDATE audit entry — nothing was actually written");
  } finally {
    await ownerA.end();
  }
});

test("Database: an existing activity absent from the import payload is left completely untouched (never deleted, never modified)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const untouched = await createAct(ownerA, p.id, { external_id: "A-999", title: "Not in this import" });

    const result = await importRows(ownerA, p.id, [row(0, { external_id: "A-1", title: "Something else" })]);
    assert.equal(result.created, 1);

    const { rows: after } = await ownerA.query("select * from public.programme_activities where id = $1", [untouched.id]);
    assert.equal(after.length, 1, "the row must still exist — never deleted");
    assert.equal(after[0].title, "Not in this import", "the row's fields must be byte-identical to before");
    assert.deepEqual(after[0].updated_at, untouched.updated_at, "updated_at must not even be touched — the row was never referenced by the write");
  } finally {
    await ownerA.end();
  }
});

test("Database: external_id matching is scoped to THIS programme — a different programme's identical external_id is untouched", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p1 = await createProg(ownerA, fx.projA1, { name: "Programme 1" });
    const p2 = await createProg(ownerA, fx.projA1, { name: "Programme 2", status: "draft" });
    const otherProgActivity = await createAct(ownerA, p2.id, { external_id: "A-1", title: "Programme 2's own A-1" });

    await importRows(ownerA, p1.id, [row(0, { external_id: "A-1", title: "Programme 1's A-1" })]);

    const { rows: p2Row } = await ownerA.query("select title from public.programme_activities where id = $1", [otherProgActivity.id]);
    assert.equal(p2Row[0].title, "Programme 2's own A-1", "importing into programme 1 must never touch programme 2's row, even with the identical external_id");
  } finally {
    await ownerA.end();
  }
});

test("Database: fallback (plot_id, title) matching updates the right row when no external_id is supplied", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const a = await createAct(ownerA, p.id, { title: "1st Fix - Electrical", plot_id: fx.plotA1, planned_start: "2026-01-01" });

    const result = await importRows(ownerA, p.id, [
      row(0, { title: "1st Fix - Electrical", plot_id: fx.plotA1, planned_start: "2026-01-05" }),
    ]);
    assert.equal(result.updated, 1);
    assert.deepEqual(result.updated_ids, [a.id]);
  } finally {
    await ownerA.end();
  }
});

// ─── Row-level rejection (anticipated problems) ──────────────────

test("Database: a duplicate external_id WITHIN the payload rejects every row that shares it, server-side", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const result = await importRows(ownerA, p.id, [
      row(0, { external_id: "DUP", title: "First" }),
      row(1, { external_id: "DUP", title: "Second" }),
    ]);
    assert.equal(result.created, 0);
    assert.equal(result.rejected.length, 2);
    assert.ok(result.rejected.every((r) => /Duplicate external_id/.test(r.reason)));

    const { rows: acts } = await ownerA.query("select count(*)::int as n from public.programme_activities where programme_id = $1", [p.id]);
    assert.equal(acts[0].n, 0, "neither duplicate row should have been written");
  } finally {
    await ownerA.end();
  }
});

test("Database: an ambiguous (plot,title) fallback match — two existing candidates, no external_id — is rejected, never guessed", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const a1 = await createAct(ownerA, p.id, { title: "1st Fix - Electrical", plot_id: fx.plotA1 });
    const a2 = await createAct(ownerA, p.id, { title: "1st Fix - Electrical", plot_id: fx.plotA1 });

    const result = await importRows(ownerA, p.id, [row(0, { title: "1st Fix - Electrical", plot_id: fx.plotA1, planned_start: "2026-03-01" })]);
    assert.equal(result.updated, 0);
    assert.equal(result.created, 0);
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /Ambiguous match/);

    const { rows: after } = await ownerA.query("select planned_start from public.programme_activities where id in ($1,$2)", [a1.id, a2.id]);
    assert.ok(after.every((r) => r.planned_start === null), "neither ambiguous candidate must be silently picked and modified");
  } finally {
    await ownerA.end();
  }
});

test("Database: a cross-project plot_id (IDOR) is rejected as a row-level problem — the rest of the batch still commits", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const result = await importRows(ownerA, p.id, [
      row(0, { external_id: "A-1", title: "Good row" }),
      row(1, { external_id: "A-2", title: "Bad row", plot_id: fx.plotB }),
    ]);
    assert.equal(result.created, 1, "the good row must still commit");
    assert.equal(result.rejected.length, 1);
    assert.match(result.rejected[0].reason, /plot_id does not belong to this project/);
  } finally {
    await ownerA.end();
  }
});

test("Database: a missing title is rejected as a row-level problem, not fatal for the whole batch", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const result = await importRows(ownerA, p.id, [
      row(0, { external_id: "A-1", title: "Good row" }),
      row(1, { external_id: "A-2", title: "" }),
      row(2, { external_id: "A-3", title: null }),
    ]);
    assert.equal(result.created, 1);
    assert.equal(result.rejected.length, 2);
    assert.ok(result.rejected.every((r) => /Title is required/.test(r.reason)));
  } finally {
    await ownerA.end();
  }
});

// ─── Transaction safety (anticipated vs. genuinely unexpected) ───

test("Database: a genuinely UNEXPECTED failure (an unparseable date) rolls back the ENTIRE batch — even rows that would otherwise have succeeded", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const payload = [
      { client_row_index: 0, title: "Would succeed 1", external_id: "OK-1", planned_start: null, planned_finish: null, is_milestone: false, plot_id: null },
      { client_row_index: 1, title: "Would succeed 2", external_id: "OK-2", planned_start: null, planned_finish: null, is_milestone: false, plot_id: null },
      { client_row_index: 2, title: "Poison row", external_id: "OK-3", planned_start: "not-a-real-date", planned_finish: null, is_milestone: false, plot_id: null },
    ];
    await assert.rejects(importRows(ownerA, p.id, payload), /invalid input syntax for type date/);

    const { rows: acts } = await ownerA.query("select count(*)::int as n from public.programme_activities where programme_id = $1", [p.id]);
    assert.equal(acts[0].n, 0, "an uncaught exception must roll back the WHOLE function call — nothing partially committed");
  } finally {
    await ownerA.end();
  }
});

test("Database: an anticipated per-row rejection (missing title) does NOT roll back rows that already succeeded earlier in the SAME batch", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const result = await importRows(ownerA, p.id, [
      row(0, { external_id: "A-1", title: "First, valid" }),
      row(1, { external_id: "A-2", title: "" }), // rejected, but not fatal
      row(2, { external_id: "A-3", title: "Third, valid" }),
    ]);
    assert.equal(result.created, 2);
    assert.equal(result.rejected.length, 1);

    const { rows: acts } = await ownerA.query("select external_id from public.programme_activities where programme_id = $1 order by external_id", [p.id]);
    assert.deepEqual(acts.map((a) => a.external_id), ["A-1", "A-3"]);
  } finally {
    await ownerA.end();
  }
});

// ─── p_rows contract / hard cap ────────────────────────────────────

test("Database: a non-array p_rows payload is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    await assert.rejects(importRows(ownerA, p.id, { not: "an array" }), /p_rows must be a JSON array/);
  } finally {
    await ownerA.end();
  }
});

test("Database: a batch over the 5,000-row cap is rejected outright, before any row is processed", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const bigPayload = Array.from({ length: 5001 }, (_, i) => row(i, { external_id: `BIG-${i}`, title: `Row ${i}` }));
    await assert.rejects(importRows(ownerA, p.id, bigPayload), /limited to 5000 rows/);

    const { rows: acts } = await ownerA.query("select count(*)::int as n from public.programme_activities where programme_id = $1", [p.id]);
    assert.equal(acts[0].n, 0, "nothing should be written when the cap is exceeded");
  } finally {
    await ownerA.end();
  }
});

// ─── Security / RLS / authorization ───────────────────────────────

test("RLS: a snagging-only member CANNOT call import_programme_activities — editor-only, matching the rest of Programme Control", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA);
  await ownerA.end();

  const snagA = await userClient(DB, SNAG_A);
  try {
    await assert.rejects(importRows(snagA, p.id, [row(0, { title: "X" })]), /not authorized/);
  } finally {
    await snagA.end();
  }
});

test("RLS: a stranger with no project membership CANNOT call import_programme_activities", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA);
  await ownerA.end();

  const stranger = await userClient(DB, STRANGER);
  try {
    await assert.rejects(importRows(stranger, p.id, [row(0, { title: "X" })]), /not authorized/);
  } finally {
    await stranger.end();
  }
});

test("RLS: Organisation B cannot import into Organisation A's programme, even with the REAL programme_id (adversarial cross-org)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    await assert.rejects(importRows(ownerB, p.id, [row(0, { title: "Smuggled row" })]), /not authorized/);
    const { rows: acts } = await ownerB.query("select count(*)::int as n from public.programme_activities where programme_id = $1", [p.id]);
    assert.equal(acts[0].n, 0);
  } finally {
    await ownerB.end();
  }
});

test("RLS: a collaborator (editor) in the SAME org can import — the RPC's own bypass-RLS read never becomes an authorization hole for a real member", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const p = await createProg(ownerA);
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A);
  try {
    const result = await importRows(collabA, p.id, [row(0, { external_id: "A-1", title: "Collab import" })]);
    assert.equal(result.created, 1);
  } finally {
    await collabA.end();
  }
});

test("RLS: a forged/nonexistent programme_id is rejected with 'programme not found'", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      importRows(ownerA, "11111111-1111-1111-1111-111111111111", [row(0, { title: "X" })]),
      /programme not found/
    );
  } finally {
    await ownerA.end();
  }
});

test("RLS: importing into an ARCHIVED programme still works for an editor (archiving doesn't itself change who may write; a caller wanting to block this should check status in the UI)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA, fx.projA1, { status: "archived" });
    const result = await importRows(ownerA, p.id, [row(0, { external_id: "A-1", title: "Into archived" })]);
    assert.equal(result.created, 1, "the RPC itself has no status gate — the wizard's own UI is what steers users to active/draft programmes");
  } finally {
    await ownerA.end();
  }
});

// ─── Audit ────────────────────────────────────────────────────────

test("Audit: a created-via-import activity produces a normal INSERT audit row attributed to the real importing user", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const p = await createProg(ownerA);
    const result = await importRows(ownerA, p.id, [row(0, { external_id: "A-1", title: "Audited" })]);
    const { rows: audit } = await ownerA.query(
      "select action, user_id from public.audit_log where table_name = 'programme_activities' and record_id = $1",
      [result.created_ids[0]]
    );
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, "INSERT");
    assert.equal(audit[0].user_id, OWNER_A);
  } finally {
    await ownerA.end();
  }
});
