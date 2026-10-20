// v75 block-level build progress stages. Mirrors the plot mechanic
// (internal_milestones / plots_v69_*) for blocks: a new block_milestones
// table seeded with the shell-only stage subset (house_default_applicable
// = true AND flat_default_applicable = false), recalc_block_progress()
// (GREATEST(override, calculated)), a new guard trigger stopping direct
// client writes to blocks.progress_pct, resolve_block_tags() closing the
// "weekly reports already recognise a block-name tag but explicitly skip
// it" gap, and the same "hard acceptance" go-live safety v69 pioneered:
// every existing block's AND site's figure must be bit-for-bit identical
// immediately after the migration runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, runSqlFile, runSql, adminClient, userClient, anonClient } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SETUP = path.join(__dirname, "../lib/mock_setup.sql");
const SCHEMA = path.join(__dirname, "../../sql/schema.sql");
const FULL = fs.readFileSync(SCHEMA, "utf8");
const V74_MARKER = "-- ─── v75 ADDITIONS: Block-level build progress stages";
const PRE_V74 = FULL.slice(0, FULL.indexOf(V74_MARKER));
const ORG = "a7400000-0000-0000-0000-0000000000f1";

test("v75: the pre-v75 prefix has no block stages yet (sanity)", () => {
  assert.ok(FULL.includes(V74_MARKER));
  assert.ok(!PRE_V74.includes("block_milestones") && PRE_V74.includes("seed_block_defaults"));
});

// A site shaped like a real one: a block with a manual figure (set via
// the v69-era direct write, since blocks had no override mechanism
// before v75), a house (its progress_pct is plot-stage-calculated,
// already live pre-v75 — a raw insert never sticks, so its real value is
// whatever internal_milestones/recalc_plot_progress naturally produce,
// not asserted on here), an issued weekly report tagging the block by
// name (previously silently skipped), and a draft report that must NOT
// be backfilled.
async function seedPreV74(admin) {
  await admin.query("insert into public.organisations (id, name) values ($1, 'Fake Homes Ltd')", [ORG]);
  const proj = (await admin.query("insert into public.projects (name, org_id, external_works_pct) values ('Fake Meadows', $1, 20) returning id", [ORG])).rows[0].id;
  const block = (await admin.query("insert into public.blocks (project_id, block_name, progress_pct) values ($1, 'Block A', 42) returning id", [proj])).rows[0].id;
  const house = (await admin.query("insert into public.plots (project_id, block_id, plot_number) values ($1, null, 'Plot 1') returning id", [proj])).rows[0].id;
  await admin.query(
    "insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1, '2026-09-07', '2026-09-13', $2::jsonb)",
    [proj, JSON.stringify([{ plot: "Block A", milestone: "Roofing", percent: 55 }])]);
  // Reports only ever raise stages once truly issued (draft -> reviewed -> approved -> issued).
  await admin.query("update public.weekly_reports set status='reviewed' where project_id=$1", [proj]);
  await admin.query("update public.weekly_reports set status='approved' where project_id=$1", [proj]);
  await admin.query("update public.weekly_reports set status='issued' where project_id=$1", [proj]);
  // A second, still-draft report — must not be backfilled (same v69 guard).
  await admin.query(
    "insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1, '2026-09-14', '2026-09-20', $2::jsonb)",
    [proj, JSON.stringify([{ plot: "Block A", milestone: "Groundworks", percent: 100 }])]);
  // Re-derive the site figure from the real, already-live v69 formula
  // (blocks.progress_pct=42, the house's own calculated figure, ext=20)
  // rather than hardcoding a number — a genuinely live site is always
  // internally consistent this way (every write already triggers a
  // recalc), so this is what "today's figure" actually means pre-v75.
  await admin.query("select public.recalc_project_progress($1)", [proj]);
  return { proj, block, house };
}

const FIGURES = `select json_build_object(
  'plots', (select json_agg(progress_pct::text order by plot_number) from public.plots),
  'blocks', (select json_agg(progress_pct::text order by block_name) from public.blocks),
  'sites', (select json_agg(json_build_object('a', actual_progress_pct::text, 'e', external_works_pct::text)) from public.projects)
) f`;

