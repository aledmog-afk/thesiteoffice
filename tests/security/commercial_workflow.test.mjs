// Commercial Module — Phase 0 (Database Foundation). Real database, real
// non-superuser `authenticated` role. Proves the workflow-enforcement
// authority underneath RLS (commercial_events_before_write()):
//
//   - the ONLY legal status transitions are draft->submitted,
//     submitted->approved, submitted->rejected, rejected->draft — every
//     other transition (including submitted->draft directly, and any
//     transition out of approved) is DB-rejected, not just UI-hidden;
//   - v48: both self-rejection AND self-approval (an approver/
//     contributor rejecting or approving their own submission) are
//     explicitly ALLOWED — the account holder's own device is expected
//     to be handed to someone else (e.g. the client) to sign on the
//     spot, so a same-account check no longer reflects who actually
//     signed; the mandatory signature (v47) is the real assurance now;
//   - once approved, a record is completely immutable for EVERYONE,
//     including a project owner holding the approver role themselves —
//     the immutability check fires before any role/permission check;
//   - the only correction mechanism is supersedes_id — a brand new
//     draft record that references the approved one it replaces,
//     leaving the original completely untouched;
//   - commercial_signatures rows are written automatically (and only
//     automatically — no client can write them directly) on each
//     submitted/approved/rejected transition, with the correct actor
//     and a non-null content hash.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_commercial_workflow";

const OWNER_A = "d1000000-0000-0000-0000-000000000101"; // project owner, ALSO granted approver
const CONTRIBUTOR_A = "d2000000-0000-0000-0000-000000000102";
const APPROVER_A = "d3000000-0000-0000-0000-000000000103";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'workflowowner@example.com'), ($2,'workflowcontributor@example.com'), ($3,'workflowapprover@example.com')`,
    [OWNER_A, CONTRIBUTOR_A, APPROVER_A]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('WF', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inviteA = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;

  for (const uid of [CONTRIBUTOR_A, APPROVER_A]) {
    const c = await userClient(DB, uid);
    await c.query("select public.join_project_by_invite($1)", [inviteA]);
    await c.end();
  }

  // Owner grants everyone their role, including a self-grant of
  // 'approver' — this is deliberate: it lets us prove that even the
  // highest role, held by the project owner themselves, still cannot
  // touch an approved record.
  await ownerA.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','approver',$2)`, [projA, OWNER_A]);
  await ownerA.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$3)`, [projA, CONTRIBUTOR_A, OWNER_A]);
  await ownerA.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','approver',$3)`, [projA, APPROVER_A, OWNER_A]);
  await ownerA.end();

  fx = { orgA, projA };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createDraft(client, projectId, title) {
  const { rows } = await client.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork',$2) returning id`,
    [projectId, title]
  );
  return rows[0].id;
}

