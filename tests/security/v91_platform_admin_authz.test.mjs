// v91: is_platform_admin() is the server-side gate behind both the
// "Invite a new customer" admin page (which pages hide/bounce away
// from for anyone it returns false for) and the invite-customer edge
// function (which re-checks it itself via the caller's own JWT before
// ever touching the service-role key — see that function's own
// comment). These tests prove the real mechanism directly: a stranger
// and an ordinary org admin both get false, and reading
// interest_signups returns nothing for either of them even though
// v91 grants authenticated base SELECT privilege on it; the one real
// platform admin (platform_admins has exactly one row, added by hand
// via the SQL editor — there is no in-app way to grant this) gets
// true and can read the table.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v91_platform_admin_authz";
const U = (n) => `a9100000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const STRANGER = U(1), ORG_ADMIN = U(2), PLATFORM_ADMIN = U(3);
const EMAIL = {
  [STRANGER]: "stranger@x.test", [ORG_ADMIN]: "orgadmin@x.test", [PLATFORM_ADMIN]: "aled@x.test",
};

const fx = {};

async function as(user, fn) {
  const c = await userClient(DB, user);
  try { return await fn(c); } finally { await c.end(); }
}
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);
  // Aled adds the one platform admin by hand, via the SQL editor —
  // exactly how this is meant to be granted (see the schema's own
  // comment: no in-app UI for this, deliberately, until a second
  // platform admin is ever actually needed).
  await admin.query("insert into public.platform_admins (user_id) values ($1)", [PLATFORM_ADMIN]);
  await admin.query(
    "insert into public.interest_signups (name, email, company) values ('Jo Smith', 'jo@example.com', 'Smith Builders')"
  );
  await admin.end();

  // ORG_ADMIN is a completely ordinary organisation admin — the exact
  // role is_org_admin() grants for its own org, proving that being
  // *an* admin of *something* is not enough; it has to be the real
  // platform-wide one.
  await as(ORG_ADMIN, async (c) => {
    fx.org = await one(c, "select public.create_organisation('Org Co', 'main_contractor') as id", []).then((r) => r.id);
  });
});

after(async () => {
  await dropTestDatabase(DB);
});

test("v91: a stranger with no relationship to anything is not a platform admin", async () => {
  await as(STRANGER, async (c) => {
    const { rows } = await c.query("select public.is_platform_admin() as v");
    assert.equal(rows[0].v, false);
  });
});

test("v91: an ordinary organisation admin is not a platform admin either — being an org admin isn't enough", async () => {
  await as(ORG_ADMIN, async (c) => {
    const { rows } = await c.query("select public.is_platform_admin() as v");
    assert.equal(rows[0].v, false, "org-level admin must never be mistaken for platform-level admin");
  });
});

test("v91: the real platform admin is recognised", async () => {
  await as(PLATFORM_ADMIN, async (c) => {
    const { rows } = await c.query("select public.is_platform_admin() as v");
    assert.equal(rows[0].v, true);
  });
});

test("v91: a stranger's SELECT on interest_signups returns zero rows, even though authenticated now has base table privilege", async () => {
  await as(STRANGER, async (c) => {
    const { rows } = await c.query("select * from public.interest_signups");
    assert.deepEqual(rows, []);
  });
});

test("v91: an ordinary org admin's SELECT on interest_signups also returns zero rows", async () => {
  await as(ORG_ADMIN, async (c) => {
    const { rows } = await c.query("select * from public.interest_signups");
    assert.deepEqual(rows, []);
  });
});

test("v91: the platform admin's SELECT on interest_signups returns the real row", async () => {
  await as(PLATFORM_ADMIN, async (c) => {
    const { rows } = await c.query("select name, email, company from public.interest_signups");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].email, "jo@example.com");
    assert.equal(rows[0].company, "Smith Builders");
  });
});

test("v91: the platform admin still cannot write to interest_signups — the new policy is select-only", async () => {
  await as(PLATFORM_ADMIN, async (c) => {
    await assert.rejects(
      c.query("insert into public.interest_signups (name, email) values ('Someone', 'someone@example.com')"),
      /row-level security|permission denied/i,
      "no insert policy was added for platform admins — service_role/the SQL editor remain the only writers"
    );
  });
});

test("v91: is_platform_admin() itself exists as a SECURITY DEFINER function granted to authenticated, not a client-side-only check", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query(
      `select p.prosecdef, p.provolatile
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'is_platform_admin'`
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].prosecdef, true, "must be SECURITY DEFINER to read platform_admins despite its own zero-policy RLS");

    const grants = await admin.query(
      `select has_function_privilege('authenticated', 'public.is_platform_admin()', 'execute') as can_execute`
    );
    assert.equal(grants.rows[0].can_execute, true, "authenticated must be able to call this directly — the page and the edge function both rely on it");
  } finally {
    await admin.end();
  }
});

// Regression guard for the exact gotcha request_commercial_approval's
// own schema.sql comment documents (and v42's cleanup migration fixed
// for 8 other RPCs): this project's ALTER DEFAULT PRIVILEGES entry
// auto-grants EXECUTE to anon on every newly created function, which a
// later bare `revoke ... from public` does NOT undo (it only strips
// the aggregate PUBLIC pseudo-grant, not the direct per-role grant
// already made at CREATE TIME) — an explicit `revoke ... from anon`
// is required, and it's easy to forget.
test("v91: anon specifically (not just an unprivileged authenticated role) cannot execute is_platform_admin() — the exact default-privilege gotcha this schema has been bitten by before", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query(
      `select has_function_privilege('anon', 'public.is_platform_admin()', 'execute') as can_execute`
    );
    assert.equal(rows[0].can_execute, false, "anon must never be granted EXECUTE here, even via the project's own default-privilege ACL");
  } finally {
    await admin.end();
  }
});
