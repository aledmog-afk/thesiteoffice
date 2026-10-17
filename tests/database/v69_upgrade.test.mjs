// v69 go-live migration safety (site progress: one 33-stage list, plot
// overrides, external works share). Upgrading a populated pre-v69
// database must leave EVERY plot and site figure exactly as it was
// (today's figure is carried over as a noted manual override), carry the
// old grid across (Dry Lining + Plastering averaged, flagged when more
// than 25 apart), retire (never delete) the old rows, backfill past
// SUBMITTED reports (never drafts) raise-only with the shared tag parser,
// and running the schema
// again must change nothing. If the figures WOULD change, the migration
// stops and applies nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, runSqlFile, runSql, adminClient } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SETUP = path.join(__dirname, "../lib/mock_setup.sql");
const SCHEMA = path.join(__dirname, "../../sql/schema.sql");
const FULL = fs.readFileSync(SCHEMA, "utf8");
const PRE_V69 = FULL.slice(0, FULL.indexOf("-- ─── v69 ADDITIONS"));
const ORG = "a6900000-0000-0000-0000-0000000000f1";

test("v69: the pre-v69 prefix has no stage list yet (sanity)", () => {
  assert.ok(FULL.includes("-- ─── v69 ADDITIONS"));
  assert.ok(!PRE_V69.includes("progress_stages") && PRE_V69.includes("seed_plot_defaults"));
});

// A small site shaped like the live ones: 3 houses (two typed at 60/50,
// one at 0), a block typed at 30 with 2 flats, external works 20, and
// weekly reports using a range tag, a block-name tag, the External tag,
// an unknown tag and an N/A stage.
async function seedPreV69(admin, { plot3Kitchen = 0 } = {}) {
  await admin.query("insert into public.organisations (id, name) values ($1, 'Fake Homes Ltd')", [ORG]);
  const proj = (await admin.query("insert into public.projects (name, org_id, external_works_pct) values ('Fake Meadows', $1, 20) returning id", [ORG])).rows[0].id;
  const block = (await admin.query("insert into public.blocks (project_id, block_name, progress_pct) values ($1, 'Block A', 30) returning id", [proj])).rows[0].id;
  const ins = async (n, blockId, pct) => (await admin.query(
    "insert into public.plots (project_id, block_id, plot_number, progress_pct) values ($1,$2,$3,$4) returning id", [proj, blockId, n, pct])).rows[0].id;
  const p1 = await ins("Plot 1", null, 60), p2 = await ins("Plot 2", null, 50), p3 = await ins("Plot 3", null, 0);
  const f11 = await ins("Flat 11", block, 0), f12 = await ins("Flat 12", block, 0);
  const setGrid = (plot, key, pct) => admin.query("update public.internal_milestones set percent = $3 where plot_id = $1 and milestone_key = $2", [plot, key, pct]);
  await setGrid(p1, "dry_lining", 100); await setGrid(p1, "plastering", 0); await setGrid(p1, "kitchen", 50);
  await setGrid(p2, "timber_frame", 100); await setGrid(p2, "dry_lining", 80); await setGrid(p2, "plastering", 80);
  if (plot3Kitchen) await setGrid(p3, "kitchen", plot3Kitchen);
  await admin.query(`insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values
    ($1, '2026-09-07', '2026-09-13', $2::jsonb), ($1, '2026-09-14', '2026-09-20', $3::jsonb)`, [proj,
    JSON.stringify([
      { plot: "1-2", milestone: "Groundworks", percent: 60 },
      { plot: "Block A", milestone: "Roofing", percent: 100 },
      { plot: "External / Engineering Works", milestone: "Drainage (Below Ground)", percent: 100 },
      { plot: "S278", milestone: "Render", percent: 100 },
    ]),
    JSON.stringify([
      { plot: "Plot 1, Plot 2", milestone: "Groundworks", percent: 100 },
      { plot: "Plot 3", milestone: "External Works / Landscaping", percent: 100 },
      { plot: "Plot 2", milestone: "Groundworks", percent: 30 },
    ])]);
  // Both of those were submitted (and issued) ...
  await admin.query("update public.weekly_reports set status='reviewed' where project_id=$1", [proj]);
  await admin.query("update public.weekly_reports set status='approved' where project_id=$1", [proj]);
  await admin.query("update public.weekly_reports set status='issued' where project_id=$1", [proj]);
  // ... and a third is still a DRAFT. It must not be backfilled: Plot 3 is
  // stored at 0, so if this draft raised its Kitchen to 100 the hard
  // acceptance check would stop the go-live.
  await admin.query(`insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1, '2026-09-21', '2026-09-27', $2::jsonb)`,
    [proj, JSON.stringify([{ plot: "Plot 3", milestone: "Kitchen Fit", percent: 100 }, { plot: "Plot 1", milestone: "Roofing", percent: 100 }])]);
  // Today's stored site figure, as the browser formula left it:
  // (60 + 50 + 0 + 0 + 0 + 30 x 2 + 20) / (5 + 2 + 1) = 23.75 -> 23.8
  await admin.query("update public.projects set actual_progress_pct = 23.8 where id = $1", [proj]);
  return { proj, block, p1, p2, p3, f11, f12 };
}

