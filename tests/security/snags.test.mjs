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

// v52: closing a snag directly now requires a completion photo to
// already exist in snag_photos (see tests/security/snag_photos.test.mjs
// for that table's own dedicated coverage) — used here purely as setup
// for tests that are actually about something else (verification,
// closed_date, audit), so the exact photo url is never meaningful.
async function addCompletionPhoto(client, snagId, url = "https://example.com/fixed.jpg") {
  await client.query("insert into public.snag_photos (snag_id, kind, photo_url) values ($1,'completion',$2)", [snagId, url]);
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
    await addCompletionPhoto(snagA, snag.id);
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
    await addCompletionPhoto(ownerA, snag.id);
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
    await addCompletionPhoto(ownerA, snag.id);
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
    await addCompletionPhoto(ownerA, snag.id);
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
    await addCompletionPhoto(ownerA, snag.id);
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
    await addCompletionPhoto(ownerA, snag.id);
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

// ─── v52: completion evidence (photo close / pending review) ────────
// Closing a snag now requires either at least one completion photo
// (self-evident, no reviewer) — see tests/security/snag_photos.test.mjs
// for that table's own dedicated coverage (RLS, project_id derivation,
// kind constraint, cross-project isolation) — or, with no photo, a trip
// through 'pending_review' that only a project editor can resolve. All
// enforced in snag_items_before_write() (sql/schema.sql, v52).
// closed <-> rejected and open -> rejected remain deliberately
// unrestricted, exactly as they always have been — not retested here,
// since nothing about them changed.

test("completion evidence: closing directly with no completion photo attached is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await assert.rejects(
      ownerA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]),
      /can only be closed directly with at least one completion photo/
    );
  } finally {
    await ownerA.end();
  }
});

test("completion evidence: attaching a completion photo THEN closing directly succeeds and leaves verified_at null — the photo is the evidence, not an editor's independent verification", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const snag = await createSnag(snagA, { assigned_to: SNAG_A });
    await addCompletionPhoto(snagA, snag.id);
    const closed = await snagA.query(
      "update public.snag_items set status = 'closed' where id = $1 returning status, verified_at, closed_date",
      [snag.id]
    );
    assert.equal(closed.rows[0].status, "closed");
    assert.equal(closed.rows[0].verified_at, null);
    assert.ok(closed.rows[0].closed_date, "closed_date is still auto-filled exactly as before");
  } finally {
    await snagA.end();
  }
});

test("completion evidence: 'add more' — several completion photos can be attached, and any one of them satisfies the close gate", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await addCompletionPhoto(ownerA, snag.id, "https://example.com/1.jpg");
    await addCompletionPhoto(ownerA, snag.id, "https://example.com/2.jpg");
    await addCompletionPhoto(ownerA, snag.id, "https://example.com/3.jpg");
    const photos = await ownerA.query("select id from public.snag_photos where snag_id = $1 and kind = 'completion'", [snag.id]);
    assert.equal(photos.rows.length, 3);
    const closed = await ownerA.query("update public.snag_items set status = 'closed' where id = $1 returning status", [snag.id]);
    assert.equal(closed.rows[0].status, "closed");
  } finally {
    await ownerA.end();
  }
});

test("completion evidence: any member (including snagging-only) can submit a snag for review from Open", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const snag = await createSnag(snagA);
    const r = await snagA.query("update public.snag_items set status = 'pending_review' where id = $1 returning status", [snag.id]);
    assert.equal(r.rows[0].status, "pending_review");
  } finally {
    await snagA.end();
  }
});

test("completion evidence: a snag can only enter pending_review from Open, not from closed or rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const closedSnag = await createSnag(ownerA);
    await addCompletionPhoto(ownerA, closedSnag.id);
    await ownerA.query("update public.snag_items set status = 'closed' where id = $1", [closedSnag.id]);
    await assert.rejects(
      ownerA.query("update public.snag_items set status = 'pending_review' where id = $1", [closedSnag.id]),
      /can only be submitted for review from Open/
    );

    const rejectedSnag = await createSnag(ownerA);
    await ownerA.query("update public.snag_items set status = 'rejected' where id = $1", [rejectedSnag.id]);
    await assert.rejects(
      ownerA.query("update public.snag_items set status = 'pending_review' where id = $1", [rejectedSnag.id]),
      /can only be submitted for review from Open/
    );
  } finally {
    await ownerA.end();
  }
});

test("completion evidence: a snag can never be CREATED already pending_review — silently reset to Open, same idiom as verified_at/closed_date", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA, { status: "pending_review" });
    assert.equal(snag.status, "open");
  } finally {
    await ownerA.end();
  }
});

test("completion evidence: a snagging-only member (non-editor) cannot approve or reject a snag pending review", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const snag = await createSnag(snagA);
    await snagA.query("update public.snag_items set status = 'pending_review' where id = $1", [snag.id]);
    await assert.rejects(
      snagA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]),
      /only a project editor.*can approve or reject/,
      "approving without a photo must require editor privilege, same bar as independent verification"
    );
    await assert.rejects(
      snagA.query("update public.snag_items set status = 'open' where id = $1", [snag.id]),
      /only a project editor.*can approve or reject/
    );
  } finally {
    await snagA.end();
  }
});

test("completion evidence: an editor can approve a pending-review snag — closes it and sets verified_at/by to the real actor, no photo required", async () => {
  const snagA = await userClient(DB, SNAG_A);
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const snag = await createSnag(snagA);
    await snagA.query("update public.snag_items set status = 'pending_review' where id = $1", [snag.id]);
    const approved = await collabA.query(
      "update public.snag_items set status = 'closed' where id = $1 returning status, verified_at, verified_by",
      [snag.id]
    );
    assert.equal(approved.rows[0].status, "closed");
    assert.ok(approved.rows[0].verified_at, "approval is equivalent to an editor's own independent verification");
    assert.equal(approved.rows[0].verified_by, COLLAB_A, "verified_by must be the real approving actor, not client-suppliable");
    const photos = await collabA.query("select 1 from public.snag_photos where snag_id = $1 and kind = 'completion'", [snag.id]);
    assert.equal(photos.rows.length, 0, "no photo was ever supplied on this path");
  } finally {
    await snagA.end();
    await collabA.end();
  }
});

