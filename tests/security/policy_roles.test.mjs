// Guard: every RLS policy created by v61 and later is scoped TO
// authenticated, so it's never evaluated for anon/public (an anon query
// would otherwise hit helpers anon can't execute and error — see the
// v58 storage anon test).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient } from "../lib/db.mjs";

const DB = "tracker_test_policy_roles";
const SCHEMA = fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8");
const NEW = SCHEMA.slice(SCHEMA.indexOf("-- ─── v61 ADDITIONS"));
const NAMES = [...NEW.matchAll(/create policy "([^"]+)" on ([a-z_.]+)/g)].map((m) => [m[1], m[2]]);

before(async () => { await createTestDatabase(DB); await setupSchema(DB); });
after(async () => { await dropTestDatabase(DB); });

test("v61+ policies exist and every one applies to authenticated only (never public/anon)", async () => {
  assert.ok(NAMES.length >= 20, `found ${NAMES.length} new policies`);
  const a = adminClient(DB); await a.connect();
  try {
    for (const [name, table] of NAMES) {
      const [schema, tbl] = table.includes(".") ? table.split(".") : ["public", table];
      const r = await a.query("select roles::text[] roles from pg_policies where schemaname=$1 and tablename=$2 and policyname=$3", [schema, tbl, name]);
      assert.equal(r.rowCount, 1, `${table} "${name}" exists`);
      assert.deepEqual(r.rows[0].roles, ["authenticated"], `${table} "${name}" is scoped to authenticated`);
    }
  } finally { await a.end(); }
});

test("anon cannot execute the v61 storage helper", async () => {
  const a = adminClient(DB); await a.connect();
  try {
    const r = await a.query("select has_function_privilege('anon', 'public.controlled_documents_party_ok(text)', 'execute') ok");
    assert.equal(r.rows[0].ok, false);
  } finally { await a.end(); }
});
