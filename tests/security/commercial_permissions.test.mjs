// Commercial Module — Phase 0 (Database Foundation). Real database, real
// non-superuser `authenticated` role. Proves the platform module-
// permission layer (module_roles / project_module_roles / can_view_
// commercial() / can_edit_commercial() / can_submit_commercial() /
// can_approve_commercial()) is a genuine, DB-enforced boundary — not a
// UI convenience — and that it is layered strictly INSIDE the existing
// project/organisation membership boundary, never a way around it:
//
//   - a project collaborator with NO commercial grant has zero
//     Commercial visibility, even though they are a full project editor
//     for every other module;
//   - a commercial grant on a project the user does not otherwise
//     belong to is never sufficient (composes with is_project_member());
//   - only the project OWNER may grant/revoke module roles, never an
//     organisation admin (verified against the existing schema before
//     writing this: is_org_admin() is never used to bypass a project-
//     level is_project_owner() check anywhere in schema.sql today, so
//     no such bypass is introduced here either);
//   - viewer/contributor/approver map to exactly the capability matrix
//     the approved architecture specifies.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_commercial_permissions";

const OWNER_A = "a1000000-0000-0000-0000-000000000101";
const NO_GRANT_COLLAB = "a2000000-0000-0000-0000-000000000102"; // full project editor, zero commercial grant
const VIEWER_A = "a3000000-0000-0000-0000-000000000103";
const CONTRIBUTOR_A = "a4000000-0000-0000-0000-000000000104";
const APPROVER_A = "a5000000-0000-0000-0000-000000000105";
const OWNER_B = "b1000000-0000-0000-0000-000000000101";
const STRANGER = "c1000000-0000-0000-0000-000000000101";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'nograntcollab@example.com'), ($3,'viewera@example.com'), ($4,'contributora@example.com'), ($5,'approvera@example.com'), ($6,'ownerb@example.com'), ($7,'stranger@example.com')`,
    [OWNER_A, NO_GRANT_COLLAB, VIEWER_A, CONTRIBUTOR_A, APPROVER_A, OWNER_B, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inviteA = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;
  await ownerA.end();

  for (const uid of [NO_GRANT_COLLAB, VIEWER_A, CONTRIBUTOR_A, APPROVER_A]) {
    const c = await userClient(DB, uid);
    await c.query("select public.join_project_by_invite($1)", [inviteA]);
    await c.end();
  }

  // Grants — owner A does the granting (project-owner-only per RLS).
  const ownerA2 = await userClient(DB, OWNER_A);
  await ownerA2.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$3)`, [projA, VIEWER_A, OWNER_A]);
  await ownerA2.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$3)`, [projA, CONTRIBUTOR_A, OWNER_A]);
  await ownerA2.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','approver',$3)`, [projA, APPROVER_A, OWNER_A]);
  await ownerA2.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

// ─── module_roles reference integrity ──────────────────────────────

test("module_roles: seeded with exactly the three V1 commercial roles, readable by any authenticated user", async () => {
  const viewer = await userClient(DB, VIEWER_A);
  try {
    const { rows } = await viewer.query("select module, role from public.module_roles where module = 'commercial' order by sort_order");
    assert.deepEqual(rows, [
      { module: "commercial", role: "viewer" },
      { module: "commercial", role: "contributor" },
      { module: "commercial", role: "approver" },
    ]);
  } finally {
    await viewer.end();
  }
});

test("module_roles: no client can insert/update/delete — reference data, admin-maintained via schema.sql only", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      ownerA.query("insert into public.module_roles (module, role) values ('commercial', 'director')"),
      isRlsError
    );
  } finally {
    await ownerA.end();
  }
});

test("project_module_roles: a composite FK rejects an unknown (module, role) combination", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      ownerA.query(
        `insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','director',$3)`,
        [fx.projA, STRANGER, OWNER_A]
      ),
      /foreign key|violates/i
    );
  } finally {
    await ownerA.end();
  }
});

// ─── granting is owner-only, never org-admin, never self-service ──

test("Granting: the project OWNER can grant a commercial role", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query(
      `insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$3) returning id`,
      [fx.projA, STRANGER, OWNER_A]
    );
    assert.ok(rows[0].id);
    await ownerA.query("delete from public.project_module_roles where project_id=$1 and user_id=$2 and module='commercial'", [fx.projA, STRANGER]);
  } finally {
    await ownerA.end();
  }
});

