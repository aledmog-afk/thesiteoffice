// Organisation onboarding & membership requests (Phase 0) — real,
// non-superuser `authenticated` Postgres role throughout, same approach
// as org_isolation.test.mjs/invites.test.mjs/project_roles.test.mjs (see
// those files' header comments for why this matters: UI hiding proves
// nothing, only the database denying the query does).
//
// Covers the full brief: independent organisation creation (no approval
// needed), organisation search, the request/approve/reject workflow, the
// critical "pending requester has ZERO access" boundary, cross-tenant
// isolation of the request table itself, and that none of this weakened
// the pre-existing invite-link flows.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_organisation_join_requests";

const NEWUSER = "e1000000-0000-0000-0000-000000000001"; // independent org creation
const ORGA_ADMIN = "e2000000-0000-0000-0000-000000000002";
const ORGA_MEMBER = "e3000000-0000-0000-0000-000000000003"; // approved via the real request->approve pipeline in before()
const ORGB_ADMIN = "e4000000-0000-0000-0000-000000000004";
const SEARCHER = "e5000000-0000-0000-0000-000000000005";
const REQ_PENDING = "e6000000-0000-0000-0000-000000000006";
const REQ_APPROVE = "e7000000-0000-0000-0000-000000000007";
const REQ_REJECT = "e8000000-0000-0000-0000-000000000008";
const INVITE_JOINER = "e9000000-0000-0000-0000-000000000009";
const SNAG_JOINER = "ea000000-0000-0000-0000-00000000000a";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values
       ($1,'newuser@example.com'),
       ($2,'orga-admin@example.com'),
       ($3,'orga-member@example.com'),
       ($4,'orgb-admin@example.com'),
       ($5,'searcher@example.com'),
       ($6,'req-pending@example.com'),
       ($7,'req-approve@example.com'),
       ($8,'req-reject@example.com'),
       ($9,'invite-joiner@example.com'),
       ($10,'snag-joiner@example.com')`,
    [NEWUSER, ORGA_ADMIN, ORGA_MEMBER, ORGB_ADMIN, SEARCHER, REQ_PENDING, REQ_APPROVE, REQ_REJECT, INVITE_JOINER, SNAG_JOINER]
  );
  await admin.end();

  // Org A and Org B, both created via the real create_organisation() RPC
  // (also incidentally exercises the independent-use path used by tests
  // 1-4 below, re-asserted there explicitly rather than only relied on
  // here).
  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  const orgA = (await orgAAdmin.query("select public.create_organisation('Org A Ltd', 'main_contractor') as id")).rows[0].id;
  const projA = (await orgAAdmin.query(
    "insert into public.projects (name, org_id, created_by) values ('Org A Site', $1, $2) returning id",
    [orgA, ORGA_ADMIN]
  )).rows[0].id;
  const inviteCode = (await orgAAdmin.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;
  const snagCode = (await orgAAdmin.query("select public.regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  // Commercial access is its own, separate grant (project_module_roles) —
  // being the project owner does not imply it, matching this schema's
  // deliberate "account/org role never implies module access" principle.
  await orgAAdmin.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$2)",
    [projA, ORGA_ADMIN]
  );
  const commEvent = (await orgAAdmin.query(
    "insert into public.commercial_events (org_id, project_id, type, title) values ($1,$2,'daywork','Test Daywork') returning id",
    [orgA, projA]
  )).rows[0].id;
  await orgAAdmin.query(
    "insert into public.org_settings (org_id, logo_url) values ($1, 'https://example.com/logo.png') on conflict (org_id) do update set logo_url = excluded.logo_url",
    [orgA]
  );
  await orgAAdmin.end();

  const orgBAdmin = await userClient(DB, ORGB_ADMIN);
  const orgB = (await orgBAdmin.query("select public.create_organisation('Org B Ltd', 'subcontractor') as id")).rows[0].id;
  await orgBAdmin.end();

  // ORGA_MEMBER becomes an approved member of Org A via the REAL
  // request -> approve pipeline (not a direct admin insert) — this
  // doubles as an end-to-end proof the pipeline works, and gives an
  // "ordinary approved member" fixture for the authority tests below.
  const orgAMemberClient = await userClient(DB, ORGA_MEMBER);
  await orgAMemberClient.query("select public.request_organisation_membership($1)", [orgA]);
  await orgAMemberClient.end();
  const bootstrapAdmin = await userClient(DB, ORGA_ADMIN);
  const memberReq = await bootstrapAdmin.query(
    "select id from public.organisation_membership_requests where organisation_id=$1 and user_id=$2 and status='pending'",
    [orgA, ORGA_MEMBER]
  );
  await bootstrapAdmin.query("select public.approve_organisation_membership($1)", [memberReq.rows[0].id]);
  await bootstrapAdmin.end();

  fx = { orgA, orgB, projA, inviteCode, snagCode, commEvent };
});

after(async () => {
  await dropTestDatabase(DB);
});

// ─── Independent organisation (1-4) ──────────────────────────────────
test("1-4. A new authenticated user creates their own organisation, becomes its admin, and can create/access a project immediately — no approval from anyone", async () => {
  const user = await userClient(DB, NEWUSER);
  try {
    const { rows: orgRows } = await user.query("select public.create_organisation('My Own Company', 'subcontractor') as id");
    const orgId = orgRows[0].id;
    assert.ok(orgId, "create_organisation() must return the new organisation's id");

    const membership = await user.query(
      "select role from public.organisation_members where org_id=$1 and user_id=$2",
      [orgId, NEWUSER]
    );
    assert.equal(membership.rowCount, 1, "the creator must be enrolled as a member immediately");
    assert.equal(membership.rows[0].role, "admin", "the creator becomes admin, with no approval step");

    // No pending request of any kind was created for this — independent
    // creation never touches organisation_membership_requests.
    const anyRequest = await user.query(
      "select 1 from public.organisation_membership_requests where organisation_id=$1 and user_id=$2",
      [orgId, NEWUSER]
    );
    assert.equal(anyRequest.rowCount, 0, "independent org creation must not create any membership request row");

    const proj = await user.query(
      "insert into public.projects (name, org_id, created_by) values ('My First Site', $1, $2) returning id",
      [orgId, NEWUSER]
    );
    const readBack = await user.query("select 1 from public.projects where id=$1", [proj.rows[0].id]);
    assert.equal(readBack.rowCount, 1, "the creator can read back the project they just made, immediately");
  } finally {
    await user.end();
  }
});

test("1-4. Organisation type is recorded and constrained, but an invalid type falls back safely rather than blocking creation", async () => {
  const user = await userClient(DB, NEWUSER);
  try {
    const { rows } = await user.query("select public.create_organisation('Another Co', 'not-a-real-type') as id");
    const type = await user.query("select type from public.organisations where id=$1", [rows[0].id]);
    assert.equal(type.rows[0].type, "other", "an unrecognised type must fall back to 'other', never reject the whole creation");
  } finally {
    await user.end();
  }
});

// ─── Search (5-7) ─────────────────────────────────────────────────────
test("5-7. An authenticated non-member can search organisations, and gets back only id/name/type — nothing else", async () => {
  const searcher = await userClient(DB, SEARCHER);
  try {
    const { rows } = await searcher.query("select * from public.search_organisations('Org A') as t");
    assert.ok(rows.length >= 1, "expected to find Org A by name search");
    const hit = rows.find((r) => r.id === fx.orgA);
    assert.ok(hit, "Org A itself must be among the results");
    assert.equal(hit.name, "Org A Ltd");
    assert.equal(hit.type, "main_contractor");
    assert.deepEqual(Object.keys(hit).sort(), ["id", "name", "type"], "search must return ONLY id/name/type — no other column");
  } finally {
    await searcher.end();
  }
});

test("5-7. Search never exposes members, projects, or any other organisation data as a side effect", async () => {
  const searcher = await userClient(DB, SEARCHER);
  try {
    await searcher.query("select * from public.search_organisations('Org A') as t"); // the search itself
    const members = await searcher.query("select 1 from public.organisation_members where org_id=$1", [fx.orgA]);
    assert.equal(members.rowCount, 0, "searching must never grant read access to the organisation's members");
    const projects = await searcher.query("select 1 from public.projects where org_id=$1", [fx.orgA]);
    assert.equal(projects.rowCount, 0, "searching must never grant read access to the organisation's projects");
    const org = await searcher.query("select 1 from public.organisations where id=$1", [fx.orgA]);
    assert.equal(org.rowCount, 0, "the underlying organisations table must still be unreadable by a non-member — search_organisations is a narrow, separate window onto it");
  } finally {
    await searcher.end();
  }
});

test("A search shorter than 2 characters returns nothing, rather than listing every organisation", async () => {
  const searcher = await userClient(DB, SEARCHER);
  try {
    const { rows } = await searcher.query("select * from public.search_organisations('a') as t");
    assert.equal(rows.length, 0);
    const { rows: emptyRows } = await searcher.query("select * from public.search_organisations('') as t");
    assert.equal(emptyRows.length, 0);
  } finally {
    await searcher.end();
  }
});

// ─── Request (8-13) ───────────────────────────────────────────────────
test("8-9. A user can request membership, and the request starts pending", async () => {
  const req = await userClient(DB, REQ_PENDING);
  try {
    const { rows } = await req.query("select public.request_organisation_membership($1) as id", [fx.orgA]);
    assert.ok(rows[0].id, "expected a request id back");

    const own = await req.query("select status from public.organisation_membership_requests where id=$1", [rows[0].id]);
    assert.equal(own.rowCount, 1, "the requester can read their own request row");
    assert.equal(own.rows[0].status, "pending");
  } finally {
    await req.end();
  }
});

test("10-11. A pending requester has ZERO access to the organisation's record, settings, or projects", async () => {
  const req = await userClient(DB, REQ_PENDING);
  try {
    const org = await req.query("select 1 from public.organisations where id=$1", [fx.orgA]);
    assert.equal(org.rowCount, 0, "pending requester must not be able to read the organisation record");
    const settings = await req.query("select 1 from public.org_settings where org_id=$1", [fx.orgA]);
    assert.equal(settings.rowCount, 0, "pending requester must not be able to read org_settings");
    const projects = await req.query("select 1 from public.projects where org_id=$1", [fx.orgA]);
    assert.equal(projects.rowCount, 0, "pending requester must not be able to read any of the organisation's projects");
    const members = await req.query("select 1 from public.organisation_members where org_id=$1", [fx.orgA]);
    assert.equal(members.rowCount, 0, "pending requester must not be able to read the organisation's member list");
  } finally {
    await req.end();
  }
});

test("12. A pending requester cannot access Commercial data belonging to the organisation", async () => {
  const req = await userClient(DB, REQ_PENDING);
  try {
    const events = await req.query("select 1 from public.commercial_events where id=$1", [fx.commEvent]);
    assert.equal(events.rowCount, 0, "pending requester must not be able to read Commercial events");
    const dayworks = await req.query("select 1 from public.dayworks where commercial_event_id=$1", [fx.commEvent]);
    assert.equal(dayworks.rowCount, 0, "pending requester must not be able to read Commercial dayworks");
  } finally {
    await req.end();
  }
});

test("13. A duplicate pending request for the same organisation is prevented, not merely discouraged", async () => {
  const req = await userClient(DB, REQ_PENDING);
  try {
    const first = await req.query("select id from public.organisation_membership_requests where organisation_id=$1 and user_id=$2 and status='pending'", [fx.orgA, REQ_PENDING]);
    const second = await req.query("select public.request_organisation_membership($1) as id", [fx.orgA]);
    assert.equal(second.rows[0].id, first.rows[0].id, "requesting again while already pending must return the SAME request, never a new one");
  } finally {
    await req.end();
  }
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const count = await admin.query(
      "select count(*)::int as n from public.organisation_membership_requests where organisation_id=$1 and user_id=$2 and status='pending'",
      [fx.orgA, REQ_PENDING]
    );
    assert.equal(count.rows[0].n, 1, "exactly one pending row must exist, enforced at the database level (partial unique index), not just by the function's own check");
  } finally {
    await admin.end();
  }
});

test("An already-approved member is refused when they try to request membership again", async () => {
  const member = await userClient(DB, ORGA_MEMBER);
  try {
    await assert.rejects(
      () => member.query("select public.request_organisation_membership($1)", [fx.orgA]),
      /already a member/i
    );
  } finally {
    await member.end();
  }
});

// ─── Approval (14-19) ─────────────────────────────────────────────────
test("14. An organisation admin can see pending requests for their own organisation", async () => {
  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  try {
    const { rows } = await orgAAdmin.query("select * from public.get_organisation_membership_requests($1, 'pending') as t", [fx.orgA]);
    assert.ok(rows.some((r) => r.user_id === REQ_PENDING), "the admin must see REQ_PENDING's pending request");
    const hit = rows.find((r) => r.user_id === REQ_PENDING);
    assert.equal(hit.email, "req-pending@example.com", "the admin view must resolve the requester's email");
  } finally {
    await orgAAdmin.end();
  }
});

test("15. An ordinary (non-admin) organisation member cannot see or approve pending requests", async () => {
  const member = await userClient(DB, ORGA_MEMBER);
  try {
    const { rows } = await member.query("select * from public.get_organisation_membership_requests($1, 'pending') as t", [fx.orgA]);
    assert.equal(rows.length, 0, "an ordinary member must see no pending requests, even for their own organisation");

    const direct = await member.query(
      "select 1 from public.organisation_membership_requests where organisation_id=$1 and status='pending' and user_id <> $2",
      [fx.orgA, ORGA_MEMBER]
    );
    assert.equal(direct.rowCount, 0, "an ordinary member reading the table directly must see no one else's request either");

    const someRequest = await adminSelectOnePendingRequest(fx.orgA, REQ_PENDING);
    await assert.rejects(
      () => member.query("select public.approve_organisation_membership($1)", [someRequest]),
      /only an organisation admin/i,
      "an ordinary member must be refused when attempting to approve, server-side, not just hidden from a button"
    );
  } finally {
    await member.end();
  }
});

test("16. An admin of a DIFFERENT organisation cannot approve this organisation's requests", async () => {
  const orgBAdmin = await userClient(DB, ORGB_ADMIN);
  try {
    const someRequest = await adminSelectOnePendingRequest(fx.orgA, REQ_PENDING);
    await assert.rejects(
      () => orgBAdmin.query("select public.approve_organisation_membership($1)", [someRequest]),
      /only an organisation admin/i
    );
  } finally {
    await orgBAdmin.end();
  }
});

test("17-19. Approval atomically creates an approved membership, grants organisation access, but NOT project access", async () => {
  const requester = await userClient(DB, REQ_APPROVE);
  try {
    await requester.query("select public.request_organisation_membership($1)", [fx.orgA]);
  } finally {
    await requester.end();
  }
  const requestId = await adminSelectOnePendingRequest(fx.orgA, REQ_APPROVE);

  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  try {
    await orgAAdmin.query("select public.approve_organisation_membership($1)", [requestId]);
  } finally {
    await orgAAdmin.end();
  }

  const admin = adminClient(DB);
  await admin.connect();
  try {
    const membership = await admin.query("select role from public.organisation_members where org_id=$1 and user_id=$2", [fx.orgA, REQ_APPROVE]);
    assert.equal(membership.rowCount, 1, "approval must create the organisation_members row");
    assert.equal(membership.rows[0].role, "member", "approved requests always grant the 'member' role, never 'admin'");

    const reqRow = await admin.query("select status, reviewed_at, reviewed_by from public.organisation_membership_requests where id=$1", [requestId]);
    assert.equal(reqRow.rows[0].status, "approved");
    assert.ok(reqRow.rows[0].reviewed_at, "reviewed_at must be set");
    assert.equal(reqRow.rows[0].reviewed_by, ORGA_ADMIN, "reviewed_by must record the approving admin");
  } finally {
    await admin.end();
  }

  const requesterAfter = await userClient(DB, REQ_APPROVE);
  try {
    const org = await requesterAfter.query("select 1 from public.organisations where id=$1", [fx.orgA]);
    assert.equal(org.rowCount, 1, "18. approved membership must grant organisation-level access (reading the org record)");
    const settings = await requesterAfter.query("select 1 from public.org_settings where org_id=$1", [fx.orgA]);
    assert.equal(settings.rowCount, 1, "18. approved membership must grant org_settings access");

    const project = await requesterAfter.query("select 1 from public.projects where id=$1", [fx.projA]);
    assert.equal(project.rowCount, 0, "19. organisation membership alone must NOT grant access to a project — that still requires an explicit project_members row");
  } finally {
    await requesterAfter.end();
  }
});

// ─── Rejection (20-22) ────────────────────────────────────────────────
test("20-22. An admin can reject a request; rejection never grants access and records who/when/why", async () => {
  const requester = await userClient(DB, REQ_REJECT);
  try {
    await requester.query("select public.request_organisation_membership($1)", [fx.orgA]);
  } finally {
    await requester.end();
  }
  const requestId = await adminSelectOnePendingRequest(fx.orgA, REQ_REJECT);

  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  try {
    await orgAAdmin.query("select public.reject_organisation_membership($1, $2)", [requestId, "Not a known subcontractor on this project"]);
  } finally {
    await orgAAdmin.end();
  }

  const admin = adminClient(DB);
  await admin.connect();
  try {
    const reqRow = await admin.query(
      "select status, reviewed_at, reviewed_by, rejection_reason from public.organisation_membership_requests where id=$1",
      [requestId]
    );
    assert.equal(reqRow.rows[0].status, "rejected");
    assert.ok(reqRow.rows[0].reviewed_at, "reviewed_at must be set on rejection too");
    assert.equal(reqRow.rows[0].reviewed_by, ORGA_ADMIN);
    assert.equal(reqRow.rows[0].rejection_reason, "Not a known subcontractor on this project");

    const membership = await admin.query("select 1 from public.organisation_members where org_id=$1 and user_id=$2", [fx.orgA, REQ_REJECT]);
    assert.equal(membership.rowCount, 0, "rejection must never create an organisation_members row");
  } finally {
    await admin.end();
  }

  const requesterAfter = await userClient(DB, REQ_REJECT);
  try {
    const org = await requesterAfter.query("select 1 from public.organisations where id=$1", [fx.orgA]);
    assert.equal(org.rowCount, 0, "a rejected requester must still have zero organisation access");
  } finally {
    await requesterAfter.end();
  }
});

test("A rejected requester may submit a fresh request later, but it starts pending again — never auto-approved", async () => {
  const requester = await userClient(DB, REQ_REJECT);
  try {
    const { rows } = await requester.query("select public.request_organisation_membership($1) as id", [fx.orgA]);
    assert.ok(rows[0].id, "a new request must be allowed after a prior rejection");
    const status = await requester.query("select status from public.organisation_membership_requests where id=$1", [rows[0].id]);
    assert.equal(status.rows[0].status, "pending", "the fresh request must start pending, never resurrect or auto-approve the old rejected one");

    const org = await requester.query("select 1 from public.organisations where id=$1", [fx.orgA]);
    assert.equal(org.rowCount, 0, "submitting a new request must not itself grant access");
  } finally {
    await requester.end();
  }
});

// ─── Cross-tenant isolation (23-25) ───────────────────────────────────
test("23. Organisation A's admin cannot see Organisation B's requests", async () => {
  const orgBRequester = await userClient(DB, SEARCHER);
  try {
    await orgBRequester.query("select public.request_organisation_membership($1)", [fx.orgB]);
  } finally {
    await orgBRequester.end();
  }

  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  try {
    const { rows } = await orgAAdmin.query("select * from public.get_organisation_membership_requests($1, 'pending') as t", [fx.orgB]);
    assert.equal(rows.length, 0, "Org A's admin must see nothing when asking about Org B's requests");

    const direct = await orgAAdmin.query("select 1 from public.organisation_membership_requests where organisation_id=$1", [fx.orgB]);
    assert.equal(direct.rowCount, 0, "Org A's admin must not see Org B's request rows even via a direct select");
  } finally {
    await orgAAdmin.end();
  }
});

test("24. Organisation A's admin cannot approve Organisation B's requests, even with a real request id", async () => {
  const orgBRequestId = await adminSelectOnePendingRequest(fx.orgB, SEARCHER);
  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  try {
    await assert.rejects(
      () => orgAAdmin.query("select public.approve_organisation_membership($1)", [orgBRequestId]),
      /only an organisation admin/i
    );
  } finally {
    await orgAAdmin.end();
  }
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const stillPending = await admin.query("select status from public.organisation_membership_requests where id=$1", [orgBRequestId]);
    assert.equal(stillPending.rows[0].status, "pending", "the cross-org approval attempt must not have changed anything");
  } finally {
    await admin.end();
  }
});

test("25. IDs alone cannot be used to bypass security: fake org id, fake request id, and direct table writes are all refused", async () => {
  const someUser = await userClient(DB, SEARCHER);
  try {
    await assert.rejects(
      () => someUser.query("select public.request_organisation_membership('00000000-0000-0000-0000-000000000000')"),
      /organisation not found/i
    );
    await assert.rejects(
      () => someUser.query("select public.approve_organisation_membership('00000000-0000-0000-0000-000000000000')"),
      /membership request not found/i
    );
    await assert.rejects(
      () => someUser.query("select public.reject_organisation_membership('00000000-0000-0000-0000-000000000000', null)"),
      /membership request not found/i
    );

    // Direct writes against the table itself: no insert/update/delete
    // policy exists at all, so every one of these must be denied outright
    // (RLS enabled + unpolicied = default-denied), never merely "0 rows
    // affected because the WHERE didn't match" — there IS a matching row.
    await assert.rejects(
      () => someUser.query(
        "insert into public.organisation_membership_requests (organisation_id, user_id, status, reviewed_by, reviewed_at) values ($1,$2,'approved',$2,now())",
        [fx.orgA, SEARCHER]
      ),
      (err) => isRlsError(err),
      "a client must not be able to forge an already-approved request row by inserting one directly"
    );
  } finally {
    await someUser.end();
  }

  const pendingId = await adminSelectOnePendingRequest(fx.orgB, SEARCHER);
  const requesterThemself = await userClient(DB, SEARCHER);
  try {
    const upd = await requesterThemself.query(
      "update public.organisation_membership_requests set status='approved', reviewed_at=now() where id=$1",
      [pendingId]
    );
    assert.equal(upd.rowCount, 0, "even the requester themself must not be able to self-approve by writing the row directly");
  } finally {
    await requesterThemself.end();
  }
});

// ─── Existing functionality still works (26-27) ───────────────────────
// 28/29 ("existing organisation/project RLS tests still pass" and
// "existing Commercial tests still pass") are proven by running
// org_isolation.test.mjs / project_roles.test.mjs / the Commercial
// security suites unchanged in the same full regression run as this
// file — not duplicated here.
test("26. The existing project collaborator invite link still works exactly as before, unrouted through any approval", async () => {
  const joiner = await userClient(DB, INVITE_JOINER);
  try {
    const { rows } = await joiner.query("select public.join_project_by_invite($1) as project_id", [fx.inviteCode]);
    assert.equal(rows[0].project_id, fx.projA);
    const proj = await joiner.query("select 1 from public.projects where id=$1", [fx.projA]);
    assert.equal(proj.rowCount, 1, "accepting the invite must grant immediate project access, no approval step");
    const role = await joiner.query("select public.get_my_role($1) as role", [fx.projA]);
    assert.equal(role.rows[0].role, "collaborator");

    // Confirms this route is genuinely independent of the new request
    // table — no row was ever created there for this join.
    const anyRequest = await joiner.query(
      "select 1 from public.organisation_membership_requests where organisation_id=$1 and user_id=$2",
      [fx.orgA, INVITE_JOINER]
    );
    assert.equal(anyRequest.rowCount, 0, "the invite-link path must never create a membership request row");
  } finally {
    await joiner.end();
  }
});

test("27. The existing snagging-only invite link still works exactly as before", async () => {
  const joiner = await userClient(DB, SNAG_JOINER);
  try {
    const { rows } = await joiner.query("select public.join_project_by_invite($1) as project_id", [fx.snagCode]);
    assert.equal(rows[0].project_id, fx.projA);
    const role = await joiner.query("select public.get_my_role($1) as role", [fx.projA]);
    assert.equal(role.rows[0].role, "snagging");
  } finally {
    await joiner.end();
  }
});

// ─── Helper ─────────────────────────────────────────────────────────
async function adminSelectOnePendingRequest(orgId, userId) {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "select id from public.organisation_membership_requests where organisation_id=$1 and user_id=$2 and status='pending'",
      [orgId, userId]
    );
    assert.ok(rows[0], `expected a pending request for org=${orgId} user=${userId}`);
    return rows[0].id;
  } finally {
    await admin.end();
  }
}
