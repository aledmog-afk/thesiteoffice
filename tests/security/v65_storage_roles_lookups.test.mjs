// v65 — (A) the three storage.objects WRITE policies apply to
// authenticated only; (B) six internal SECURITY DEFINER lookups that
// take arbitrary user/party ids are no longer callable directly by a
// signed-in user (only from the SECURITY DEFINER functions/triggers that
// use them), while the two that RLS policies call keep their grant.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient,
  isRlsError, runSqlFile, runSql,
} from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB = "tracker_test_v65";
const DB_DACL = "tracker_test_v65_default_acl";

const OWNER = "a6500000-0000-0000-0000-000000000001";
const OUTSIDER = "a6500000-0000-0000-0000-000000000002";
const SNAGGER = "a6500000-0000-0000-0000-000000000003";

const STORAGE_POLICIES = [
  ["project editors upload site-photos", "INSERT"],
  ["project editors delete site-photos", "DELETE"],
  ["project editors upload controlled-documents", "INSERT"],
];

// signature -> a direct call a signed-in user might try
const V65_INTERNAL = [
  ["is_party_member_user(uuid,uuid)", "select public.is_party_member_user($1::uuid, $2::uuid)"],
  ["party_cap_user(uuid,uuid,text)", "select public.party_cap_user($1::uuid, $2::uuid, 'snags')"],
  ["user_party_ids(uuid,uuid)", "select * from public.user_party_ids($1::uuid, $2::uuid)"],
  ["can_be_assigned_work(uuid,uuid,uuid,text)", "select public.can_be_assigned_work($1::uuid, $2::uuid, null, 'actions')"],
  ["party_and_descendants(uuid)", "select * from public.party_and_descendants($1::uuid)"],
  ["commercial_event_hash(uuid)", "select public.commercial_event_hash($1::uuid)"],
];
const V65_KEPT = ["is_owner_side_user(uuid,uuid)", "is_project_editor_user(uuid,uuid)"];

const PRIV_SQL = `
  select p.prosecdef,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
         has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
         has_function_privilege('service_role', p.oid, 'EXECUTE') as service_ok,
         exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_ok
    from pg_proc p where p.oid = to_regprocedure($1)`;

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'v65owner@example.com'), ($2,'v65out@example.com'), ($3,'v65snag@example.com')`,
    [OWNER, OUTSIDER, SNAGGER]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const org = (await owner.query("select public.create_organisation('V65 Org', 'main_contractor') as id")).rows[0].id;
  const proj = (await owner.query(
    "insert into public.projects (name, org_id, created_by) values ('v65 site', $1, $2) returning id", [org, OWNER]
  )).rows[0].id;
  const snagCode = (await owner.query("select public.test_regenerate_snagging_invite_code($1) as code", [proj])).rows[0].code;
  await owner.query(
    `insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$2)`,
    [proj, OWNER]
  );
  const eventId = (await owner.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork','v65 daywork') returning id`, [proj]
  )).rows[0].id;
  await owner.query(
    `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','labour',3,40)`,
    [eventId]
  );
  await owner.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
  await owner.end();

  const snagger = await userClient(DB, SNAGGER);
  await snagger.query("select public.test_join_project_by_invite($1)", [snagCode]);
  await snagger.end();

  const out = await userClient(DB, OUTSIDER);
  const outOrg = (await out.query("select public.create_organisation('Other Org', 'main_contractor') as id")).rows[0].id;
  await out.end();

  fx = { org, proj, eventId, outOrg };
});

after(async () => {
  await dropTestDatabase(DB);
  await dropTestDatabase(DB_DACL);
});

const insertObj = (c, bucket, name) =>
  c.query("insert into storage.objects (bucket_id, name) values ($1, $2)", [bucket, name]);

// ─── (A) storage ─────────────────────────────────────────────────────
test("A: the three storage write policies are scoped to authenticated, with their checks unchanged", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    for (const [name, cmd] of STORAGE_POLICIES) {
      const { rows } = await admin.query(
        `select cmd, roles::text[] roles, qual, with_check from pg_policies
          where schemaname='storage' and tablename='objects' and policyname=$1`, [name]);
      assert.equal(rows.length, 1, `${name} exists`);
      assert.equal(rows[0].cmd, cmd);
      assert.deepEqual(rows[0].roles, ["authenticated"], `${name} must apply to authenticated only`);
      const expr = cmd === "DELETE" ? rows[0].qual : rows[0].with_check;
      const fn = name.includes("controlled") ? "controlled_documents_write_authorized(name)" : "site_photos_authorized(name)";
      const bucket = name.includes("controlled") ? "controlled-documents" : "site-photos";
      assert.equal(expr, `((bucket_id = '${bucket}'::text) AND ${fn})`);
    }
    const pub = await admin.query(
      `select policyname from pg_policies where schemaname='storage' and tablename='objects' and roles::text[] && array['public','anon']`);
    assert.deepEqual(pub.rows, [], "no storage.objects policy may apply to public/anon");
  } finally {
    await admin.end();
  }
});

