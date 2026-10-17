// v61 migration safety: (1) upgrading a v60 database that has real data
// (owner, same-company colleague added the old way, a leftover invite
// code, snags) keeps every existing access exactly as it was and retires
// the codes; (2) applying the whole schema twice is a no-op for v61.
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
const V60_ONLY = FULL.slice(0, FULL.indexOf("-- ─── v61 ADDITIONS"));
const OWNER = "a6300000-0000-0000-0000-000000000001";
const COLLEAGUE = "a6300000-0000-0000-0000-000000000002";

test("v61: the v60 prefix is a real, separately-appliable schema (sanity)", () => {
  assert.ok(V60_ONLY.length > 100000 && V60_ONLY.includes("v60 ADDITIONS") && !V60_ONLY.includes("project_parties"));
});

test("v61: upgrading a populated v60 database keeps existing access and retires invite codes", async () => {
  const db = "tracker_test_v61_upgrade";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, V60_ONLY);
    await admin.query("insert into auth.users (id, email) values ($1, 'o@x.test'), ($2, 'c@x.test')", [OWNER, COLLEAGUE]);
    const o = await userClient(db, OWNER);
    const org = (await o.query("select public.create_organisation('Tai Tarian', 'developer_client') as id")).rows[0].id;
    const proj = (await o.query("insert into public.projects (name, org_id, created_by) values ('County Flats', $1, $2) returning id", [org, OWNER])).rows[0].id;
    const list = (await o.query("insert into public.snag_lists (project_id, title) values ($1, 'L') returning id", [proj])).rows[0].id;
    await o.query("insert into public.snag_items (project_id, snag_list_id, description) values ($1, $2, 'pre-v61 snag')", [proj, list]);
    const code = (await o.query("select public.regenerate_invite_code($1) as c", [proj])).rows[0].c;
    await o.end();
    const c = await userClient(db, COLLEAGUE);
    await c.query("select public.join_project_by_invite($1)", [code]); // v60 behaviour: auto-added to Tai Tarian
    await c.end();
    const before = (await admin.query("select (select count(*) from public.projects)::int p, (select count(*) from public.project_members)::int pm, (select count(*) from public.organisation_members)::int om, (select count(*) from public.snag_items)::int s")).rows[0];

    await runSqlFile(admin, SCHEMA);
    await runSqlFile(admin, SCHEMA);

    const after = (await admin.query("select (select count(*) from public.projects)::int p, (select count(*) from public.project_members)::int pm, (select count(*) from public.organisation_members)::int om, (select count(*) from public.snag_items)::int s")).rows[0];
    assert.deepEqual(after, before, "no row created or removed by the upgrade");

    for (const [u, role] of [[OWNER, "owner"], [COLLEAGUE, "collaborator"]]) {
      const cl = await userClient(db, u);
      assert.equal((await cl.query("select public.get_my_role($1) as r", [proj])).rows[0].r, role);
      assert.equal((await cl.query("select public.is_project_member($1) as m", [proj])).rows[0].m, true);
      assert.deepEqual((await cl.query("select description from public.snag_items")).rows.map((r) => r.description), ["pre-v61 snag"]);
      await cl.end();
    }
    const late = await userClient(db, COLLEAGUE);
    // v68: the retired stub is closed to signed-in users; it still refuses
    // with the friendly message if anything internal ever calls it.
    await assert.rejects(late.query("select public.join_project_by_invite($1)", [code]), /permission denied for function/i);
    await assert.rejects(admin.query("select public.join_project_by_invite($1)", [code]), /no longer used/);
    await late.end();
  } finally {
    await admin.end().catch(() => {});
    await dropTestDatabase(db);
  }
});

test("v61: applying the full schema twice leaves exactly one of each v61 object", async () => {
  const db = "tracker_test_v61_twice";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSqlFile(admin, SCHEMA);
    await runSqlFile(admin, SCHEMA);
    const q = async (sql) => (await admin.query(sql)).rows[0].n;
    assert.equal(await q("select count(*)::int n from pg_tables where schemaname='public' and tablename in ('project_parties','project_party_invites','project_party_members')"), 3);
    assert.equal(await q("select count(*)::int n from pg_policies where tablename in ('project_parties','project_party_invites','project_party_members')"), 3);
    assert.equal(await q("select count(*)::int n from pg_policies where tablename = 'snag_items'"), 4);
    assert.equal(await q("select count(*)::int n from pg_trigger where tgname in ('trg_snag_items_party_guard','trg_organisation_members_party_handover','trg_audit_project_parties')"), 3);
    assert.equal(await q("select count(*)::int n from information_schema.columns where table_name='snag_items' and column_name='party_id'"), 1);
    assert.equal(await q("select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')"), 4, "still only the 4 allowlisted functions for anon");
    assert.equal(await q("select count(*)::int n from information_schema.column_privileges where table_name='project_party_invites' and column_name='token_hash' and grantee in ('anon','authenticated')"), 0, "token_hash never readable by clients");
  } finally {
    await admin.end().catch(() => {});
    await dropTestDatabase(db);
  }
});