test("Granting: a project collaborator (non-owner) cannot grant a commercial role, even with a commercial grant of their own", async () => {
  const contributorA = await userClient(DB, CONTRIBUTOR_A);
  try {
    await assert.rejects(
      contributorA.query(
        `insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$2)`,
        [fx.projA, STRANGER]
      ),
      isRlsError
    );
  } finally {
    await contributorA.end();
  }
});

test("Granting: an organisation admin who is NOT the project owner cannot grant a commercial role on that project — no org-admin bypass of project ownership exists anywhere in this schema, and none is introduced here", async () => {
  // OWNER_A is both org admin (creator of orgA) and project owner here,
  // so to test the distinction we need an org-admin who is genuinely
  // NOT this project's owner. NO_GRANT_COLLAB is only ever a
  // collaborator on projA (never made org admin), so promote them to
  // org admin directly and confirm that still isn't enough.
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query("update public.organisation_members set role='admin' where org_id=$1 and user_id=$2", [fx.orgA, NO_GRANT_COLLAB]);
  await admin.end();

  const orgAdminNonOwner = await userClient(DB, NO_GRANT_COLLAB);
  try {
    await assert.rejects(
      orgAdminNonOwner.query(
        `insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$2)`,
        [fx.projA, STRANGER]
      ),
      isRlsError,
      "an org admin who is not this project's owner must not be able to grant Commercial access on it"
    );
  } finally {
    await orgAdminNonOwner.end();
  }
});

// ─── the core correction: editor status alone is never enough ─────

test("No grant: a full project collaborator with ZERO commercial grant cannot see or touch commercial_events at all", async () => {
  const noGrant = await userClient(DB, NO_GRANT_COLLAB);
  try {
    const { rows: sel } = await noGrant.query("select * from public.commercial_events where project_id=$1", [fx.projA]);
    assert.equal(sel.length, 0, "must see zero commercial_events rows, even though they are a full project collaborator");

    await assert.rejects(
      noGrant.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Should fail')`, [fx.projA]),
      isRlsError,
      "a project collaborator with no commercial grant must not be able to create a commercial event"
    );
  } finally {
    await noGrant.end();
  }
});

test("Project owner WITHOUT an explicit commercial grant has NO commercial access either — module access is explicit, never implied by ownership", async () => {
  // A fresh project owned by someone with no self-granted commercial
  // role — being the owner must not implicitly unlock Commercial.
  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rows: sel } = await ownerB.query("select * from public.commercial_events where project_id=$1", [fx.projB]);
    assert.equal(sel.length, 0);
    await assert.rejects(
      ownerB.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Should fail')`, [fx.projB]),
      isRlsError,
      "the project owner must not implicitly have Commercial access without an explicit grant"
    );
  } finally {
    await ownerB.end();
  }
});

// ─── capability matrix: viewer / contributor / approver ───────────

test("Viewer: can view, cannot create, cannot edit, cannot submit, cannot approve", async () => {
  const viewer = await userClient(DB, VIEWER_A);
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  try {
    const { rows } = await contributor.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Viewer test') returning id`, [fx.projA]);
    const eventId = rows[0].id;

    const { rows: seen } = await viewer.query("select * from public.commercial_events where id=$1", [eventId]);
    assert.equal(seen.length, 1, "a viewer must be able to see commercial_events");

    await assert.rejects(
      viewer.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Viewer create attempt')`, [fx.projA]),
      isRlsError
    );

    // commercial_events' UPDATE policy is USING-only (no separate WITH
    // CHECK) — matching this codebase's established RLS pattern (see
    // actions.test.mjs), a row a client fails to satisfy USING() for is
    // simply invisible to the UPDATE's target-row scan, so the statement
    // succeeds with rowCount 0 rather than throwing. Prove both that zero
    // rows were touched AND that the row's content is genuinely unchanged.
    const titleAttempt = await viewer.query(`update public.commercial_events set title='edited by viewer' where id=$1`, [eventId]);
    assert.equal(titleAttempt.rowCount, 0, "a viewer must not be able to edit a commercial event — the update must silently affect zero rows");

    const statusAttempt = await viewer.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
    assert.equal(statusAttempt.rowCount, 0, "a viewer must not be able to submit a commercial event — the update must silently affect zero rows");

    const { rows: unchanged } = await contributor.query("select title, status from public.commercial_events where id=$1", [eventId]);
    assert.equal(unchanged[0].title, "Viewer test", "the title must be genuinely unchanged after the viewer's failed update attempt");
    assert.equal(unchanged[0].status, "draft", "the status must be genuinely unchanged after the viewer's failed update attempt");
  } finally {
    await viewer.end();
    await contributor.end();
  }
});

