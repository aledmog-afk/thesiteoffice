// v62 migration safety: upgrading a populated v61 database (owner, a
// subcontractor company and a main contractor company on a job, snags,
// RFIs, actions) keeps every existing access as it was, defaults the
// main contractor to FULL, and applying the schema twice is a no-op.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, runSqlFile, runSql, adminClient, userClient } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SETUP = path.join(__dirname, "../lib/mock_setup.sql");
const SCHEMA = path.join(__dirname, "../../sql/schema.sql");
const FULL = fs.readFileSync(SCHEMA, "utf8");
const V61_ONLY = FULL.slice(0, FULL.indexOf("-- ─── v62 ADDITIONS"));
const OWNER = "a6500000-0000-0000-0000-000000000001", SUB = "a6500000-0000-0000-0000-000000000002", MC = "a6500000-0000-0000-0000-000000000003";

test("v62: the v61 prefix is a real, separately-appliable schema (sanity)", () => {
  assert.ok(V61_ONLY.includes("v61 ADDITIONS") && !V61_ONLY.includes("party_role_capabilities"));
});

test("v62: upgrading a populated v61 database keeps access, MC defaults to full, applying twice changes nothing", async () => {
  const db = "tracker_test_v62_upgrade";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, V61_ONLY);
    await admin.query("insert into auth.users (id, email) values ($1,'o@x.test'),($2,'s@sub.test'),($3,'m@mc.test')", [OWNER, SUB, MC]);
    const o = await userClient(db, OWNER);
    const org = (await o.query("select public.create_organisation('Tai Tarian','developer_client') as id")).rows[0].id;
    const proj = (await o.query("insert into public.projects (name, org_id, created_by) values ('County Flats',$1,$2) returning id", [org, OWNER])).rows[0].id;
    const list = (await o.query("insert into public.snag_lists (project_id, title) values ($1,'L') returning id", [proj])).rows[0].id;
    const invS = (await o.query("select * from public.create_party_invite($1,'s@sub.test','subcontractor','Carpentry',null)", [proj])).rows[0];
    const invM = (await o.query("select * from public.create_party_invite($1,'m@mc.test','main_contractor',null,null)", [proj])).rows[0];
    await o.query("insert into public.rfis (project_id, title, question) values ($1,'Old RFI','?')", [proj]);
    await o.query("insert into public.actions (project_id, title) values ($1,'Old action')", [proj]);
    await o.end();
    for (const [u, inv, name] of [[SUB, invS, "Almo"], [MC, invM, "MainCo"]]) {
      const c = await userClient(db, u);
      const id = (await c.query("select public.create_organisation($1,'subcontractor') as id", [name])).rows[0].id;
      await c.query("select public.accept_party_invite($1,$2)", [inv.token, id]);
      await c.end();
    }
    const subParty = (await admin.query("select pp.id from public.project_parties pp join public.organisations o on o.id = pp.org_id where o.name='Almo'")).rows[0].id;
    await admin.query("insert into public.snag_items (project_id, snag_list_id, description, party_id) values ($1,$2,'Almo snag',$3),($1,$2,'Unassigned snag',null)", [proj, list, subParty]);
    const countsQ = "select (select count(*) from public.project_members)::int pm, (select count(*) from public.project_parties)::int pp, (select count(*) from public.snag_items)::int s, (select count(*) from public.rfis)::int r, (select count(*) from public.actions)::int a, (select string_agg(user_id::text || role, ',' order by user_id) from public.project_members) roles";
    const before = (await admin.query(countsQ)).rows[0];

    await runSqlFile(admin, SCHEMA);
    const once = (await admin.query(countsQ)).rows[0];
    await runSqlFile(admin, SCHEMA);
    const twice = (await admin.query(countsQ)).rows[0];
    assert.deepEqual(once, before, "upgrade creates/removes/changes no rows");
    assert.deepEqual(twice, before, "second apply is a no-op");
    assert.equal((await admin.query("select main_contractor_access m from public.projects")).rows[0].m, "full");
    assert.equal((await admin.query("select count(*)::int n from public.party_role_capabilities")).rows[0].n, 23);

    const m = await userClient(db, MC);
    assert.equal((await m.query("select public.get_my_role($1) r", [proj])).rows[0].r, "collaborator");
    assert.deepEqual((await m.query("select title from public.rfis")).rows.map((r) => r.title), ["Old RFI"]);
    await m.end();
    const s = await userClient(db, SUB);
    assert.deepEqual((await s.query("select description from public.snag_items")).rows.map((r) => r.description), ["Almo snag"]);
    assert.deepEqual((await s.query("select title from public.rfis")).rows, [], "pre-v62 RFIs have no company, so a sub still sees none");
    await s.end();
    const ow = await userClient(db, OWNER);
    assert.equal((await ow.query("select count(*)::int n from public.snag_items")).rows[0].n, 2);
    assert.equal((await ow.query("select count(*)::int n from public.rfis")).rows[0].n, 1);
    await ow.end();
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});
