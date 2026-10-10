// v59 — EXECUTE privileges of the `anon` role (a caller holding only the
// public anon key, no session) on public SECURITY DEFINER functions.
//
// Postgres grants EXECUTE on new functions to PUBLIC, and the real
// Supabase project additionally auto-grants EXECUTE directly to anon at
// CREATE time via ALTER DEFAULT PRIVILEGES (the "default-ACL auto-grant
// gotcha", see commercial_approval_workflow.test.mjs test 19). A
// SECURITY DEFINER function runs as its owner and bypasses RLS, so every
// one anon can reach is part of the public attack surface.
//
// The ALLOWLIST CI GUARD below fails the build if anon can execute ANY
// public SECURITY DEFINER function other than the 4 the external client
// approval link genuinely needs. A new SECURITY DEFINER function must
// either be added to the allowlist on purpose, or follow the convention:
//   revoke all on function public.f(...) from public;
//   revoke execute on function public.f(...) from anon;
//   grant execute on function public.f(...) to authenticated;
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient,
  runSqlFile, runSql,
} from "../lib/db.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = "tracker_test_anon_grants";
const DB_DACL = "tracker_test_anon_grants_default_acl";

const OWNER = "a5900000-0000-0000-0000-000000000001";
const JOINER = "a5900000-0000-0000-0000-000000000002";
const SNAG_JOINER = "a5900000-0000-0000-0000-000000000003";

// The ONLY public SECURITY DEFINER functions anon may execute — the
// external client approval link (commercial-approval.html + the
// commercial-approval-evidence Edge Function).
const ANON_ALLOWLIST = [
  "approve_commercial_approval_request(text,text,text,text)",
  "get_commercial_approval_request(text)",
  "reject_commercial_approval_request(text,text,text)",
  "resolve_commercial_approval_evidence(text,uuid)",
].sort();

// Internal functions v59 took away from anon. Each entry: signature as
// regprocedure prints it, plus a call that exercises it.
const REVOKED = [
  ["is_project_member(uuid)", "select public.is_project_member($1::uuid)", "uuid"],
  ["is_project_editor(uuid)", "select public.is_project_editor($1::uuid)", "uuid"],
  ["is_project_owner(uuid)", "select public.is_project_owner($1::uuid)", "uuid"],
  ["is_org_member(uuid)", "select public.is_org_member($1::uuid)", "uuid"],
  ["is_org_admin(uuid)", "select public.is_org_admin($1::uuid)", "uuid"],
  ["can_view_commercial(uuid)", "select public.can_view_commercial($1::uuid)", "uuid"],
  ["can_edit_commercial(uuid)", "select public.can_edit_commercial($1::uuid)", "uuid"],
  ["can_submit_commercial(uuid)", "select public.can_submit_commercial($1::uuid)", "uuid"],
  ["can_approve_commercial(uuid)", "select public.can_approve_commercial($1::uuid)", "uuid"],
  ["can_view_toolbox_talks(uuid)", "select public.can_view_toolbox_talks($1::uuid)", "uuid"],
  ["can_edit_toolbox_talks(uuid)", "select public.can_edit_toolbox_talks($1::uuid)", "uuid"],
  ["can_read_audit_row(text,uuid,uuid)", "select public.can_read_audit_row('projects', $1::uuid, $1::uuid)", "uuid"],
  ["get_my_role(uuid)", "select public.get_my_role($1::uuid)", "uuid"],
  ["get_my_project_roles()", "select * from public.get_my_project_roles()", null],
  ["project_module_role(uuid,text)", "select public.project_module_role($1::uuid, 'commercial')", "uuid"],
  ["effective_toolbox_talk_role(uuid)", "select public.effective_toolbox_talk_role($1::uuid)", "uuid"],
  ["get_project_members(uuid)", "select * from public.get_project_members($1::uuid)", "uuid"],
  ["join_project_by_invite(text)", "select public.join_project_by_invite($1::text)", "text"],
  ["ensure_organisation()", "select public.ensure_organisation()", null],
  ["import_programme_activities(uuid,jsonb)", "select public.import_programme_activities($1::uuid, '[]'::jsonb)", "uuid"],
  ["regenerate_invite_code(uuid)", "select public.regenerate_invite_code($1::uuid)", "uuid"],
  ["regenerate_snagging_invite_code(uuid)", "select public.regenerate_snagging_invite_code($1::uuid)", "uuid"],
  ["revoke_invite_code(uuid)", "select public.revoke_invite_code($1::uuid)", "uuid"],
  ["revoke_snagging_invite_code(uuid)", "select public.revoke_snagging_invite_code($1::uuid)", "uuid"],
  ["commercial_event_hash(uuid)", "select public.commercial_event_hash($1::uuid)", "uuid"],
];