test("Contributor: can view, create, edit draft/rejected, submit, and (v48) sign & approve their OWN submission on the spot", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  try {
    const { rows } = await contributor.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Contributor test') returning id`, [fx.projA]);
    const eventId = rows[0].id;

    await contributor.query(`update public.commercial_events set title='edited while draft' where id=$1`, [eventId]);
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);

    const { rows: after1 } = await contributor.query("select status from public.commercial_events where id=$1", [eventId]);
    assert.equal(after1[0].status, "submitted");

    // v48: no separate 'approver' role needed — a plain contributor can
    // complete the on-site sign-off themselves, since the mandatory
    // signature is what authorizes the approval now, not the account
    // role. Still requires a signature (unchanged from v47).
    await assert.rejects(
      contributor.query(`update public.commercial_events set status='approved' where id=$1`, [eventId]),
      /signature or typed name is required/i,
      "a contributor CAN approve now, but the mandatory-signature rule is unchanged"
    );
    await contributor.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Client On-Site' where id=$1`, [eventId]);
    const { rows: after2 } = await contributor.query("select status, approved_by from public.commercial_events where id=$1", [eventId]);
    assert.equal(after2[0].status, "approved");
    assert.equal(after2[0].approved_by, CONTRIBUTOR_A, "a contributor can now approve their own submission, given a signature");
  } finally {
    await contributor.end();
  }
});

test("Approver: can view, create, edit draft/rejected, submit, and (v48) approve ANOTHER user's record or their own", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A);
  const approver = await userClient(DB, APPROVER_A);
  try {
    const { rows } = await contributor.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Approver test') returning id`, [fx.projA]);
    const eventId = rows[0].id;
    await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);

    await approver.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [eventId]);
    const { rows: after1 } = await approver.query("select status, approved_by from public.commercial_events where id=$1", [eventId]);
    assert.equal(after1[0].status, "approved");
    assert.equal(after1[0].approved_by, APPROVER_A);

    // v48: the approver's OWN submission can now also be approved by
    // them, given a signature — the self-approval block was removed
    // (see commercial_workflow.test.mjs for the dedicated coverage of
    // this specific change).
    const { rows: own } = await approver.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Approver self-approval test') returning id`, [fx.projA]);
    const ownId = own[0].id;
    await approver.query(`update public.commercial_events set status='submitted' where id=$1`, [ownId]);
    await approver.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Test Approver' where id=$1`, [ownId]);
    const { rows: after2 } = await approver.query("select status, approved_by from public.commercial_events where id=$1", [ownId]);
    assert.equal(after2[0].status, "approved");
    assert.equal(after2[0].approved_by, APPROVER_A);
  } finally {
    await contributor.end();
    await approver.end();
  }
});

// ─── project / organisation isolation ──────────────────────────────

test("Wrong project: a commercial grant on project A gives zero access to project B's commercial data", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR_A); // only granted on projA
  try {
    const { rows } = await contributor.query("select * from public.commercial_events where project_id=$1", [fx.projB]);
    assert.equal(rows.length, 0);
    await assert.rejects(
      contributor.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Cross-project attempt')`, [fx.projB]),
      isRlsError
    );
  } finally {
    await contributor.end();
  }
});

test("Wrong organisation: a stranger with no membership anywhere sees zero commercial data and cannot be meaningfully granted access without first joining the project", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    const { rows } = await stranger.query("select * from public.commercial_events where project_id=$1", [fx.projA]);
    assert.equal(rows.length, 0);
  } finally {
    await stranger.end();
  }
});

test("A commercial grant alone, without real project membership, is never sufficient — project_module_role() composes with is_project_member()", async () => {
  // Directly insert a project_module_roles row for STRANGER on projA
  // without ever inviting them to the project — proves the module
  // grant cannot outrun the platform's own membership boundary.
  const ownerA = await userClient(DB, OWNER_A);
  await ownerA.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','approver',$3)`, [fx.projA, STRANGER, OWNER_A]);
  await ownerA.end();

  const stranger = await userClient(DB, STRANGER);
  try {
    const { rows } = await stranger.query("select * from public.commercial_events where project_id=$1", [fx.projA]);
    assert.equal(rows.length, 0, "a commercial grant must never grant access to a project the user is not otherwise a member of");
  } finally {
    await stranger.end();
  }
});