const FIGURES = `select json_build_object(
  'plots', (select json_agg(json_build_object('n', plot_number, 'pct', progress_pct::text) order by plot_number) from public.plots),
  'blocks', (select json_agg(progress_pct::text) from public.blocks),
  'sites', (select json_agg(json_build_object('a', actual_progress_pct::text, 'e', external_works_pct::text)) from public.projects)
) f`;
const COUNTS = `select json_build_object(
  'im', (select count(*) from public.internal_milestones),
  'st', (select count(*) from public.internal_milestones where stage_key is not null),
  'retired', (select count(*) from public.internal_milestones where retired_at is not null),
  'events', (select count(*) from public.progress_stage_events),
  'overrides', (select count(*) from public.plot_progress_overrides),
  'flags', (select count(*) from public.progress_migration_flags),
  'maplog', (select count(*) from public.progress_stage_mapping_log),
  'runs', (select count(*) from public.progress_migration_runs),
  'audit', (select count(*) from public.audit_log),
  'stage_values', (select json_agg(plot_id::text || stage_key || percent::text || applicable::text order by plot_id, stage_key) from public.internal_milestones where stage_key is not null)
) c`;

test("v69: every plot and site figure is identical after go-live; grid carried, old rows retired, reports backfilled raise-only; second apply is a no-op", async () => {
  const db = "tracker_test_v69_upgrade";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V69);
    const fx = await seedPreV69(admin);
    const before = (await admin.query(FIGURES)).rows[0].f;
    const legacyBefore = (await admin.query("select count(*)::int n from public.internal_milestones")).rows[0].n;
    assert.equal(legacyBefore, 3 * 18 + 2 * 16);

    await runSqlFile(admin, SCHEMA);
    const after = (await admin.query(FIGURES)).rows[0].f;
    assert.deepEqual(after, before, "HARD ACCEPTANCE: identical plot, block and site figures");

    // 33 live stages per plot; the old rows are retired, not deleted.
    const c1 = (await admin.query(COUNTS)).rows[0].c;
    assert.equal(c1.st, 5 * 33);
    assert.equal(c1.retired, legacyBefore);
    assert.equal(c1.im, legacyBefore + 5 * 33, "nothing deleted");
    assert.equal(c1.runs, 1);

    const stage = async (plot, key) => (await admin.query(
      "select percent::float p, applicable a, last_source s from public.internal_milestones where plot_id=$1 and stage_key=$2", [plot, key])).rows[0];
    // Grid mapping (logged): Dry Lining 100 + Plastering 0 -> 50 and flagged; 80/80 -> 80, not flagged.
    assert.equal((await stage(fx.p1, "st_plaster_dryline")).p, 50);
    assert.equal((await stage(fx.p2, "st_plaster_dryline")).p, 80);
    assert.equal((await stage(fx.p2, "st_timber_frame")).p, 100);
    assert.equal((await stage(fx.p1, "st_kitchen")).p, 50);
    const flags = (await admin.query("select plot_id from public.progress_migration_flags")).rows.map((r) => r.plot_id);
    assert.deepEqual(flags, [fx.p1]);
    assert.ok(c1.maplog > 0, "every carried mapping is logged");
    // Backfill: "1-2" range counts for both plots; raise-only (a later 30 doesn't lower 100).
    assert.deepEqual(await stage(fx.p1, "st_groundworks"), { p: 100, a: true, s: "backfill" });
    assert.equal((await stage(fx.p2, "st_groundworks")).p, 100);
    // Block name, External tag and unknown tag move nothing; N/A stays N/A and unraised.
    assert.equal((await stage(fx.f11, "st_roofing")).p, 0);
    assert.equal((await stage(fx.f11, "st_roofing")).a, false, "flats: roofing N/A by default");
    for (const p of [fx.p1, fx.p2, fx.p3]) {
      assert.equal((await stage(p, "st_drainage")).p, 0);
      assert.equal((await stage(p, "st_render")).p, 0);
    }
    assert.deepEqual(await stage(fx.p3, "st_external_works"), { p: 0, a: false, s: "migration" });
    assert.equal((await stage(fx.p3, "st_site_setup")).a, false);
    // The draft report raised nothing.
    assert.equal((await stage(fx.p3, "st_kitchen")).p, 0, "drafts are not backfilled");
    assert.equal((await stage(fx.p1, "st_roofing")).p, 0, "drafts are not backfilled");

    // Overrides: every plot with a figure above 0 carried over, with the note; manual while above calculated.
    const ov = (await admin.query(`select p.plot_number n, p.progress_override::float o, p.progress_calculated::float c, p.progress_override_note note
      from public.plots p order by plot_number`)).rows;
    const byN = Object.fromEntries(ov.map((r) => [r.n, r]));
    assert.equal(byN["Plot 1"].o, 60);
    assert.equal(byN["Plot 2"].o, 50);
    assert.equal(byN["Plot 1"].note, "Carried over at go-live — site taken over mid-build");
    assert.equal(byN["Plot 3"].o, null, "nothing to carry on a plot at 0");
    assert.equal(byN["Flat 11"].o, null);
    // Calculated = average of applicable stages (house 31): (100+50+50)/31 = 6.5
    assert.equal(byN["Plot 1"].c, 6.5);
    const carried = (await admin.query("select count(*)::int n from public.plot_progress_overrides where action='carried_over'")).rows[0].n;
    assert.equal(carried, 2);
    const site = (await admin.query("select external_works_share s, stage_progress_since is not null since from public.projects")).rows[0];
    assert.equal(site.s, null, "share starts unset, so today's weighting is kept");
    assert.equal(site.since, true);

    // Second (and third) full apply: nothing at all changes.
    await runSqlFile(admin, SCHEMA);
    const c2 = (await admin.query(COUNTS)).rows[0].c;
    assert.deepEqual(c2, c1, "re-running schema.sql never re-backfills, re-carries or resets overrides");
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before);
    await runSqlFile(admin, SCHEMA);
    assert.deepEqual((await admin.query(COUNTS)).rows[0].c, c1);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