const ANON_EXECUTABLE_DEFINER_SQL = `
  select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE')
   order by 1`;

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'v59owner@example.com'), ($2,'v59joiner@example.com'), ($3,'v59snag@example.com')`,
    [OWNER, JOINER, SNAG_JOINER]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const org = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;
  const proj = (await owner.query(
    "insert into public.projects (name, org_id, created_by) values ('v59 site', $1, $2) returning id", [org, OWNER]
  )).rows[0].id;
  await owner.query(
    `insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$2)`,
    [proj, OWNER]
  );
  await owner.query(`insert into public.snag_items (project_id, description) values ($1, 'v59 snag')`, [proj]);
  const eventId = (await owner.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork','v59 daywork') returning id`, [proj]
  )).rows[0].id;
  await owner.query(
    `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','labour',8,20)`,
    [eventId]
  );
  await owner.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
  await owner.end();

  fx = { org, proj, eventId };
});

after(async () => {
  await dropTestDatabase(DB);
  await dropTestDatabase(DB_DACL);
});

// ─── (1) Allowlist CI guard ──────────────────────────────────────────
test("ALLOWLIST CI GUARD: the public SECURITY DEFINER functions anon can execute are EXACTLY the 4 client-approval-link RPCs", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const { rows } = await admin.query(ANON_EXECUTABLE_DEFINER_SQL);
  await admin.end();
  assert.deepEqual(
    rows.map((r) => r.sig).sort(),
    ANON_ALLOWLIST,
    "anon (the public anon key, no session) must not be able to EXECUTE any other SECURITY DEFINER function. " +
      "If you added one, revoke it from public AND anon and grant it to authenticated (see sql/schema.sql v59), " +
      "or add it to ANON_ALLOWLIST here only if logged-out visitors genuinely need it."
  );
});

test("ALLOWLIST CI GUARD holds even with Supabase's default-ACL auto-grant (EXECUTE granted directly to anon at CREATE time), and after re-running schema.sql a second time", async () => {
  await createTestDatabase(DB_DACL);
  const admin = adminClient(DB_DACL);
  await admin.connect();
  await runSqlFile(admin, path.join(__dirname, "../lib/mock_setup.sql"));
  // Mirrors the real project's ALTER DEFAULT PRIVILEGES entry.
  await runSql(admin, "alter default privileges in schema public grant execute on functions to anon, authenticated");
  const schemaPath = path.join(__dirname, "../../sql/schema.sql");
  await runSqlFile(admin, schemaPath);
  const first = (await admin.query(ANON_EXECUTABLE_DEFINER_SQL)).rows.map((r) => r.sig).sort();
  await runSqlFile(admin, schemaPath); // the file is re-run top to bottom in production
  const second = (await admin.query(ANON_EXECUTABLE_DEFINER_SQL)).rows.map((r) => r.sig).sort();
  await admin.end();
  assert.deepEqual(first, ANON_ALLOWLIST);
  assert.deepEqual(second, ANON_ALLOWLIST, "a re-run of schema.sql must not hand anon its grants back");
});