test("Legal transitions: draft -> submitted -> approved succeeds end to end", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraft(contributor, fx.projA, "Legal path test");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [id]);
    const { rows } = await approver.query("select status, approved_by, approved_at from public.commercial_events where id=$1", [id]);
    assert.equal(rows[0].status, "approved");
    assert.equal(rows[0].approved_by, APPROVER_A);
    assert.ok(rows[0].approved_at);
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("v47 SIGNATURE REQUIRED: approving with neither a signature nor a typed name is rejected server-side, regardless of what the UI sends", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraft(contributor, fx.projA, "No signature test");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await assert.rejects(
      approver.query(`update public.commercial_events set status='approved' where id=$1`, [id]),
      /A signature or typed name is required to approve/i
    );
    const { rows } = await approver.query("select status from public.commercial_events where id=$1", [id]);
    assert.equal(rows[0].status, "submitted", "must not have been approved");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("v47 SIGNATURE REQUIRED: the raw signature is never persisted on commercial_events itself — only relayed into commercial_signatures", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraft(contributor, fx.projA, "Relay-only test");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(
      `update public.commercial_events set status='approved', pending_signature_data='data:image/png;base64,FAKE', pending_signature_typed_name='Jane Approver' where id=$1`,
      [id]
    );
    const { rows: eventRows } = await approver.query("select pending_signature_data, pending_signature_typed_name from public.commercial_events where id=$1", [id]);
    assert.equal(eventRows[0].pending_signature_data, null);
    assert.equal(eventRows[0].pending_signature_typed_name, null);

    const { rows: sigRows } = await approver.query(
      "select signature_data, signature_typed_name from public.commercial_signatures where commercial_event_id=$1 and action='approved'", [id]
    );
    assert.equal(sigRows[0].signature_data, "data:image/png;base64,FAKE");
    assert.equal(sigRows[0].signature_typed_name, "Jane Approver");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("v47 SIGNATURE OPTIONAL: submit and reject succeed with no signature at all — only approve requires one", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraft(contributor, fx.projA, "Optional signature test");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='rejected', rejection_reason='no thanks' where id=$1`, [id]);
    const { rows } = await approver.query("select status from public.commercial_events where id=$1", [id]);
    assert.equal(rows[0].status, "rejected", "reject must succeed with no signature — only approve requires one");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("Legal transitions: draft -> submitted -> rejected -> draft -> submitted -> approved (the full correction cycle)", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraft(contributor, fx.projA, "Correction cycle test");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='rejected', rejection_reason='needs more detail' where id=$1`, [id]);

    const { rows: rej } = await approver.query("select status, rejected_by, rejection_reason from public.commercial_events where id=$1", [id]);
    assert.equal(rej[0].status, "rejected");
    assert.equal(rej[0].rejected_by, APPROVER_A);
    assert.equal(rej[0].rejection_reason, "needs more detail");

    // Back to draft — content editable again.
    await contributor.query(`update public.commercial_events set status='draft', title='revised after rejection' where id=$1`, [id]);
    const { rows: back } = await contributor.query("select status, title from public.commercial_events where id=$1", [id]);
    assert.equal(back[0].status, "draft");
    assert.equal(back[0].title, "revised after rejection");

    // Round two: submit and approve successfully.
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [id]);
    const { rows: final } = await approver.query("select status from public.commercial_events where id=$1", [id]);
    assert.equal(final[0].status, "approved");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("v48: self-rejection AND self-approval are both explicitly ALLOWED — the mandatory signature is the assurance now, not a distinct account", async () => {
  const approver = await userClient(DB, APPROVER_A);
  try {
    const rejectId = await createDraft(approver, fx.projA, "Self-reject test");
    await approver.query(`update public.commercial_events set status='submitted' where id=$1`, [rejectId]);
    await approver.query(`update public.commercial_events set status='rejected' where id=$1`, [rejectId]);
    const { rows: rej } = await approver.query("select status, rejected_by from public.commercial_events where id=$1", [rejectId]);
    assert.equal(rej[0].status, "rejected");
    assert.equal(rej[0].rejected_by, APPROVER_A);

    // v48: self-approval, with a signature, must now succeed too — this
    // is the exact on-site scenario the change exists for: the raiser's
    // own account/device, handed to someone else to sign.
    const approveId = await createDraft(approver, fx.projA, "Self-approve test");
    await approver.query(`update public.commercial_events set status='submitted' where id=$1`, [approveId]);
    await approver.query(`update public.commercial_events set status='approved', pending_signature_typed_name='On-Site Client' where id=$1`, [approveId]);
    const { rows: app } = await approver.query("select status, approved_by from public.commercial_events where id=$1", [approveId]);
    assert.equal(app[0].status, "approved");
    assert.equal(app[0].approved_by, APPROVER_A);
  } finally {
    await approver.end();
  }
});

test("Illegal transitions are DB-rejected: draft -> approved directly, submitted -> draft directly, approved -> anything", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const draftId = await createDraft(contributor, fx.projA, "Illegal transition test");
    await assert.rejects(
      contributor.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [draftId]),
      /Invalid commercial event status transition/i,
      "draft -> approved must skip the required submitted step and be rejected"
    );

    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [draftId]);
    await assert.rejects(
      contributor.query(`update public.commercial_events set status='draft' where id=$1`, [draftId]),
      /Invalid commercial event status transition/i,
      "submitted -> draft must go through rejected, not be a direct transition"
    );

    await approver.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [draftId]);
    await assert.rejects(
      approver.query(`update public.commercial_events set status='rejected' where id=$1`, [draftId]),
      /immutable/i,
      "approved -> rejected must be blocked by the immutability guard, which fires before transition validation"
    );
    await assert.rejects(
      approver.query(`update public.commercial_events set status='submitted' where id=$1`, [draftId]),
      /immutable/i
    );
    await assert.rejects(
      approver.query(`update public.commercial_events set status='draft' where id=$1`, [draftId]),
      /immutable/i
    );
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("Content lock while submitted: no field other than the pure status transition may change alongside submit/approve/reject", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraft(contributor, fx.projA, "Content lock test");
    await assert.rejects(
      contributor.query(`update public.commercial_events set status='submitted', title='sneaky edit' where id=$1`, [id]),
      /Save your changes first/i,
      "submitting must be a pure status change — content edits must be a separate prior step"
    );

    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);

    await assert.rejects(
      approver.query(`update public.commercial_events set status='approved', title='sneaky approval edit', pending_signature_typed_name='Test Approver' where id=$1`, [id]),
      /pure status change/i,
      "approval must be a pure status change"
    );

    // A genuinely locked (submitted) record also can't be silently
    // content-edited without touching status at all.
    await assert.rejects(
      contributor.query(`update public.commercial_events set title='edit while submitted, no status change' where id=$1`, [id]),
      /locked until it is rejected back to draft/i
    );
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("Approved immutability: even a project owner holding the approver role themselves cannot touch an approved record", async () => {
  const owner = await userClient(DB, OWNER_A); // OWNER_A holds 'approver' on their own project
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  try {
    const id = await createDraft(contributor, fx.projA, "Owner immutability test");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await owner.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [id]);

    await assert.rejects(
      owner.query(`update public.commercial_events set title='owner override attempt' where id=$1`, [id]),
      /immutable/i,
      "the project owner, even holding the approver role, must not be able to edit an approved record"
    );
    await assert.rejects(
      owner.query(`update public.commercial_events set rejection_reason='trying to sneak this in' where id=$1`, [id]),
      /immutable/i
    );

    const { rows } = await owner.query("select title from public.commercial_events where id=$1", [id]);
    assert.equal(rows[0].title, "Owner immutability test", "the title must be genuinely unchanged");
  } finally {
    await owner.end();
    await contributor.end();
  }
});

