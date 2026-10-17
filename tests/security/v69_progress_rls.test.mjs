// v69 site progress with real non-superuser roles and real RLS: the
// weekly report raises stages only once ISSUED (raise-only, shared
// range parser; a draft save changes nothing),
// the plot page can set any value and N/A, the database owns plot % and
// site %, overrides and external works need a note and the right
// permission — for an editor, a report-only company (Clerk of Works:
// weekly_reports_write + programme_read), a viewer company (client:
// weekly_reports_read + programme_read), an outsider and anon.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient } from "../lib/db.mjs";

const DB = "tracker_test_v69_progress";
const U = (n) => `a6900000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), CLERK = U(2), CLIENT = U(3), OUTSIDER = U(4), MC = U(5);
const EMAIL = { [OWNER]: "o@fake-owner.test", [CLERK]: "c@fake-cow.test", [CLIENT]: "v@fake-client.test", [OUTSIDER]: "x@fake-other.test", [MC]: "m@fake-builder.test" };
const fx = {};
async function as(u, fn) { const c = await userClient(DB, u); try { return await fn(c); } finally { await c.end(); } }
async function sql(q, p = []) { const a = adminClient(DB); await a.connect(); try { return await a.query(q, p); } finally { await a.end(); } }
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);
const num = (v) => (v === null || v === undefined ? v : Number(v));

async function join(user, company, role) {
  const inv = await as(OWNER, (c) => one(c, "select * from public.create_party_invite($1,$2,$3,null,null)", [fx.job, EMAIL[user], role]));
  await as(user, async (c) => {
    const id = (await one(c, "select public.create_organisation($1,'subcontractor') as id", [company])).id;
    await c.query("select public.accept_party_invite($1,$2)", [inv.token, id]);
  });
}
async function plot(n) { return (await sql("select id, progress_pct, progress_calculated, progress_override from public.plots where plot_number=$1", [n])).rows[0]; }
async function stage(plotId, key) { return (await sql("select id, percent::float p, applicable a, last_source s from public.internal_milestones where plot_id=$1 and stage_key=$2", [plotId, key])).rows[0]; }
// Live reports go Draft -> (Reviewed -> Approved ->) Issued; only Issued raises.
const issue = (u, id) => as(u, async (c) => {
  for (const st of ["reviewed", "approved", "issued"]) await c.query("update public.weekly_reports set status=$2 where id=$1", [id, st]);
});
const auditCount = async () => (await sql("select count(*)::int n from public.audit_log where table_name='projects' and record_id=$1", [fx.job])).rows[0].n;
async function site() { return (await sql("select actual_progress_pct::float a, external_works_pct::float e, external_works_share::float s from public.projects where id=$1", [fx.job])).rows[0]; }
// Today's formula (external works = one plot's worth, blocks once per flat).
async function oldFormula() {
  const r = (await sql(`select (select coalesce(sum(progress_pct),0) from public.plots where project_id=$1)::float sp,
      (select count(*) from public.plots where project_id=$1)::int np,
      (select coalesce(sum(b.progress_pct * greatest((select count(*) from public.plots f where f.block_id=b.id),1)),0) from public.blocks b where b.project_id=$1)::float sb,
      (select coalesce(sum(greatest((select count(*) from public.plots f where f.block_id=b.id),1)),0) from public.blocks b where b.project_id=$1)::int wb,
      (select external_works_pct from public.projects where id=$1)::float e`, [fx.job])).rows[0];
  return Math.round(((r.sp + r.sb + r.e) / (r.np + r.wb + 1)) * 10) / 10;
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);
  // Supabase keeps the sign-up name in raw_user_meta_data (the mock table
  // doesn't have it). The owner has a name; the others don't.
  await sql("alter table auth.users add column if not exists raw_user_meta_data jsonb");
  await sql("update auth.users set raw_user_meta_data = $2::jsonb where id = $1", [OWNER, JSON.stringify({ full_name: "Olwen Owner" })]);
  await as(OWNER, async (c) => {
    fx.org = (await one(c, "select public.create_organisation('Fake Owner Co','developer_client') as id")).id;
    fx.job = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Fake Meadows',$1,$2) returning id", [fx.org, OWNER])).id;
    for (const n of ["Plot 1", "Plot 2", "Plot 3"]) await c.query("insert into public.plots (project_id, plot_number) values ($1,$2)", [fx.job, n]);
    fx.block = (await one(c, "insert into public.blocks (project_id, block_name) values ($1,'Block A') returning id", [fx.job])).id;
    await c.query("insert into public.plots (project_id, block_id, plot_number) values ($1,$2,'Flat 11'),($1,$2,'Flat 12')", [fx.job, fx.block]);
  });
  await join(CLERK, "Fake CoW Ltd", "clerk_of_works");
  await join(CLIENT, "Fake Client HA", "client");
  await join(MC, "Fake Build Ltd", "main_contractor");
  await as(OUTSIDER, (c) => c.query("select public.create_organisation('Other Fake Co','developer_client')"));
});
after(async () => { await dropTestDatabase(DB); });

test("new plots get the 33 stages with house / flat N/A defaults (houses 31 applicable, flats 17)", async () => {
  const r = (await sql(`select p.plot_number n, count(*)::int total, count(*) filter (where m.applicable)::int app
    from public.plots p join public.internal_milestones m on m.plot_id = p.id and m.stage_key is not null and m.retired_at is null
    where p.project_id=$1 group by 1 order by 1`, [fx.job])).rows;
  assert.deepEqual(r.map((x) => [x.n, x.total, x.app]), [["Flat 11", 33, 17], ["Flat 12", 33, 17], ["Plot 1", 33, 31], ["Plot 2", 33, 31], ["Plot 3", 33, 31]]);
  const legacy = (await sql("select count(*)::int n from public.internal_milestones where stage_key is null")).rows[0].n;
  assert.equal(legacy, 0, "the old 16/18-stage grid is no longer seeded");
});

test("a DRAFT save changes no stage; ISSUING raises tagged plots' stages (range tag), never lowers, skips block names / External / unknown tags and N/A stages; plot % and site % follow", async () => {
  const p1 = await plot("Plot 1");
  const items = [
    { plot: "1-2", milestone: "Groundworks", percent: 62 },
    { plot: "Block A", milestone: "1st Fix – Carpentry", percent: 100 },
    { plot: "External / Engineering Works", milestone: "Foundations (Foots)", percent: 100 },
    { plot: "S278", milestone: "Render", percent: 100 },
    { plot: "Plot 3", milestone: "Site Set-Up / Enabling Works", percent: 100 },
  ];
  fx.report = await as(OWNER, (c) => one(c, `insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items)
    values ($1,'2026-10-05','2026-10-11',$2::jsonb) returning id`, [fx.job, JSON.stringify(items)])).then((r) => r.id);
  // Draft: saved (and re-saved) but nothing moves and nothing is logged.
  assert.equal((await stage(p1.id, "st_groundworks")).p, 0, "a draft save raises nothing");
  await as(OWNER, (c) => c.query("update public.weekly_reports set progress_items=$2::jsonb where id=$1", [fx.report, JSON.stringify(items)]));
  assert.equal((await stage(p1.id, "st_groundworks")).p, 0, "a draft re-save raises nothing");
  assert.equal((await sql("select count(*)::int n from public.progress_stage_events where weekly_report_id=$1", [fx.report])).rows[0].n, 0);
  assert.equal(num((await plot("Plot 1")).progress_pct), 0);
  // Reviewed and Approved still raise nothing; Issued does.
  await as(OWNER, (c) => c.query("update public.weekly_reports set status='reviewed' where id=$1", [fx.report]));
  await as(OWNER, (c) => c.query("update public.weekly_reports set status='approved' where id=$1", [fx.report]));
  assert.equal((await stage(p1.id, "st_groundworks")).p, 0, "reviewed / approved raise nothing");
  await as(OWNER, (c) => c.query("update public.weekly_reports set status='issued' where id=$1", [fx.report]));
  const g1 = await stage(p1.id, "st_groundworks");
  assert.deepEqual({ p: g1.p, a: g1.a, s: g1.s }, { p: 62, a: true, s: "report" });
  assert.equal((await stage((await plot("Plot 2")).id, "st_groundworks")).p, 62);
  assert.equal((await stage((await plot("Plot 3")).id, "st_groundworks")).p, 0);
  assert.equal((await stage((await plot("Flat 11")).id, "st_1fix_carpentry")).p, 0, "a block-name tag moves no flat");
  assert.equal((await stage(p1.id, "st_foundations")).p, 0, "External tag moves no plot");
  assert.equal((await stage(p1.id, "st_render")).p, 0, "unknown tag moves no plot");
  assert.equal((await stage((await plot("Plot 3")).id, "st_site_setup")).p, 0, "N/A stage is never raised");
  assert.equal(num((await plot("Plot 1")).progress_pct), 2, "62 / 31 applicable stages = 2.0");
  assert.equal((await site()).a, await oldFormula(), "no share set: today's formula exactly");

  // An issued report is content-locked for clients ...
  await assert.rejects(as(OWNER, (c) => c.query("update public.weekly_reports set progress_items=$2::jsonb where id=$1",
    [fx.report, JSON.stringify([{ plot: "1-2", milestone: "Groundworks", percent: 90 }])])), /content is locked/);
  // ... but if its tasks do change while issued (a maintenance fix, with
  // the lock lifted), the change raises, and a lower % doesn't lower.
  await sql("alter table public.weekly_reports disable trigger trg_weekly_reports_before_write");
  try {
    await sql("update public.weekly_reports set progress_items=$2::jsonb where id=$1",
      [fx.report, JSON.stringify([{ plot: "1-2", milestone: "Groundworks", percent: 20 }, { plot: "Plot 1", milestone: "Scaffold Erect", percent: 30 }])]);
  } finally {
    await sql("alter table public.weekly_reports enable trigger trg_weekly_reports_before_write");
  }
  assert.equal((await stage(p1.id, "st_groundworks")).p, 62, "raise-only");
  assert.equal((await stage(p1.id, "st_scaffold_erect")).p, 30, "new task on an issued report raises");
  await as(OWNER, (c) => c.query("update public.internal_milestones set percent=0 where plot_id=$1 and stage_key='st_scaffold_erect'", [p1.id]));
  const ev = (await sql("select count(*)::int n from public.progress_stage_events where source='report' and weekly_report_id=$1", [fx.report])).rows[0].n;
  assert.equal(ev, 3, "each raise is logged with its report");
});

test("an issued report revised back to draft and edited raises nothing until it is issued again", async () => {
  const p3 = await plot("Plot 3");
  const id = await as(OWNER, (c) => one(c, `insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items)
    values ($1,'2026-09-28','2026-10-04',$2::jsonb) returning id`, [fx.job, JSON.stringify([{ plot: "Plot 3", milestone: "Scaffold Erect", percent: 40 }])])).then((r) => r.id);
  await issue(OWNER, id);
  assert.equal((await stage(p3.id, "st_scaffold_erect")).p, 40);
  await as(OWNER, (c) => c.query("update public.weekly_reports set status='draft' where id=$1", [id])); // Revise
  await as(OWNER, (c) => c.query("update public.weekly_reports set progress_items=$2::jsonb where id=$1", [id, JSON.stringify([{ plot: "Plot 3", milestone: "Scaffold Erect", percent: 100 }])]));
  assert.equal((await stage(p3.id, "st_scaffold_erect")).p, 40, "edits while back in draft raise nothing");
  await issue(OWNER, id);
  assert.equal((await stage(p3.id, "st_scaffold_erect")).p, 100, "re-issuing raises");
});

test("the plot page (editor) can set any value including lower, and N/A; the database stamps the source and recalculates", async () => {
  const p1 = await plot("Plot 1");
  const g = await stage(p1.id, "st_groundworks");
  await as(OWNER, (c) => c.query("update public.internal_milestones set percent=10 where id=$1", [g.id]));
  const g2 = await stage(p1.id, "st_groundworks");
  assert.deepEqual({ p: g2.p, a: g2.a, s: g2.s }, { p: 10, a: true, s: "plot_page" });
  assert.equal(num((await plot("Plot 1")).progress_pct), 0.3);
  // N/A takes the stage out of the average: (10 + 100) / 30.
  const k = await stage(p1.id, "st_kitchen");
  await as(OWNER, (c) => c.query("update public.internal_milestones set percent=100 where id=$1", [k.id]));
  const gas = await stage(p1.id, "st_1fix_gas");
  await as(OWNER, (c) => c.query("update public.internal_milestones set applicable=false where id=$1", [gas.id]));
  assert.equal(num((await plot("Plot 1")).progress_pct), Math.round((110 / 30) * 10) / 10);
  // Clients can't move a row to another plot or stage, or un-retire anything.
  const p2id = (await plot("Plot 2")).id;
  await as(OWNER, (c) => c.query("update public.internal_milestones set stage_key='st_roofing', plot_id=$2 where id=$1", [k.id, p2id]));
  const kk = (await sql("select stage_key, plot_id from public.internal_milestones where id=$1", [k.id])).rows[0];
  assert.deepEqual(kk, { stage_key: "st_kitchen", plot_id: p1.id });
  assert.equal((await site()).a, await oldFormula());
});

test("stored plot % and site % can't be typed by any client; external works can't be changed without a note", async () => {
  const p1 = await plot("Plot 1");
  await as(OWNER, (c) => c.query("update public.plots set progress_pct=99, progress_override=99, progress_override_note='sneaky' where id=$1", [p1.id]));
  const after = await plot("Plot 1");
  assert.equal(num(after.progress_pct), num(p1.progress_pct), "typed plot % ignored");
  assert.equal(after.progress_override, null);
  const s0 = await site();
  await as(OWNER, (c) => c.query("update public.projects set actual_progress_pct=88 where id=$1", [fx.job]));
  assert.equal((await site()).a, s0.a, "typed site % ignored");
  await assert.rejects(as(OWNER, (c) => c.query("update public.projects set external_works_pct=70 where id=$1", [fx.job])), /need a note/);
  await assert.rejects(as(OWNER, (c) => c.query("update public.projects set external_works_share=10 where id=$1", [fx.job])), /need a note/);
  // Ordinary Site Details edits still work.
  await as(OWNER, (c) => c.query("update public.projects set address='1 Fake Street' where id=$1", [fx.job]));
  assert.equal((await sql("select address from public.projects where id=$1", [fx.job])).rows[0].address, "1 Fake Street");
});

test("override: note required, shown while above calculated, falls away by itself when the stages catch up (logged), and can be switched back by hand", async () => {
  const p2 = await plot("Plot 2");
  await assert.rejects(as(OWNER, (c) => c.query("select public.set_plot_override($1, 40, '  ')", [p2.id])), (e) => e.code === "22023" && /note is required/.test(e.message));
  await assert.rejects(as(OWNER, (c) => c.query("select public.set_plot_override($1, 1, 'below calc')", [p2.id])), /higher than the calculated/);
  const pct = await as(OWNER, (c) => one(c, "select public.set_plot_override($1, 5, 'Checked on site: frame up') v", [p2.id])).then((r) => num(r.v));
  assert.equal(pct, 5);
  const after = await plot("Plot 2");
  assert.equal(num(after.progress_override), 5);
  assert.ok(num(after.progress_calculated) < 5);
  assert.equal((await site()).a, await oldFormula(), "site follows the displayed figure");
  // Raise stages until calculated >= 5 -> back to automatic, logged as superseded.
  const ids = (await sql("select id from public.internal_milestones where plot_id=$1 and stage_key in ('st_slab','st_foundations') ", [p2.id])).rows.map((r) => r.id);
  await as(OWNER, (c) => c.query("update public.internal_milestones set percent=100 where id = any($1)", [ids]));
  const auto = await plot("Plot 2");
  assert.equal(auto.progress_override, null);
  assert.equal(num(auto.progress_pct), num(auto.progress_calculated));
  const hist = (await sql("select action, note, changed_by_name from public.plot_progress_overrides where plot_id=$1 order by changed_at, action", [p2.id])).rows;
  assert.deepEqual(hist.map((h) => h.action), ["set", "superseded"]);
  assert.equal(hist[0].changed_by_name, "Olwen Owner", "the editor's name, resolved by the database");
  // Manual switch-back.
  await as(OWNER, (c) => c.query("select public.set_plot_override($1, 50, 'Taken over mid-build at 50%')", [p2.id]));
  assert.equal(num((await plot("Plot 2")).progress_pct), 50);
  await as(OWNER, (c) => c.query("select public.clear_plot_override($1, null)", [p2.id]));
  const back = await plot("Plot 2");
  assert.equal(back.progress_override, null);
  assert.equal(num(back.progress_pct), num(back.progress_calculated));
  const last = (await sql("select action, note from public.plot_progress_overrides where plot_id=$1 order by changed_at desc limit 1", [p2.id])).rows[0];
  assert.deepEqual(last, { action: "cleared", note: "Switched back to automatic" });
  // History rows can't be written or edited by clients.
  await assert.rejects(as(OWNER, (c) => c.query("insert into public.plot_progress_overrides (project_id, plot_id, action, note) values ($1,$2,'set','x x x')", [fx.job, p2.id])), /permission denied/);
});

test("external works: share formula, note-required history, packages give a weighted %, report figure never set automatically", async () => {
  await assert.rejects(as(OWNER, (c) => c.query("select public.set_external_works($1, 50, 20, '')", [fx.job])), /note is required/);
  await as(OWNER, (c) => c.query("select public.set_external_works($1, 50, 20, 'Roads to base course')", [fx.job]));
  const plotsPart = (await sql(`select ((select sum(progress_pct) from public.plots where project_id=$1)
      + (select coalesce(sum(b.progress_pct * greatest((select count(*) from public.plots f where f.block_id=b.id),1)),0) from public.blocks b where b.project_id=$1))
      / ((select count(*) from public.plots where project_id=$1)
      + (select coalesce(sum(greatest((select count(*) from public.plots f where f.block_id=b.id),1)),0) from public.blocks b where b.project_id=$1))::float v`, [fx.job])).rows[0].v;
  assert.deepEqual(await site(), { a: Math.round((0.2 * 50 + 0.8 * plotsPart) * 10) / 10, e: 50, s: 20 });
  // Packages: 60 share at 50%, 40 share at 100% -> 70%.
  const roads = await as(OWNER, (c) => one(c, "select public.save_external_works_package($1, null, 'Roads', 60, 50, array['Groundworks','Not a stage'], 'Roads package set up') id", [fx.job])).then((r) => r.id);
  const sewers = await as(OWNER, (c) => one(c, "select public.save_external_works_package($1, null, 'Sewers', 40, 100, array['Drainage (Below Ground)'], 'Sewer connection made') id", [fx.job])).then((r) => r.id);
  assert.equal((await site()).e, 70);
  assert.deepEqual((await sql("select report_stages from public.external_works_packages where id=$1", [roads])).rows[0].report_stages, ["Groundworks"], "only real stage names kept");
  await assert.rejects(as(OWNER, (c) => c.query("select public.set_external_works($1, 10, 20, 'typed over packages')", [fx.job])), /worked out from its packages/);
  await as(OWNER, (c) => c.query("select public.set_external_works($1, null, 25, 'Share revised after QS review')", [fx.job]));
  assert.equal((await site()).s, 25);
  await as(OWNER, (c) => c.query("select public.retire_external_works_package($1, 'Sewers folded into roads')", [sewers]));
  assert.equal((await site()).e, 50);
  const hist = (await sql("select kind from public.external_works_updates where project_id=$1 order by changed_at", [fx.job])).rows.map((r) => r.kind);
  assert.deepEqual(hist, ["site", "package_added", "package_added", "site", "package_retired"]);
  assert.ok((await sql("select external_works_updated_at from public.projects where id=$1", [fx.job])).rows[0].external_works_updated_at);
  // A report task tagged External changes nothing.
  const before = await site();
  const ext = await as(OWNER, (c) => one(c, `insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1,'2026-10-12','2026-10-18',$2::jsonb) returning id`,
    [fx.job, JSON.stringify([{ plot: "External / Engineering Works", milestone: "Groundworks", percent: 100 }])])).then((r) => r.id);
  await issue(OWNER, ext);
  assert.deepEqual(await site(), before);
  // Clearing the share goes back to today's formula exactly.
  await as(OWNER, (c) => c.query("select public.set_external_works($1, null, null, 'Back to the old weighting for now')", [fx.job]));
  assert.equal((await site()).a, await oldFormula());
});

test("block % stays typed by editors and the database re-weights the site (once per flat)", async () => {
  await as(OWNER, (c) => c.query("update public.blocks set progress_pct=40 where id=$1", [fx.block]));
  assert.equal((await site()).a, await oldFormula());
});

test("report-only company (Clerk of Works): its report saves raise stages, but it can't edit stages, overrides or external works", async () => {
  const p3 = await plot("Plot 3");
  const rep = await as(CLERK, (c) => one(c, `insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1,'2026-10-19','2026-10-25',$2::jsonb) returning id`,
    [fx.job, JSON.stringify([{ plot: "Plot 3", milestone: "Roofing", percent: 100 }])])).then((r) => r.id);
  assert.equal((await stage(p3.id, "st_roofing")).p, 0, "the clerk's draft raises nothing");
  await issue(CLERK, rep);
  assert.equal((await stage(p3.id, "st_roofing")).p, 100, "issuing it does");
  const s = await stage(p3.id, "st_roofing");
  const upd = await as(CLERK, (c) => c.query("update public.internal_milestones set percent=0 where id=$1", [s.id]));
  assert.equal(upd.rowCount, 0, "can read stages (programme_read) but not write them");
  assert.equal((await stage(p3.id, "st_roofing")).p, 100);
  assert.ok((await as(CLERK, (c) => c.query("select 1 from public.internal_milestones where plot_id=$1", [p3.id]))).rowCount > 0);
  await assert.rejects(as(CLERK, (c) => c.query("select public.set_plot_override($1, 90, 'cow says so')", [p3.id])), (e) => e.code === "42501");
  await assert.rejects(as(CLERK, (c) => c.query("select public.clear_plot_override($1, null)", [p3.id])), (e) => e.code === "42501");
  await assert.rejects(as(CLERK, (c) => c.query("select public.set_external_works($1, 90, 10, 'cow says so')", [fx.job])), (e) => e.code === "42501");
  await assert.rejects(as(CLERK, (c) => c.query("select public.save_external_works_package($1, null, 'X', 10, 10, null, 'cow says so')", [fx.job])), (e) => e.code === "42501");
  const plotUpd = await as(CLERK, (c) => c.query("update public.plots set progress_pct=1 where id=$1", [p3.id]));
  assert.equal(plotUpd.rowCount, 0);
  assert.ok((await as(CLERK, (c) => c.query("select 1 from public.plot_progress_overrides"))).rowCount > 0, "members can read override history");
});

test("viewer company (client): reads plot %, history and external works; writes nothing", async () => {
  const p2 = await plot("Plot 2");
  await as(CLIENT, async (c) => {
    assert.equal((await c.query("select progress_pct from public.plots where project_id=$1", [fx.job])).rowCount, 5);
    assert.ok((await c.query("select 1 from public.external_works_updates")).rowCount > 0);
    assert.ok((await c.query("select 1 from public.external_works_packages")).rowCount > 0);
    assert.ok((await c.query("select 1 from public.internal_milestones where plot_id=$1", [p2.id])).rowCount > 0, "programme_read");
    assert.equal((await c.query("update public.internal_milestones set percent=100 where plot_id=$1", [p2.id])).rowCount, 0);
    await assert.rejects(c.query("insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1,'2026-11-02','2026-11-08')", [fx.job]), /row-level security/);
    await assert.rejects(c.query("select public.set_plot_override($1, 90, 'client says so')", [p2.id]), (e) => e.code === "42501");
    await assert.rejects(c.query("select public.set_external_works($1, 90, 10, 'client says so')", [fx.job]), (e) => e.code === "42501");
  });
});

test("no email reaches a client: history stores and returns a display name (or null -> 'A team member'), never an email", async () => {
  // An editor with no sign-up name, and one whose "name" is an email address.
  await sql("update auth.users set raw_user_meta_data = null where id = $1", [OWNER]);
  const p1 = await plot("Plot 1");
  await as(OWNER, (c) => c.query("select public.set_plot_override($1, 60, 'Walked the plot with the QS')", [p1.id]));
  await sql("update auth.users set raw_user_meta_data = $2::jsonb where id = $1", [OWNER, JSON.stringify({ full_name: "o@fake-owner.test" })]);
  await as(OWNER, (c) => c.query("select public.set_external_works($1, null, 30, 'Share confirmed')", [fx.job]));
  await sql("update auth.users set raw_user_meta_data = $2::jsonb where id = $1", [OWNER, JSON.stringify({ full_name: "Olwen Owner" })]);
  const latest = (await sql("select changed_by_name from public.plot_progress_overrides where plot_id=$1 order by changed_at desc limit 1", [p1.id])).rows[0];
  assert.equal(latest.changed_by_name, null, "no name -> null; the page shows 'A team member'");
  for (const u of [CLIENT, CLERK]) {
    await as(u, async (c) => {
      for (const t of ["plot_progress_overrides", "external_works_updates", "external_works_packages", "progress_stage_events", "progress_stages"]) {
        const r = await c.query(`select * from public.${t}`);
        assert.ok(t === "progress_stages" || r.rowCount > 0, `${t} readable`);
        assert.ok(!r.fields.some((f) => /email/i.test(f.name)), `${t} has no email column`);
        const leaked = r.rows.flatMap((row) => Object.values(row)).filter((v) => typeof v === "string" && /@/.test(v));
        assert.deepEqual(leaked, [], `${t} returns no email`);
      }
      const r = await c.query("select * from public.plots where project_id=$1", [fx.job]);
      assert.deepEqual(r.rows.flatMap((row) => Object.values(row)).filter((v) => typeof v === "string" && /@/.test(v)), []);
      await assert.rejects(c.query("select public.progress_actor_name($1)", [OWNER]), /permission denied/, "the name lookup isn't callable by clients");
    });
  }
  const names = (await sql("select distinct changed_by_name from public.external_works_updates where changed_by_name is not null")).rows.map((r) => r.changed_by_name);
  assert.deepEqual(names, ["Olwen Owner"], "an email-looking name is never stored");
});

test("the share's first-set time is recorded once (so the 21-day reminder can start) and isn't cleared or client-writable", async () => {
  const at = async () => (await sql("select external_works_share_set_at t from public.projects where id=$1", [fx.job])).rows[0].t;
  const t0 = await at();
  assert.ok(t0, "set when the share was first given");
  await as(OWNER, (c) => c.query("select public.set_external_works($1, null, null, 'Share cleared for now')", [fx.job]));
  assert.deepEqual(await at(), t0, "clearing the share later doesn't reset it");
  await as(OWNER, (c) => c.query("update public.projects set external_works_share_set_at = null where id=$1", [fx.job]));
  assert.deepEqual(await at(), t0, "clients can't change it");
  const fresh = await as(OWNER, (c) => one(c, "insert into public.projects (name, org_id, created_by, external_works_share_set_at) values ('Fake Fields',$1,$2, now()) returning id", [fx.org, OWNER])).then((r) => r.id);
  assert.equal((await sql("select external_works_share_set_at t from public.projects where id=$1", [fresh])).rows[0].t, null, "a new site starts with no share set");
  await as(OWNER, (c) => c.query("select public.set_external_works($1, 0, null, 'Set at site setup')", [fresh]));
  assert.equal((await sql("select external_works_share_set_at t from public.projects where id=$1", [fresh])).rows[0].t, null, "a note with no share doesn't count");
  await as(OWNER, (c) => c.query("select public.set_external_works($1, null, 12, 'Share agreed')", [fresh]));
  assert.ok((await sql("select external_works_share_set_at t from public.projects where id=$1", [fresh])).rows[0].t);
});

test("audit log: a recalculation writes a row only when the site figure actually changes", async () => {
  const p2 = await plot("Plot 2");
  // Plot 2 has a manual figure far above its stages, so raising a stage
  // moves its calculated figure but not its shown figure or the site.
  await as(OWNER, (c) => c.query("select public.set_plot_override($1, 90, 'Fake: near finished')", [p2.id]));
  const site0 = await site(), a0 = await auditCount();
  const rep = await as(OWNER, (c) => one(c, `insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1,'2026-11-02','2026-11-08',$2::jsonb) returning id`,
    [fx.job, JSON.stringify([{ plot: "Plot 2", milestone: "Brick & Block Superstructure", percent: 100 }])])).then((r) => r.id);
  await issue(OWNER, rep);
  assert.ok(num((await plot("Plot 2")).progress_calculated) > num(p2.progress_calculated), "the calculation ran");
  assert.deepEqual(await site(), site0);
  assert.equal(await auditCount(), a0, "no figure changed -> no audit row");
  // A plot-page edit that leaves every figure the same: still nothing.
  const s = await stage(p2.id, "st_brick_block");
  await as(OWNER, (c) => c.query("update public.internal_milestones set percent=100 where id=$1", [s.id]));
  assert.equal(await auditCount(), a0);
  // A raise that does move the site: exactly one row.
  const p1 = await plot("Plot 1");
  const rep2 = await as(OWNER, (c) => one(c, `insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1,'2026-11-09','2026-11-15',$2::jsonb) returning id`,
    [fx.job, JSON.stringify(["Roofing", "Render", "Cladding / External Finishes", "Scaffold Drop", "Mastic", "Clean", "Snagging", "Flooring", "Kitchen Fit", "Bathroom Fit", "Painting & Decorating", "Testing & Commissioning", "Handover / Practical Completion", "Carpentry Finals", "Solar Panels (PV)", "Timber Frame Erect", "Slab Pour / Oversite", "Foundations (Foots)", "Drainage (Below Ground)", "Windows & External Doors", "Scaffold Erect", "Brick & Block Superstructure", "1st Fix – Carpentry", "1st Fix – Electrical", "1st Fix – Plumbing & Heating", "Plastering / Drylining", "2nd Fix – Carpentry", "2nd Fix – Electrical", "2nd Fix – Plumbing & Heating", "Groundworks"].map((m) => ({ plot: "Plot 1", milestone: m, percent: 100 })))])).then((r) => r.id);
  await issue(OWNER, rep2);
  assert.ok(num((await plot("Plot 1")).progress_pct) > num(p1.progress_pct));
  assert.notDeepEqual(await site(), site0);
  assert.equal(await auditCount(), a0 + 1, "one figure change -> one audit row");
});

test("build-stage rows can't be deleted or added by any client (owner, main contractor, clerk, client); N/A is the way; deleting a plot still works", async () => {
  const p1 = await plot("Plot 1");
  const before = (await sql("select count(*)::int n from public.internal_milestones where plot_id=$1 and stage_key is not null", [p1.id])).rows[0].n;
  const pctBefore = num((await plot("Plot 1")).progress_pct);
  assert.equal(before, 33);
  // Owner and main contractor have write access to the grid: refused outright.
  for (const u of [OWNER, MC]) {
    await assert.rejects(as(u, (c) => c.query("delete from public.internal_milestones where plot_id=$1 and stage_key <> 'st_groundworks'", [p1.id])),
      (e) => e.code === "42501" && /Mark the stage N\/A/.test(e.message), `delete as ${u}`);
    await assert.rejects(as(u, (c) => c.query("insert into public.internal_milestones (project_id, plot_id, milestone_key, stage_key, title, percent) values ($1,$2,'x_extra','st_roofing','Extra',100)", [fx.job, p1.id])),
      (e) => e.code === "42501" || e.code === "23505", `insert as ${u}`);
  }
  // Clerk (programme_read) and client (programme_read): RLS removes nothing.
  for (const u of [CLERK, CLIENT]) {
    const res = await as(u, (c) => c.query("delete from public.internal_milestones where plot_id=$1", [p1.id]));
    assert.equal(res.rowCount, 0, `delete as ${u}`);
  }
  assert.equal((await sql("select count(*)::int n from public.internal_milestones where plot_id=$1 and stage_key is not null", [p1.id])).rows[0].n, 33);
  assert.equal(num((await plot("Plot 1")).progress_pct), pctBefore, "figure unchanged");
  // Deleting a whole plot still takes its stage rows with it.
  const tmp = await as(OWNER, (c) => one(c, "insert into public.plots (project_id, plot_number) values ($1,'Plot 99') returning id", [fx.job])).then((r) => r.id);
  assert.equal((await sql("select count(*)::int n from public.internal_milestones where plot_id=$1", [tmp])).rows[0].n, 33);
  await as(OWNER, (c) => c.query("delete from public.plots where id=$1", [tmp]));
  assert.equal((await sql("select count(*)::int n from public.internal_milestones where plot_id=$1", [tmp])).rows[0].n, 0);
});

test("overrides use the external works rule: an editor who isn't only an invited company. The main contractor (editor via its company) can't set or clear one", async () => {
  const p3 = await plot("Plot 3");
  await assert.rejects(as(MC, (c) => c.query("select public.set_plot_override($1, 95, 'mc says so')", [p3.id])), (e) => e.code === "42501");
  await assert.rejects(as(MC, (c) => c.query("select public.set_external_works($1, 90, 10, 'mc says so')", [fx.job])), (e) => e.code === "42501");
  await as(OWNER, (c) => c.query("select public.set_plot_override($1, 95, 'Owner checked on site')", [p3.id]));
  await assert.rejects(as(MC, (c) => c.query("select public.clear_plot_override($1, null)", [p3.id])), (e) => e.code === "42501");
  assert.equal(num((await plot("Plot 3")).progress_override), 95);
  await as(OWNER, (c) => c.query("select public.clear_plot_override($1, null)", [p3.id]));
  assert.equal((await plot("Plot 3")).progress_override, null);
});

test("clear_plot_override with a 1-2 character note (or only spaces) falls back to the default note instead of raising", async () => {
  const p3 = await plot("Plot 3");
  for (const note of ["x", "ok", "  ", " a "]) {
    await as(OWNER, (c) => c.query("select public.set_plot_override($1, 96, 'Owner checked on site')", [p3.id]));
    await as(OWNER, (c) => c.query("select public.clear_plot_override($1, $2)", [p3.id, note]));
    assert.equal((await plot("Plot 3")).progress_override, null, `cleared with note ${JSON.stringify(note)}`);
    const h = (await sql("select note from public.plot_progress_overrides where plot_id=$1 and action='cleared' order by changed_at desc, id desc limit 1", [p3.id])).rows[0];
    assert.equal(h.note, "Switched back to automatic");
  }
  await as(OWNER, (c) => c.query("select public.set_plot_override($1, 96, 'Owner checked on site')", [p3.id]));
  await as(OWNER, (c) => c.query("select public.clear_plot_override($1, $2)", [p3.id, "Stages caught up"]));
  assert.equal((await sql("select note from public.plot_progress_overrides where plot_id=$1 and action='cleared' order by changed_at desc, id desc limit 1", [p3.id])).rows[0].note, "Stages caught up");
});

test("create_site: the site and its share in one call; a bad share leaves no half-made site; permission enforced in the database", async () => {
  const count = async () => (await sql("select count(*)::int n from public.projects where name like 'Fake New Site%'")).rows[0].n;
  const id = await as(OWNER, (c) => one(c, "select public.create_site($1::jsonb, 15, 'Set at site setup') id",
    [JSON.stringify({ name: "Fake New Site", address: "1 Fake Road", org_id: fx.org })])).then((r) => r.id);
  const row = (await sql("select external_works_share::float s, external_works_share_set_at is not null set, created_by from public.projects where id=$1", [id])).rows[0];
  assert.deepEqual(row, { s: 15, set: true, created_by: OWNER });
  assert.equal((await sql("select count(*)::int n from public.external_works_updates where project_id=$1 and note='Set at site setup'", [id])).rows[0].n, 1);
  assert.equal((await sql("select count(*)::int n from public.project_members where project_id=$1 and user_id=$2", [id, OWNER])).rows[0].n, 1, "creator is a member");
  // A share that can't be saved: nothing is created at all.
  const n0 = await count();
  await assert.rejects(as(OWNER, (c) => c.query("select public.create_site($1::jsonb, 150)", [JSON.stringify({ name: "Fake New Site 2", org_id: fx.org })])), /share must be between/);
  assert.equal(await count(), n0, "no half-made site");
  // Without a share: a site with share not set (today's weighting).
  const id2 = await as(OWNER, (c) => one(c, "select public.create_site($1::jsonb) id", [JSON.stringify({ name: "Fake New Site 3", org_id: fx.org })])).then((r) => r.id);
  assert.equal((await sql("select external_works_share s from public.projects where id=$1", [id2])).rows[0].s, null);
  // Not an admin of that company: refused by the database.
  for (const u of [CLIENT, MC]) {
    await assert.rejects(as(u, (c) => c.query("select public.create_site($1::jsonb, 10)", [JSON.stringify({ name: "Fake New Site 4", org_id: fx.org })])), /row-level security/);
  }
  assert.equal(await count(), n0 + 1);
  const anon = await anonClient(DB);
  try {
    await assert.rejects(anon.query("select public.create_site($1::jsonb, 10)", [JSON.stringify({ name: "Fake New Site 5", org_id: fx.org })]), /permission denied/);
  } finally {
    await anon.end();
  }
});

test("outsider sees none of it; anon can't call anything", async () => {
  const p1 = await plot("Plot 1");
  await as(OUTSIDER, async (c) => {
    for (const t of ["plots", "internal_milestones", "plot_progress_overrides", "external_works_updates", "external_works_packages", "progress_stage_events", "progress_migration_flags"]) {
      assert.equal((await c.query(`select 1 from public.${t}`)).rowCount, 0, t);
    }
    assert.equal((await c.query("select 1 from public.progress_stages")).rowCount, 33, "the stage list itself is readable");
    await assert.rejects(c.query("select public.set_plot_override($1, 90, 'outsider')", [p1.id]), (e) => e.code === "42501");
    await assert.rejects(c.query("select public.set_external_works($1, 90, 10, 'outsider')", [fx.job]), (e) => e.code === "42501");
    for (const f of ["public.recalc_project_progress($1)", "public.recalc_plot_progress($1)", "public.apply_weekly_report_progress($1, 'report')", "public.resolve_plot_tags($1, '1')", "public.resolve_plot_tags_detail($1, '1')"]) {
      await assert.rejects(c.query(`select ${f}`, [fx.job]), /permission denied/, f);
    }
    await assert.rejects(c.query("select 1 from public.legacy_v69_plot_progress"), /permission denied/);
  });
  const anon = await anonClient(DB);
  try {
    for (const f of ["public.set_plot_override($1, 90, 'anon')", "public.clear_plot_override($1, null)", "public.set_external_works($1, 1, 1, 'anon')", "public.retire_external_works_package($1, 'anon')"]) {
      await assert.rejects(anon.query(`select ${f}`, [p1.id]), /permission denied/, f);
    }
  } finally {
    await anon.end();
  }
});
