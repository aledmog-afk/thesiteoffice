// v101: Programme import — Summary rows and % complete.
//
// Real database, real non-superuser `authenticated` role — covers:
// a non-editor still can't import (same authorization check as
// always, re-proven against this extended function); Summary rows
// (is_summary) are excluded from compute_programme_complete_pct();
// % complete is raise-only — a higher value raises it (with status/
// actual_start/actual_finish kept consistent via the exact same
// raise_programme_activity_from_report() a weekly report's own raise
// already calls), a lower or blank value never changes it; an old-
// format import (no Summary/% complete columns at all) behaves
// exactly as it did before this existed, including never clearing an
// existing summary flag; and percent_raised_count is recorded
// correctly on programme_import_runs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v101_summary_rows_percent_complete";
const U = (n) => `a1010000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SNAGGER = U(2);
const EMAIL = { [OWNER]: "owner101@x.test", [SNAGGER]: "snagger101@x.test" };

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

let projectCounter = 0;
async function createProgramme() {
  projectCounter += 1;
  return as(OWNER, async (c) => {
    const project = await one(c, "insert into public.projects (name, org_id, created_by) values ($1, $2, $3) returning id", [`Site v101-${projectCounter}`, fx.orgId, OWNER]);
    return one(c, `
      insert into public.programmes (project_id, org_id, name, status, created_by) values ($1,$2,$3,'active',$4) returning *
    `, [project.id, fx.orgId, "Programme", OWNER]);
  });
}

async function createActivity(programmeId, overrides = {}) {
  const f = {
    title: "Activity", is_milestone: false, planned_start: null, planned_finish: null,
    external_id: null, percent_complete: 0, status: "not_started", is_summary: false,
    ...overrides,
  };
  return as(OWNER, (c) => one(c, `
    insert into public.programme_activities (programme_id, title, is_milestone, planned_start, planned_finish, external_id, percent_complete, status, is_summary)
    values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *
  `, [programmeId, f.title, f.is_milestone, f.planned_start, f.planned_finish, f.external_id, f.percent_complete, f.status, f.is_summary]));
}

function importRows(rows) {
  return JSON.stringify(rows.map((r, i) => ({ client_row_index: i, is_milestone: false, ...r })));
}
// Same shape, but the `summary` KEY is omitted entirely from every row
// (not merely set to null) — mirrors exactly what mapRowsToImportRows()
// in app.js sends when the user never maps a Summary column, which is
// the one signal that must leave an existing flag alone.
function importRowsNoSummaryColumn(rows) {
  return JSON.stringify(rows.map((r, i) => {
    const { summary, ...rest } = { client_row_index: i, is_milestone: false, ...r };
    return rest;
  }));
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.orgId = (await one(c, "select public.create_organisation('Test Org v101', 'main_contractor') as id")).id;
  });
});

after(async () => { await dropTestDatabase(DB); });

// ─── Authorization (unchanged, re-proven against the extended function) ──

test("v101: a non-editor (snagging role) still cannot import, even a batch carrying Summary/% complete columns", async () => {
  const prog = await createProgramme();
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1,$2,'member') on conflict do nothing", [fx.orgId, SNAGGER]);
  await sql("insert into public.project_members (project_id, user_id, role) values ($1,$2,'snagging') on conflict do nothing", [prog.project_id, SNAGGER]);

  await assert.rejects(
    () => as(SNAGGER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
      { external_id: "ext-1", title: "Should never be created", summary: "Y", percent_complete: 50 },
    ])])),
    /not authorized/,
  );
  const count = (await sql("select count(*)::int as n from public.programme_activities where programme_id = $1", [prog.id])).rows[0].n;
  assert.equal(count, 0, "nothing must be created — same rollback guarantee v100 already proved, re-checked here");
});

// ─── Summary rows ───────────────────────────────────────────────────

test("v101: a row imported with Summary=Y is flagged is_summary and excluded from compute_programme_complete_pct(), even though its own span would otherwise dominate", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("update public.projects set progress_source = 'programme' where id = $1", [prog.project_id]));

  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "GW2", title: "Ground Works 2nd Stage", summary: "Y", planned_start: "2026-01-01", planned_finish: "2026-12-31" },
    { external_id: "GW", title: "Groundworks", percent_complete: 81, planned_start: "2026-01-01", planned_finish: "2026-02-01" },
  ])]));

  const rows = (await sql("select title, is_summary, percent_complete from public.programme_activities where programme_id = $1 order by title", [prog.id])).rows;
  assert.deepEqual(rows.map((r) => [r.title, r.is_summary]), [["Ground Works 2nd Stage", true], ["Groundworks", false]]);

  const pct = Number((await sql("select public.compute_programme_complete_pct($1) as pct", [prog.project_id])).rows[0].pct);
  assert.equal(pct, 81, "the summary bar's own huge 365-day span must contribute NOTHING — the figure must be exactly Groundworks' own 81%");
});

test("v101: accepts yes/true/1 as well as Y for Summary; blank means not-a-summary when the column IS mapped", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "a", title: "A", summary: "yes" },
    { external_id: "b", title: "B", summary: "TRUE" },
    { external_id: "c", title: "C", summary: 1 },
    { external_id: "d", title: "D", summary: "" },
  ])]));
  const rows = (await sql("select external_id, is_summary from public.programme_activities where programme_id = $1 order by external_id", [prog.id])).rows;
  assert.deepEqual(rows.map((r) => [r.external_id, r.is_summary]), [["a", true], ["b", true], ["c", true], ["d", false]]);
});

test("v101: re-importing WITHOUT the Summary column at all never clears an existing summary flag", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "GW2", title: "Ground Works 2nd Stage", summary: "Y", planned_start: "2026-01-01", planned_finish: "2026-02-01" },
  ])]));
  let row = (await sql("select is_summary from public.programme_activities where programme_id = $1", [prog.id])).rows[0];
  assert.equal(row.is_summary, true, "sanity check: flagged on the first import");

  // Re-import the SAME row, but as an old-format payload with no
  // `summary` key in the JSON at all (title/dates changed slightly to
  // prove this is a real re-import, not a no-op).
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRowsNoSummaryColumn([
    { external_id: "GW2", title: "Ground Works 2nd Stage (revised)", planned_start: "2026-01-01", planned_finish: "2026-03-01" },
  ])]));
  row = (await sql("select title, is_summary from public.programme_activities where programme_id = $1", [prog.id])).rows[0];
  assert.equal(row.title, "Ground Works 2nd Stage (revised)", "sanity check: the import-owned fields DID change");
  assert.equal(row.is_summary, true, "the summary flag itself must survive a re-import that never mentions the column at all");
});

test("v101: a later import WITH the Summary column mapped, but blank for this row, DOES clear a previously-set flag — mapped-and-blank means a real 'no', not 'leave alone'", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "x", title: "X", summary: "Y" },
  ])]));
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "x", title: "X", summary: "" },
  ])]));
  const row = (await sql("select is_summary from public.programme_activities where programme_id = $1", [prog.id])).rows[0];
  assert.equal(row.is_summary, false, "a mapped column's genuinely blank cell for this row is a real answer, not an omission");
});

// ─── % complete: raise-only ─────────────────────────────────────────

test("v101: a higher imported % complete raises the stored value and escalates status/actual_start consistently with a weekly report's own raise", async () => {
  const prog = await createProgramme();
  const act = await createActivity(prog.id, { title: "Groundworks", external_id: "ext-1", percent_complete: 0, status: "not_started" });

  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "ext-1", title: "Groundworks", percent_complete: 81 },
  ])]));

  const row = (await sql("select percent_complete::float as pct, status, actual_start from public.programme_activities where id = $1", [act.id])).rows[0];
  assert.equal(row.pct, 81);
  assert.equal(row.status, "in_progress");
  assert.ok(row.actual_start, "actual_start must be filled in on the transition into >0%, same as a weekly report raise");
});

test("v101: a lower imported % complete never lowers the stored value, and a blank cell never touches it at all", async () => {
  const prog = await createProgramme();
  const act = await createActivity(prog.id, { title: "Groundworks", external_id: "ext-1", percent_complete: 76, status: "in_progress", actual_start: "2026-01-01" });

  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "ext-1", title: "Groundworks", percent_complete: 40 },
  ])]));
  let row = (await sql("select percent_complete::float as pct from public.programme_activities where id = $1", [act.id])).rows[0];
  assert.equal(row.pct, 76, "a lower value must never lower the stored figure");

  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "ext-1", title: "Groundworks" },
  ])]));
  row = (await sql("select percent_complete::float as pct from public.programme_activities where id = $1", [act.id])).rows[0];
  assert.equal(row.pct, 76, "a blank cell must leave the figure completely untouched");
});

test("v101: a raise to 100 sets status complete and stamps actual_finish, the same as a weekly report raise reaching 100", async () => {
  const prog = await createProgramme();
  const act = await createActivity(prog.id, { title: "Snagging walk", external_id: "ext-2", percent_complete: 90, status: "in_progress", actual_start: "2026-01-01" });

  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "ext-2", title: "Snagging walk", percent_complete: 100 },
  ])]));
  const row = (await sql("select percent_complete::float as pct, status, actual_finish from public.programme_activities where id = $1", [act.id])).rows[0];
  assert.equal(row.pct, 100);
  assert.equal(row.status, "complete");
  assert.ok(row.actual_finish);
});

test("v101: a brand-new row created via import with a % complete starts at that figure, not 0 then separately raised", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([
    { external_id: "ext-new", title: "Frame Erect", percent_complete: 25 },
  ])]));
  const row = (await sql("select percent_complete::float as pct, status from public.programme_activities where programme_id = $1", [prog.id])).rows[0];
  assert.equal(row.pct, 25);
  assert.equal(row.status, "in_progress");
});

test("v101: an out-of-range percent_complete is rejected per-row (never aborts the whole batch, never written)", async () => {
  const prog = await createProgramme();
  const result = await as(OWNER, (c) => one(c, "select public.import_programme_activities($1, $2::jsonb) as r", [prog.id, importRows([
    { external_id: "ext-1", title: "Bad percent", percent_complete: 150 },
    { external_id: "ext-2", title: "Good row", percent_complete: 50 },
  ])]));
  assert.equal(result.r.created, 1, "the good row must still be created");
  assert.equal(result.r.rejected.length, 1);
  assert.match(result.r.rejected[0].reason, /percent_complete/i);
  const count = (await sql("select count(*)::int as n from public.programme_activities where programme_id = $1", [prog.id])).rows[0].n;
  assert.equal(count, 1, "only the good row was written");
});

// ─── percent_raised_count on programme_import_runs ──────────────────

test("v101: programme_import_runs.percent_raised_count counts exactly the rows actually raised, including a row otherwise completely unchanged", async () => {
  const prog = await createProgramme();
  await createActivity(prog.id, { title: "Unchanged except %", external_id: "ext-1", percent_complete: 20, status: "in_progress", planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  await createActivity(prog.id, { title: "Already complete, no raise possible", external_id: "ext-2", percent_complete: 100, status: "complete" });

  const result = await as(OWNER, (c) => one(c, "select public.import_programme_activities($1, $2::jsonb) as r", [prog.id, importRows([
    // Same title/dates as stored — only % differs.
    { external_id: "ext-1", title: "Unchanged except %", percent_complete: 60, planned_start: "2026-01-01", planned_finish: "2026-01-11" },
    { external_id: "ext-2", title: "Already complete, no raise possible", percent_complete: 50 }, // lower than 100, and already complete — no-op
    { external_id: "ext-new", title: "Brand new with a %", percent_complete: 10 },
  ])]));
  assert.equal(result.r.raised, 2, "ext-1 (20->60) and the brand-new row both raised; ext-2 did not");
  // Both ext-1 and ext-2 are "unchanged" in import-owned-field terms —
  // title/dates/milestone/plot/is_summary genuinely match what's
  // already stored for both. ext-1's own % was still raised (it's
  // tracked completely independently); ext-2's wasn't, since it's
  // already complete (raise_programme_activity_from_report() is a
  // no-op on a complete/cancelled row, the same "never lower, never
  // reopen" guarantee a weekly report's own raise already honours).
  assert.equal(result.r.unchanged, 2);

  const run = (await sql("select percent_raised_count, unchanged_count from public.programme_import_runs where programme_id = $1", [prog.id])).rows[0];
  assert.equal(run.percent_raised_count, 2);
  assert.equal(run.unchanged_count, 2);
});

// ─── Old-format files import exactly as before ──────────────────────

test("v101: an old-format payload (no Summary, no % complete at all) behaves exactly as it always did — plain create/update on title/dates/milestone/plot only", async () => {
  const prog = await createProgramme();
  const act = await createActivity(prog.id, { title: "Old name", external_id: "ext-1", percent_complete: 30, status: "in_progress", is_summary: false });

  const result = await as(OWNER, (c) => one(c, "select public.import_programme_activities($1, $2::jsonb) as r", [prog.id, importRowsNoSummaryColumn([
    { external_id: "ext-1", title: "New name", planned_start: "2026-01-01", planned_finish: "2026-01-11" },
    { external_id: "ext-new", title: "A new row" },
  ])]));
  assert.equal(result.r.created, 1);
  assert.equal(result.r.updated, 1);
  assert.equal(result.r.raised, 0, "no percent_complete column at all -> never a raise");

  const row = (await sql("select title, percent_complete::float as pct, is_summary from public.programme_activities where id = $1", [act.id])).rows[0];
  assert.equal(row.title, "New name", "the import-owned fields still update exactly as before");
  assert.equal(row.pct, 30, "percent_complete must be completely untouched by an old-format import");
  assert.equal(row.is_summary, false);

  const newRow = (await sql("select is_summary from public.programme_activities where external_id = 'ext-new' and programme_id = $1", [prog.id])).rows[0];
  assert.equal(newRow.is_summary, false, "a brand-new row from an old-format import defaults to not-a-summary");
});
