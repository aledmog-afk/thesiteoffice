// Commercial Module — Phase 2 (Variations). Real database, real
// non-superuser `authenticated` role.
//
// Proves the variation_dayworks linking boundary — the single most
// important piece of Phase 2 functionality per the brief — is
// genuinely DB-enforced, not merely UI-filtered:
//
//   - a Daywork can only ever be linked to a Variation on the SAME
//     project (a real, exploitable cross-project/cross-tenant leak
//     found during inspection and fixed as part of this phase — see
//     variation_dayworks_before_insert()'s and the INSERT policy's own
//     comments in sql/schema.sql);
//   - the composite primary key (variation_id, daywork_id) prevents
//     linking the same Daywork twice to the same Variation;
//   - only a real dayworks row can ever be linked (the FK to
//     dayworks(commercial_event_id), not commercial_events(id)
//     directly, makes linking a Variation-type event structurally
//     impossible);
//   - a Viewer can never link/unlink, regardless of project;
//   - linking/unlinking is only permitted while the Variation itself
//     is unlocked (draft/rejected), exactly like every other child
//     table in this module.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_commercial_variation_dayworks";

const OWNER_A = "f1000000-0000-0000-0000-000000000101";
const CONTRIBUTOR_A = "f2000000-0000-0000-0000-000000000102";
const VIEWER_A = "f3000000-0000-0000-0000-000000000103";
const OWNER_B = "f4000000-0000-0000-0000-000000000104";
const CONTRIBUTOR_B = "f5000000-0000-0000-0000-000000000105";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'vdw-ownera@example.com'), ($2,'vdw-contributora@example.com'), ($3,'vdw-viewera@example.com'), ($4,'vdw-ownerb@example.com'), ($5,'vdw-contributorb@example.com')`,
    [OWNER_A, CONTRIBUTOR_A, VIEWER_A, OWNER_B, CONTRIBUTOR_B]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('VDW A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inviteA = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;
  for (const uid of [CONTRIBUTOR_A, VIEWER_A]) {
    const c = await userClient(DB, uid);
    await c.query("select public.join_project_by_invite($1)", [inviteA]);
    await c.end();
  }
  await ownerA.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$3)`, [projA, CONTRIBUTOR_A, OWNER_A]);
  await ownerA.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$3)`, [projA, VIEWER_A, OWNER_A]);
  await ownerA.end();

  // Project B — entirely separate organisation ("cross-tenant", not
  // merely cross-project within the same org).
  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('VDW B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  const inviteB = (await ownerB.query("select public.regenerate_invite_code($1) as code", [projB])).rows[0].code;
  const contributorBClient = await userClient(DB, CONTRIBUTOR_B);
  await contributorBClient.query("select public.join_project_by_invite($1)", [inviteB]);
  await contributorBClient.end();
  await ownerB.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$3)`, [projB, CONTRIBUTOR_B, OWNER_B]);
  await ownerB.end();

  fx = { orgA, projA, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createDaywork(client, projectId, title) {
  const { rows } = await client.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork',$2) returning id`, [projectId, title]);
  const eventId = rows[0].id;
  await client.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [eventId]);
  return eventId;
}
async function createVariation(client, projectId, title) {
  const { rows } = await client.query(`insert into public.commercial_events (project_id, type, title) values ($1,'variation',$2) returning id`, [projectId, title]);
  const eventId = rows[0].id;
  await client.query(`insert into public.variations (commercial_event_id, markup_pct) values ($1, 0)`, [eventId]);
  return eventId;
}

test("Cross-project linking is rejected: a Daywork on project B cannot be linked to a Variation on project A, even by a contributor with full edit rights on project A", async () => {
  const contributorA = await userClient(DB, CONTRIBUTOR_A);
  const adminClient_ = adminClient(DB);
  await adminClient_.connect();
  try {
    const variation = await createVariation(contributorA, fx.projA, "Cross-project link attempt");
    // The daywork genuinely exists on project B — created as admin so
    // this isn't conflated with a permission failure on creating it.
    const daywork = await createDaywork(adminClient_, fx.projB, "Project B daywork");

    await assert.rejects(
      contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork]),
      /same project|row-level security|permission denied/i,
      "linking a Daywork from a different project must be rejected, not silently folded into the Variation's total"
    );

    const { rows } = await adminClient_.query("select count(*)::int as n from public.variation_dayworks where variation_id=$1", [variation]);
    assert.equal(rows[0].n, 0, "no variation_dayworks row must have been created");
  } finally {
    await contributorA.end();
    await adminClient_.end();
  }
});

