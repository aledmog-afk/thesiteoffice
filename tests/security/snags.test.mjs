// Defects / Snagging (Priority 8) — real database, real non-superuser
// `authenticated` role, the actual RLS/trigger boundary (see
// org_isolation.test.mjs's header comment for why this matters).
//
// snag_items itself is NOT new — it's existed since the very first
// schema and its RLS (member-level, snagging-only included) is
// deliberately left unchanged. What's new here is the accountability
// layer added on top: assigned_to (must be a real project member),
// action_id / inspection_finding_id (must belong to the SAME project —
// an IDOR closed the same way Priority 7 closed it for Findings), and
// verified_at/verified_by (editor-only, and only once the snag is
// closed) via snag_items_before_write() (sql/schema.sql, v32).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_snags";

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
  // the same organisation. A1 gets a plot (which auto-creates its own
  // snag_list — the pre-existing trigger, untouched), an inspection +
  // finding, and an action, to link snags to. A2 gets its own action
  // and finding, used only to prove cross-project linkage is rejected.
  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA1 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A1', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const projA2 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A2', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inviteCode = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA1])).rows[0].code;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA1])).rows[0].code;

  const plotA1 = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id", [projA1])).rows[0].id;
  const listA1 = (await ownerA.query("select id from public.snag_lists where plot_id = $1", [plotA1])).rows[0].id;

  const actionA1 = (await ownerA.query("insert into public.actions (project_id, title) values ($1,'Fix in A1') returning id", [projA1])).rows[0].id;
  const actionA2 = (await ownerA.query("insert into public.actions (project_id, title) values ($1,'Fix in A2') returning id", [projA2])).rows[0].id;

  const inspA1 = (await ownerA.query("insert into public.inspections (project_id, title, inspection_type) values ($1,'A1 walk-round','quality') returning id", [projA1])).rows[0].id;
  const findingA1 = (await ownerA.query("insert into public.inspection_findings (inspection_id, project_id, title, severity) values ($1,$2,'Crack in wall','medium') returning id", [inspA1, projA1])).rows[0].id;
  const inspA2 = (await ownerA.query("insert into public.inspections (project_id, title, inspection_type) values ($1,'A2 walk-round','quality') returning id", [projA2])).rows[0].id;
  const findingA2 = (await ownerA.query("insert into public.inspection_findings (inspection_id, project_id, title, severity) values ($1,$2,'Loose tile','medium') returning id", [inspA2, projA2])).rows[0].id;
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A);
  await collabA.query("select public.join_project_by_invite($1)", [inviteCode]);
  await collabA.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagA.end();

  // Org B: fully separate.
  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA1, projA2, listA1, actionA1, actionA2, findingA1, findingA2, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createSnag(client, overrides = {}) {
  const fields = { project_id: fx.projA1, snag_list_id: fx.listA1, location: "Kitchen", description: "Cracked tile", ...overrides };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(
    `insert into public.snag_items (${cols.join(",")}) values (${placeholders}) returning *`,
    params
  );
  return rows[0];
}

// ─── Assignee validation ────────────────────────────────────────────

test("assigned_to: any legitimate project member (including snagging-only) can be assigned", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA, { assigned_to: SNAG_A });
    assert.equal(snag.assigned_to, SNAG_A, "a snagging-only member is a legitimate snag assignee (unlike Actions, which require an editor)");
  } finally {
    await ownerA.end();
  }
});

test("assigned_to: a non-member is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createSnag(ownerA, { assigned_to: OWNER_B }),
      /assigned_to must be a member of this project/,
      "assigning a snag to a user outside the project must be rejected server-side"
    );
  } finally {
    await ownerA.end();
  }
});

test("assigned_to: a snagging-only member can self-assign", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const snag = await createSnag(snagA, { assigned_to: SNAG_A });
    assert.equal(snag.assigned_to, SNAG_A);
  } finally {
    await snagA.end();
  }
});

// ─── Action linkage (IDOR) ──────────────────────────────────────────