test("A: anon is refused upload by policy (RLS), not by a helper's permission error, in both buckets", async () => {
  const anon = await anonClient(DB);
  try {
    for (const [bucket, name] of [
      ["site-photos", `${fx.proj}/reports/anon.jpg`],
      ["controlled-documents", `${fx.proj}/doc-1/revisions/rev-1/anon.pdf`],
    ]) {
      await assert.rejects(insertObj(anon, bucket, name), (e) => {
        assert.match(e.message, /row-level security/i, `expected an RLS refusal, got: ${e.message}`);
        return true;
      });
    }
  } finally {
    await anon.end();
  }
});

test("A: anon cannot delete a site photo — no delete policy applies to it, 0 rows, file survives", async () => {
  const owner = await userClient(DB, OWNER);
  await insertObj(owner, "site-photos", `${fx.proj}/reports/keep.jpg`);
  await owner.end();
  const anon = await anonClient(DB);
  try {
    const del = await anon.query("delete from storage.objects where bucket_id='site-photos' and name=$1", [`${fx.proj}/reports/keep.jpg`]);
    assert.equal(del.rowCount, 0);
  } finally {
    await anon.end();
  }
  const admin = adminClient(DB);
  await admin.connect();
  const still = await admin.query("select 1 from storage.objects where bucket_id='site-photos' and name=$1", [`${fx.proj}/reports/keep.jpg`]);
  await admin.end();
  assert.equal(still.rowCount, 1);
});

test("A: a project editor can still upload to both buckets and delete their site photo", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    assert.equal((await insertObj(owner, "site-photos", `${fx.proj}/reports/ed.jpg`)).rowCount, 1);
    assert.equal((await insertObj(owner, "controlled-documents", `${fx.proj}/doc-1/revisions/rev-1/ed.pdf`)).rowCount, 1);
    const del = await owner.query("delete from storage.objects where bucket_id='site-photos' and name=$1", [`${fx.proj}/reports/ed.jpg`]);
    assert.equal(del.rowCount, 1);
  } finally {
    await owner.end();
  }
});

test("A: signed-in non-editors are refused — another org's user anywhere, a snagging-only member on controlled documents", async () => {
  const out = await userClient(DB, OUTSIDER);
  try {
    await assert.rejects(insertObj(out, "site-photos", `${fx.proj}/reports/x.jpg`), (e) => isRlsError(e));
    await assert.rejects(insertObj(out, "controlled-documents", `${fx.proj}/doc-1/revisions/rev-1/x.pdf`), (e) => isRlsError(e));
  } finally {
    await out.end();
  }
  const owner = await userClient(DB, OWNER);
  await insertObj(owner, "site-photos", `${fx.proj}/reports/owner-file.jpg`);
  await owner.end();
  const out2 = await userClient(DB, OUTSIDER);
  try {
    const del = await out2.query("delete from storage.objects where bucket_id='site-photos' and name=$1", [`${fx.proj}/reports/owner-file.jpg`]);
    assert.equal(del.rowCount, 0);
  } finally {
    await out2.end();
  }
  const snag = await userClient(DB, SNAGGER);
  try {
    await assert.rejects(insertObj(snag, "controlled-documents", `${fx.proj}/doc-1/revisions/rev-1/s.pdf`), (e) => isRlsError(e));
  } finally {
    await snag.end();
  }
});

// ─── (B) lookups ─────────────────────────────────────────────────────
test("B: the six internal lookups are SECURITY DEFINER and executable by nobody but the owner/service_role", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    for (const [sig] of V65_INTERNAL) {
      const { rows } = await admin.query(PRIV_SQL, [`public.${sig}`]);
      assert.equal(rows.length, 1, `public.${sig} not found`);
      assert.equal(rows[0].prosecdef, true, `${sig} should be SECURITY DEFINER`);
      assert.equal(rows[0].auth_ok, false, `authenticated must not have EXECUTE on ${sig}`);
      assert.equal(rows[0].anon_ok, false, `anon must not have EXECUTE on ${sig}`);
      assert.equal(rows[0].public_ok, false, `PUBLIC must not have EXECUTE on ${sig}`);
    }
  } finally {
    await admin.end();
  }
});

