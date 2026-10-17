// v61 — companies on a project ("parties"). Real RLS, real RPCs, as
// real signed-in users. Fixture:
//   Owner Co (OWNER, staff OSTAFF) owns JOB1 and JOB2.
//   Almo   — subcontractor (Carpentry) on JOB1: lead SUBA (admin), SUBA2 staff.
//   Bolt   — subcontractor (Electrical) on JOB1: lead SUBB.
//   Cee    — sub-subcontractor of Almo on JOB1: lead SUBSUB.
//   MainCo — main contractor on JOB1: lead MC.
//   JOINER — wants to join Almo (existing company) via a membership request.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_project_parties";
const U = (n) => `a6200000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), OSTAFF = U(2), SUBA = U(3), SUBA2 = U(4), SUBB = U(5), SUBSUB = U(6), MC = U(7), JOINER = U(8), STRANGER = U(9), WRONG = U(10);
const EMAIL = { [OWNER]: "owner@x.test", [OSTAFF]: "ostaff@x.test", [SUBA]: "dave@almo.test", [SUBA2]: "sam@almo.test",
  [SUBB]: "bob@bolt.test", [SUBSUB]: "cee@cee.test", [MC]: "mc@main.test", [JOINER]: "jo@almo.test", [STRANGER]: "s@x.test", [WRONG]: "wrong@x.test" };

const fx = {};
// RLS refusals and the RPCs' own permission refusals both carry SQLSTATE 42501.
const denied = (e) => isRlsError(e) || e?.code === "42501";

async function as(user, fn) {
  const c = await userClient(DB, user);
  try { return await fn(c); } finally { await c.end(); }
}
async function sql(q, p = []) {
  const a = adminClient(DB); await a.connect();
  try { return await a.query(q, p); } finally { await a.end(); }
}
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);
const invite = (c, job, email, role, trade = null, parent = null) =>
  one(c, "select * from public.create_party_invite($1, $2, $3, $4, $5)", [job, email, role, trade, parent]);
const newOrg = (c, name, type = "subcontractor") => one(c, "select public.create_organisation($1, $2) as id", [name, type]).then((r) => r.id);
const accept = (c, token, org) => one(c, "select public.accept_party_invite($1, $2) as p", [token, org]).then((r) => r.p);
const snagIds = (c, job) => c.query("select description from public.snag_items where project_id = $1 order by description", [job]).then((r) => r.rows.map((x) => x.description));

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.ownerOrg = await newOrg(c, "Owner Co", "developer_client");
    fx.job1 = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job 1', $1, $2) returning id", [fx.ownerOrg, OWNER])).id;
    fx.job2 = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job 2', $1, $2) returning id", [fx.ownerOrg, OWNER])).id;
    fx.list1 = (await one(c, "insert into public.snag_lists (project_id, title) values ($1, 'L1') returning id", [fx.job1])).id;
    fx.list2 = (await one(c, "insert into public.snag_lists (project_id, title) values ($1, 'L2') returning id", [fx.job2])).id;
  });
  // OSTAFF is an approved member of Owner Co (as via a membership request).
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1, $2, 'member')", [fx.ownerOrg, OSTAFF]);
  await sql(`insert into public.drawings (project_id, drawing_name, drawing_url) values ($1, 'GA plan', 'x/ga.pdf')`, [fx.job1]);
  await sql(`insert into public.commercial_items (project_id, title, type) values ($1, 'VO1', 'instruction')`, [fx.job1]);
  await sql(`insert into public.monthly_reports (project_id, month) values ($1, '2026-10-01')`, [fx.job1]);
  await sql(`insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1, '2026-10-05', '2026-10-11')`, [fx.job1]);
});

after(async () => { await dropTestDatabase(DB); });

// ── Invites ───────────────────────────────────────────────────────────
test("only the project owner can invite a top-level company; the token is returned once and never stored in clear", async () => {
  await as(STRANGER, async (c) => {
    await assert.rejects(invite(c, fx.job1, EMAIL[SUBA], "subcontractor", "Carpentry"), denied);
  });
  await as(OWNER, async (c) => {
    const inv = await invite(c, fx.job1, " Dave@Almo.test ", "subcontractor", "Carpentry");
    assert.match(inv.token, /^[0-9a-f]{64}$/);
    const exp = new Date(inv.expires_at).getTime() - Date.now();
    assert.ok(exp > 13.9 * 864e5 && exp < 14.1 * 864e5, "expires after 14 days");
    fx.invA = inv;
    await assert.rejects(c.query("select token_hash from public.project_party_invites"), /permission denied/);
    const rows = await c.query("select invited_email, status from public.project_party_invites where id = $1", [inv.invite_id]);
    assert.deepEqual(rows.rows[0], { invited_email: "dave@almo.test", status: "pending" });
  });
  const stored = (await sql("select token_hash from public.project_party_invites where id = $1", [fx.invA.invite_id])).rows[0].token_hash;
  assert.notEqual(stored, fx.invA.token);
  assert.equal(stored.length, 64);
});

test("a subcontractor (as a party) cannot be invited without a trade", async () => {
  await as(OWNER, async (c) => { await assert.rejects(invite(c, fx.job1, "x@y.test", "subcontractor", null), /check constraint/); });
});

test("the invitee can read the invite through the link, but not the invites table", async () => {
  await as(SUBA, async (c) => {
    const i = await one(c, "select * from public.get_party_invite($1)", [fx.invA.token]);
    assert.equal(i.project_name, "Job 1");
    assert.equal(i.inviting_company, "Owner Co");
    assert.equal(i.status, "pending");
    assert.equal(i.email_matches, true);
    const t = await c.query("select id from public.project_party_invites");
    assert.equal(t.rowCount, 0);
  });
  await as(WRONG, async (c) => {
    assert.equal((await one(c, "select email_matches from public.get_party_invite($1)", [fx.invA.token])).email_matches, false);
  });
});

test("accepting with the wrong email is refused", async () => {
  await as(WRONG, async (c) => {
    const org = await newOrg(c, "Wrong Co");
    await assert.rejects(accept(c, fx.invA.token, org), /different email/);
  });
});

test("accepting for a company you don't belong to is refused and creates NO membership", async () => {
  fx.otherOrg = await as(STRANGER, (c) => newOrg(c, "Somebody Else"));
  await as(SUBA, async (c) => { await assert.rejects(accept(c, fx.invA.token, fx.otherOrg), /needs_membership/); });
  const m = await sql("select 1 from public.organisation_members where user_id = $1", [SUBA]);
  assert.equal(m.rowCount, 0);
});

test("accepting by creating your own company: you become its admin, the company joins the job, and you are NOT added to the owner's company", async () => {
  await as(SUBA, async (c) => {
    fx.almo = await newOrg(c, "Almo Carpentry");
    assert.equal(await accept(c, fx.invA.token, fx.almo), fx.job1);
    assert.equal((await one(c, "select public.get_my_role($1) as r", [fx.job1])).r, "snagging");
  });
  const roles = (await sql("select org_id, role from public.organisation_members where user_id = $1", [SUBA])).rows;
  assert.deepEqual(roles, [{ org_id: fx.almo, role: "admin" }]);
  const party = (await sql("select * from public.project_parties where org_id = $1", [fx.almo])).rows[0];
  assert.equal(party.party_role, "subcontractor");
  assert.equal(party.trade, "Carpentry");
  assert.equal(party.lead_user_id, SUBA);
  fx.partyA = party.id;
});

test("an invite can only be used once", async () => {
  await as(SUBA, async (c) => { await assert.rejects(accept(c, fx.invA.token, fx.almo), /already been accepted/); });
});

test("expired and cancelled invites are refused; resend replaces the token", async () => {
  await as(OWNER, async (c) => {
    fx.invB = await invite(c, fx.job1, EMAIL[SUBB], "subcontractor", "Electrical");
    fx.invMC = await invite(c, fx.job1, EMAIL[MC], "main_contractor");
  });
  await sql("update public.project_party_invites set expires_at = now() - interval '1 minute' where id = $1", [fx.invB.invite_id]);
  await as(SUBB, async (c) => {
    fx.bolt = await newOrg(c, "Bolt Electrical");
    assert.equal((await one(c, "select status from public.get_party_invite($1)", [fx.invB.token])).status, "expired");
    await assert.rejects(accept(c, fx.invB.token, fx.bolt), /expired/);
  });
  const fresh = await as(OWNER, (c) => one(c, "select * from public.resend_party_invite($1)", [fx.invB.invite_id]));
  await as(SUBB, async (c) => {
    await assert.rejects(accept(c, fx.invB.token, fx.bolt), /isn't valid/, "the old token dies on resend");
    assert.equal(await accept(c, fresh.token, fx.bolt), fx.job1);
  });
  fx.partyB = (await sql("select id from public.project_parties where org_id = $1", [fx.bolt])).rows[0].id;

  const tmp = await as(OWNER, (c) => invite(c, fx.job1, "temp@x.test", "consultant"));
  await as(SUBA, async (c) => { await assert.rejects(c.query("select public.cancel_party_invite($1)", [tmp.invite_id]), denied); });
  await as(OWNER, (c) => c.query("select public.cancel_party_invite($1)", [tmp.invite_id]));
  assert.equal((await sql("select status from public.project_party_invites where id = $1", [tmp.invite_id])).rows[0].status, "cancelled");
});

test("a main contractor party starts as an editor (collaborator) on the job", async () => {
  await as(MC, async (c) => {
    fx.mainCo = await newOrg(c, "MainCo", "main_contractor");
    await accept(c, fx.invMC.token, fx.mainCo);
    assert.equal((await one(c, "select public.get_my_role($1) as r", [fx.job1])).r, "collaborator");
    assert.equal((await one(c, "select public.is_project_editor($1) as e", [fx.job1])).e, true);
  });
  fx.partyMC = (await sql("select id from public.project_parties where org_id = $1", [fx.mainCo])).rows[0].id;
});

// ── Joining an existing company goes through membership approval ─────
test("joining an EXISTING company: accept waits for that company's admin to approve; accepting never grants membership", async () => {
  const inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[JOINER], "subcontractor", "Carpentry"));
  await as(JOINER, async (c) => {
    await assert.rejects(accept(c, inv.token, fx.almo), /needs_membership/);
    fx.req = (await one(c, "select public.request_organisation_membership($1) as id", [fx.almo])).id;
  });
  assert.equal((await sql("select 1 from public.organisation_members where user_id = $1", [JOINER])).rowCount, 0);
  await as(SUBA, (c) => c.query("select public.approve_organisation_membership($1)", [fx.req]));
  await as(JOINER, async (c) => {
    assert.equal(await accept(c, inv.token, fx.almo), fx.job1);
  });
  const pm = (await sql("select party_id from public.project_party_members where user_id = $1", [JOINER])).rows;
  assert.deepEqual(pm, [{ party_id: fx.partyA }], "joins Almo's existing party, no duplicate party");
  assert.equal((await sql("select count(*)::int n from public.project_parties where org_id = $1", [fx.almo])).rows[0].n, 1);
});

// ── Party staff ───────────────────────────────────────────────────────
test("a party's company admin adds their own staff; non-admins and outsiders can't", async () => {
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1, $2, 'member')", [fx.almo, SUBA2]);
  await as(SUBA2, async (c) => { await assert.rejects(c.query("select public.add_party_member($1, $2)", [fx.partyA, SUBA2]), denied); });
  await as(SUBB, async (c) => { await assert.rejects(c.query("select public.add_party_member($1, $2)", [fx.partyA, SUBB]), denied); });
  await as(SUBA, async (c) => {
    await assert.rejects(c.query("select public.add_party_member($1, $2)", [fx.partyA, STRANGER]), /isn't a member of your company/);
    await c.query("select public.add_party_member($1, $2)", [fx.partyA, SUBA2]);
  });
  await as(SUBA2, async (c) => { assert.equal((await one(c, "select public.get_my_role($1) as r", [fx.job1])).r, "snagging"); });
});

// ── Sub-subcontractors ───────────────────────────────────────────────
test("a subcontractor's admin can invite a sub-subcontractor; others can't", async () => {
  await as(SUBA2, async (c) => { await assert.rejects(invite(c, fx.job1, EMAIL[SUBSUB], "subcontractor", "Fixings", fx.partyA), denied); });
  await as(SUBB, async (c) => { await assert.rejects(invite(c, fx.job1, EMAIL[SUBSUB], "subcontractor", "Fixings", fx.partyA), denied); });
  await as(SUBA, async (c) => {
    await assert.rejects(invite(c, fx.job1, EMAIL[SUBSUB], "consultant", null, fx.partyA), /check constraint|only invite sub-subcontractors/);
    fx.invC = await invite(c, fx.job1, EMAIL[SUBSUB], "subcontractor", "Fixings", fx.partyA);
  });
  await as(SUBSUB, async (c) => {
    const i = await one(c, "select * from public.get_party_invite($1)", [fx.invC.token]);
    assert.equal(i.parent_company, "Almo Carpentry");
    fx.cee = await newOrg(c, "Cee Fixings");
    await accept(c, fx.invC.token, fx.cee);
  });
  const p = (await sql("select id, parent_party_id from public.project_parties where org_id = $1", [fx.cee])).rows[0];
  assert.equal(p.parent_party_id, fx.partyA);
  fx.partyC = p.id;
});

// ── Same-job cross-company visibility ────────────────────────────────
test("snags: each company sees only its own; a sub sees its sub-subs'; a sub-sub never sees its parent's; MC and owner see all", async () => {
  await sql(`insert into public.snag_items (project_id, snag_list_id, description, party_id) values
    ($1, $2, 'A-snag', $3), ($1, $2, 'B-snag', $4), ($1, $2, 'C-snag', $5), ($1, $2, 'owner-internal', null)`,
    [fx.job1, fx.list1, fx.partyA, fx.partyB, fx.partyC]);
  assert.deepEqual(await as(OWNER, (c) => snagIds(c, fx.job1)), ["A-snag", "B-snag", "C-snag", "owner-internal"]);
  assert.deepEqual(await as(MC, (c) => snagIds(c, fx.job1)), ["A-snag", "B-snag", "C-snag", "owner-internal"]);
  assert.deepEqual(await as(SUBA, (c) => snagIds(c, fx.job1)), ["A-snag", "C-snag"]);
  assert.deepEqual(await as(SUBA2, (c) => snagIds(c, fx.job1)), ["A-snag", "C-snag"]);
  assert.deepEqual(await as(SUBB, (c) => snagIds(c, fx.job1)), ["B-snag"]);
  assert.deepEqual(await as(SUBSUB, (c) => snagIds(c, fx.job1)), ["C-snag"]);
});

test("sub vs other sub: can't update, delete, re-assign or create into another company's snags", async () => {
  await as(SUBB, async (c) => {
    const bSnag = (await one(c, "select id from public.snag_items where description = 'B-snag'")).id;
    const aId = (await sql("select id from public.snag_items where description = 'A-snag'")).rows[0].id;
    assert.equal((await c.query("update public.snag_items set description = 'hacked' where id = $1", [aId])).rowCount, 0);
    assert.equal((await c.query("delete from public.snag_items where id = $1", [aId])).rowCount, 0);
    await assert.rejects(c.query("update public.snag_items set party_id = $1 where id = $2", [fx.partyA, bSnag]), denied);
    await assert.rejects(c.query("insert into public.snag_items (project_id, snag_list_id, description, party_id) values ($1, $2, 'x', $3)", [fx.job1, fx.list1, fx.partyA]), denied);
    const own = await one(c, "insert into public.snag_items (project_id, snag_list_id, description) values ($1, $2, 'B-own') returning party_id", [fx.job1, fx.list1]);
    assert.equal(own.party_id, fx.partyB, "a party member's new snag defaults to their own company");
  });
  assert.equal((await sql("select description from public.snag_items where description = 'hacked'")).rowCount, 0);
});

test("sub-sub vs parent sub: the sub-sub can't touch the parent's snags; the parent can work on the sub-sub's", async () => {
  const aId = (await sql("select id from public.snag_items where description = 'A-snag'")).rows[0].id;
  const cId = (await sql("select id from public.snag_items where description = 'C-snag'")).rows[0].id;
  await as(SUBSUB, async (c) => {
    assert.equal((await c.query("select 1 from public.snag_items where id = $1", [aId])).rowCount, 0);
    assert.equal((await c.query("update public.snag_items set description = 'x' where id = $1", [aId])).rowCount, 0);
  });
  await as(SUBA, async (c) => {
    assert.equal((await c.query("update public.snag_items set location = 'Flat 2' where id = $1", [cId])).rowCount, 1);
  });
});

test("snag assignee must work for the company the snag is given to", async () => {
  const bId = (await sql("select id from public.snag_items where description = 'B-snag'")).rows[0].id;
  await as(OWNER, async (c) => {
    await assert.rejects(c.query("update public.snag_items set assigned_to = $1 where id = $2", [SUBA, bId]), /must work for the company/);
    await c.query("update public.snag_items set assigned_to = $1 where id = $2", [SUBB, bId]);
  });
});

test("cross-job: a party on Job 1 sees nothing of Job 2", async () => {
  await sql("insert into public.snag_items (project_id, snag_list_id, description) values ($1, $2, 'job2-snag')", [fx.job2, fx.list2]);
  for (const u of [SUBA, SUBB, SUBSUB, MC]) {
    await as(u, async (c) => {
      assert.equal((await c.query("select 1 from public.projects where id = $1", [fx.job2])).rowCount, 0);
      assert.deepEqual(await snagIds(c, fx.job2), []);
      await assert.rejects(c.query("insert into public.snag_items (project_id, snag_list_id, description) values ($1, $2, 'x')", [fx.job2, fx.list2]), denied);
    });
  }
});

test("drawings: invited companies can view but not change them", async () => {
  await as(SUBB, async (c) => {
    assert.equal((await c.query("select 1 from public.drawings where project_id = $1", [fx.job1])).rowCount, 1);
    assert.equal((await c.query("update public.drawings set drawing_name = 'x' where project_id = $1", [fx.job1])).rowCount, 0);
    await assert.rejects(c.query("insert into public.drawings (project_id, drawing_name, drawing_url) values ($1, 'n', 'u')", [fx.job1]), denied);
  });
});

test("no commercials or monthly reports for any invited company, main contractor included; MC sees site diaries", async () => {
  for (const u of [SUBA, SUBB, SUBSUB, MC]) {
    await as(u, async (c) => {
      for (const t of ["commercial_items", "monthly_reports", "commercial_events"]) {
        assert.equal((await c.query(`select 1 from public.${t} where project_id = $1`, [fx.job1])).rowCount, 0, `${u} must not read ${t}`);
      }
      assert.equal((await c.query("update public.projects set name = 'renamed' where id = $1", [fx.job1])).rowCount, 0, "can't edit project details");
    });
  }
  await as(MC, async (c) => {
    assert.equal((await c.query("select 1 from public.weekly_reports where project_id = $1", [fx.job1])).rowCount, 1);
    await assert.rejects(c.query("insert into public.commercial_items (project_id, title, type) values ($1, 't', 'instruction')", [fx.job1]), denied);
  });
  await as(SUBA, async (c) => {
    assert.equal((await c.query("select 1 from public.weekly_reports where project_id = $1", [fx.job1])).rowCount, 0);
  });
  await as(OWNER, async (c) => {
    assert.equal((await c.query("select 1 from public.commercial_items where project_id = $1", [fx.job1])).rowCount, 1);
  });
});

// ── Roles ────────────────────────────────────────────────────────────
test("only the project owner changes or removes a company's role; a party admin can't upgrade anyone", async () => {
  for (const u of [SUBA, MC, OSTAFF]) {
    await as(u, async (c) => {
      await assert.rejects(c.query("select public.set_party_role($1, 'main_contractor', null)", [fx.partyA]), denied);
      await assert.rejects(c.query("select public.remove_party($1)", [fx.partyB]), denied);
      await assert.rejects(c.query("select public.set_project_member_role($1, $2, 'collaborator')", [fx.job1, SUBA2]), denied);
    });
  }
  await as(SUBA, async (c) => {
    await assert.rejects(c.query("update public.project_parties set party_role = 'main_contractor' where id = $1", [fx.partyA]), /permission denied/);
    await assert.rejects(c.query("insert into public.project_party_members (party_id, user_id) values ($1, $2)", [fx.partyB, SUBA]), /permission denied/);
    const up = await c.query("update public.project_members set role = 'collaborator' where user_id = $1", [SUBA]);
    assert.equal(up.rowCount, 0, "no client update policy on project_members");
  });
  assert.equal((await sql("select role from public.project_members where project_id = $1 and user_id = $2", [fx.job1, SUBA])).rows[0].role, "snagging");
});

test("the owner can raise one individual, who still never sees commercials", async () => {
  await as(OWNER, (c) => c.query("select public.set_project_member_role($1, $2, 'collaborator')", [fx.job1, SUBB]));
  await as(SUBB, async (c) => {
    assert.equal((await one(c, "select public.is_project_editor($1) as e", [fx.job1])).e, true);
    assert.equal((await c.query("select 1 from public.weekly_reports where project_id = $1", [fx.job1])).rowCount, 1);
    assert.equal((await c.query("select 1 from public.commercial_items where project_id = $1", [fx.job1])).rowCount, 0);
  });
  await as(OWNER, (c) => c.query("select public.set_project_member_role($1, $2, 'snagging')", [fx.job1, SUBB]));
});

test("owner adds their OWN company's staff directly; someone from another company must be invited instead", async () => {
  await as(OWNER, async (c) => {
    await c.query("select public.add_org_member_to_project($1, $2, 'collaborator')", [fx.job1, OSTAFF]);
    await assert.rejects(c.query("select public.add_org_member_to_project($1, $2, 'collaborator')", [fx.job1, STRANGER]), /Invite their company/);
  });
  assert.deepEqual(await as(OSTAFF, (c) => snagIds(c, fx.job1)), ["A-snag", "B-own", "B-snag", "C-snag", "owner-internal"]);
});

test("company overview lists parties to the owner, and only relevant ones to a sub", async () => {
  const all = await as(OWNER, (c) => c.query("select company from public.get_project_parties($1) order by company", [fx.job1]));
  assert.deepEqual(all.rows.map((r) => r.company), ["Almo Carpentry", "Bolt Electrical", "Cee Fixings", "MainCo"]);
  const subA = await as(SUBA, (c) => c.query("select company from public.get_project_parties($1) order by company", [fx.job1]));
  assert.deepEqual(subA.rows.map((r) => r.company), ["Almo Carpentry", "Cee Fixings"]);
  const subB = await as(SUBB, (c) => c.query("select company from public.get_project_parties($1)", [fx.job1]));
  assert.deepEqual(subB.rows.map((r) => r.company), ["Bolt Electrical"]);
});

// ── Lead handover and removal ─────────────────────────────────────────
test("lead handover: when the lead leaves their company, another admin there takes over and the leaver loses access", async () => {
  await sql("update public.organisation_members set role = 'admin' where org_id = $1 and user_id = $2", [fx.almo, SUBA2]);
  await sql("delete from public.organisation_members where org_id = $1 and user_id = $2", [fx.almo, SUBA]);
  const p = (await sql("select lead_user_id from public.project_parties where id = $1", [fx.partyA])).rows[0];
  assert.equal(p.lead_user_id, SUBA2);
  await as(SUBA, async (c) => {
    assert.equal((await c.query("select 1 from public.projects where id = $1", [fx.job1])).rowCount, 0);
    assert.deepEqual(await snagIds(c, fx.job1), []);
  });
  assert.deepEqual(await as(SUBA2, (c) => snagIds(c, fx.job1)), ["A-snag", "C-snag"]);
});

test("lead handover with no other admin leaves the lead empty (owner is shown 'needs a lead')", async () => {
  await sql("delete from public.organisation_members where org_id = $1 and user_id = $2", [fx.cee, SUBSUB]);
  assert.equal((await sql("select lead_user_id from public.project_parties where id = $1", [fx.partyC])).rows[0].lead_user_id, null);
});

test("removing a company takes it (and its sub-subs) off the job", async () => {
  await as(OWNER, (c) => c.query("select public.remove_party($1)", [fx.partyA]));
  await as(SUBA2, async (c) => {
    assert.equal((await c.query("select 1 from public.projects where id = $1", [fx.job1])).rowCount, 0);
  });
  const st = (await sql("select status from public.project_parties where id = any($1) order by status", [[fx.partyA, fx.partyC]])).rows;
  assert.deepEqual(st.map((r) => r.status), ["removed", "removed"]);
  assert.deepEqual(await as(SUBB, (c) => snagIds(c, fx.job1)), ["B-own", "B-snag"], "other companies unaffected");
});
