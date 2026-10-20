// v68 — 13 SECURITY DEFINER functions closed to signed-in users (and
// kept closed to anon/PUBLIC). None is called by a page, the edge
// function, an RLS policy, a view or a SECURITY INVOKER function; the ones
// still in use are only called from other SECURITY DEFINER functions or
// triggers, which run as the owner and so keep working. CLOSED, NOT
// DROPPED: every one stays defined. Also: anon/PUBLIC lose every privilege
// on the commercial_event_totals view.
// Real non-superuser roles (authenticated / anon), real RPCs and triggers.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient, runSqlFile, runSql,
} from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = "tracker_test_v68";
const DB_DACL = "tracker_test_v68_default_acl";
const U = (n) => `a6810000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SUBA = U(2), SUBA2 = U(3);
const EMAIL = { [OWNER]: "owner@v68s.test", [SUBA]: "a@almo68s.test", [SUBA2]: "a2@almo68s.test" };

// signature (as regprocedure prints it, without schema) -> a direct call
const V68_CLOSED = [
  ["can_approve_commercial(uuid)", "select public.can_approve_commercial($1::uuid)"],
  ["can_write_snags(uuid)", "select public.can_write_snags($1::uuid)"],
  ["can_submit_commercial(uuid)", "select public.can_submit_commercial($1::uuid)"],
  ["can_verify_snag(uuid,uuid)", "select public.can_verify_snag($1::uuid, null)"],
  ["own_party_row(uuid,uuid)", "select public.own_party_row($1::uuid, null)"],
  ["party_cap(uuid,text)", "select public.party_cap($1::uuid, 'snags_all')"],
  ["party_member_role_for(uuid,text)", "select public.party_member_role_for($1::uuid, 'main_contractor')"],
  ["is_project_member_user(uuid,uuid)", "select public.is_project_member_user($1::uuid, $1::uuid)"],
  ["join_project_by_invite(text)", "select public.join_project_by_invite($1::text)"],
  ["regenerate_invite_code(uuid)", "select public.regenerate_invite_code($1::uuid)"],
  ["regenerate_snagging_invite_code(uuid)", "select public.regenerate_snagging_invite_code($1::uuid)"],
  ["revoke_invite_code(uuid)", "select public.revoke_invite_code($1::uuid)"],
  ["revoke_snagging_invite_code(uuid)", "select public.revoke_snagging_invite_code($1::uuid)"],
];

// ALLOWLIST CI GUARD: after v68, EXACTLY these public SECURITY DEFINER
// functions are EXECUTE-able by authenticated (live had 80 before v68).
// A new SECURITY DEFINER function a page/policy needs must be added here
// on purpose; anything internal-only should be revoked from authenticated.
// (Test-only fixture helpers test_* from tests/lib/legacy_invite_shim.sql
// are excluded: they never exist outside the test databases.)
const AUTH_ALLOWLIST = [
  "accept_party_invite(text,uuid)",
  "add_org_member_to_project(uuid,uuid,text)",
  "add_party_member(uuid,uuid)",
  "approve_commercial_approval_request(text,text,text,text)",
  "approve_organisation_membership(uuid)",
  "can_edit_commercial(uuid)",
  "can_edit_toolbox_talk_template_library(uuid)",
  "can_edit_toolbox_talks(uuid)",
  "can_manage_party_invite(uuid,uuid)",
  "can_read_action_row(uuid,uuid)",
  "can_read_audit_row(text,uuid,uuid)",
  "can_read_project_party(uuid,uuid,uuid)",
  "can_read_snag_row(uuid,uuid)",
  "can_see_commercial_prices(uuid)",
  "can_see_party_row(uuid,uuid)",
  "can_view_commercial(uuid)",
  "can_view_toolbox_talks(uuid)",
  "cancel_party_invite(uuid)",
  "commercial_access_role(uuid)",
  "commercial_tbc_event_ids(uuid)",
  "controlled_documents_party_ok(text)",
  "create_organisation(text,text)",
  "create_party_invite(uuid,text,text,text,uuid)",
  "effective_toolbox_talk_role(uuid)",
  "ensure_organisation()",
  "get_commercial_approval_request(text)",
  "get_commercial_event_view(uuid)",
  "get_my_job_roles()",
  "get_my_organisation_requests()",
  "get_my_project_roles()",
  "get_my_role(uuid)",
  "get_organisation_members(uuid)",
  "get_organisation_membership_requests(uuid,text)",
  "get_party_invite(text)",
  "get_project_members(uuid)",
  "get_project_parties(uuid)",
  "get_unassigned_company_snags()",
  "get_unassigned_company_work()",
  "import_programme_activities(uuid,jsonb)",
  "is_org_admin(uuid)",
  "is_org_member(uuid)",
  "is_owner_side_user(uuid,uuid)",
  "is_party_only(uuid)",
  "is_project_editor(uuid)",
  "is_project_editor_user(uuid,uuid)",
  "is_project_member(uuid)",
  "is_project_owner(uuid)",
  "list_commercial_variation_facts(uuid)",
  "owner_side_projects()",
  "party_cap_projects(text)",
  "party_scope_ids(text)",
  "project_module_role(uuid,text)",
  "reject_commercial_approval_request(text,text,text)",
  "reject_organisation_membership(uuid,text)",
  "remove_party(uuid)",
  "remove_party_member(uuid,uuid)",
  "request_commercial_approval(uuid,text,text,text,integer)",
  "request_organisation_membership(uuid)",
  "resend_party_invite(uuid)",
  "resolve_commercial_approval_evidence(text,uuid)",
  "revoke_commercial_approval_request(uuid)",
  "search_organisations(text)",
  "set_main_contractor_access(uuid,text)",
  "set_party_role(uuid,text,text)",
  "set_project_member_role(uuid,uuid,text)",
  "site_photos_read_authorized(text)",
  "snag_write_projects()",
  // v69: the note-required progress RPCs the plot page, Site Details and
  // new-site form call (each checks is_project_editor itself).
  "clear_plot_override(uuid,text)",
  "retire_external_works_package(uuid,text)",
  "save_external_works_package(uuid,uuid,text,numeric,numeric,text[],text)",
  "set_external_works(uuid,numeric,numeric,text)",
  "set_plot_override(uuid,numeric,text)",
  // v72 (Handover Part B): explicit handover confirmation + optional
  // buyer/solicitor share link, mirroring the Commercial approval-link
  // RPCs above exactly.
  "confirm_plot_handover(uuid,text,jsonb,jsonb,text)",
  "get_plot_handover_share(text)",
  "request_plot_handover_share(uuid,text,text,integer)",
  "revoke_plot_handover_share(uuid)",
  // v75: block-level build progress stages, the note-required override
  // RPCs the block page calls (each checks is_project_editor itself) —
  // exact mirror of set_plot_override / clear_plot_override above.
  "set_block_override(uuid,numeric,text)",
  "clear_block_override(uuid,text)"
].sort();

const PRIV_SQL = `
  select p.prosecdef,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_ok
    from pg_proc p where p.oid = to_regprocedure($1)`;
const AUTH_EXECUTABLE_DEFINER_SQL = `
  select replace(p.oid::regprocedure::text, 'public.', '') as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and p.proname not like 'test\\_%'
     and has_function_privilege('authenticated', p.oid, 'EXECUTE')
   order by 1`;
const VIEW_ACL_SQL = `
  select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end as grantee, a.privilege_type
    from pg_class c, aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
   where c.oid = 'public.commercial_event_totals'::regclass and a.grantee in (0, 'anon'::regrole::oid, 'authenticated'::regrole::oid)
   order by 1, 2`;

const fx = {};
async function as(user, fn) {
  const c = await userClient(DB, user);
  try { return await fn(c); } finally { await c.end(); }
}
async function sql(q, p = []) {
  const a = adminClient(DB); await a.connect();
  try { return await a.query(q, p); } finally { await a.end(); }
}
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);
  await as(OWNER, async (c) => {
    fx.ownerOrg = (await one(c, "select public.create_organisation('Owner 68s', 'developer_client') as id")).id;
    fx.job = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job 68s', $1, $2) returning id", [fx.ownerOrg, OWNER])).id;
    fx.list = (await one(c, "insert into public.snag_lists (project_id, title) values ($1, 'L') returning id", [fx.job])).id;
    fx.inv = await one(c, "select * from public.create_party_invite($1, $2, 'main_contractor', null, null)", [fx.job, EMAIL[SUBA]]);
    await c.query("insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$2)", [fx.job, OWNER]);
  });
  await as(SUBA, async (c) => {
    fx.mainco = (await one(c, "select public.create_organisation('MainCo 68s', 'main_contractor') as id")).id;
    await c.query("select public.accept_party_invite($1, $2)", [fx.inv.token, fx.mainco]);
  });
  fx.party = (await sql("select id from public.project_parties where project_id = $1 and org_id = $2", [fx.job, fx.mainco])).rows[0].id;
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1, $2, 'member')", [fx.mainco, SUBA2]);
});

after(async () => {
  await dropTestDatabase(DB);
  await dropTestDatabase(DB_DACL);
});

test("all 13 still exist (closed, not dropped), are SECURITY DEFINER with search_path pinned, and NOT executable by authenticated, anon or PUBLIC", async () => {
  for (const [sig] of V68_CLOSED) {
    const { rows } = await sql(PRIV_SQL, [`public.${sig}`]);
    assert.equal(rows.length, 1, `public.${sig} must still exist`);
    assert.equal(rows[0].prosecdef, true, `${sig} should be SECURITY DEFINER`);
    assert.equal(rows[0].auth_ok, false, `authenticated must not have EXECUTE on ${sig}`);
    assert.equal(rows[0].anon_ok, false, `anon must not have EXECUTE on ${sig}`);
    assert.equal(rows[0].public_ok, false, `PUBLIC must not have EXECUTE on ${sig}`);
    const cfg = (await sql("select proconfig from pg_proc where oid = to_regprocedure($1)", [`public.${sig}`])).rows[0].proconfig;
    assert.ok(cfg && cfg.some((s) => s.startsWith("search_path=")), `${sig} keeps its pinned search_path`);
  }
});

for (const [sig, q] of V68_CLOSED) {
  test(`v68: a signed-in user AND anon calling ${sig} directly get permission denied`, async () => {
    const arg = sig.startsWith("join_project_by_invite") ? "some-code" : fx.job;
    await as(OWNER, (c) => assert.rejects(c.query(q, [arg]), /permission denied for function/i));
    const anon = await anonClient(DB);
    try { await assert.rejects(anon.query(q, [arg]), /permission denied for function/i); } finally { await anon.end(); }
  });
}

test("ALLOWLIST CI GUARD: the SECURITY DEFINER functions authenticated can execute are EXACTLY the 67 kept after v68, plus the 5 v69 progress RPCs, the 4 v72 handover-confirmation RPCs and the 2 v75 block-override RPCs", async () => {
  const got = (await sql(AUTH_EXECUTABLE_DEFINER_SQL)).rows.map((r) => r.sig).sort();
  assert.equal(AUTH_ALLOWLIST.length, 78);
  assert.deepEqual(got, AUTH_ALLOWLIST,
    "authenticated must reach only the reviewed set. Internal-only SECURITY DEFINER helpers: revoke execute from public, anon, authenticated. " +
    "Needed by a page or an RLS policy: add to AUTH_ALLOWLIST on purpose.");
  for (const keep of ["is_owner_side_user(uuid,uuid)", "is_project_editor_user(uuid,uuid)", "search_organisations(text)", "remove_party_member(uuid,uuid)"]) {
    assert.ok(got.includes(keep), `${keep} must stay callable by signed-in users`);
  }
});

test("the internal callers still work as a signed-in user (each runs as owner)", async () => {
  // party_member_role_for: via accept_party_invite (fixture) and add_party_member.
  assert.equal((await sql("select role from public.project_members where project_id = $1 and user_id = $2", [fx.job, SUBA])).rows[0].role, "collaborator",
    "a main contractor on a full-access job joins as collaborator (party_member_role_for)");
  await as(SUBA, (c) => c.query("select public.add_party_member($1, $2)", [fx.party, SUBA2]));
  assert.equal((await sql("select role from public.project_members where project_id = $1 and user_id = $2", [fx.job, SUBA2])).rows[0].role, "collaborator");

  // is_project_member_user: the snag_items trigger's assigned_to check.
  const snag = await as(OWNER, (c) => one(c,
    "insert into public.snag_items (project_id, snag_list_id, description, assigned_to) values ($1, $2, 'v68 snag', $3) returning id, assigned_to",
    [fx.job, fx.list, SUBA]));
  assert.equal(snag.assigned_to, SUBA);
  await as(OWNER, (c) => assert.rejects(
    c.query("insert into public.snag_items (project_id, snag_list_id, description, assigned_to) values ($1, $2, 'bad', $3)", [fx.job, fx.list, U(99)]),
    /assigned_to must be a member of this project/));

  // party_cap / own_party_row: via can_see_party_row and the snag RLS helpers.
  await as(SUBA, async (c) => {
    assert.equal((await one(c, "select public.can_see_party_row($1, $2) ok", [fx.job, fx.party])).ok, true);
    assert.ok(Array.isArray((await c.query("select * from public.snag_write_projects()")).rows));
  });

  // can_submit_commercial: via the commercial_events trigger (submit).
  const ev = await as(OWNER, async (c) => {
    const id = (await one(c, "insert into public.commercial_events (project_id, type, title) values ($1, 'daywork', 'v68 dw') returning id", [fx.job])).id;
    await c.query("insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','l',1,10)", [id]);
    await c.query("update public.commercial_events set status = 'submitted' where id = $1", [id]);
    return id;
  });
  assert.equal((await sql("select status from public.commercial_events where id = $1", [ev])).rows[0].status, "submitted");
  // the anon approval link still reads the totals view (as owner, inside the RPC)
  const tok = await as(OWNER, (c) => one(c, "select * from public.request_commercial_approval($1, 'c@example.invalid', null, null, 24)", [ev]).then((r) => r.token));
  const anon = await anonClient(DB);
  try {
    const r = (await anon.query("select public.get_commercial_approval_request($1) r", [tok])).rows[0].r;
    assert.equal(r.active, true);
    assert.equal(Number(r.event.total_value), 10);
  } finally { await anon.end(); }
  // a signed-in contributor can still read the view directly
  await as(OWNER, async (c) => {
    assert.equal(Number((await one(c, "select total from public.commercial_event_totals where commercial_event_id = $1", [ev])).total), 10);
  });
});

test("v68: anon and PUBLIC have no privilege on commercial_event_totals; authenticated has SELECT", async () => {
  const rows = (await sql(VIEW_ACL_SQL)).rows;
  assert.deepEqual(rows.filter((r) => r.grantee !== "authenticated"), []);
  assert.ok(rows.some((r) => r.grantee === "authenticated" && r.privilege_type === "SELECT"));
});

test("v68 holds with Supabase's default-ACL auto-grant and after running schema.sql twice (closed state, view, remove_party_member guard)", async () => {
  await createTestDatabase(DB_DACL);
  const admin = adminClient(DB_DACL);
  await admin.connect();
  try {
    await runSqlFile(admin, path.join(__dirname, "../lib/mock_setup.sql"));
    await runSql(admin, "alter default privileges in schema public grant execute on functions to anon, authenticated");
    await runSql(admin, "alter default privileges in schema public grant all on tables to anon, authenticated");
    const schemaPath = path.join(__dirname, "../../sql/schema.sql");
    for (let run = 1; run <= 2; run++) {
      await runSqlFile(admin, schemaPath);
      for (const [sig] of V68_CLOSED) {
        const { rows } = await admin.query(PRIV_SQL, [`public.${sig}`]);
        assert.equal(rows.length, 1, `run ${run}: ${sig} must still exist`);
        assert.equal(rows[0].auth_ok, false, `run ${run}: authenticated regained ${sig}`);
        assert.equal(rows[0].anon_ok, false, `run ${run}: anon regained ${sig}`);
        assert.equal(rows[0].public_ok, false, `run ${run}: PUBLIC regained ${sig}`);
      }
      const got = (await admin.query(AUTH_EXECUTABLE_DEFINER_SQL)).rows.map((r) => r.sig).sort();
      assert.deepEqual(got, AUTH_ALLOWLIST, `run ${run}: authenticated-executable SECURITY DEFINER set changed`);
      const acl = (await admin.query(VIEW_ACL_SQL)).rows;
      assert.deepEqual(acl.filter((r) => r.grantee !== "authenticated"), [], `run ${run}: anon/PUBLIC regained a privilege on commercial_event_totals`);
      assert.ok(acl.some((r) => r.grantee === "authenticated" && r.privilege_type === "SELECT"), `run ${run}: authenticated lost SELECT on the view`);
      const src = (await admin.query("select prosrc, proconfig from pg_proc where oid = 'public.remove_party_member(uuid, uuid)'::regprocedure")).rows[0];
      assert.match(src.prosrc, /from public\.project_party_members m where m\.party_id = p_party_id and m\.user_id = p_user_id/, `run ${run}: remove_party_member lost its v68 guard`);
      assert.deepEqual(src.proconfig, ["search_path=public"]);
    }
  } finally {
    await admin.end();
  }
});
