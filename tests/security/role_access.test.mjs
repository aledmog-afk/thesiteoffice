// v62 — role-based access per company role on a job. Real RLS, real
// triggers, as real signed-in users. Fixture on JOB (owned by Owner Co):
//   Almo  subcontractor (Carpentry)  SUBA      Bolt subcontractor (Electrical) SUBB
//   Cow   clerk_of_works             COW       Clie client                     CL
//   Cons  consultant                 CON       Main main_contractor            MC
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_role_access";
const U = (n) => `a6400000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SUBA = U(2), SUBB = U(3), COW = U(4), CL = U(5), CON = U(6), MC = U(7), SUBSUB = U(8);
const EMAIL = { [OWNER]: "o@own.test", [SUBA]: "a@almo.test", [SUBB]: "b@bolt.test", [COW]: "c@cow.test", [CL]: "cl@client.test", [CON]: "con@cons.test", [MC]: "mc@main.test", [SUBSUB]: "ss@cee.test" };
const denied = (e) => isRlsError(e) || e?.code === "42501";
const fx = { party: {} };

async function as(user, fn) { const c = await userClient(DB, user); try { return await fn(c); } finally { await c.end(); } }
async function sql(q, p = []) { const a = adminClient(DB); await a.connect(); try { return await a.query(q, p); } finally { await a.end(); } }
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);
const titles = (c, table, col = "title") => c.query(`select ${col} as t from public.${table} where project_id = $1 order by 1`, [fx.job]).then((r) => r.rows.map((x) => x.t));

async function join(user, company, role, trade = null) {
  const inv = await as(OWNER, (c) => one(c, "select * from public.create_party_invite($1,$2,$3,$4,null)", [fx.job, EMAIL[user], role, trade]));
  fx.party[user] = await as(user, async (c) => {
    const org = (await one(c, "select public.create_organisation($1,'subcontractor') as id", [company])).id;
    await c.query("select public.accept_party_invite($1,$2)", [inv.token, org]);
    return org;
  });
  fx.party[user] = (await sql("select id from public.project_parties where project_id=$1 and org_id=$2", [fx.job, fx.party[user]])).rows[0].id;
}
async function snag(desc, party, extra = {}) {
  return (await sql(`insert into public.snag_items (project_id, snag_list_id, description, party_id, status) values ($1,$2,$3,$4,$5) returning id`,
    [fx.job, fx.list, desc, party, extra.status || "open"])).rows[0].id;
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);
  await as(OWNER, async (c) => {
    fx.org = (await one(c, "select public.create_organisation('Owner Co','developer_client') as id")).id;
    fx.job = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job', $1, $2) returning id", [fx.org, OWNER])).id;
    fx.list = (await one(c, "insert into public.snag_lists (project_id, title) values ($1,'L') returning id", [fx.job])).id;
  });
  await join(SUBA, "Almo", "subcontractor", "Carpentry");
  await join(SUBB, "Bolt", "subcontractor", "Electrical");
  await join(COW, "Cow", "clerk_of_works");
  await join(CL, "Clie", "client");
  await join(CON, "Cons", "consultant");
  await join(MC, "Main", "main_contractor");
  fx.snagA = await snag("A snag", fx.party[SUBA]);
  fx.snagB = await snag("B snag", fx.party[SUBB]);
  fx.snagMC = await snag("MC snag", fx.party[MC]);
  await sql(`insert into public.rfis (project_id, title, question, party_id) values ($1,'RFI Almo','?',$2),($1,'RFI Bolt','?',$3),($1,'RFI none','?',null)`, [fx.job, fx.party[SUBA], fx.party[SUBB]]);
  await sql(`insert into public.actions (project_id, title, party_id) values ($1,'Act Almo',$2),($1,'Act Bolt',$3),($1,'Act none',null)`, [fx.job, fx.party[SUBA], fx.party[SUBB]]);
  await sql(`insert into public.commercial_items (project_id, title, type) values ($1,'VO1','instruction')`, [fx.job]);
  await sql(`insert into public.monthly_reports (project_id, month) values ($1,'2026-10-01')`, [fx.job]);
  await sql(`insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1,'2026-10-05','2026-10-11')`, [fx.job]);
  await sql(`insert into public.inspections (project_id, title) values ($1,'Walk')`, [fx.job]);
  await sql(`insert into public.programmes (project_id, name, status) values ($1,'Prog','active')`, [fx.job]);
});
after(async () => { await dropTestDatabase(DB); });

const count = (c, table) => c.query(`select count(*)::int n from public.${table} where project_id = $1`, [fx.job]).then((r) => r.rows[0].n);

test("snag visibility per role: subs see their own company's, CoW/Client/MC see all, consultant own only (none)", async () => {
  assert.deepEqual(await as(SUBA, (c) => titles(c, "snag_items", "description")), ["A snag"]);
  assert.deepEqual(await as(SUBB, (c) => titles(c, "snag_items", "description")), ["B snag"]);
  for (const u of [COW, CL, MC, OWNER]) assert.deepEqual(await as(u, (c) => titles(c, "snag_items", "description")), ["A snag", "B snag", "MC snag"]);
  assert.deepEqual(await as(CON, (c) => titles(c, "snag_items", "description")), []);
});

test("RFIs are per company: Almo sees only Almo's, Bolt only Bolt's; CoW sees none it didn't raise; owner sees all", async () => {
  assert.deepEqual(await as(SUBA, (c) => titles(c, "rfis")), ["RFI Almo"]);
  assert.deepEqual(await as(SUBB, (c) => titles(c, "rfis")), ["RFI Bolt"]);
  assert.deepEqual(await as(COW, (c) => titles(c, "rfis")), []);
  assert.deepEqual(await as(CL, (c) => titles(c, "rfis")), []);
  assert.deepEqual(await as(OWNER, (c) => titles(c, "rfis")), ["RFI Almo", "RFI Bolt", "RFI none"]);
});

test("a sub's new RFI defaults to its own company and it can be assigned to a colleague; it cannot file one as another company", async () => {
  await as(SUBA, async (c) => {
    const r = await one(c, "insert into public.rfis (project_id, title, question, assigned_to) values ($1,'RFI by A','?',$2) returning party_id", [fx.job, SUBA]);
    assert.equal(r.party_id, fx.party[SUBA]);
    await assert.rejects(c.query("insert into public.rfis (project_id, title, question, party_id) values ($1,'fake','?',$2)", [fx.job, fx.party[SUBB]]), denied);
    await assert.rejects(c.query("insert into public.rfis (project_id, title, question, assigned_to) values ($1,'x','?',$2)", [fx.job, SUBB]), /assigned_to must be/);
    const u = await c.query("update public.rfis set title = 'hacked' where title = 'RFI Bolt'");
    assert.equal(u.rowCount, 0);
  });
  assert.equal((await sql("select count(*)::int n from public.rfis where title='hacked'")).rows[0].n, 0);
});

test("consultant raises and works its own company's RFIs (Aled: consultants CAN raise RFIs), never others'", async () => {
  await as(CON, async (c) => {
    const r = await one(c, "insert into public.rfis (project_id, title, question) values ($1,'RFI Cons','?') returning party_id", [fx.job]);
    assert.equal(r.party_id, fx.party[CON]);
    assert.deepEqual(await titles(c, "rfis"), ["RFI Cons"]);
    assert.equal((await c.query("update public.rfis set question='more detail' where title='RFI Cons'")).rowCount, 1);
    assert.equal((await c.query("update public.rfis set title='z' where title='RFI Almo'")).rowCount, 0);
  });
});

test("actions are per company for subs; narrow MC sees all actions; CoW/client none", async () => {
  assert.deepEqual(await as(SUBA, (c) => titles(c, "actions")), ["Act Almo"]);
  assert.deepEqual(await as(SUBB, (c) => titles(c, "actions")), ["Act Bolt"]);
  assert.deepEqual(await as(COW, (c) => titles(c, "actions")), []);
  assert.deepEqual(await as(CL, (c) => titles(c, "actions")), []);
  await as(SUBA, async (c) => {
    const a = await one(c, "insert into public.actions (project_id, title) values ($1,'A new') returning party_id", [fx.job]);
    assert.equal(a.party_id, fx.party[SUBA]);
    await assert.rejects(c.query("delete from public.actions where title='Act Almo'").then((r) => { if (r.rowCount === 0) throw Object.assign(new Error("rls"), { code: "42501" }); }), denied);
  });
});

test("commercials stay closed to every company; monthly reports only to the client", async () => {
  for (const u of [SUBA, COW, CL, CON, MC]) assert.equal(await as(u, (c) => count(c, "commercial_items")), 0, u);
  for (const u of [SUBA, COW, CON, MC]) assert.equal(await as(u, (c) => count(c, "monthly_reports")), 0, u);
  assert.equal(await as(CL, (c) => count(c, "monthly_reports")), 1);
  await as(CL, async (c) => { assert.equal((await c.query("update public.monthly_reports set month='2026-11-01'")).rowCount, 0); });
});

test("client and consultant are read-only on snags", async () => {
  await as(CL, async (c) => {
    await assert.rejects(c.query("insert into public.snag_items (project_id, snag_list_id, description) values ($1,$2,'cl')", [fx.job, fx.list]), denied);
    assert.equal((await c.query("update public.snag_items set description='x' where id=$1", [fx.snagA])).rowCount, 0);
  });
  await as(CON, async (c) => {
    await assert.rejects(c.query("insert into public.snag_items (project_id, snag_list_id, description) values ($1,$2,'co')", [fx.job, fx.list]), denied);
  });
});

test("clerk of works: raises snags for any company, inspections and weekly reports, reads programme; no actions/commercials", async () => {
  await as(COW, async (c) => {
    await c.query("insert into public.snag_items (project_id, snag_list_id, description, party_id) values ($1,$2,'CoW raised for Bolt',$3)", [fx.job, fx.list, fx.party[SUBB]]);
    await c.query("insert into public.inspections (project_id, title) values ($1,'CoW walk')", [fx.job]);
    assert.equal(await count(c, "inspections"), 2);
    await c.query("update public.weekly_reports set progress_summary = 'CoW notes' where project_id = $1", [fx.job]);
    assert.equal(await count(c, "programmes"), 1);
    assert.equal((await c.query("update public.programmes set name='x' where project_id=$1", [fx.job])).rowCount, 0);
    await assert.rejects(c.query("insert into public.actions (project_id, title) values ($1,'cow act')", [fx.job]), denied);
  });
  assert.deepEqual(await as(SUBB, (c) => titles(c, "snag_items", "description")), ["B snag", "CoW raised for Bolt"]);
  assert.equal((await sql("select progress_summary as summary from public.weekly_reports")).rows[0].summary, "CoW notes");
});

test("a sub can close its own snag with a completion photo but cannot verify it", async () => {
  await as(SUBA, async (c) => {
    await c.query("insert into public.snag_photos (project_id, snag_id, photo_url, kind) values ($2,$1,'p/a.jpg','completion')", [fx.snagA, fx.job]);
    await c.query("update public.snag_items set status='closed' where id=$1", [fx.snagA]);
    await assert.rejects(c.query("update public.snag_items set verified_at = now() where id=$1", [fx.snagA]), /never the company that did the work/);
  });
});

test("clerk of works verifies a close-out; who and which company verified are recorded", async () => {
  await as(COW, async (c) => {
    const r = await one(c, "update public.snag_items set verified_at = now() where id=$1 returning verified_by, verified_party_id", [fx.snagA]);
    assert.equal(r.verified_by, COW);
    assert.equal(r.verified_party_id, fx.party[COW]);
  });
});

test("the company that did the work can never verify it — even a full-access main contractor (an editor)", async () => {
  await sql("insert into public.snag_photos (project_id, snag_id, photo_url, kind) values ($2,$1,'p/m.jpg','completion')", [fx.snagMC, fx.job]);
  await sql("update public.snag_items set status='closed' where id=$1", [fx.snagMC]);
  await as(MC, async (c) => {
    await assert.rejects(c.query("update public.snag_items set verified_at = now() where id=$1", [fx.snagMC]), /never the company that did the work/);
  });
  await as(OWNER, async (c) => {
    const r = await one(c, "update public.snag_items set verified_at = now() where id=$1 returning verified_by, verified_party_id", [fx.snagMC]);
    assert.equal(r.verified_by, OWNER);
    assert.equal(r.verified_party_id, null);
  });
});

test("pending-review approval follows the same rule: CoW may approve, the sub that did the work may not", async () => {
  const id = await snag("B review", fx.party[SUBB]);
  await as(SUBB, (c) => c.query("update public.snag_items set status='pending_review' where id=$1", [id]));
  await as(SUBB, async (c) => { await assert.rejects(c.query("update public.snag_items set status='closed' where id=$1", [id]), /never the company/); });
  await as(COW, async (c) => {
    const r = await one(c, "update public.snag_items set status='closed' where id=$1 returning verified_by, verified_party_id", [id]);
    assert.equal(r.verified_by, COW); assert.equal(r.verified_party_id, fx.party[COW]);
  });
});

test("main contractor FULL (default): editor on the job (as v61), no commercials", async () => {
  assert.equal((await sql("select role from public.project_members where project_id=$1 and user_id=$2", [fx.job, MC])).rows[0].role, "collaborator");
  await as(MC, async (c) => {
    const r = await titles(c, "rfis");
    assert.equal(r.length, 5); assert.ok(r.includes("RFI none") && r.includes("RFI Bolt"));
    await c.query("insert into public.blocks (project_id, block_name) values ($1,'MC block')", [fx.job]);
  });
});

test("only the owner can switch the main contractor's access", async () => {
  await as(MC, async (c) => { await assert.rejects(c.query("select public.set_main_contractor_access($1,'narrow')", [fx.job]), denied); });
  await as(SUBA, async (c) => { await assert.rejects(c.query("select public.set_main_contractor_access($1,'narrow')", [fx.job]), denied); });
  await as(OWNER, async (c) => { await assert.rejects(c.query("select public.set_main_contractor_access($1,'bogus')", [fx.job]), /full or narrow/); });
});

test("main contractor NARROW: programme, actions, handovers, all RFIs, all snags, weekly reports; no blocks/commercials/inspection writes", async () => {
  await as(OWNER, (c) => c.query("select public.set_main_contractor_access($1,'narrow')", [fx.job]));
  assert.equal((await sql("select role from public.project_members where project_id=$1 and user_id=$2", [fx.job, MC])).rows[0].role, "snagging");
  await as(MC, async (c) => {
    assert.equal((await titles(c, "rfis")).length, 5);
    assert.equal((await titles(c, "actions")).length, 4);
    await c.query("insert into public.actions (project_id, title, assigned_to, party_id) values ($1,'MC act',$2,$3)", [fx.job, SUBA, fx.party[SUBA]]);
    await assert.rejects(c.query("insert into public.actions (project_id, title, assigned_to) values ($1,'no co',$2)", [fx.job, SUBA]), /assigned_to must be/);
    assert.equal((await c.query("update public.programmes set name='MC prog' where project_id=$1", [fx.job])).rowCount, 1);
    await c.query("insert into public.handover_documents (project_id, block_id, doc_key, title) select $1, id, 'om', 'O&M' from public.blocks where project_id = $1 limit 1", [fx.job]);
    assert.ok((await c.query("select 1 from public.handover_documents where project_id=$1", [fx.job])).rowCount >= 1);
    await c.query("update public.weekly_reports set progress_summary='MC' where project_id=$1", [fx.job]);
    assert.equal(await count(c, "inspections"), 2);
    await assert.rejects(c.query("insert into public.inspections (project_id, title) values ($1,'mc')", [fx.job]), denied);
    await assert.rejects(c.query("insert into public.blocks (project_id, block_name) values ($1,'nope')", [fx.job]), denied);
    assert.equal(await count(c, "commercial_items"), 0);
    assert.equal((await c.query("update public.snag_items set description='MC responded' where id=$1", [fx.snagB])).rowCount, 1);
  });
});

test("switching back to FULL restores editor; new MC members follow the current mode", async () => {
  await as(OWNER, (c) => c.query("select public.set_main_contractor_access($1,'full')", [fx.job]));
  assert.equal((await sql("select role from public.project_members where project_id=$1 and user_id=$2", [fx.job, MC])).rows[0].role, "collaborator");
  await as(OWNER, (c) => c.query("select public.set_main_contractor_access($1,'narrow')", [fx.job]));
  assert.equal((await sql("select public.party_member_role_for($1,'main_contractor') r", [fx.job])).rows[0].r, "snagging");
  assert.equal((await sql("select public.party_member_role_for($1,'subcontractor') r", [fx.job])).rows[0].r, "snagging");
  await as(OWNER, (c) => c.query("select public.set_main_contractor_access($1,'full')", [fx.job]));
});

test("get_my_job_roles returns company, role and capabilities", async () => {
  const r = await as(COW, (c) => one(c, "select * from public.get_my_job_roles()"));
  assert.equal(r.company, "Cow"); assert.equal(r.party_role, "clerk_of_works");
  assert.ok(r.capabilities.includes("snags_verify"));
  const o = await as(OWNER, (c) => c.query("select * from public.get_my_job_roles()"));
  assert.equal(o.rowCount, 0);
});

test("the capability table is read-only to signed-in users and invisible to anon", async () => {
  await as(SUBA, async (c) => { await assert.rejects(c.query("insert into public.party_role_capabilities values ('subcontractor','any','rfis_all')"), /permission denied/); });
  const g = await sql("select has_table_privilege('anon','public.party_role_capabilities','select') a");
  assert.equal(g.rows[0].a, false);
});

test("a subcontractor can never verify its own sub-subcontractor's work (even if raised to editor)", async () => {
  const inv = await as(SUBA, (c) => one(c, "select * from public.create_party_invite($1,$2,'subcontractor','Plastering',$3)", [fx.job, EMAIL[SUBSUB], fx.party[SUBA]]));
  await as(SUBSUB, async (c) => {
    const org = (await one(c, "select public.create_organisation('Cee','subcontractor') as id")).id;
    await c.query("select public.accept_party_invite($1,$2)", [inv.token, org]);
  });
  const ssParty = (await sql("select id from public.project_parties where parent_party_id=$1", [fx.party[SUBA]])).rows[0].id;
  const id = await snag("Sub-sub snag", ssParty);
  await sql("insert into public.snag_photos (project_id, snag_id, photo_url, kind) values ($1,$2,'p/s.jpg','completion')", [fx.job, id]);
  await sql("update public.snag_items set status='closed' where id=$1", [id]);
  await as(OWNER, (c) => c.query("select public.set_project_member_role($1,$2,'collaborator')", [fx.job, SUBA]));
  await as(SUBA, async (c) => { await assert.rejects(c.query("update public.snag_items set verified_at = now() where id=$1", [id]), /never the company/); });
  await as(COW, async (c) => { assert.equal((await one(c, "update public.snag_items set verified_at = now() where id=$1 returning verified_by", [id])).verified_by, COW); });
  await as(OWNER, (c) => c.query("select public.set_project_member_role($1,$2,'snagging')", [fx.job, SUBA]));
});

test("weekly and monthly report commercial notes: owner side only — no invited company can read them, and they can't write them", async () => {
  await as(OWNER, (c) => c.query("update public.weekly_reports set commercial_items = $2 where project_id = $1", [fx.job, JSON.stringify([{ title: "VO 12 £4,000" }])]));
  await as(OWNER, (c) => c.query("update public.monthly_reports set commercial_items = $2 where project_id = $1", [fx.job, JSON.stringify([{ title: "Dayworks £900" }])]));
  assert.deepEqual((await sql("select commercial_items c from public.weekly_reports")).rows[0].c, [], "the column itself never holds them");
  const own = await as(OWNER, (c) => c.query("select report_kind, items from public.report_commercial_notes order by 1"));
  assert.deepEqual(own.rows.map((r) => [r.report_kind, r.items[0].title]), [["monthly", "Dayworks £900"], ["weekly", "VO 12 £4,000"]]);
  for (const u of [SUBA, COW, CL, CON, MC]) {
    assert.equal((await as(u, (c) => c.query("select 1 from public.report_commercial_notes"))).rowCount, 0, u);
    const wr = await as(u, (c) => c.query("select commercial_items from public.weekly_reports"));
    for (const row of wr.rows) assert.deepEqual(row.commercial_items, []);
  }
  await as(COW, async (c) => {
    await assert.rejects(c.query("update public.weekly_reports set commercial_items = '[{\"title\":\"x\"}]' where project_id=$1", [fx.job]), denied);
    await c.query("update public.weekly_reports set commercial_items = '[]', progress_summary = 'CoW edit' where project_id=$1", [fx.job]);
  });
  assert.equal((await sql("select items from public.report_commercial_notes where report_kind='weekly'")).rows[0].items.length, 1, "a company editing the report never wipes the notes");
  await assert.rejects(as(OWNER, (c) => c.query("insert into public.report_commercial_notes (report_kind, report_id, project_id) values ('weekly', gen_random_uuid(), $1)", [fx.job])), /permission denied/);
});

test("RFI evidence: only the RFI's company, the owner side and the Clerk of Works — not a full-access main contractor", async () => {
  const rfi = (await sql("select id from public.rfis where title='RFI Almo'")).rows[0].id;
  const wr = (await sql("select id from public.weekly_reports limit 1")).rows[0].id;
  // Fixture only: bypass the photo-existence trigger (tested in rfi_evidence_links.test.mjs).
  const a = adminClient(DB); await a.connect();
  try {
    await a.query("set session_replication_role = replica");
    await a.query("insert into public.rfi_evidence_links (rfi_id, project_id, source_type, weekly_report_id, photo_id) values ($1,$2,'weekly_report_photo',$3,gen_random_uuid())", [rfi, fx.job, wr]);
  } finally { await a.end(); }
  const seen = async (u) => (await as(u, (c) => c.query("select 1 from public.rfi_evidence_links"))).rowCount;
  assert.equal(await seen(OWNER), 1);
  assert.equal(await seen(SUBA), 1);
  assert.equal(await seen(COW), 1);
  assert.equal(await seen(MC), 0, "MC (full) sees the RFI but not another company's evidence");
  assert.equal(await seen(SUBB), 0);
  assert.equal(await seen(CL), 0);
});

test("switching the MC's access keeps an individually raised/lowered MC person as the owner set them", async () => {
  await as(OWNER, (c) => c.query("select public.set_project_member_role($1,$2,'snagging')", [fx.job, MC]));
  await as(OWNER, (c) => c.query("select public.set_main_contractor_access($1,'narrow')", [fx.job]));
  await as(OWNER, (c) => c.query("select public.set_main_contractor_access($1,'full')", [fx.job]));
  assert.equal((await sql("select role from public.project_members where project_id=$1 and user_id=$2", [fx.job, MC])).rows[0].role, "snagging");
  await sql("update public.project_members set role='collaborator', role_override=false where project_id=$1 and user_id=$2", [fx.job, MC]);
});

test("owner's unassigned-work flag counts open snags, RFIs and actions with no company; owner only", async () => {
  const r = (await as(OWNER, (c) => c.query("select * from public.get_unassigned_company_work()"))).rows[0];
  assert.equal(r.project_name, "Job");
  assert.equal(r.rfi_count, 1);
  assert.equal(r.action_count, 1);
  assert.equal((await as(MC, (c) => c.query("select * from public.get_unassigned_company_work()"))).rowCount, 0);
  await as(OWNER, (c) => c.query("update public.rfis set party_id=$2 where title='RFI none' and project_id=$1", [fx.job, fx.party[SUBB]]));
  assert.equal((await as(OWNER, (c) => c.query("select rfi_count from public.get_unassigned_company_work()"))).rows[0].rfi_count, 0);
  assert.ok((await as(SUBB, (c) => titles(c, "rfis"))).includes("RFI none"), "once assigned, the company sees it");
});