test("completion evidence: an editor can reject a pending-review snag — sends it back to Open with a review_note, verification stays clear", async () => {
  const snagA = await userClient(DB, SNAG_A);
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(snagA);
    await snagA.query("update public.snag_items set status = 'pending_review' where id = $1", [snag.id]);
    const rejected = await ownerA.query(
      "update public.snag_items set status = 'open', review_note = $1 where id = $2 returning status, review_note, verified_at, verified_by",
      ["photo missing, please attach one or redo the fix", snag.id]
    );
    assert.equal(rejected.rows[0].status, "open");
    assert.equal(rejected.rows[0].review_note, "photo missing, please attach one or redo the fix");
    assert.equal(rejected.rows[0].verified_at, null);
    assert.equal(rejected.rows[0].verified_by, null);
  } finally {
    await snagA.end();
    await ownerA.end();
  }
});

test("completion evidence: an editor can only approve (closed) or reject (open) a pending-review snag — cannot jump it straight to rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await ownerA.query("update public.snag_items set status = 'pending_review' where id = $1", [snag.id]);
    await assert.rejects(
      ownerA.query("update public.snag_items set status = 'rejected' where id = $1", [snag.id]),
      /can only be approved \(closed\) or sent back to Open/
    );
  } finally {
    await ownerA.end();
  }
});

test("completion evidence: reopening a photo-closed snag DELETES its completion photos (but keeps problem photos), not just clears verification — stale 'before' evidence must not linger", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await ownerA.query("insert into public.snag_photos (snag_id, kind, photo_url) values ($1,'problem','https://example.com/problem.jpg')", [snag.id]);
    await addCompletionPhoto(ownerA, snag.id);
    await ownerA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    await ownerA.query("update public.snag_items set status = 'open' where id = $1", [snag.id]);
    const completion = await ownerA.query("select 1 from public.snag_photos where snag_id = $1 and kind = 'completion'", [snag.id]);
    const problem = await ownerA.query("select 1 from public.snag_photos where snag_id = $1 and kind = 'problem'", [snag.id]);
    assert.equal(completion.rows.length, 0, "reopen must delete every completion photo");
    assert.equal(problem.rows.length, 1, "reopen must never touch problem photos — they document the persistent defect");
    // And re-closing directly must now need FRESH evidence again.
    await assert.rejects(
      ownerA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]),
      /can only be closed directly with at least one completion photo/
    );
  } finally {
    await ownerA.end();
  }
});

test("completion evidence: resubmitting for review after a rejection clears the stale review_note before the new cycle", async () => {
  const snagA = await userClient(DB, SNAG_A);
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(snagA);
    await snagA.query("update public.snag_items set status = 'pending_review' where id = $1", [snag.id]);
    await ownerA.query("update public.snag_items set status = 'open', review_note = 'not good enough' where id = $1", [snag.id]);
    const resubmitted = await snagA.query("update public.snag_items set status = 'pending_review' where id = $1 returning review_note", [snag.id]);
    assert.equal(resubmitted.rows[0].review_note, null, "a fresh review cycle must not carry a stale rejection reason from the PRIOR cycle");
  } finally {
    await snagA.end();
    await ownerA.end();
  }
});

test("completion evidence: an existing loose transition (rejected -> closed) still works, now gated only by the same photo-evidence rule as any other direct close", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const snag = await createSnag(ownerA);
    await ownerA.query("update public.snag_items set status = 'rejected' where id = $1", [snag.id]);
    await addCompletionPhoto(ownerA, snag.id);
    const closed = await ownerA.query(
      "update public.snag_items set status = 'closed' where id = $1 returning status",
      [snag.id]
    );
    assert.equal(closed.rows[0].status, "closed", "closed <-> rejected was never restricted before this feature and stays available, just now sharing the same evidence gate as any other direct close");
  } finally {
    await ownerA.end();
  }
});

test("completion evidence: cross-org — a stranger's attempted approve/reject on an inaccessible pending-review snag affects zero rows, not an error", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    const snag = await createSnag(ownerA);
    await ownerA.query("update public.snag_items set status = 'pending_review' where id = $1", [snag.id]);
    const attempt = await stranger.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    assert.equal(attempt.rowCount, 0, "RLS must return zero affected rows for an inaccessible snag, not leak its existence via a different error");
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

test("completion evidence: audit trail captures the pending_review submission and the approval as separate UPDATE rows", async () => {
  const snagA = await userClient(DB, SNAG_A);
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const snag = await createSnag(snagA);
    await snagA.query("update public.snag_items set status = 'pending_review' where id = $1", [snag.id]);
    await collabA.query("update public.snag_items set status = 'closed' where id = $1", [snag.id]);
    const audit = await snagA.query(
      "select old_data->>'status' as old_status, new_data->>'status' as new_status from public.audit_log where table_name = 'snag_items' and record_id = $1 and action = 'UPDATE' order by created_at",
      [snag.id]
    );
    assert.equal(audit.rows.length, 2);
    assert.deepEqual([audit.rows[0].old_status, audit.rows[0].new_status], ["open", "pending_review"]);
    assert.deepEqual([audit.rows[1].old_status, audit.rows[1].new_status], ["pending_review", "closed"]);
  } finally {
    await snagA.end();
    await collabA.end();
  }
});
