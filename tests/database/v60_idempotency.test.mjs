// v60 migration idempotency: applying sql/schema.sql twice (as happens
// whenever it is re-run in the Supabase SQL editor) leaves exactly one
// projects INSERT policy (the admin one), the admin-only
// ensure_organisation(), its grants, and all existing data intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, runSqlFile, adminClient, userClient } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SETUP = path.join(__dirname, "../lib/mock_setup.sql");
const SCHEMA = path.join(__dirname, "../../sql/schema.sql");
const DB = "tracker_test_v60_idempotency";
const U = "a6100000-0000-0000-0000-000000000001";

test("v60: schema applied twice keeps the admin-only project creation rules and data", async () => {
  await createTestDatabase(DB);
  try {
    const admin = adminClient(DB); await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSqlFile(admin, SCHEMA);
    await admin.query("insert into auth.users (id, email) values ($1, 'u@example.com')", [U]);
    const c = await userClient(DB, U);
    const org = (await c.query("select public.create_organisation('Co', 'main_contractor') as id")).rows[0].id;
    await c.query("insert into public.projects (name, org_id, created_by) values ('P', $1, $2)", [org, U]);
    await c.end();

    await runSqlFile(admin, SCHEMA); // second application must not throw

    const pol = await admin.query("select policyname from pg_policies where schemaname='public' and tablename='projects' and cmd='INSERT'");
    assert.deepEqual(pol.rows.map((r) => r.policyname), ["org admins insert projects"]);
    const fn = await admin.query("select prosrc, provolatile from pg_proc where oid = 'public.ensure_organisation()'::regprocedure");
    assert.match(fn.rows[0].prosrc, /role = 'admin'/);
    assert.doesNotMatch(fn.rows[0].prosrc, /insert into/i);
    const g = await admin.query("select has_function_privilege('anon', 'public.ensure_organisation()', 'EXECUTE') as anon");
    assert.equal(g.rows[0].anon, false);
    const counts = await admin.query("select (select count(*) from public.organisations)::int o, (select count(*) from public.projects)::int p, (select count(*) from public.organisation_members)::int m");
    assert.deepEqual(counts.rows[0], { o: 1, p: 1, m: 1 });
    await admin.end();

    const c2 = await userClient(DB, U);
    assert.equal((await c2.query("select public.ensure_organisation() as id")).rows[0].id, org);
    await c2.end();
  } finally {
    await dropTestDatabase(DB);
  }
});
