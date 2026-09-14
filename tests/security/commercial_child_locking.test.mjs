// Commercial Module — Phase 0 (Database Foundation). Real database, real
// non-superuser `authenticated` role.
//
// CRITICAL SECURITY REQUIREMENT: proves that commercial_line_items and
// commercial_evidence_links each independently enforce their parent
// commercial_events row's lock state through their OWN row-level
// security policies — NOT merely as a side effect of a trigger that
// happens to run on the parent. Every call in this file writes directly
// to the child table; no parent-row endpoint is ever touched to produce
// the lock. If a child table's own RLS policy did not re-check the
// parent's status (e.g. if someone "simplified" it to just
// can_edit_commercial(project_id) without the status filter), every
// test below would fail to catch it EXCEPT this file, because the
// other Commercial test files never attempt a direct, isolated write to
// a child row while its parent is locked.
//
// Confirmed from the live policy text in sql/schema.sql: both
// commercial_line_items and commercial_evidence_links insert/update/
// delete policies embed
//   ce.status in ('draft', 'rejected')
// directly in their own USING/WITH CHECK clauses via a join back to
// commercial_events — there is no separate "lock" flag and no trigger
// that disables child writes; the child table's policy itself is the
// enforcement point under test here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_commercial_child_locking";

const OWNER_A = "e1000000-0000-0000-0000-000000000101";
const CONTRIBUTOR_A = "e2000000-0000-0000-0000-000000000102";
const APPROVER_A = "e3000000-0000-0000-0000-000000000103";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'lockowner@example.com'), ($2,'lockcontributor@example.com'), ($3,'lockapprover@example.com')`,
    [OWNER_A, CONTRIBUTOR_A, APPROVER_A]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('Lock', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inviteA = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;

  for (const uid of [CONTRIBUTOR_A, APPROVER_A]) {
    const c = await userClient(DB, uid);
    await c.query("select public.join_project_by_invite($1)", [inviteA]);
    await c.end();
  }
  await ownerA.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$3)`, [projA, CONTRIBUTOR_A, OWNER_A]);
  await ownerA.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','approver',$3)`, [projA, APPROVER_A, OWNER_A]);
  await ownerA.end();

  fx = { orgA, projA };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createDraftWithLineItem(contributor) {
  const { rows } = await contributor.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Locking test') returning id`,
    [fx.projA]
  );
  const eventId = rows[0].id;
  const { rows: li } = await contributor.query(
    `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','Groundworks labour',4,25) returning id`,
    [eventId]
  );
  return { eventId, lineItemId: li[0].id };
}

async function createDraftWithEvidence(contributor) {
  const { rows } = await contributor.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Evidence locking test') returning id`,
    [fx.projA]
  );
  const eventId = rows[0].id;
  const { rows: ev } = await contributor.query(
    `insert into public.commercial_evidence_links (commercial_event_id, source_table, source_id, caption) values ($1,'snag_items',$2,'photo evidence') returning id`,
    [eventId, randomUUID()]
  );
  return { eventId, evidenceId: ev[0].id };
}

test("commercial_line_items: writable directly while parent is draft", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  try {
    const { lineItemId } = await createDraftWithLineItem(contributor);
    const upd = await contributor.query(`update public.commercial_line_items set quantity=5 where id=$1`, [lineItemId]);
    assert.equal(upd.rowCount, 1, "a line item must be directly editable while its parent is draft");
  } finally {
    await contributor.end();
  }
});

test("commercial_line_items: INSERT is rejected the moment the parent is submitted — direct child write, no parent endpoint touched", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  try {
    const { eventId } = await createDraftWithLineItem(contributor);
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);

    await assert.rejects(
      contributor.query(
        `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'plant','Excavator hire',1,150)`,
        [eventId]
      ),
      isRlsError,
      "inserting a new line item under a submitted parent must be rejected by commercial_line_items' own INSERT policy"
    );
  } finally {
    await contributor.end();
  }
});

test("commercial_line_items: UPDATE and DELETE silently affect zero rows once the parent is submitted", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  try {
    const { eventId, lineItemId } = await createDraftWithLineItem(contributor);
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);

    const upd = await contributor.query(`update public.commercial_line_items set quantity=99 where id=$1`, [lineItemId]);
    assert.equal(upd.rowCount, 0, "a line item under a submitted parent must not be editable — the child table's own USING() clause must exclude it");

    const del = await contributor.query(`delete from public.commercial_line_items where id=$1`, [lineItemId]);
    assert.equal(del.rowCount, 0, "a line item under a submitted parent must not be deletable");

    const { rows } = await contributor.query("select quantity from public.commercial_line_items where id=$1", [lineItemId]);
    assert.equal(rows.length, 1, "the line item must still exist — the delete attempt must not have succeeded");
    assert.equal(Number(rows[0].quantity), 4, "the quantity must be genuinely unchanged");
  } finally {
    await contributor.end();
  }
});

