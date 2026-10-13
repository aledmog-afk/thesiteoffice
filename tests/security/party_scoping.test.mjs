// v61 part 2 (Aled's stage-2 decisions): documents / specifications /
// snag lists tied to a company are seen only by that company (owner side
// and main contractor see all; drawings stay visible to all, view-only);
// role changes keep individual raises; owner dashboard flag for snags
// with no company. Real RLS, real users.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_party_scoping";
const U = (n) => `a6600000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SUBA = U(2), SUBA2 = U(3), SUBB = U(4), MC = U(5);
const EMAIL = { [OWNER]: "o@own.test", [SUBA]: "a@almo.test", [SUBA2]: "a2@almo.test", [SUBB]: "b@bolt.test", [MC]: "m@main.test" };
const fx = { party: {}, org: {} };
async function as(u, fn) { const c = await userClient(DB, u); try { return await fn(c); } finally { await c.end(); } }
async function sql(q, p = []) { const a = adminClient(DB); await a.connect(); try { return await a.query(q, p); } finally { await a.end(); } }
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);
const col = (c, q, p) => c.query(q, p).then((r) => r.rows.map((x) => Object.values(x)[0]));

async function join(user, company, role, trade = null) {
  const inv = await as(OWNER, (c) => one(c, "select * from public.create_party_invite($1,$2,$3,$4,null)", [fx.job, EMAIL[user], role, trade]));
  const org = await as(user, async (c) => {
    const id = (await one(c, "select public.create_organisation($1,'subcontractor') as id", [company])).id;
    await c.query("select public.accept_party_invite($1,$2)", [inv.token, id]);
    return id;
  });
  fx.org[user] = org;
  fx.party[user] = (await sql("select id from public.project_parties where project_id=$1 and org_id=$2", [fx.job, org])).rows[0].id;
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);
  await as(OWNER, async (c) => {
    fx.ownerOrg = (await one(c, "select public.create_organisation('Owner Co','developer_client') as id")).id;
    fx.job = (await one(c, "insert into public.projects (name, org_id, created_by) values ('County Flats',$1,$2) returning id", [fx.ownerOrg, OWNER])).id;
  });
  await join(SUBA, "Almo", "subcontractor", "Carpentry");
  await join(SUBB, "Bolt", "subcontractor", "Electrical");
  await join(MC, "Main", "main_contractor");
  await as(SUBA, (c) => c.query("select public.add_party_member($1,$2)", [fx.party[SUBA], SUBA2])).catch(async () => {
    await sql("insert into public.organisation_members (org_id, user_id, role) values ($1,$2,'member')", [fx.org[SUBA], SUBA2]);
    await as(SUBA, (c) => c.query("select public.add_party_member($1,$2)", [fx.party[SUBA], SUBA2]));
  });
  const A = fx.party[SUBA], B = fx.party[SUBB];
  await sql(`insert into public.documents (org_id, project_id, title, party_id) values ($1,$2,'Doc Almo',$3),($1,$2,'Doc Bolt',$4),($1,$2,'Doc general',null)`, [fx.ownerOrg, fx.job, A, B]);
  await sql(`insert into public.specifications (project_id, spec_name, spec_url, party_id) values ($1,'Spec Almo','x',$2),($1,'Spec Bolt','x',$3),($1,'Spec general','x',null)`, [fx.job, A, B]);
  await sql(`insert into public.drawings (project_id, drawing_name, drawing_url) values ($1,'GA plan','x')`, [fx.job]);
  const lists = await sql(`insert into public.snag_lists (project_id, title, party_id) values ($1,'List Almo',$2),($1,'List Bolt',$3),($1,'List mixed',null) returning id, title`, [fx.job, A, B]);
  fx.lists = Object.fromEntries(lists.rows.map((r) => [r.title, r.id]));
  await sql(`insert into public.snag_items (project_id, snag_list_id, description, party_id) values ($1,$2,'Almo in mixed',$3),($1,$2,'Nobody yet',null),($1,$2,'Nobody yet 2',null)`, [fx.job, fx.lists["List mixed"], A]);
  const d = (await sql("select id from public.documents where title='Doc Bolt'")).rows[0].id;
  await sql(`insert into public.document_revisions (document_id, project_id, revision_number, file_url, file_name) values ($1,$2,1,'bolt/file.pdf','f.pdf')`, [d, fx.job]);
});
after(async () => { await dropTestDatabase(DB); });

test("a subcontractor sees only documents and specifications tied to its own company", async () => {
  await as(SUBA, async (c) => {
    assert.deepEqual(await col(c, "select title from public.documents order by 1"), ["Doc Almo"]);
    assert.deepEqual(await col(c, "select spec_name from public.specifications order by 1"), ["Spec Almo"]);
    assert.deepEqual(await col(c, "select file_url from public.document_revisions"), [], "Bolt's revision is hidden");
  });
  await as(SUBB, async (c) => {
    assert.deepEqual(await col(c, "select title from public.documents order by 1"), ["Doc Bolt"]);
    assert.deepEqual(await col(c, "select file_url from public.document_revisions"), ["bolt/file.pdf"]);
  });
});

test("Bolt's stored document file can't be read by Almo even knowing the path", async () => {
  assert.equal(await as(SUBA, (c) => one(c, "select public.controlled_documents_party_ok('bolt/file.pdf') ok")).then((r) => r.ok), false);
  assert.equal(await as(SUBB, (c) => one(c, "select public.controlled_documents_party_ok('bolt/file.pdf') ok")).then((r) => r.ok), true);
});

test("snag lists: own company's, plus any list holding one of its snags", async () => {
  assert.deepEqual(await as(SUBA, (c) => col(c, "select title from public.snag_lists order by 1")), ["List Almo", "List mixed"]);
  assert.deepEqual(await as(SUBB, (c) => col(c, "select title from public.snag_lists order by 1")), ["List Bolt"]);
});

test("owner side and main contractor see everything; drawings visible to all and view-only for subs", async () => {
  for (const u of [OWNER, MC]) {
    assert.equal((await as(u, (c) => col(c, "select title from public.documents"))).length, 3);
    assert.equal((await as(u, (c) => col(c, "select title from public.snag_lists"))).length, 3);
  }
  for (const u of [SUBA, SUBB]) {
    await as(u, async (c) => {
      assert.deepEqual(await col(c, "select drawing_name from public.drawings"), ["GA plan"]);
      assert.equal((await c.query("update public.drawings set drawing_name='x'")).rowCount, 0);
      await assert.rejects(c.query("insert into public.drawings (project_id, drawing_name, drawing_url) values ($1,'n','x')", [fx.job]), (e) => isRlsError(e));
    });
  }
});

test("changing a company's role keeps an individually raised person raised (and the rest follow the role)", async () => {
  await as(OWNER, (c) => c.query("select public.set_project_member_role($1,$2,'collaborator')", [fx.job, SUBA2]));
  await as(OWNER, (c) => c.query("select public.set_party_role($1,'main_contractor',null)", [fx.party[SUBA]]));
  const roles = async () => Object.fromEntries((await sql("select user_id, role from public.project_members where project_id=$1 and user_id in ($2,$3)", [fx.job, SUBA, SUBA2])).rows.map((r) => [r.user_id, r.role]));
  assert.deepEqual(await roles(), { [SUBA]: "collaborator", [SUBA2]: "collaborator" });
  await as(OWNER, (c) => c.query("select public.set_party_role($1,'subcontractor','Carpentry')", [fx.party[SUBA]]));
  assert.deepEqual(await roles(), { [SUBA]: "snagging", [SUBA2]: "collaborator" }, "the raise survives both role changes");
});

test("owner dashboard: snags with no company on jobs that have companies are flagged; nobody else gets the list", async () => {
  const r = await as(OWNER, (c) => c.query("select * from public.get_unassigned_company_snags()"));
  assert.deepEqual(r.rows.map((x) => [x.project_name, x.snag_count]), [["County Flats", 2]]);
  assert.equal((await as(SUBB, (c) => c.query("select * from public.get_unassigned_company_snags()"))).rowCount, 0);
  assert.equal((await as(MC, (c) => c.query("select * from public.get_unassigned_company_snags()"))).rowCount, 0);
});