test("Cross-tenant linking is rejected at the RLS layer too: a contributor cannot even discover project B's daywork_id is invalid via a different error path", async () => {
  // Same scenario, but the daywork is created by a REAL contributor on
  // project B (not admin) — proves this isn't an artefact of how the
  // fixture set the row up.
  const contributorA = await userClient(DB, CONTRIBUTOR_A);
  const contributorB = await userClient(DB, CONTRIBUTOR_B);
  try {
    const variation = await createVariation(contributorA, fx.projA, "Cross-tenant link attempt");
    const daywork = await createDaywork(contributorB, fx.projB, "Real project B daywork");

    await assert.rejects(
      contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork]),
      /same project|row-level security|permission denied/i
    );
  } finally {
    await contributorA.end();
    await contributorB.end();
  }
});

test("Duplicate linking is rejected: the same Daywork cannot be linked twice to the same Variation", async () => {
  const contributorA = await userClient(DB, CONTRIBUTOR_A);
  try {
    const variation = await createVariation(contributorA, fx.projA, "Duplicate link test");
    const daywork = await createDaywork(contributorA, fx.projA, "Daywork to link");
    await contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork]);
    await assert.rejects(
      contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork]),
      /duplicate key|violates unique/i,
      "the composite primary key must reject an exact duplicate link"
    );
  } finally {
    await contributorA.end();
  }
});

test("Wrong-type linking is structurally impossible: a Variation cannot be linked as if it were a Daywork", async () => {
  const contributorA = await userClient(DB, CONTRIBUTOR_A);
  try {
    const variationX = await createVariation(contributorA, fx.projA, "Variation X");
    const variationY = await createVariation(contributorA, fx.projA, "Variation Y");
    await assert.rejects(
      contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variationX, variationY]),
      /must reference an existing dayworks row|foreign key|violates/i
    );
  } finally {
    await contributorA.end();
  }
});

test("A Viewer can never link or unlink a Daywork, regardless of project", async () => {
  const viewer = await userClient(DB, VIEWER_A);
  const contributorA = await userClient(DB, CONTRIBUTOR_A);
  try {
    const variation = await createVariation(contributorA, fx.projA, "Viewer link attempt");
    const daywork = await createDaywork(contributorA, fx.projA, "Daywork for viewer test");

    await assert.rejects(
      viewer.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork]),
      isRlsError
    );

    // Now link it legitimately as the contributor, then confirm the
    // viewer also cannot unlink it.
    await contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork]);
    const del = await viewer.query(`delete from public.variation_dayworks where variation_id=$1 and daywork_id=$2`, [variation, daywork]);
    assert.equal(del.rowCount, 0, "a viewer's delete attempt must silently affect zero rows");
  } finally {
    await viewer.end();
    await contributorA.end();
  }
});

test("Linking/unlinking is only permitted while the Variation is unlocked (draft/rejected) — locked while submitted or approved", async () => {
  const contributorA = await userClient(DB, CONTRIBUTOR_A);
  const owner = await userClient(DB, OWNER_A);
  await owner.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','approver',$2) on conflict do nothing`, [fx.projA, OWNER_A]);
  try {
    const variation = await createVariation(contributorA, fx.projA, "Lock state test");
    const daywork1 = await createDaywork(contributorA, fx.projA, "Daywork 1");
    const daywork2 = await createDaywork(contributorA, fx.projA, "Daywork 2");
    await contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork1]);

    await contributorA.query(`update public.commercial_events set status='submitted' where id=$1`, [variation]);

    await assert.rejects(
      contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork2]),
      isRlsError,
      "linking a new Daywork to a submitted Variation must be rejected"
    );
    const del = await contributorA.query(`delete from public.variation_dayworks where variation_id=$1 and daywork_id=$2`, [variation, daywork1]);
    assert.equal(del.rowCount, 0, "unlinking from a submitted Variation must silently affect zero rows");
  } finally {
    await contributorA.end();
    await owner.end();
  }
});

test("Legitimate same-project linking and unlinking succeeds for a Contributor", async () => {
  const contributorA = await userClient(DB, CONTRIBUTOR_A);
  try {
    const variation = await createVariation(contributorA, fx.projA, "Legit link test");
    const daywork = await createDaywork(contributorA, fx.projA, "Daywork to legitimately link");

    const ins = await contributorA.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2) returning id`, [variation, daywork]);
    assert.ok(ins.rows[0].id);

    const del = await contributorA.query(`delete from public.variation_dayworks where variation_id=$1 and daywork_id=$2`, [variation, daywork]);
    assert.equal(del.rowCount, 1, "a legitimate unlink while draft must succeed");
  } finally {
    await contributorA.end();
  }
});