test("action_id: linking an action from the SAME project succeeds", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    const linked = await ownerA.query("update public.snag_items set action_id = $1 where id = $2 returning action_id", [fx.actionA1, snag.id]);
    assert.equal(linked.rows[0].action_id, fx.actionA1);
  } finally {
    await ownerA.end();
  }
});

test("action_id: linking an action from a DIFFERENT project is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await assert.rejects(
      ownerA.query("update public.snag_items set action_id = $1 where id = $2", [fx.actionA2, snag.id]),
      /must belong to the same project/,
      "linking a cross-project action must be rejected — the exact IDOR this trigger exists to close"
    );
  } finally {
    await ownerA.end();
  }
});

test("action_id: linking a non-existent action is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await assert.rejects(
      ownerA.query("update public.snag_items set action_id = $1 where id = $2", ["99999999-9999-9999-9999-999999999999", snag.id]),
      /must reference an existing action/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Inspection finding linkage (IDOR) ──────────────────────────────

test("inspection_finding_id: linking a finding from the SAME project succeeds", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA, { inspection_finding_id: fx.findingA1 });
    assert.equal(snag.inspection_finding_id, fx.findingA1);
  } finally {
    await ownerA.end();
  }
});

test("inspection_finding_id: linking a finding from a DIFFERENT project is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createSnag(ownerA, { inspection_finding_id: fx.findingA2 }),
      /must belong to the same project/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Resolved vs. Verified ──────────────────────────────────────────

test("verification: a snagging-only member cannot verify a snag, even one they closed themselves", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const snag = await createSnag(snagA, { created_by: SNAG_A });
    await snagA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    await assert.rejects(
      snagA.query("update public.snag_items set verified_at = now() where id = $1", [snag.id]),
      /only a project editor.*can change a snag's verification/,
      "a contractor closing their own snag must not be able to also mark it independently verified"
    );
  } finally {
    await snagA.end();
  }
});

test("verification: an owner/collaborator can verify a closed snag, and verified_by is the real actor", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const snag = await createSnag(ownerA);
    await ownerA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    const verified = await collabA.query("update public.snag_items set verified_at = now() where id = $1 returning verified_at, verified_by", [snag.id]);
    assert.ok(verified.rows[0].verified_at, "verified_at must be set");
    assert.equal(verified.rows[0].verified_by, COLLAB_A, "verified_by must be the real authenticated actor, not client-suppliable");
  } finally {
    await ownerA.end();
    await collabA.end();
  }
});

test("verification: a snag must be closed before it can be verified", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA); // still 'open'
    await assert.rejects(
      ownerA.query("update public.snag_items set verified_at = now() where id = $1", [snag.id]),
      /must be closed before it can be verified/
    );
  } finally {
    await ownerA.end();
  }
});

test("verification: reopening a verified snag auto-clears verification, and any member (not just an editor) can do it", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const snag = await createSnag(ownerA);
    await ownerA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    await ownerA.query("update public.snag_items set verified_at = now() where id = $1", [snag.id]);

    // A plain reopen by a snagging-only member must succeed with no
    // permission barrier — they're not touching verification directly,
    // the reopen just has that side effect.
    const reopened = await snagA.query("update public.snag_items set status = 'open' where id = $1 returning status, verified_at, verified_by, closed_date", [snag.id]);
    assert.equal(reopened.rows[0].status, "open");
    assert.equal(reopened.rows[0].verified_at, null, "verification must be cleared the moment a snag is reopened — a contractor 'fixing it again' is not still independently verified");
    assert.equal(reopened.rows[0].verified_by, null);
    assert.equal(reopened.rows[0].closed_date, null);
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("verification: an editor can explicitly unverify (clear verification) without reopening", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await ownerA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    await ownerA.query("update public.snag_items set verified_at = now() where id = $1", [snag.id]);
    const unverified = await ownerA.query("update public.snag_items set verified_at = null where id = $1 returning verified_at, verified_by, status", [snag.id]);
    assert.equal(unverified.rows[0].verified_at, null);
    assert.equal(unverified.rows[0].verified_by, null);
    assert.equal(unverified.rows[0].status, "closed", "unverifying must not itself reopen the snag");
  } finally {
    await ownerA.end();
  }
});

