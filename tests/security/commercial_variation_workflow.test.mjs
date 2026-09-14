// Commercial Module — Phase 2 (Variations). Real database, real
// non-superuser `authenticated` role.
//
// Phase 0's commercial_workflow.test.mjs already proves the shared
// draft->submitted->approved/rejected machinery generically (using
// type='daywork' throughout, since commercial_events_before_write()
// makes no distinction by type). This file proves the SAME guarantees
// hold for type='variation' specifically, plus the two pieces that are
// genuinely new in Phase 2: evidence locking for Variations, and the
// full amend-and-resubmit cycle with linked Dayworks intact through a
// reject -> draft -> resubmit round trip.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_commercial_variation_workflow";

const OWNER_A = "07100000-0000-0000-0000-000000000101";
const CONTRIBUTOR_A = "07200000-0000-0000-0000-000000000102";
const APPROVER_A = "07300000-0000-0000-0000-000000000103";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'vwfowner@example.com'), ($2,'vwfcontributor@example.com'), ($3,'vwfapprover@example.com')`,
    [OWNER_A, CONTRIBUTOR_A, APPROVER_A]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('VWF', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
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

async function createDraftVariation(client, title) {
  const { rows } = await client.query(`insert into public.commercial_events (project_id, type, title) values ($1,'variation',$2) returning id`, [fx.projA, title]);
  const id = rows[0].id;
  await client.query(`insert into public.variations (commercial_event_id, markup_pct) values ($1, 10)`, [id]);
  return id;
}

test("Variation workflow: draft -> submitted -> approved succeeds end to end, with a signature at each step", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraftVariation(contributor, "Legal path variation");
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='approved' where id=$1`, [id]);

    const { rows } = await approver.query("select status, approved_by from public.commercial_events where id=$1", [id]);
    assert.equal(rows[0].status, "approved");
    assert.equal(rows[0].approved_by, APPROVER_A);

    const { rows: sigs } = await approver.query("select action from public.commercial_signatures where commercial_event_id=$1 order by signed_at", [id]);
    assert.deepEqual(sigs.map((s) => s.action), ["submitted", "approved"]);
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("Variation workflow: self-approval is blocked using the real DB mechanism, not merely hidden in the UI", async () => {
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraftVariation(approver, "Self-approval attempt");
    await approver.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await assert.rejects(
      approver.query(`update public.commercial_events set status='approved' where id=$1`, [id]),
      /cannot approve a commercial event you created yourself/i
    );
  } finally {
    await approver.end();
  }
});

