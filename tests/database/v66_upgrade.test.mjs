// v66 migration safety: removing the Dayworks & Variations 'approver' role.
// Upgrading a populated pre-v66 database moves an existing approver grant
// to contributor (same powers, nobody locked out), removes the approver
// reference row so it can't be granted again, the helpers stop accepting
// it, and applying the schema twice changes nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, runSqlFile, runSql, adminClient, userClient } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SETUP = path.join(__dirname, "../lib/mock_setup.sql");
const SCHEMA = path.join(__dirname, "../../sql/schema.sql");
const LEGACY_SHIM = path.join(__dirname, "../lib/legacy_invite_shim.sql");
const FULL = fs.readFileSync(SCHEMA, "utf8");
const PRE_V66 = FULL.slice(0, FULL.indexOf("-- ─── v66 ADDITIONS"));
const OWNER = "a6600000-0000-0000-0000-000000000001", APPR = "a6600000-0000-0000-0000-000000000002", VIEW = "a6600000-0000-0000-0000-000000000003";

const SNAPSHOT_SQL = `
  select json_build_object(
    'module_roles', (select json_agg(module || ':' || role order by module, role) from public.module_roles),
    'grants', (select json_agg(user_id::text || ':' || module || ':' || role order by user_id, module) from public.project_module_roles),
    'funcs', (select json_agg(json_build_object('f', proname, 'src', prosrc, 'acl', proacl::text, 'cfg', proconfig, 'secdef', prosecdef) order by proname)
                from pg_proc where pronamespace = 'public'::regnamespace
                 and proname in ('can_view_commercial','can_edit_commercial','can_submit_commercial','can_approve_commercial','project_module_role'))
  ) as s`;

test("v66: the pre-v66 prefix still has the approver role (sanity)", () => {
  assert.ok(PRE_V66.includes("('commercial', 'approver', 3)") && !PRE_V66.includes("v66 ADDITIONS"));
});

test("v66: an existing approver keeps their access as a contributor, approver can't be granted again, helpers refuse it, and applying twice is a no-op", async () => {
  const db = "tracker_test_v66_upgrade";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V66);
    await runSqlFile(admin, LEGACY_SHIM);
    await admin.query("insert into auth.users (id, email) values ($1,'o@x.test'),($2,'a@x.test'),($3,'v@x.test')", [OWNER, APPR, VIEW]);

    const o = await userClient(db, OWNER);
    const org = (await o.query("select public.create_organisation('Mogford','main_contractor') as id")).rows[0].id;
    const proj = (await o.query("insert into public.projects (name, org_id, created_by) values ('P',$1,$2) returning id", [org, OWNER])).rows[0].id;
    const code = (await o.query("select public.test_regenerate_invite_code($1) as c", [proj])).rows[0].c;
    for (const uid of [APPR, VIEW]) {
      const c = await userClient(db, uid);
      await c.query("select public.test_join_project_by_invite($1)", [code]);
      await c.end();
    }
    await o.query("insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','approver',$3)", [proj, APPR, OWNER]);
    await o.query("insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$3)", [proj, VIEW, OWNER]);

    // Pre-v66 the approver can raise and submit a daywork.
    const a = await userClient(db, APPR);
    const ev = (await a.query("insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Before v66') returning id", [proj])).rows[0].id;
    await a.query("update public.commercial_events set status='submitted' where id=$1", [ev]);
    await a.end();

    // Upgrade to v66.
    await runSql(admin, FULL);

    const grants = (await admin.query("select user_id::text as u, role from public.project_module_roles where module='commercial' order by role")).rows;
    assert.deepEqual(grants, [{ u: APPR, role: "contributor" }, { u: VIEW, role: "viewer" }]);
    const roles = (await admin.query("select role from public.module_roles where module='commercial' order by sort_order")).rows.map((r) => r.role);
    assert.deepEqual(roles, ["viewer", "contributor"]);

    // The migrated user still has full contributor powers: approve with a signature.
    const a2 = await userClient(db, APPR);
    const caps = (await a2.query("select public.can_view_commercial($1) v, public.can_edit_commercial($1) e", [proj])).rows[0];
    assert.deepEqual(caps, { v: true, e: true });
    // v68: can_submit_commercial / can_approve_commercial are internal-only
    // (the commercial_events trigger calls can_submit_commercial as owner);
    // the approval below proves submit rights still work through it.
    await assert.rejects(a2.query("select public.can_submit_commercial($1)", [proj]), /permission denied for function/i);
    await assert.rejects(a2.query("select public.can_approve_commercial($1)", [proj]), /permission denied for function/i);
    assert.equal((await admin.query("select public.can_approve_commercial($1) ap", [proj])).rows[0].ap, false);
    await a2.query("update public.commercial_events set status='approved', pending_signature_typed_name='Client' where id=$1", [ev]);
    assert.equal((await a2.query("select status from public.commercial_events where id=$1", [ev])).rows[0].status, "approved");
    await a2.end();

    // The viewer is unchanged.
    const v = await userClient(db, VIEW);
    assert.deepEqual((await v.query("select public.can_view_commercial($1) v, public.can_edit_commercial($1) e", [proj])).rows[0], { v: true, e: false });
    await v.end();

    // The owner can no longer grant 'approver' (foreign key to module_roles).
    await assert.rejects(
      o.query("update public.project_module_roles set role='approver' where project_id=$1 and user_id=$2", [proj, VIEW]),
      /foreign key/i
    );
    await assert.rejects(
      o.query("insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','approver',$2)", [proj, OWNER]),
      /foreign key/i
    );
    await o.end();

    // The helpers no longer mention approver at all.
    const srcs = (await admin.query("select proname, prosrc from pg_proc where pronamespace='public'::regnamespace and proname in ('can_view_commercial','can_edit_commercial','can_submit_commercial','can_approve_commercial')")).rows;
    assert.equal(srcs.length, 4);
    for (const r of srcs) assert.ok(!r.prosrc.includes("approver"), `${r.proname} still mentions approver`);

    // Grants stay signed-in only (v68: submit/approve closed to signed-in users too).
    for (const [f, au] of [["can_view_commercial", true], ["can_edit_commercial", true], ["can_submit_commercial", false], ["can_approve_commercial", false]]) {
      const { rows } = await admin.query(`select has_function_privilege('anon', 'public.${f}(uuid)', 'EXECUTE') an, has_function_privilege('authenticated', 'public.${f}(uuid)', 'EXECUTE') au`);
      assert.deepEqual(rows[0], { an: false, au }, f);
    }

    // Apply again: nothing changes.
    const before = (await admin.query(SNAPSHOT_SQL)).rows[0].s;
    await runSql(admin, FULL);
    const after = (await admin.query(SNAPSHOT_SQL)).rows[0].s;
    assert.deepEqual(after, before);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});