// Nothing of v69 left: no v69 tables, triggers, functions (so nothing
// callable by anon / authenticated), columns, data, and the old seed.
async function assertNothingOfV69(admin) {
  const r = (await admin.query(`select
    (select count(*) from pg_trigger where tgname like '%v69%')::int triggers,
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
       and p.proname in ('progress_internal','progress_bulk','plot_tag_key','resolve_plot_tags','resolve_plot_tags_detail','recalc_plot_progress',
         'recalc_project_progress','apply_weekly_report_progress','set_plot_override','clear_plot_override','set_external_works',
         'save_external_works_package','retire_external_works_package','create_site','progress_actor_name','external_works_check'))::int functions,
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
       and (c.relname like 'legacy_v69%' or c.relname like 'progress_%' or c.relname like 'external_works_%' or c.relname = 'plot_progress_overrides'))::int tables,
    (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'internal_milestones' and column_name = 'stage_key')::int cols,
    (select prosrc from pg_proc where proname = 'seed_plot_defaults') seed`)).rows[0];
  assert.deepEqual({ t: r.triggers, f: r.functions, tb: r.tables, c: r.cols }, { t: 0, f: 0, tb: 0, c: 0 }, "no v69 objects left");
  assert.ok(!r.seed.includes("progress_stages"), "the old seed_plot_defaults is still the live one");
}