test("Variation workflow: reject -> draft -> amend (line item AND linked Daywork) -> resubmit -> approve — the full correction cycle", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraftVariation(contributor, "Full correction cycle");
    await contributor.query(
      `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','Original line',1,100)`,
      [id]
    );
    const dw1 = (await contributor.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','DW1') returning id`, [fx.projA])).rows[0].id;
    await contributor.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [dw1]);
    await contributor.query(`insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'plant','x',1,50)`, [dw1]);
    await contributor.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [id, dw1]);

    // (100 + 50) * 1.10 = 165.00
    let { rows } = await contributor.query("select total_value from public.commercial_events where id=$1", [id]);
    assert.equal(rows[0].total_value, "165.00");

    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='rejected', rejection_reason='pricing needs review' where id=$1`, [id]);
    await contributor.query(`update public.commercial_events set status='draft' where id=$1`, [id]);

    // Amend: add a second direct line, and link a second Daywork.
    await contributor.query(
      `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'material','Amended line',1,200)`,
      [id]
    );
    const dw2 = (await contributor.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','DW2') returning id`, [fx.projA])).rows[0].id;
    await contributor.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [dw2]);
    await contributor.query(`insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'subcontractor','y',1,75)`, [dw2]);
    await contributor.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [id, dw2]);

    // (100 + 200 + 50 + 75) * 1.10 = 467.50
    ({ rows } = await contributor.query("select total_value from public.commercial_events where id=$1", [id]));
    assert.equal(rows[0].total_value, "467.50");

    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='approved' where id=$1`, [id]);

    ({ rows } = await approver.query("select status, total_value from public.commercial_events where id=$1", [id]));
    assert.equal(rows[0].status, "approved");
    assert.equal(rows[0].total_value, "467.50", "the approved total must reflect every amendment made during the correction cycle");

    const { rows: links } = await approver.query("select count(*)::int as n from public.variation_dayworks where variation_id=$1", [id]);
    assert.equal(links[0].n, 2, "both linked Dayworks must have survived the correction cycle");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

test("Variation workflow: an approved Variation is completely immutable — cannot edit content, cannot change markup, cannot link/unlink Dayworks", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraftVariation(contributor, "Immutability test");
    const dw = (await contributor.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','DW') returning id`, [fx.projA])).rows[0].id;
    await contributor.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [dw]);
    await contributor.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [id, dw]);
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await approver.query(`update public.commercial_events set status='approved' where id=$1`, [id]);

    await assert.rejects(
      approver.query(`update public.commercial_events set title='hacked' where id=$1`, [id]),
      /immutable/i
    );
    // variations' UPDATE policy is USING-only (no separate WITH CHECK),
    // matching commercial_events' own established pattern — a row that
    // fails USING() is invisible to the UPDATE's target-row scan, so
    // the statement succeeds with rowCount 0 rather than throwing.
    const markupAttempt = await approver.query(`update public.variations set markup_pct=99 where commercial_event_id=$1`, [id]);
    assert.equal(markupAttempt.rowCount, 0, "markup_pct must not be editable on an approved variation — the update must silently affect zero rows");
    const { rows: unchangedMarkup } = await contributor.query("select markup_pct from public.variations where commercial_event_id=$1", [id]);
    assert.equal(unchangedMarkup[0].markup_pct, "10.00", "markup_pct must be genuinely unchanged");

    const dw2 = (await contributor.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','DW2') returning id`, [fx.projA])).rows[0].id;
    await contributor.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [dw2]);
    await assert.rejects(
      approver.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [id, dw2]),
      isRlsError,
      "linking a new Daywork to an approved Variation must be rejected"
    );
    const del = await approver.query(`delete from public.variation_dayworks where variation_id=$1 and daywork_id=$2`, [id, dw]);
    assert.equal(del.rowCount, 0, "unlinking from an approved Variation must silently affect zero rows");
  } finally {
    await contributor.end();
    await approver.end();
  }
});

// ─── Evidence locking, specific to Variations ──────────────────────

test("Variation evidence: can be added while draft, locked once submitted, still locked once approved", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const id = await createDraftVariation(contributor, "Evidence lock test");
    const { rows: ev1 } = await contributor.query(
      `insert into public.commercial_evidence_links (commercial_event_id, source_table, source_id, caption) values ($1,'documents',gen_random_uuid(),'photo 1') returning id`,
      [id]
    );
    assert.ok(ev1[0].id, "evidence must be addable while draft");

    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [id]);
    await assert.rejects(
      contributor.query(
        `insert into public.commercial_evidence_links (commercial_event_id, source_table, source_id, caption) values ($1,'documents',gen_random_uuid(),'sneaky photo') returning id`,
        [id]
      ),
      isRlsError,
      "evidence must not be addable once submitted"
    );
    const del1 = await contributor.query(`delete from public.commercial_evidence_links where id=$1`, [ev1[0].id]);
    assert.equal(del1.rowCount, 0, "existing evidence must not be removable once submitted");

    await approver.query(`update public.commercial_events set status='approved' where id=$1`, [id]);
    await assert.rejects(
      approver.query(
        `insert into public.commercial_evidence_links (commercial_event_id, source_table, source_id, caption) values ($1,'documents',gen_random_uuid(),'post-approval photo') returning id`,
        [id]
      ),
      isRlsError,
      "evidence must not be addable once approved"
    );
    const del2 = await approver.query(`delete from public.commercial_evidence_links where id=$1`, [ev1[0].id]);
    assert.equal(del2.rowCount, 0, "evidence must not be removable once approved");
  } finally {
    await contributor.end();
    await approver.end();
  }
});
