// Organisation onboarding RPCs — EXECUTE privilege boundary (v43).
// Separate from tests/security/organisation_join_requests.test.mjs
// (which exercises RLS/business-logic correctness as an authenticated
// user throughout): this file specifically proves the GRANT/REVOKE
// change itself — that a genuinely anonymous Postgres role (`anon`, a
// real unauthenticated REST API caller, distinct from `authenticated`
// with no JWT sub) cannot invoke any of the 8 v42 functions at all,
// while the ordinary `authenticated` role still can. See
// tests/lib/db.mjs's anonClient()/userClient() header comments for why
// these are two different things worth testing separately.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_organisation_rpc_privileges";
const USER = "f1000000-0000-0000-0000-000000000001";

// One call per v42 RPC, with argument shapes that are valid enough for
// execution to actually begin (proving the GRANT works) — the exact
// business outcome (success, or a business-rule exception) doesn't
// matter here, only that it is NEVER a permission-denied error.
const RPC_CALLS = [
  { name: "search_organisations", sql: "select * from public.search_organisations('anything') as t" },
  { name: "create_organisation", sql: "select public.create_organisation('Priv Test Org 2', 'other') as id" },
  { name: "request_organisation_membership", sql: "select public.request_organisation_membership('00000000-0000-0000-0000-000000000000')" },
  { name: "approve_organisation_membership", sql: "select public.approve_organisation_membership('00000000-0000-0000-0000-000000000000')" },
  { name: "reject_organisation_membership", sql: "select public.reject_organisation_membership('00000000-0000-0000-0000-000000000000', null)" },
  { name: "get_my_organisation_requests", sql: "select * from public.get_my_organisation_requests() as t" },
  { name: "get_organisation_members", sql: "select * from public.get_organisation_members('00000000-0000-0000-0000-000000000000') as t" },
  { name: "get_organisation_membership_requests", sql: "select * from public.get_organisation_membership_requests('00000000-0000-0000-0000-000000000000', 'pending') as t" },
];

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query("insert into auth.users (id, email) values ($1, 'rpc-priv-test@example.com')", [USER]);
  await admin.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

test("6. Every v42 RPC is callable by the authenticated role (privilege present, whatever the business outcome)", async () => {
  const client = await userClient(DB, USER);
  try {
    for (const { name, sql } of RPC_CALLS) {
      try {
        await client.query(sql);
        // Succeeded outright — fine, that's also proof the grant works.
      } catch (err) {
        assert.ok(
          !isRlsError(err),
          `${name}(): authenticated must never be refused on privilege grounds — got: ${err.message}`
        );
      }
    }
  } finally {
    await client.end();
  }
});

test("7. Every v42 RPC is REJECTED for the anon role — a genuinely unauthenticated caller, not merely an authenticated session with no identity", async () => {
  const client = await anonClient(DB);
  try {
    for (const { name, sql } of RPC_CALLS) {
      await assert.rejects(
        () => client.query(sql),
        (err) => {
          assert.match(
            err.message,
            /permission denied for function/i,
            `${name}(): expected a permission-denied error for anon, got: ${err.message}`
          );
          return true;
        },
        `${name}() must be rejected outright for an anonymous caller`
      );
    }
  } finally {
    await client.end();
  }
});

test("search_organisations() specifically: anon cannot call it even with a well-formed, plausible search term", async () => {
  const client = await anonClient(DB);
  try {
    await assert.rejects(
      () => client.query("select * from public.search_organisations('Acme') as t"),
      (err) => /permission denied for function/i.test(err.message)
    );
  } finally {
    await client.end();
  }
});

test("search_organisations() specifically: authenticated can still call it and gets a real (possibly empty) result set back", async () => {
  const client = await userClient(DB, USER);
  try {
    const { rows } = await client.query("select * from public.search_organisations('Acme') as t");
    assert.ok(Array.isArray(rows));
  } finally {
    await client.end();
  }
});

test("Sanity: the anon role genuinely has no EXECUTE grant on these functions at the catalog level, not just an incidental failure", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const fnNames = [
      "search_organisations", "create_organisation", "request_organisation_membership",
      "approve_organisation_membership", "reject_organisation_membership",
      "get_my_organisation_requests", "get_organisation_members", "get_organisation_membership_requests",
    ];
    const { rows } = await admin.query(
      `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1)
         and has_function_privilege('anon', p.oid, 'EXECUTE')`,
      [fnNames]
    );
    assert.equal(rows.length, 0, `expected zero of these functions to show anon EXECUTE privilege, found: ${rows.map((r) => r.proname).join(", ")}`);
  } finally {
    await admin.end();
  }
});

test("Sanity: the authenticated role genuinely DOES have EXECUTE grant on all 8 functions at the catalog level", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const fnNames = [
      "search_organisations", "create_organisation", "request_organisation_membership",
      "approve_organisation_membership", "reject_organisation_membership",
      "get_my_organisation_requests", "get_organisation_members", "get_organisation_membership_requests",
    ];
    const { rows } = await admin.query(
      `select p.proname
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any($1)
         and has_function_privilege('authenticated', p.oid, 'EXECUTE')`,
      [fnNames]
    );
    assert.equal(rows.length, fnNames.length, `expected all 8 functions to grant authenticated EXECUTE, found only: ${rows.map((r) => r.proname).join(", ")}`);
  } finally {
    await admin.end();
  }
});
