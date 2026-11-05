// v85: personal_diary_entries — a private diary, one per user. Once an
// entry is assigned to a project (site), it becomes readable (never
// writable by anyone but the author) by a CONTRACTOR-SIDE project
// editor of that project — never a Viewer, never an owner-side/client
// user, however broad their ordinary project access otherwise is.
// Fixture:
//   Owner Co (OWNER) owns JOB1 and JOB2.
//   MainCo — main contractor on JOB1: lead MC (becomes a collaborator/
//     editor automatically, 'full' main_contractor_access default).
//   Almo — subcontractor on JOB1: SUBA (explicitly promoted to
//     collaborator/editor by the owner) and SUBVIEW (left at the
//     default snagging/viewer role).
//   ClientCo — client party on JOB1: CLIENTUSER, explicitly promoted
//     to collaborator/editor — the strongest test that the exclusion
//     is about SIDE (client), not role.
//   STRANGER has no relationship to JOB1 or JOB2 at all.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_v85_personal_diary";
const U = (n) => `a8500000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), MC = U(2), SUBA = U(3), SUBVIEW = U(4), CLIENTUSER = U(5), STRANGER = U(6);
const EMAIL = {
  [OWNER]: "owner@x.test", [MC]: "mc@main.test", [SUBA]: "suba@almo.test",
  [SUBVIEW]: "subview@almo.test", [CLIENTUSER]: "client@clientco.test", [STRANGER]: "stranger@x.test",
};

const fx = {};
const denied = (e) => isRlsError(e) || e?.code === "42501";

async function as(user, fn) {
  const c = await userClient(DB, user);
  try { return await fn(c); } finally { await c.end(); }
}
async function sql(q, p = []) {
  const a = adminClient(DB); await a.connect();
  try { return await a.query(q, p); } finally { await a.end(); }
}
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);
const newOrg = (c, name, type = "developer_client") => one(c, "select public.create_organisation($1, $2) as id", [name, type]).then((r) => r.id);
const invite = (c, job, email, role, trade = null, parent = null) =>
  one(c, "select * from public.create_party_invite($1, $2, $3, $4, $5)", [job, email, role, trade, parent]);
const accept = (c, token, org) => one(c, "select public.accept_party_invite($1, $2) as p", [token, org]).then((r) => r.p);

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.ownerOrg = await newOrg(c, "Owner Co");
    fx.job1 = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job 1', $1, $2) returning id", [fx.ownerOrg, OWNER])).id;
    fx.job2 = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job 2', $1, $2) returning id", [fx.ownerOrg, OWNER])).id;
  });

  // Main contractor — defaults to 'collaborator' (full mc_mode).
  await as(MC, async (c) => { fx.mcOrg = await newOrg(c, "MainCo"); });
  let inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[MC], "main_contractor"));
  await as(MC, (c) => accept(c, inv.token, fx.mcOrg));

  // Subcontractor — SUBA promoted to collaborator by the owner; SUBVIEW left as default snagging.
  await as(SUBA, async (c) => { fx.almoOrg = await newOrg(c, "Almo", "subcontractor"); });
  inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[SUBA], "subcontractor", "Carpentry"));
  await as(SUBA, (c) => accept(c, inv.token, fx.almoOrg));
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1, $2, 'member')", [fx.almoOrg, SUBVIEW]);
  // add_party_member must be called by the COMPANY'S OWN admin, not the owner.
  const almoPartyId = (await sql("select id from public.project_parties where project_id = $1 and org_id = $2", [fx.job1, fx.almoOrg])).rows[0].id;
  await as(SUBA, (c) => c.query("select public.add_party_member($1, $2)", [almoPartyId, SUBVIEW]));
  await as(OWNER, (c) => c.query("select public.set_project_member_role($1, $2, 'collaborator')", [fx.job1, SUBA]));

  // Client party — CLIENTUSER explicitly promoted to collaborator too.
  await as(CLIENTUSER, async (c) => { fx.clientOrg = await newOrg(c, "ClientCo", "developer_client"); });
  inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[CLIENTUSER], "client"));
  await as(CLIENTUSER, (c) => accept(c, inv.token, fx.clientOrg));
  await as(OWNER, (c) => c.query("select public.set_project_member_role($1, $2, 'collaborator')", [fx.job1, CLIENTUSER]));
});

after(async () => { await dropTestDatabase(DB); });

test("v85: the author can create, read, edit and delete their own diary entry, unassigned", async () => {
  await as(MC, async (c) => {
    const row = await one(c, "insert into public.personal_diary_entries (body, weather) values ('Site tidy, no issues.', 'Overcast') returning id, user_id, body", []);
    assert.equal(row.user_id, MC);
    await c.query("update public.personal_diary_entries set body = 'Updated note' where id = $1", [row.id]);
    const { rows } = await c.query("select body from public.personal_diary_entries where id = $1", [row.id]);
    assert.equal(rows[0].body, "Updated note");
    await c.query("delete from public.personal_diary_entries where id = $1", [row.id]);
    assert.equal((await c.query("select 1 from public.personal_diary_entries where id = $1", [row.id])).rowCount, 0);
  });
});

test("v85: a stranger can't read, edit or delete someone else's unassigned entry at all", async () => {
  const entry = await as(MC, (c) => one(c, "insert into public.personal_diary_entries (body) values ('private note') returning id", []));
  await as(STRANGER, async (c) => {
    assert.equal((await c.query("select 1 from public.personal_diary_entries where id = $1", [entry.id])).rowCount, 0);
    await assert.rejects(c.query("update public.personal_diary_entries set body = 'hacked' where id = $1", [entry.id]).then((r) => {
      if (r.rowCount === 0) throw Object.assign(new Error("no row matched"), { code: "42501" });
    }), denied);
  });
});

test("v85: assigning a site requires genuine project membership", async () => {
  await as(STRANGER, async (c) => {
    await assert.rejects(
      c.query("insert into public.personal_diary_entries (project_id, body) values ($1, 'trying to tag a job I am not on')", [fx.job1]),
      /not a member of that project/
    );
  });
  // MC (a member of job1, not job2) can't tag job2 with their own entry either.
  await as(MC, async (c) => {
    await assert.rejects(
      c.query("insert into public.personal_diary_entries (project_id, body) values ($1, 'wrong job')", [fx.job2]),
      /not a member of that project/
    );
  });
});

test("v85: once site-assigned, a contractor-side editor (promoted subcontractor) can read it — but cannot edit or delete it", async () => {
  const entry = await as(MC, (c) => one(c, "insert into public.personal_diary_entries (project_id, entry_date, body, weather, labour_count, visitors) values ($1, current_date, 'Steel delivery arrived, slight delay unloading.', 'Dry', 8, 'Building control') returning id", [fx.job1]));

  await as(SUBA, async (c) => {
    const { rows } = await c.query("select body, labour_count from public.personal_diary_entries where id = $1", [entry.id]);
    assert.equal(rows.length, 1, "a contractor-side editor must be able to read another author's site-assigned entry");
    assert.equal(rows[0].body, "Steel delivery arrived, slight delay unloading.");

    const upd = await c.query("update public.personal_diary_entries set body = 'overwritten' where id = $1", [entry.id]);
    assert.equal(upd.rowCount, 0, "a contractor-side editor must NOT be able to edit someone else's diary entry");
    const del = await c.query("delete from public.personal_diary_entries where id = $1", [entry.id]);
    assert.equal(del.rowCount, 0, "a contractor-side editor must NOT be able to delete someone else's diary entry");
  });

  // Confirm it's genuinely untouched.
  const still = await sql("select body from public.personal_diary_entries where id = $1", [entry.id]);
  assert.equal(still.rows[0].body, "Steel delivery arrived, slight delay unloading.");
});

test("v85: a Viewer (default-role subcontractor) can NOT read another author's site-assigned entry", async () => {
  const entry = await as(MC, (c) => one(c, "insert into public.personal_diary_entries (project_id, body) values ($1, 'viewer must not see this') returning id", [fx.job1]));
  await as(SUBVIEW, async (c) => {
    const { rows } = await c.query("select 1 from public.personal_diary_entries where id = $1", [entry.id]);
    assert.equal(rows.length, 0, "a Viewer must never see another person's site-assigned diary entry");
  });
});

test("v85: an owner-side user (even the project owner) can NOT read another author's site-assigned entry", async () => {
  const entry = await as(MC, (c) => one(c, "insert into public.personal_diary_entries (project_id, body) values ($1, 'owner-side must not see this') returning id", [fx.job1]));
  await as(OWNER, async (c) => {
    const { rows } = await c.query("select 1 from public.personal_diary_entries where id = $1", [entry.id]);
    assert.equal(rows.length, 0, "an owner-side user must never see another person's site-assigned diary entry, regardless of their editor role");
  });
});

test("v85: a client party member can NOT read another author's site-assigned entry, even promoted to editor", async () => {
  const entry = await as(MC, (c) => one(c, "insert into public.personal_diary_entries (project_id, body) values ($1, 'client must not see this') returning id", [fx.job1]));
  await as(CLIENTUSER, async (c) => {
    const { rows } = await c.query("select 1 from public.personal_diary_entries where id = $1", [entry.id]);
    assert.equal(rows.length, 0, "a client-side editor must never see another person's site-assigned diary entry — side, not role, is what's gated");
  });
});

test("v85: delay_reason is cleared whenever delay_flag is false", async () => {
  await as(MC, async (c) => {
    const row = await one(c, "insert into public.personal_diary_entries (body, delay_flag, delay_reason) values ('no delay really', false, 'should be wiped') returning delay_reason", []);
    assert.equal(row.delay_reason, null);
    const row2 = await one(c, "insert into public.personal_diary_entries (body, delay_flag, delay_reason) values ('genuine delay', true, 'crane breakdown') returning delay_reason", []);
    assert.equal(row2.delay_reason, "crane breakdown");
  });
});

test("v85: photos require a site to be assigned first", async () => {
  await as(MC, async (c) => {
    await assert.rejects(
      c.query(`insert into public.personal_diary_entries (body, photos) values ('no site yet', '[{"path":"x"}]'::jsonb)`),
      /only have photos once a site is assigned/
    );
    const ok = await one(c, `insert into public.personal_diary_entries (project_id, body, photos) values ($1, 'has a site', '[{"path":"x"}]'::jsonb) returning photos`, [fx.job1]);
    assert.equal(ok.photos.length, 1);
  });
});