test("Correction mechanism: supersedes_id links a new draft to the approved record it replaces, without altering the original", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const originalId = await createDraft(contributor, fx.projA, "Original approved record");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [originalId]);
    await approver.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [originalId]);

    const { rows: created } = await contributor.query(
      `insert into public.commercial_events (project_id, type, title, supersedes_id) values ($1,'daywork','Corrected record',$2) returning id, status, supersedes_id`,
      [fx.projA, originalId]
    );
    assert.equal(created[0].status, "draft");
    assert.equal(created[0].supersedes_id, originalId);

    const { rows: original } = await contributor.query("select status, title from public.commercial_events where id=$1", [originalId]);
    assert.equal(original[0].status, "approved");
    assert.equal(original[0].title, "Original approved record", "the original approved record must be completely untouched by the correction");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("commercial_signatures: written automatically for submit/approve/reject with correct actor and a non-null hash — never directly writable by any client", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraft(contributor, fx.projA, "Signature test");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [id]);

    const { rows: sigs } = await contributor.query(
      "select action, signed_by_user_id, signed_by_name, record_hash from public.commercial_signatures where commercial_event_id=$1 order by signed_at",
      [id]
    );
    assert.equal(sigs.length, 2, "exactly one signature per submit and per approve");
    assert.equal(sigs[0].action, "submitted");
    assert.equal(sigs[0].signed_by_user_id, CONTRIBUTOR_A);
    assert.equal(sigs[0].signed_by_name, "workflowcontributor@example.com");
    assert.ok(sigs[0].record_hash, "a content hash must be recorded at signing time");
    assert.equal(sigs[1].action, "approved");
    assert.equal(sigs[1].signed_by_user_id, APPROVER_A);
    assert.ok(sigs[1].record_hash);

    await assert.rejects(
      contributor.query(
        `insert into public.commercial_signatures (commercial_event_id, project_id, action, signed_by_user_id, signed_by_name, org_id) values ($1,$2,'approved',$3,'forged',$4)`,
        [id, fx.projA, CONTRIBUTOR_A, fx.orgA]
      ),
      isRlsError,
      "no client, not even one who legitimately holds the approver role, may write commercial_signatures directly — it is a pure side-effect table"
    );
  } finally {
    await contributor.end();
    await approver.end();
  }
});