test("every function in the v59 revoke list actually exists with that exact signature and is SECURITY DEFINER", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  for (const [sig] of REVOKED) {
    const { rows } = await admin.query(`select prosecdef from pg_proc where oid = to_regprocedure($1)`, [`public.${sig}`]);
    assert.equal(rows.length, 1, `public.${sig} not found`);
    assert.equal(rows[0].prosecdef, true, `public.${sig} should be SECURITY DEFINER`);
  }
  await admin.end();
});

// ─── (2) Each of the 25 rejects anon ─────────────────────────────────
for (const [sig, sql, argType] of REVOKED) {
  test(`anon CANNOT execute ${sig} — permission denied`, async () => {
    const anon = await anonClient(DB);
    try {
      const params = argType === "uuid" ? [fx.proj] : argType === "text" ? ["not-a-real-code"] : [];
      await assert.rejects(anon.query(sql, params), /permission denied for function/i);
    } finally {
      await anon.end();
    }
  });
}

// ─── (3) authenticated keeps EXECUTE on all 25 ───────────────────────
test("authenticated still has EXECUTE on all 25 v59 functions (catalog check), and PUBLIC no longer does", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  for (const [sig] of REVOKED) {
    const { rows } = await admin.query(
      `select has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') as auth_ok,
              has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') as anon_ok,
              exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where p.oid = to_regprocedure($1) and a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_ok`,
      [`public.${sig}`]
    );
    assert.equal(rows[0].auth_ok, true, `authenticated must keep EXECUTE on ${sig}`);
    assert.equal(rows[0].anon_ok, false, `anon must not have EXECUTE on ${sig}`);
    assert.equal(rows[0].public_ok, false, `PUBLIC must not have EXECUTE on ${sig}`);
  }
  await admin.end();
});

test("a signed-in member can still call the helpers and gets real answers", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query(
      `select public.is_project_member($1) as m, public.is_project_owner($1) as o, public.get_my_role($1) as r,
              public.can_view_commercial($1) as cv, length(public.commercial_event_hash($2)) as h`,
      [fx.proj, fx.eventId]
    );
    assert.equal(rows[0].m, true);
    assert.equal(rows[0].o, true);
    assert.equal(rows[0].r, "owner");
    assert.equal(rows[0].cv, true);
    assert.equal(rows[0].h, 64);
  } finally {
    await owner.end();
  }
});

// ─── (4) anon approval-link flow still works ─────────────────────────
test("SMOKE: the anon client-approval link still works end to end (get -> approve), including the internal commercial_event_hash() check it runs as owner", async () => {
  const owner = await userClient(DB, OWNER);
  const eventId = (await owner.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork','v59 approval smoke') returning id`, [fx.proj]
  )).rows[0].id;
  await owner.query(
    `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','labour',2,50)`,
    [eventId]
  );
  await owner.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
  const req = (await owner.query(
    `select * from public.request_commercial_approval($1,$2,null,null,168)`, [eventId, `client-${crypto.randomUUID()}@example.invalid`]
  )).rows[0];
  await owner.end();

  const anon = await anonClient(DB);
  try {
    const got = (await anon.query(`select public.get_commercial_approval_request($1) as r`, [req.token])).rows[0].r;
    assert.ok(got, "anon must still be able to open the approval link");
    await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  } finally {
    await anon.end();
  }

  const admin = adminClient(DB);
  await admin.connect();
  const { rows } = await admin.query(`select status from public.commercial_events where id=$1`, [eventId]);
  await admin.end();
  assert.equal(rows[0].status, "approved");
});

