// v68 — remove_party_member() may only take someone off a company that
// they are actually in, on that project. Before v68 it checked only that
// the caller was an admin of the company (or the project owner), then
// handed ANY user id to detach_party_member(), which deletes that user's
// project membership when they are neither owner-side nor in an active
// company on the project. So an admin of company A could remove a member
// of the project who has nothing to do with company A.
// Real non-superuser roles (authenticated), real RPCs. Fixture:
//   Owner Co (OWNER) owns JOB.
//   Almo — subcontractor on JOB: SUBA (admin, lead) + SUBA2 (staff).
//   Bolt — subcontractor on JOB: SUBB (admin, lead).
//   LOOSE — a non-owner project member in no company on the job (a
//           pre-v61 style direct member; inserted as fixture by the admin).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_v68_remove_party_member";
const U = (n) => `a6800000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SUBA = U(2), SUBA2 = U(3), SUBB = U(4), LOOSE = U(5);
const EMAIL = { [OWNER]: "owner@v68.test", [SUBA]: "a@almo68.test", [SUBA2]: "a2@almo68.test", [SUBB]: "b@bolt68.test", [LOOSE]: "loose@v68.test" };

const fx = {};
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
const onProject = async (user) => (await sql("select 1 from public.project_members where project_id = $1 and user_id = $2", [fx.job, user])).rowCount === 1;
const inParty = async (party, user) => (await sql("select 1 from public.project_party_members where party_id = $1 and user_id = $2", [party, user])).rowCount === 1;
const removeMember = (c, party, user) => c.query("select public.remove_party_member($1, $2)", [party, user]);

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);
  await as(OWNER, async (c) => {
    fx.ownerOrg = (await one(c, "select public.create_organisation('Owner Co 68', 'developer_client') as id")).id;
    fx.job = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job 68', $1, $2) returning id", [fx.ownerOrg, OWNER])).id;
    fx.invA = await one(c, "select * from public.create_party_invite($1, $2, 'subcontractor', 'Carpentry', null)", [fx.job, EMAIL[SUBA]]);
    fx.invB = await one(c, "select * from public.create_party_invite($1, $2, 'subcontractor', 'Electrical', null)", [fx.job, EMAIL[SUBB]]);
  });
  await as(SUBA, async (c) => {
    fx.almo = (await one(c, "select public.create_organisation('Almo 68', 'subcontractor') as id")).id;
    fx.almoParty = (await one(c, "select public.accept_party_invite($1, $2) as p", [fx.invA.token, fx.almo])).p;
  });
  fx.almoParty = (await sql("select id from public.project_parties where project_id = $1 and org_id = $2", [fx.job, fx.almo])).rows[0].id;
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1, $2, 'member')", [fx.almo, SUBA2]);
  await as(SUBA, (c) => c.query("select public.add_party_member($1, $2)", [fx.almoParty, SUBA2]));
  await as(SUBB, async (c) => {
    fx.bolt = (await one(c, "select public.create_organisation('Bolt 68', 'subcontractor') as id")).id;
    await c.query("select public.accept_party_invite($1, $2)", [fx.invB.token, fx.bolt]);
  });
  fx.boltParty = (await sql("select id from public.project_parties where project_id = $1 and org_id = $2", [fx.job, fx.bolt])).rows[0].id;
  // A non-owner member who is in no company on the job (fixture, as superuser).
  await sql("insert into public.project_members (project_id, user_id, role) values ($1, $2, 'collaborator')", [fx.job, LOOSE]);
});

after(async () => { await dropTestDatabase(DB); });

test("fixture: LOOSE is on the job, owner-side? no; in any company? no", async () => {
  assert.equal(await onProject(LOOSE), true);
  assert.equal(await inParty(fx.almoParty, LOOSE), false);
  assert.equal(await inParty(fx.boltParty, LOOSE), false);
  assert.equal(await inParty(fx.almoParty, SUBA2), true);
});

test("the gap: an admin of company A cannot remove a project member who isn't in company A — refused, and the membership survives", async () => {
  const err = await as(SUBA, (c) => removeMember(c, fx.almoParty, LOOSE).then(() => null, (e) => e));
  assert.equal(await onProject(LOOSE), true, "LOOSE's project membership was deleted by another company's admin");
  assert.ok(err && denied(err), `remove_party_member must refuse a user who isn't in that company (got: ${err ? err.message : "no error"})`);
});

test("an admin of company A cannot remove a member of company B through company A", async () => {
  await as(SUBA, async (c) => {
    await assert.rejects(removeMember(c, fx.almoParty, SUBB), denied);
  });
  assert.equal(await inParty(fx.boltParty, SUBB), true);
  assert.equal(await onProject(SUBB), true);
});

test("the project owner also can't use a company they name to remove someone who isn't in it", async () => {
  await as(OWNER, async (c) => {
    await assert.rejects(removeMember(c, fx.almoParty, LOOSE), denied);
  });
  assert.equal(await onProject(LOOSE), true);
});

test("legitimate removals still work: company admin removes their own staff; owner removes a company's lead", async () => {
  await as(SUBA, (c) => removeMember(c, fx.almoParty, SUBA2));
  assert.equal(await inParty(fx.almoParty, SUBA2), false);
  assert.equal(await onProject(SUBA2), false, "staff with no other reason to be on the job leave the project");
  await as(OWNER, (c) => removeMember(c, fx.boltParty, SUBB));
  assert.equal(await inParty(fx.boltParty, SUBB), false);
  assert.equal(await onProject(SUBB), false);
  const lead = (await sql("select lead_user_id from public.project_parties where id = $1", [fx.boltParty])).rows[0].lead_user_id;
  assert.equal(lead, null, "the removed lead is cleared");
});

test("a stranger (no admin, not owner) is still refused", async () => {
  await as(LOOSE, async (c) => {
    await assert.rejects(removeMember(c, fx.almoParty, SUBA), denied);
  });
  assert.equal(await inParty(fx.almoParty, SUBA), true);
});

test("remove_party_member stays SECURITY DEFINER with search_path pinned, signed-in only", async () => {
  const r = (await sql(`select p.prosecdef, p.proconfig,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_ok,
      has_function_privilege('anon', p.oid, 'EXECUTE') anon_ok
      from pg_proc p where p.oid = 'public.remove_party_member(uuid, uuid)'::regprocedure`)).rows[0];
  assert.equal(r.prosecdef, true);
  assert.deepEqual(r.proconfig, ["search_path=public"]);
  assert.equal(r.auth_ok, true);
  assert.equal(r.anon_ok, false);
});
