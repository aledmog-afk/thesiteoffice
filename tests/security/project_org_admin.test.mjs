// v60 (organisation tiers, stage 1): new projects only go into an
// organisation the creator is an ADMIN of. ensure_organisation() returns
// the caller's earliest admin org or NULL (never creates one, never
// returns a member-only org), and the projects INSERT policy requires
// is_org_admin(org_id). join_project_by_invite() is deliberately
// unchanged here — it still adds the joiner to the owner's org as a
// member; that member must still not be able to create projects there.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_project_org_admin";
const NEW_USER = "a6000000-0000-0000-0000-000000000001";
const OWNER = "a6000000-0000-0000-0000-000000000002";
const INVITEE = "a6000000-0000-0000-0000-000000000003";
const TWO_ORGS = "a6000000-0000-0000-0000-000000000004";

let fx;

async function as(user, fn) {
  const c = await userClient(DB, user);
  try { return await fn(c); } finally { await c.end(); }
}
const ensure = (c) => c.query("select public.ensure_organisation() as id").then((r) => r.rows[0].id);

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'new@example.com'), ($2,'owner@example.com'), ($3,'sub@example.com'), ($4,'two@example.com')`,
    [NEW_USER, OWNER, INVITEE, TWO_ORGS]
  );
  await admin.end();

  fx = {};
  await as(OWNER, async (c) => {
    fx.ownerOrg = (await c.query("select public.create_organisation('Tai Tarian', 'developer_client') as id")).rows[0].id;
    fx.proj = (await c.query("insert into public.projects (name, org_id, created_by) values ('County Flats', $1, $2) returning id", [fx.ownerOrg, OWNER])).rows[0].id;
    fx.code = (await c.query("select public.test_regenerate_invite_code($1) as code", [fx.proj])).rows[0].code;
  });
  await as(INVITEE, (c) => c.query("select public.test_join_project_by_invite($1)", [fx.code]));
  await as(TWO_ORGS, async (c) => {
    fx.first = (await c.query("select public.create_organisation('First Co', 'main_contractor') as id")).rows[0].id;
    await c.query("select pg_sleep(0.01)");
    fx.second = (await c.query("select public.create_organisation('Second Co', 'subcontractor') as id")).rows[0].id;
  });
});

after(async () => { await dropTestDatabase(DB); });

test("v60: a brand-new user with no organisation gets NULL and nothing is created", async () => {
  await as(NEW_USER, async (c) => {
    assert.equal(await ensure(c), null);
    assert.equal(await ensure(c), null, "repeat calls must stay side-effect free");
  });
  const admin = adminClient(DB); await admin.connect();
  const { rowCount } = await admin.query("select 1 from public.organisation_members where user_id = $1", [NEW_USER]);
  await admin.end();
  assert.equal(rowCount, 0, "ensure_organisation must never create an organisation");
});

test("v60: a brand-new user cannot insert a project with no org or someone else's org", async () => {
  await as(NEW_USER, async (c) => {
    for (const org of [null, fx.ownerOrg]) {
      let err = null;
      try { await c.query("insert into public.projects (name, org_id, created_by) values ('X', $1, $2)", [org, NEW_USER]); } catch (e) { err = e; }
      assert.ok(isRlsError(err) || /null value/.test(err?.message || ""), `expected a refusal, got ${err?.message}`);
    }
  });
});

test("v60: the admin of one organisation gets that organisation and can create a project in it", async () => {
  await as(OWNER, async (c) => {
    assert.equal(await ensure(c), fx.ownerOrg);
    const { rows } = await c.query("insert into public.projects (name, org_id, created_by) values ('Second Site', $1, $2) returning org_id", [fx.ownerOrg, OWNER]);
    assert.equal(rows[0].org_id, fx.ownerOrg);
  });
});

test("v60: a member-only user (auto-added via invite) gets NULL, not the inviting company", async () => {
  const admin = adminClient(DB); await admin.connect();
  const m = await admin.query("select role from public.organisation_members where user_id = $1 and org_id = $2", [INVITEE, fx.ownerOrg]);
  await admin.end();
  assert.equal(m.rows[0]?.role, "member", "precondition: invite still auto-adds as member (unchanged until stage 2)");
  await as(INVITEE, async (c) => { assert.equal(await ensure(c), null); });
});

test("v60: a member-only user cannot insert a project into the company they were invited into", async () => {
  await as(INVITEE, async (c) => {
    let err = null;
    try { await c.query("insert into public.projects (name, org_id, created_by) values ('Sneaky', $1, $2)", [fx.ownerOrg, INVITEE]); } catch (e) { err = e; }
    assert.ok(isRlsError(err), `expected an RLS refusal, got ${err?.message}`);
    // ...but still sees the project they were invited to.
    const { rowCount } = await c.query("select 1 from public.projects where id = $1", [fx.proj]);
    assert.equal(rowCount, 1);
  });
});

test("v60: once the member-only user sets up their own company, new projects go there", async () => {
  await as(INVITEE, async (c) => {
    const own = (await c.query("select public.create_organisation('Almo Carpentry', 'subcontractor') as id")).rows[0].id;
    assert.equal(await ensure(c), own);
    const { rows } = await c.query("insert into public.projects (name, org_id, created_by) values ('Almo Job', $1, $2) returning org_id", [own, INVITEE]);
    assert.equal(rows[0].org_id, own);
    assert.notEqual(rows[0].org_id, fx.ownerOrg);
  });
});

test("v60: an admin of two organisations gets the earliest, and may create projects in either", async () => {
  await as(TWO_ORGS, async (c) => {
    assert.equal(await ensure(c), fx.first);
    for (const org of [fx.first, fx.second]) {
      const { rows } = await c.query("insert into public.projects (name, org_id, created_by) values ('S', $1, $2) returning org_id", [org, TWO_ORGS]);
      assert.equal(rows[0].org_id, org);
    }
  });
});

test("v60: ensure_organisation is executable by authenticated but not anon or public", async () => {
  const admin = adminClient(DB); await admin.connect();
  const { rows } = await admin.query(`select has_function_privilege('anon', 'public.ensure_organisation()', 'EXECUTE') as anon,
    has_function_privilege('authenticated', 'public.ensure_organisation()', 'EXECUTE') as auth,
    exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.ensure_organisation()'::regprocedure and a.grantee = 0) as pub`);
  await admin.end();
  assert.deepEqual(rows[0], { anon: false, auth: true, pub: false });
});
