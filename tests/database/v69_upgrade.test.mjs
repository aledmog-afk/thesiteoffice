// v69 go-live migration safety (site progress: one 33-stage list, plot
// overrides, external works share). Upgrading a populated pre-v69
// database must leave EVERY plot and site figure exactly as it was
// (today's figure is carried over as a noted manual override), carry the
// old grid across (Dry Lining + Plastering averaged, flagged when more
// than 25 apart), retire (never delete) the old rows, backfill past
// reports raise-only with the shared tag parser, and running the schema
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
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before);
    // A schema.sql run is one implicit transaction, so the whole v69 apply
    // (tables, triggers, data) is rolled back with it.
    const after = (await admin.query("select count(*)::int n, count(*) filter (where percent > 0)::int nz from public.internal_milestones")).rows[0];
    assert.deepEqual(after, imBefore, "no stage rows added, nothing changed");
    assert.equal((await admin.query("select to_regclass('public.progress_stages') t")).rows[0].t, null, "nothing of v69 applied");
    assert.equal((await admin.query("select count(*)::int n from public.audit_log")).rows[0].n, auditBefore);
    assert.ok(fx.p3);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});