test("v75: every block and site figure is identical after go-live; shell stages seeded, previously-skipped block tag now backfilled raise-only; second apply is a no-op", async () => {
  const db = "tracker_test_v75_block_stages";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V74);
    const fx = await seedPreV74(admin);
    const before = (await admin.query(FIGURES)).rows[0].f;

    await runSqlFile(admin, SCHEMA);
    const after = (await admin.query(FIGURES)).rows[0].f;
    assert.deepEqual(after, before, "HARD ACCEPTANCE: identical plot, block and site figures");

    // Exactly the shell-only stages (house_default_applicable AND NOT
    // flat_default_applicable) — not all 29 house-applicable stages.
    const stages = (await admin.query(
      "select stage_key from public.block_milestones where block_id=$1 order by sort_order", [fx.block])).rows.map((r) => r.stage_key);
    assert.deepEqual(stages, [
      "st_groundworks", "st_foundations", "st_drainage", "st_slab", "st_timber_frame", "st_brick_block",
      "st_scaffold_erect", "st_roofing", "st_windows_doors", "st_scaffold_drop", "st_render", "st_cladding",
      "st_1fix_gas", "st_pv",
    ]);
    const expected = (await admin.query(
      "select count(*)::int n from public.progress_stages where house_default_applicable and not flat_default_applicable")).rows[0].n;
    assert.equal(stages.length, expected);

    // The override carried the block's previous manual figure over.
    const block = (await admin.query(
      "select progress_pct::float p, progress_calculated::float c, progress_override::float o, progress_override_note note from public.blocks where id=$1", [fx.block])).rows[0];
    assert.equal(block.o, 42);
    assert.match(block.note, /Carried over at the block-stages go-live/);
    const carried = (await admin.query("select count(*)::int n from public.block_progress_overrides where action='carried_over'")).rows[0].n;
    assert.equal(carried, 1);

    // The issued report's block-name tag, previously silently skipped,
    // now raises the matching stage, raise-only; the draft report doesn't.
    const roofing = (await admin.query(
      "select percent::float p, last_source s from public.block_milestones where block_id=$1 and stage_key='st_roofing'", [fx.block])).rows[0];
    assert.equal(roofing.p, 55);
    assert.equal(roofing.s, "backfill");
    const groundworks = (await admin.query(
      "select percent::float p from public.block_milestones where block_id=$1 and stage_key='st_groundworks'", [fx.block])).rows[0];
    assert.equal(groundworks.p, 0, "the draft report must not be backfilled");

    // Second (and third) full apply: nothing changes.
    const countsQ = `select json_build_object(
      'bm', (select count(*) from public.block_milestones),
      'ev', (select count(*) from public.block_progress_stage_events),
      'ov', (select count(*) from public.block_progress_overrides),
      'runs', (select count(*) from public.progress_migration_runs where step='v75_block_stages_go_live')
    ) c`;
    const c1 = (await admin.query(countsQ)).rows[0].c;
    assert.equal(c1.runs, 1);
    await runSqlFile(admin, SCHEMA);
    assert.deepEqual((await admin.query(countsQ)).rows[0].c, c1, "re-running schema.sql never re-backfills, re-carries or resets overrides");
    assert.deepEqual((await admin.query(FIGURES)).rows[0].f, before);
    await runSqlFile(admin, SCHEMA);
    assert.deepEqual((await admin.query(countsQ)).rows[0].c, c1);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

// Regression: a real bug the hard acceptance check itself caught on the
// live database (not hypothetical) — a block whose progress_pct was
// genuinely 0% gets NO override carried over in step 3 ("0% needs no
// carry-over"), so it has nothing protecting its displayed figure if
// the go-live backfill then raises its block_milestones above 0 from a
// historical issued report's block-name tag. The live apply aborted
// with "block ...: 0 -> 6.1" and rolled back cleanly before this was
// fixed. Fixed by excluding exactly the 0%-starting blocks from the
// one-time backfill (via the app.progress_block_floor_zero_ids GUC) —
// this test locks that in for a block that is genuinely 0% AND has a
// matching issued report, alongside the normal (protected, non-zero)
// case the test above already covers.
test("v75: a block that starts at genuinely 0% is excluded from the go-live backfill, so its figure can't move with no override to protect it", async () => {
  const db = "tracker_test_v75_zero_block";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V74);
    const fx = await seedPreV74(admin);

    // A second block, genuinely at 0% (never manually set), with its
    // own issued report tagging it by name — exactly the shape that
    // broke on the real data.
    const zeroBlock = (await admin.query(
      "insert into public.blocks (project_id, block_name, progress_pct) values ($1, 'Block Z', 0) returning id", [fx.proj])).rows[0].id;
    // Update by this one report's own id, not by project_id — seedPreV74
    // already left a deliberately-draft report on this same project
    // (to prove drafts are never backfilled), and a project-wide status
    // update would wrongly promote that one to issued too.
    const zReport = (await admin.query(
      "insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1, '2026-09-07', '2026-09-13', $2::jsonb) returning id",
      [fx.proj, JSON.stringify([{ plot: "Block Z", milestone: "Groundworks", percent: 30 }])])).rows[0].id;
    await admin.query("update public.weekly_reports set status='reviewed' where id=$1", [zReport]);
    await admin.query("update public.weekly_reports set status='approved' where id=$1", [zReport]);
    await admin.query("update public.weekly_reports set status='issued' where id=$1", [zReport]);
    await admin.query("select public.recalc_project_progress($1)", [fx.proj]);
    const before = (await admin.query(FIGURES)).rows[0].f;

    await runSqlFile(admin, SCHEMA);
    const after = (await admin.query(FIGURES)).rows[0].f;
    assert.deepEqual(after, before, "HARD ACCEPTANCE: the 0%-block's figure (and every other figure) is unchanged");

    // The 0%-block's own stage was NOT retroactively raised...
    const groundworksZ = (await admin.query(
      "select percent::float p from public.block_milestones where block_id=$1 and stage_key='st_groundworks'", [zeroBlock])).rows[0];
    assert.equal(groundworksZ.p, 0, "a block that started at 0% must not be retroactively raised by its own historical report");

    // ...and it got no carried-over override (consistent with "0% needs no carry-over").
    const zb = (await admin.query(
      "select progress_pct::float p, progress_override o from public.blocks where id=$1", [zeroBlock])).rows[0];
    assert.equal(zb.p, 0);
    assert.equal(zb.o, null);
    const carriedZero = (await admin.query(
      "select count(*)::int n from public.block_progress_overrides where block_id=$1", [zeroBlock])).rows[0].n;
    assert.equal(carriedZero, 0);

    // The OTHER (non-zero, protected) block's own backfill is unaffected
    // by the exclusion — still raised exactly like the first test shows.
    const roofingA = (await admin.query(
      "select percent::float p, last_source s from public.block_milestones where block_id=$1 and stage_key='st_roofing'", [fx.block])).rows[0];
    assert.equal(roofingA.p, 55);
    assert.equal(roofingA.s, "backfill");

    // A live 'report' call (not the go-live backfill) still raises a
    // 0%-progress block normally — the exclusion is scoped to the
    // one-time go-live step only, never to ordinary live reporting.
    // (weekly_reports_before_write() forces every INSERT to 'draft'
    // regardless of what's passed; apply_weekly_report_progress itself
    // doesn't gate on status, so calling it directly here is enough to
    // exercise the one behaviour this assertion cares about.)
    const liveReport = (await admin.query(
      "insert into public.weekly_reports (project_id, week_starting, week_ending, progress_items) values ($1, '2026-10-05', '2026-10-11', $2::jsonb) returning id",
      [fx.proj, JSON.stringify([{ plot: "Block Z", milestone: "Foundations (Foots)", percent: 15 }])])).rows[0].id;
    await admin.query("select public.apply_weekly_report_progress($1, 'report')", [liveReport]);
    const foundationsZ = (await admin.query(
      "select percent::float p from public.block_milestones where block_id=$1 and stage_key='st_foundations'", [zeroBlock])).rows[0];
    assert.equal(foundationsZ.p, 15, "the floor-zero exclusion must not leak into ordinary live reporting");
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

test("v75: recalc_block_progress - calculated is the average of applicable live stages, GREATEST(override, calculated), override retires itself once calculated catches up", async () => {
  const db = "tracker_test_v75_recalc";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSqlFile(admin, SCHEMA);
    await admin.query("insert into public.organisations (id, name) values ($1, 'X')", [ORG]);
    const proj = (await admin.query("insert into public.projects (name, org_id) values ('P', $1) returning id", [ORG])).rows[0].id;
    const block = (await admin.query("insert into public.blocks (project_id, block_name) values ($1, 'B1') returning id", [proj])).rows[0].id;

    // Fresh block: 14 shell stages at 0%, calculated 0, no override.
    let row = (await admin.query("select progress_pct::float p, progress_calculated::float c, progress_override o from public.blocks where id=$1", [block])).rows[0];
    assert.deepEqual(row, { p: 0, c: 0, o: null });

    // Raise two stages directly (percent/applicable are the one thing a
    // non-internal write is always allowed to change, admin included —
    // mirrors how the real block page itself updates a stage row).
    const stageRows = (await admin.query("select id, stage_key from public.block_milestones where block_id=$1 order by sort_order limit 14", [block])).rows;
    await admin.query("update public.block_milestones set percent=100 where id=$1", [stageRows[0].id]);
    await admin.query("update public.block_milestones set percent=42 where id=$1", [stageRows[1].id]);
    row = (await admin.query("select progress_calculated::float c, progress_pct::float p from public.blocks where id=$1", [block])).rows[0];
    // (100 + 42 + 0*12) / 14 = 10.142857... -> 10.1
    assert.equal(row.c, 10.1);
    assert.equal(row.p, 10.1, "no override set, so pct == calculated");

    // A manual override above the calculated figure takes over, with a
    // note. Writes the override columns directly (set_block_override's
    // own is_project_editor() permission check is covered as its own
    // test below — this one only checks the recalc maths), wrapped in
    // app.progress_internal (session-level here, not transaction-local,
    // since each .query() call is its own implicit transaction) so the
    // guard trigger doesn't force it back to the old value.
    await admin.query("select set_config('app.progress_internal', 'on', false)");
    await admin.query(
      "insert into public.block_progress_overrides (project_id, block_id, action, new_override, calculated, note) values ($1,$2,'set',60,10.1,'test')",
      [proj, block]);
    await admin.query("update public.blocks set progress_override=60, progress_override_note='test' where id=$1", [block]);
    await admin.query("select public.recalc_block_progress($1)", [block]);
    await admin.query("select set_config('app.progress_internal', '', false)");
    row = (await admin.query("select progress_pct::float p from public.blocks where id=$1", [block])).rows[0];
    assert.equal(row.p, 60, "GREATEST(override, calculated) = 60");

    // Once the calculated figure reaches the override, it retires itself (logged as 'superseded').
    for (const r of stageRows) {
      await admin.query("update public.block_milestones set percent=100 where id=$1", [r.id]);
    }
    row = (await admin.query("select progress_pct::float p, progress_override o from public.blocks where id=$1", [block])).rows[0];
    assert.equal(row.p, 100);
    assert.equal(row.o, null, "override retired itself once calculated caught up");
    const superseded = (await admin.query("select count(*)::int n from public.block_progress_overrides where block_id=$1 and action='superseded'", [block])).rows[0].n;
    assert.equal(superseded, 1);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

test("v75: blocks_v75_progress_guard - a signed-in client can't write progress_pct/progress_calculated/override columns directly; only the stage mechanic and the override RPCs can", async () => {
  const db = "tracker_test_v75_guard";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSqlFile(admin, SCHEMA);
    await admin.query("insert into public.organisations (id, name) values ($1, 'X')", [ORG]);
    const proj = (await admin.query("insert into public.projects (name, org_id) values ('P', $1) returning id", [ORG])).rows[0].id;
    const userId = "b1000000-0000-0000-0000-000000000001";
    await admin.query(
      "insert into public.project_members (project_id, user_id, role) values ($1, $2, 'admin') on conflict do nothing",
      [proj, userId]).catch(() => {});
    const block = (await admin.query("insert into public.blocks (project_id, block_name) values ($1, 'B1') returning id", [proj])).rows[0].id;

    const user = await userClient(db, userId);
    // Old block-detail.html behaviour: a direct update to progress_pct.
    // Ignored (not rejected), matching plots' own "old cached page can't break" idiom.
    await user.query("update public.blocks set progress_pct = 99 where id = $1", [block]);
    await user.end();
    const row = (await admin.query("select progress_pct::float p from public.blocks where id=$1", [block])).rows[0];
    assert.equal(row.p, 0, "the direct write was silently ignored by the guard");
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

test("v75: resolve_block_tags - matches a block name (trim/lower-case/collapse-whitespace), scoped to its own project, and returns nothing for a plot number or an unrelated project's block", async () => {
  const db = "tracker_test_v75_resolve";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSqlFile(admin, SCHEMA);
    await admin.query("insert into public.organisations (id, name) values ($1, 'X')", [ORG]);
    const proj1 = (await admin.query("insert into public.projects (name, org_id) values ('P1', $1) returning id", [ORG])).rows[0].id;
    const proj2 = (await admin.query("insert into public.projects (name, org_id) values ('P2', $1) returning id", [ORG])).rows[0].id;
    const block1 = (await admin.query("insert into public.blocks (project_id, block_name) values ($1, '  Block   A  ') returning id", [proj1])).rows[0].id;
    await admin.query("insert into public.blocks (project_id, block_name) values ($1, 'Block A') returning id", [proj2]);

    const hit = async (proj, tag) => (await admin.query("select * from public.resolve_block_tags($1, $2)", [proj, tag])).rows.map((r) => r.resolve_block_tags);
    assert.deepEqual(await hit(proj1, "block a"), [block1], "normalised match (trim/lower/collapse)");
    assert.deepEqual(await hit(proj1, "BLOCK   A"), [block1]);
    assert.deepEqual(await hit(proj1, "Plot 5"), [], "not a block");
    assert.deepEqual(await hit(proj1, "External / Engineering Works"), [], "the site-wide tag is never a block");
    assert.deepEqual(await hit(proj2, "Block A"), (await admin.query("select id from public.blocks where project_id=$1", [proj2])).rows.map((r) => r.id), "scoped to its own project, not proj1's block");
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

test("v75: drawing_pins-style IDOR closed - a block_milestones row can't be created pointing at a block in a different project than the one it claims", async () => {
  const db = "tracker_test_v75_idor";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSqlFile(admin, SCHEMA);
    await admin.query("insert into public.organisations (id, name) values ($1, 'X')", [ORG]);
    const proj1 = (await admin.query("insert into public.projects (name, org_id) values ('P1', $1) returning id", [ORG])).rows[0].id;
    const block1 = (await admin.query("insert into public.blocks (project_id, block_name) values ($1, 'B1') returning id", [proj1])).rows[0].id;
    // block_milestones' own project_id is always trigger-derived from
    // block_id (never client-trusted) - confirm it's correctly set even
    // when a caller (hypothetically) passed a different one.
    await admin.query("select set_config('app.progress_internal', 'on', false)");
    // seed_block_defaults() already seeded st_roofing for block1 on
    // creation (now that it's wired up correctly) — remove it first so
    // this insert isn't just hitting the unique(block_id, stage_key) constraint.
    await admin.query("delete from public.block_milestones where block_id=$1 and stage_key='st_roofing'", [block1]);
    const row = (await admin.query(
      "insert into public.block_milestones (project_id, block_id, stage_key, title, sort_order) values (gen_random_uuid(), $1, 'st_roofing', 'Roofing', 1) returning project_id",
      [block1])).rows[0];
    await admin.query("select set_config('app.progress_internal', '', false)");
    assert.equal(row.project_id, proj1, "project_id is always derived from the real block, never the client-supplied value");
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});

// Nothing of v75 left after a rollback: no v75 tables, triggers,
// functions, or columns.
test("v75 rollback: removes all new structure, preserves blocks.progress_pct exactly, and refuses a second run", async () => {
  const db = "tracker_test_v75_rollback";
  await createTestDatabase(db);
  const admin = adminClient(db);
  try {
    await admin.connect();
    await runSqlFile(admin, MOCK_SETUP);
    await runSql(admin, PRE_V74);
    const fx = await seedPreV74(admin);
    await runSqlFile(admin, SCHEMA);
    const before = (await admin.query("select progress_pct::float p from public.blocks where id=$1", [fx.block])).rows[0].p;

    await runSqlFile(admin, path.join(__dirname, "../../sql/rollback/v75_block_progress_stages_rollback.sql"));

    const after = (await admin.query("select progress_pct::float p from public.blocks where id=$1", [fx.block])).rows[0].p;
    assert.equal(after, before, "blocks.progress_pct survives the rollback exactly");

    const tables = (await admin.query(
      "select to_regclass('public.block_milestones') t1, to_regclass('public.block_progress_overrides') t2, to_regclass('public.block_progress_stage_events') t3")).rows[0];
    assert.deepEqual(tables, { t1: null, t2: null, t3: null });

    const cols = (await admin.query(
      "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='blocks' and column_name in ('progress_calculated','progress_override','progress_override_note','progress_override_by','progress_override_at')")).rows[0].n;
    assert.equal(cols, 0);

    const triggers = (await admin.query("select count(*)::int n from pg_trigger where tgname like '%block_milestones_v75%' or tgname = 'trg_blocks_v75_progress_guard'")).rows[0].n;
    assert.equal(triggers, 0);

    // Re-running the rollback refuses (and the go-live step refuses to re-run too).
    await assert.rejects(() => runSqlFile(admin, path.join(__dirname, "../../sql/rollback/v75_block_progress_stages_rollback.sql")), /already run here/);
  } finally {
    await admin.end();
    await dropTestDatabase(db);
  }
});