test("Unauthenticated: sees zero commercial data and cannot write any of it", async () => {
  const anon = await userClient(DB, null);
  try {
    const { rows } = await anon.query("select * from public.commercial_events where project_id=$1", [fx.projA]);
    assert.equal(rows.length, 0);
    await assert.rejects(
      anon.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Anon attempt')`, [fx.projA]),
      isRlsError
    );
  } finally {
    await anon.end();
  }
});

// ─── commercial_event_totals view: security_invoker regression ────
//
// This is the one gap the rest of this file could never have caught:
// every other test here queries commercial_events/commercial_line_items
// directly, so a broken RLS policy on those TABLES would fail loudly.
// A view created without `security_invoker = true` (Postgres 15+) is a
// different, subtler failure mode — Postgres evaluates the view's
// underlying-table access (RLS included) using the VIEW OWNER's
// privileges, not the querying user's. Since every migration-applying
// role (including Supabase's own migration tooling, and this test
// suite's own schema-setup superuser — see tests/lib/db.mjs's
// setupSchema()) is exactly this kind of elevated, RLS-bypassing role,
// a view missing this option silently leaks every organisation's data
// through its own auto-exposed endpoint, with EVERY underlying table's
// RLS still individually correct and every other test in this file
// still green. Discovered for real during the Phase 1 production
// deploy via Supabase's security advisor (an ERROR-level "Security
// Definer View" finding) — commercial_event_totals had exactly this
// gap despite an (incorrect) code comment claiming otherwise.
test("commercial_event_totals view: is created with security_invoker=true, so it enforces RLS as the querying user, not the view owner", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query("select reloptions from pg_class where relname='commercial_event_totals'");
    assert.ok(
      (rows[0]?.reloptions || []).includes("security_invoker=true"),
      "commercial_event_totals must be created with security_invoker=true, or it silently bypasses RLS for every caller"
    );
  } finally {
    await admin.end();
  }
});

test("commercial_event_totals view: a contributor on project B cannot see project A's totals through the view, even though the view was created by a superuser", async () => {
  const contributorA = await userClient(DB, CONTRIBUTOR_A); // granted on projA only
  const ownerB = await userClient(DB, OWNER_B); // owns projB, no commercial grant anywhere
  try {
    // Give an unrelated draft daywork on project A a real, non-zero
    // total via a real line item, so there is something non-trivial for
    // the view to leak if security_invoker were missing.
    const { rows: created } = await contributorA.query(
      `insert into public.commercial_events (project_id, type, title) values ($1,'daywork','View isolation test') returning id`,
      [fx.projA]
    );
    const eventId = created[0].id;
    await contributorA.query(
      `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','x',10,50)`,
      [eventId]
    );

    // The contributor (who legitimately has access to project A) sees it.
    const { rows: seenByContributor } = await contributorA.query(
      "select total from public.commercial_event_totals where commercial_event_id=$1", [eventId]
    );
    assert.equal(seenByContributor.length, 1, "a user with real access to the event must still see it through the view");
    assert.equal(seenByContributor[0].total, "500.00");

    // ownerB has no Commercial grant on projA (or anywhere) — querying
    // the VIEW (not the base table) must return zero rows for them,
    // exactly as commercial_events itself already does.
    const { rows: seenByOwnerB } = await ownerB.query(
      "select total from public.commercial_event_totals where commercial_event_id=$1", [eventId]
    );
    assert.equal(seenByOwnerB.length, 0, "commercial_event_totals must enforce RLS as the querying user — an unrelated project owner must see nothing through the view, not everything");

    // Belt and braces: an unfiltered select must also come back empty
    // for ownerB, not merely a specific id lookup.
    const { rows: allForOwnerB } = await ownerB.query("select * from public.commercial_event_totals");
    assert.equal(allForOwnerB.length, 0, "an unfiltered query against the view must also return zero rows for a user with no Commercial access anywhere");
  } finally {
    await contributorA.end();
    await ownerB.end();
  }
});