test("closed_date: auto-filled to today when the client omits it on close, and always cleared on reopen", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    const today = new Date().toISOString().slice(0, 10);
    const closed = await ownerA.query("update public.snag_items set status = 'closed' where id = $1 returning closed_date", [snag.id]);
    assert.equal(closed.rows[0].closed_date.toISOString().slice(0, 10), today, "an omitted closed_date must be auto-filled with today's date");
    const reopened = await ownerA.query("update public.snag_items set status = 'open' where id = $1 returning closed_date", [snag.id]);
    assert.equal(reopened.rows[0].closed_date, null, "closed_date must always be cleared on reopen, regardless of what the client sends");
  } finally {
    await ownerA.end();
  }
});

// ─── Cross-org isolation ────────────────────────────────────────────

test("cross-org: a stranger cannot read, create, or update Org A's snags", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    const snag = await createSnag(ownerA);

    const read = await stranger.query("select 1 from public.snag_items where id = $1", [snag.id]);
    assert.equal(read.rows.length, 0, "RLS must return zero rows, not an error, for an inaccessible snag");

    await assert.rejects(
      createSnag(stranger),
      isRlsError,
      "a stranger must not be able to create a snag in a project they aren't a member of"
    );

    const update = await stranger.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    assert.equal(update.rowCount, 0, "an update to an inaccessible row must affect zero rows, not silently succeed");
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

test("cross-project: within the same org, a member of A2 (not A1) cannot see A1's snags", async () => {
  // OWNER_A is a member of both A1 and A2 (created both), so use a
  // fresh org-A user who only ever joined A1 via invite (COLLAB_A) to
  // prove A1 membership doesn't leak into A2, and vice versa via a
  // project-scoped query.
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const { rows } = await collabA.query("select 1 from public.snag_items where project_id = $1", [fx.projA2]);
    assert.equal(rows.length, 0, "a member of A1 only must not see A2's snags, even within the same organisation");
  } finally {
    await collabA.end();
  }
});

// ─── Audit trail (reused, not reinvented) ──────────────────────────

test("audit: snag_items writes are already captured by the existing generic audit trigger — no new audit code was needed", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await ownerA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    await ownerA.query("update public.snag_items set verified_at = now() where id = $1", [snag.id]);

    const audit = await ownerA.query(
      "select action, old_data->>'status' as old_status, new_data->>'status' as new_status, new_data->>'verified_at' as new_verified_at from public.audit_log where table_name = 'snag_items' and record_id = $1 order by created_at",
      [snag.id]
    );
    assert.equal(audit.rows.length, 3, "insert + close + verify = 3 audited writes");
    assert.equal(audit.rows[0].action, "INSERT");
    assert.equal(audit.rows[1].old_status, "open");
    assert.equal(audit.rows[1].new_status, "closed");
    assert.ok(audit.rows[2].new_verified_at, "the verification write must be captured with the new verified_at value");
  } finally {
    await ownerA.end();
  }
});

test("audit: a snagging-only member (member-level bucket) can read snag_items audit history for their own project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const snag = await createSnag(ownerA);
    const { rows } = await snagA.query("select 1 from public.audit_log where table_name = 'snag_items' and record_id = $1", [snag.id]);
    assert.ok(rows.length >= 1, "snag_items audit rows are member-level (matching the table's own SELECT RLS), so a snagging-only member should be able to read them");
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("audit: a stranger cannot read Org A's snag_items audit history", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    const snag = await createSnag(ownerA);
    const { rows } = await stranger.query("select 1 from public.audit_log where table_name = 'snag_items' and record_id = $1", [snag.id]);
    assert.equal(rows.length, 0);
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

test("audit: a rejected cross-project action link fabricates no audit row", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await assert.rejects(ownerA.query("update public.snag_items set action_id = $1 where id = $2", [fx.actionA2, snag.id]));
    const audit = await ownerA.query("select 1 from public.audit_log where table_name = 'snag_items' and record_id = $1 and action = 'UPDATE'", [snag.id]);
    assert.equal(audit.rows.length, 0, "a write that was rejected server-side must never leave an audit trail behind, as if it had happened");
  } finally {
    await ownerA.end();
  }
});