test("SMOKE: the anon reject path still works", async () => {
  const owner = await userClient(DB, OWNER);
  const eventId = (await owner.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork','v59 reject smoke') returning id`, [fx.proj]
  )).rows[0].id;
  await owner.query(
    `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','labour',1,10)`,
    [eventId]
  );
  await owner.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
  const req = (await owner.query(
    `select * from public.request_commercial_approval($1,$2,null,null,168)`, [eventId, `client-${crypto.randomUUID()}@example.invalid`]
  )).rows[0];
  await owner.end();

  const anon = await anonClient(DB);
  try {
    await anon.query(`select public.reject_commercial_approval_request($1,'Jane Client','Too expensive')`, [req.token]);
  } finally {
    await anon.end();
  }
  const admin = adminClient(DB);
  await admin.connect();
  const { rows } = await admin.query(`select status from public.commercial_events where id=$1`, [eventId]);
  await admin.end();
  assert.equal(rows[0].status, "rejected");
});

// ─── (5) invite join / regenerate / revoke for signed-in users ───────
test("a signed-in user can still join by invite, and an owner can still regenerate and revoke both invite codes", async () => {
  const owner = await userClient(DB, OWNER);
  const code = (await owner.query("select public.regenerate_invite_code($1) as c", [fx.proj])).rows[0].c;
  const snagCode = (await owner.query("select public.regenerate_snagging_invite_code($1) as c", [fx.proj])).rows[0].c;
  assert.ok(code && snagCode);

  const joiner = await userClient(DB, JOINER);
  const joined = (await joiner.query("select public.join_project_by_invite($1) as p", [code])).rows[0].p;
  assert.equal(joined, fx.proj);
  assert.equal((await joiner.query("select public.get_my_role($1) as r", [fx.proj])).rows[0].r, "collaborator");
  await joiner.end();

  const snagJoiner = await userClient(DB, SNAG_JOINER);
  assert.equal((await snagJoiner.query("select public.join_project_by_invite($1) as p", [snagCode])).rows[0].p, fx.proj);
  await snagJoiner.end();

  const members = (await owner.query("select * from public.get_project_members($1)", [fx.proj])).rows;
  assert.ok(members.length >= 3, "owner should see the joined members");

  await owner.query("select public.revoke_invite_code($1)", [fx.proj]);
  await owner.query("select public.revoke_snagging_invite_code($1)", [fx.proj]);
  await owner.end();

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`insert into auth.users (id, email) values ('a5900000-0000-0000-0000-000000000009','late@example.com')`);
  await admin.end();
  const late = await userClient(DB, "a5900000-0000-0000-0000-000000000009");
  const after = (await late.query("select public.join_project_by_invite($1) as p", [code])).rows[0].p;
  await late.end();
  assert.equal(after, null, "a revoked invite code must stop working");
});

// ─── (6) anon on RLS tables never sees rows ──────────────────────────
// v59 deliberately does NOT rewrite the policies that call these
// helpers without `to authenticated` (a later PR). Until then an anon
// SELECT on such a table raises "permission denied for function ..."
// instead of returning zero rows. Both outcomes mean "anon sees
// nothing" and both are accepted here; a returned row never is.
for (const table of ["projects", "snag_items", "commercial_events", "commercial_line_items", "organisations", "project_members", "commercial_approval_requests"]) {
  test(`anon SELECT on ${table} never returns rows (error or empty both acceptable)`, async () => {
    const admin = adminClient(DB);
    await admin.connect();
    const seeded = (await admin.query(`select count(*)::int as n from public.${table}`)).rows[0].n;
    await admin.end();
    if (["projects", "snag_items", "commercial_events", "commercial_line_items", "organisations"].includes(table)) {
      assert.ok(seeded > 0, `fixture should have seeded ${table}, or this test proves nothing`);
    }

    const anon = await anonClient(DB);
    try {
      const { rows } = await anon.query(`select * from public.${table}`);
      assert.equal(rows.length, 0, `anon must not see any ${table} rows`);
    } catch (err) {
      assert.match(err.message, /permission denied/i, `unexpected error type for anon on ${table}: ${err.message}`);
    } finally {
      await anon.end();
    }
  });
}