test("commercial_line_items: still fully locked once the parent is APPROVED, for the approver too", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const { eventId, lineItemId } = await createDraftWithLineItem(contributor);
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
    await approver.query(`update public.commercial_events set status='approved' where id=$1`, [eventId]);

    await assert.rejects(
      approver.query(
        `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'material','Sneaky post-approval item',1,1)`,
        [eventId]
      ),
      isRlsError,
      "even the approver must not be able to insert a line item under an approved parent"
    );

    const upd = await approver.query(`update public.commercial_line_items set quantity=1 where id=$1`, [lineItemId]);
    assert.equal(upd.rowCount, 0, "even the approver must not be able to edit a line item under an approved parent");

    const del = await approver.query(`delete from public.commercial_line_items where id=$1`, [lineItemId]);
    assert.equal(del.rowCount, 0, "even the approver must not be able to delete a line item under an approved parent");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("commercial_line_items: editable again directly once the parent is rejected back to draft-equivalent unlock state", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const { eventId, lineItemId } = await createDraftWithLineItem(contributor);
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
    await approver.query(`update public.commercial_events set status='rejected' where id=$1`, [eventId]);

    const upd = await contributor.query(`update public.commercial_line_items set quantity=7 where id=$1`, [lineItemId]);
    assert.equal(upd.rowCount, 1, "a line item under a rejected (editable) parent must be directly editable again — 'rejected' unlocks exactly like 'draft'");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("commercial_evidence_links: writable directly while parent is draft, locked the moment it is submitted", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  try {
    const { eventId, evidenceId } = await createDraftWithEvidence(contributor);
    const updDraft = await contributor.query(`update public.commercial_evidence_links set caption='updated while draft' where id=$1`, [evidenceId]);
    assert.equal(updDraft.rowCount, 1, "an evidence link must be directly editable while its parent is draft");

    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);

    await assert.rejects(
      contributor.query(
        `insert into public.commercial_evidence_links (commercial_event_id, source_table, source_id, caption) values ($1,'documents',$2,'sneaky post-submit evidence')`,
        [eventId, randomUUID()]
      ),
      isRlsError,
      "inserting new evidence under a submitted parent must be rejected by commercial_evidence_links' own INSERT policy"
    );

    const updLocked = await contributor.query(`update public.commercial_evidence_links set caption='sneaky edit' where id=$1`, [evidenceId]);
    assert.equal(updLocked.rowCount, 0, "an evidence link under a submitted parent must not be editable");

    const del = await contributor.query(`delete from public.commercial_evidence_links where id=$1`, [evidenceId]);
    assert.equal(del.rowCount, 0, "an evidence link under a submitted parent must not be deletable");
  } finally {
    await contributor.end();
  }
});

test("commercial_evidence_links: still fully locked once the parent is APPROVED", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const { eventId, evidenceId } = await createDraftWithEvidence(contributor);
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
    await approver.query(`update public.commercial_events set status='approved' where id=$1`, [eventId]);

    await assert.rejects(
      approver.query(
        `insert into public.commercial_evidence_links (commercial_event_id, source_table, source_id, caption) values ($1,'actions',$2,'post-approval evidence')`,
        [eventId, randomUUID()]
      ),
      isRlsError
    );
    const upd = await approver.query(`update public.commercial_evidence_links set caption='post-approval edit' where id=$1`, [evidenceId]);
    assert.equal(upd.rowCount, 0);
    const del = await approver.query(`delete from public.commercial_evidence_links where id=$1`, [evidenceId]);
    assert.equal(del.rowCount, 0);
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("A viewer can never write to child tables, in any parent status, even draft", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const admin = adminClient(DB);
  await admin.connect();
  const VIEWER_A = "e4000000-0000-0000-0000-000000000104";
  await admin.query(`insert into auth.users (id, email) values ($1,'lockviewer@example.com')`, [VIEWER_A]);
  await admin.end();
  const owner = await userClient(DB, OWNER_A);
  const inviteRow = await owner.query("select public.regenerate_invite_code($1) as code", [fx.projA]);
  const viewerJoin = await userClient(DB, VIEWER_A);
  await viewerJoin.query("select public.join_project_by_invite($1)", [inviteRow.rows[0].code]);
  await viewerJoin.end();
  await owner.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$2)`, [fx.projA, VIEWER_A]);
  await owner.end();

  const viewer = await userClient(DB, VIEWER_A);
  try {
    const { eventId } = await createDraftWithLineItem(contributor);
    await assert.rejects(
      viewer.query(
        `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','Viewer attempt',1,1)`,
        [eventId]
      ),
      isRlsError,
      "a viewer must never be able to insert a line item, regardless of the parent's status"
    );
  } finally {
    await contributor.end();
    await viewer.end();
  }
});