test("v69: if any figure WOULD change, the go-live step stops with the differences and applies nothing", async () => {
  const db = "tracker_test_v69_upgrade_stop";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V69);
    // Plot 3 is stored at 0 but its old grid already shows Kitchen 100, so
    // its calculated figure (3.2) would be above today's: a real difference.
    const fx = await seedPreV69(admin, { plot3Kitchen: 100 });
    const before = (await admin.query(FIGURES)).rows[0].f;
    const imBefore = (await admin.query("select count(*)::int n, count(*) filter (where percent > 0)::int nz from public.internal_milestones")).rows[0];
    const auditBefore = (await admin.query("select count(*)::int n from public.audit_log")).rows[0].n;
    await assert.rejects(runSqlFile(admin, SCHEMA), /v69 go-live stopped: figures would change \(plot [0-9a-f-]+: 0 -> 3\.2/);
    // v69 runs in its own BEGIN ... COMMIT, so after a failure the session
    // holds an aborted transaction: the runner (psql exits on error, the
    // SQL editor ends its session) rolls it back.
    await admin.query("rollback");
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before);
    // A schema.sql run is one implicit transaction, so the whole v69 apply
    // (tables, triggers, data) is rolled back with it.
    const after = (await admin.query("select count(*)::int n, count(*) filter (where percent > 0)::int nz from public.internal_milestones")).rows[0];
    assert.deepEqual(after, imBefore, "no stage rows added, nothing changed");
    assert.equal((await admin.query("select to_regclass('public.progress_stages') t")).rows[0].t, null, "nothing of v69 applied");
    await assertNothingOfV69(admin);
    assert.equal((await admin.query("select count(*)::int n from public.audit_log")).rows[0].n, auditBefore);
    assert.ok(fx.p3);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

const ROLLBACK = path.join(__dirname, "../../sql/rollback/v69_site_progress_rollback.sql");
const GRID = `select json_agg(json_build_object('id', id, 'k', milestone_key, 't', title, 'p', percent::text, 'o', sort_order) order by id) g
  from public.internal_milestones`;

test("v69 rollback script: after go-live and later use, every figure and the old grid go back exactly; new tables kept; re-run is a no-op", async () => {
  const db = "tracker_test_v69_rollback";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V69);
    const fx = await seedPreV69(admin);
    const before = (await admin.query(FIGURES)).rows[0].f;
    const gridBefore = (await admin.query(GRID)).rows[0].g;
    assert.equal(gridBefore.length, 3 * 18 + 2 * 16);

    await runSqlFile(admin, SCHEMA);
    // Use it after go-live: a submitted report raises Plot 3, the site
    // share is set, a plot override is set.
    const rep = (await admin.query(`insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1,'2026-10-05','2026-10-11',$2::jsonb) returning id`,
      [fx.proj, JSON.stringify([{ plot: "Plot 3", milestone: "Groundworks", percent: 100 }])])).rows[0].id;
    for (const st of ["reviewed", "approved", "issued"]) await admin.query("update public.weekly_reports set status=$2 where id=$1", [rep, st]);
    await admin.query("select set_config('app.progress_internal','on',false)");
    await admin.query("update public.projects set external_works_share = 15, external_works_share_set_at = now() where id=$1", [fx.proj]);
    await admin.query("select set_config('app.progress_internal','',false)");
    await admin.query("select public.recalc_project_progress($1)", [fx.proj]);
    assert.notDeepEqual((await admin.query(FIGURES)).rows[0].f, before, "figures moved after go-live");
    const kept = (await admin.query("select (select count(*) from public.progress_stage_events)::int ev, (select count(*) from public.plot_progress_overrides)::int ov")).rows[0];

    await runSqlFile(admin, ROLLBACK);
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before, "every plot, block and site figure back exactly");
    assert.deepEqual((await admin.query(GRID)).rows[0].g, gridBefore, "old grid rows back (same values); no 33-stage rows left on go-live plots");
    assert.equal((await admin.query("select count(*)::int n from public.internal_milestones where retired_at is not null")).rows[0].n, 0, "old grid un-retired");
    // New tables and their history are kept (nothing dropped); the stage rows are archived.
    const k2 = (await admin.query("select (select count(*) from public.progress_stage_events)::int ev, (select count(*) from public.plot_progress_overrides)::int ov")).rows[0];
    assert.deepEqual(k2, kept);
    assert.equal((await admin.query("select count(*)::int n from public.legacy_v69_rollback_stage_rows")).rows[0].n, 5 * 33);
    for (const t of ["progress_stages", "external_works_updates", "external_works_packages", "legacy_v69_plot_progress"]) {
      assert.ok((await admin.query("select to_regclass($1) t", [`public.${t}`])).rows[0].t, `${t} kept`);
    }
    // v69 behaviour is off: a submitted report no longer moves anything, and
    // a typed plot % sticks again (today's pages).
    const v69Triggers = (await admin.query("select count(*)::int n from pg_trigger where tgname like '%v69%'")).rows[0].n;
    assert.equal(v69Triggers, 0);
    await admin.query("update public.plots set progress_pct = 70 where id=$1", [fx.p1]);
    assert.equal(Number((await admin.query("select progress_pct from public.plots where id=$1", [fx.p1])).rows[0].progress_pct), 70);
    await admin.query("update public.plots set progress_pct = 60 where id=$1", [fx.p1]);
    // New plots get the old 18-row grid again.
    const np = (await admin.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 9') returning id", [fx.proj])).rows[0].id;
    assert.equal((await admin.query("select count(*)::int n from public.internal_milestones where plot_id=$1", [np])).rows[0].n, 18);
    await admin.query("delete from public.plots where id=$1", [np]);

    // Running it again changes nothing; re-applying v69 on top refuses.
    const audit = (await admin.query("select count(*)::int n from public.audit_log")).rows[0].n;
    await runSqlFile(admin, ROLLBACK);
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before);
    assert.deepEqual((await admin.query(GRID)).rows[0].g, gridBefore);
    assert.equal((await admin.query("select count(*)::int n from public.audit_log")).rows[0].n, audit, "no audit rows when nothing differs");
    await assert.rejects(runSqlFile(admin, SCHEMA), /v69 was rolled back here/);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

const V69_ONLY = FULL.slice(FULL.indexOf("-- ─── v69 ADDITIONS"));

test("v69 abort path: inside an outer transaction (as apply_migration runs it) and when run statement by statement in one session, a STOP at the data step leaves nothing behind", async () => {
  const db = "tracker_test_v69_abort";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V69);
    await seedPreV69(admin, { plot3Kitchen: 100 });
    const before = (await admin.query(FIGURES)).rows[0].f;
    // 1. Wrapped in an outer transaction: v69's own BEGIN only warns.
    await admin.query("begin");
    await assert.rejects(runSql(admin, V69_ONLY), /v69 go-live stopped/);
    await admin.query("rollback");
    await assertNothingOfV69(admin);
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before);
    // 2. Statement by statement (separate round trips, one session): after
    //    the STOP every later statement fails and the final COMMIT rolls back.
    const stmts = splitStatements(V69_ONLY);
    assert.ok(stmts.length > 100 && /^begin;?$/i.test(stmts[0].trim()));
    let stopped = false;
    for (const st of stmts) {
      try { await admin.query(st); } catch (e) { if (/v69 go-live stopped/.test(e.message)) stopped = true; }
    }
    assert.ok(stopped);
    await admin.query("rollback").catch(() => {});
    await assertNothingOfV69(admin);
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

test("v69 inside an outer transaction (apply_migration style) applies normally when the figures match", async () => {
  const db = "tracker_test_v69_outer";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V69);
    await seedPreV69(admin);
    const before = (await admin.query(FIGURES)).rows[0].f;
    await admin.query("begin");
    await runSql(admin, V69_ONLY);
    await admin.query("commit").catch(() => {});
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before);
    assert.equal((await admin.query("select count(*)::int n from public.progress_migration_runs where step='v69_go_live'")).rows[0].n, 1);
    assert.ok((await admin.query("select count(*)::int n from pg_trigger where tgname like '%v69%'")).rows[0].n >= 7);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

// Minimal SQL splitter for the test: top-level semicolons, honouring
// dollar quotes, quotes and -- comments.
function splitStatements(sql) {
  const out = []; let cur = ""; let i = 0; let dollar = null; let q = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (dollar) {
      if (sql.startsWith(dollar, i)) { cur += dollar; i += dollar.length; dollar = null; continue; }
      cur += ch; i++; continue;
    }
    if (q) { cur += ch; if (ch === "'") q = false; i++; continue; }
    if (ch === "-" && sql[i + 1] === "-") { const j = sql.indexOf("\n", i); const end = j < 0 ? sql.length : j; cur += sql.slice(i, end); i = end; continue; }
    if (ch === "'") { q = true; cur += ch; i++; continue; }
    if (ch === "$") { const m = sql.slice(i).match(/^\$[A-Za-z0-9_]*\$/); if (m) { dollar = m[0]; cur += dollar; i += dollar.length; continue; } }
    if (ch === ";") { if (cur.replace(/--[^\n]*/g, "").trim()) out.push(cur.replace(/^(\s*--[^\n]*\n)*\s*/, "") + ";"); cur = ""; i++; continue; }
    cur += ch; i++;
  }
  return out;
}