for (const [sig, sql] of V65_INTERNAL) {
  test(`B: a signed-in user calling ${sig} directly gets permission denied`, async () => {
    const owner = await userClient(DB, OWNER);
    try {
      const params = sig.startsWith("commercial_event_hash") ? [fx.eventId]
        : sig.startsWith("party_and_descendants") ? [fx.proj]
        : [fx.proj, OUTSIDER];
      await assert.rejects(owner.query(sql, params), /permission denied for function/i);
    } finally {
      await owner.end();
    }
  });
}

test("B: the two lookups RLS policies call (is_owner_side_user, is_project_editor_user) are deliberately left callable by authenticated, never anon", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    for (const sig of V65_KEPT) {
      const { rows } = await admin.query(PRIV_SQL, [`public.${sig}`]);
      assert.equal(rows[0].auth_ok, true, `authenticated must keep ${sig} (policy-evaluated as the caller)`);
      assert.equal(rows[0].anon_ok, false);
      assert.equal(rows[0].public_ok, false);
    }
  } finally {
    await admin.end();
  }
});

test("B: the callers still work — assigning an action (can_be_assigned_work in the trigger), party listings, and approval requests (commercial_event_hash)", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const a = await owner.query(
      "insert into public.actions (project_id, title, assigned_to) values ($1,'v65 assign',$2) returning assigned_to", [fx.proj, OWNER]);
    assert.equal(a.rows[0].assigned_to, OWNER);
    const parties = await owner.query("select * from public.get_project_parties($1)", [fx.proj]);
    assert.ok(Array.isArray(parties.rows));
    const req = (await owner.query(
      `select * from public.request_commercial_approval($1,$2,null,null,168)`, [fx.eventId, `client-${crypto.randomUUID()}@example.invalid`]
    )).rows[0];
    assert.ok(req.token);
    const pc = await owner.query("select public.party_cap($1, 'snags') as ok", [fx.proj]);
    assert.equal(typeof pc.rows[0].ok, "boolean");
  } finally {
    await owner.end();
  }
  const anon = await anonClient(DB);
  try {
    // get/approve call commercial_event_hash internally as owner
    const got = (await anon.query("select public.get_commercial_approval_request(r.token) as r from (select $1::text token) r", [
      (await (async () => {
        const o = await userClient(DB, OWNER);
        const ev = (await o.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','v65 anon') returning id`, [fx.proj])).rows[0].id;
        await o.query(`insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','l',1,10)`, [ev]);
        await o.query(`update public.commercial_events set status='submitted' where id=$1`, [ev]);
        const t = (await o.query(`select * from public.request_commercial_approval($1,$2,null,null,168)`, [ev, `c-${crypto.randomUUID()}@example.invalid`])).rows[0].token;
        await o.end();
        return t;
      })()),
    ])).rows[0].r;
    assert.equal(got.active, true);
  } finally {
    await anon.end();
  }
});

test("v65 holds with Supabase's default-ACL auto-grant and after running schema.sql twice", async () => {
  await createTestDatabase(DB_DACL);
  const admin = adminClient(DB_DACL);
  await admin.connect();
  try {
    await runSqlFile(admin, path.join(__dirname, "../lib/mock_setup.sql"));
    await runSql(admin, "alter default privileges in schema public grant execute on functions to anon, authenticated");
    const schemaPath = path.join(__dirname, "../../sql/schema.sql");
    for (let run = 1; run <= 2; run++) {
      await runSqlFile(admin, schemaPath);
      for (const [sig] of V65_INTERNAL) {
        const { rows } = await admin.query(PRIV_SQL, [`public.${sig}`]);
        assert.equal(rows[0].auth_ok, false, `run ${run}: authenticated regained ${sig}`);
        assert.equal(rows[0].anon_ok, false, `run ${run}: anon regained ${sig}`);
        assert.equal(rows[0].public_ok, false, `run ${run}: PUBLIC regained ${sig}`);
      }
      for (const sig of V65_KEPT) {
        const { rows } = await admin.query(PRIV_SQL, [`public.${sig}`]);
        assert.equal(rows[0].auth_ok, true);
        assert.equal(rows[0].anon_ok, false, `run ${run}: anon regained ${sig}`);
      }
      for (const [name] of STORAGE_POLICIES) {
        const { rows } = await admin.query(
          "select roles::text[] roles from pg_policies where schemaname='storage' and tablename='objects' and policyname=$1", [name]);
        assert.equal(rows.length, 1);
        assert.deepEqual(rows[0].roles, ["authenticated"], `run ${run}: ${name} went back to public`);
      }
    }
  } finally {
    await admin.end();
  }
});
