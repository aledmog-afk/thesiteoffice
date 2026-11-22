// v99: Exclude programme rows from progress.
//
// Real database, real non-superuser `authenticated` role, the actual
// RLS/trigger boundary — covers the auto-tick rule itself (90%-of-span
// threshold, milestone exemption, applied on insert/import), that a
// manual tick/untick always wins and survives both a later auto pass
// and a re-import, that a non-editor can't change the tick, and that
// compute_programme_complete_pct() excludes a ticked row exactly like
// a cancelled one. Also proves SQL/JS parity directly against the
// real computeProgrammeComplete() extracted from app.js (never
// reimplemented), on the exact same activity set stored here.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v99_exclude_programme_progress";
const U = (n) => `a9900000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SNAGGER = U(2);
const EMAIL = { [OWNER]: "owner99@x.test", [SNAGGER]: "snagger99@x.test" };

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
// Each test gets its OWN fresh project (never fx.projectId directly) —
// programmes_one_active_per_project is a real partial unique index, so
// two tests both creating an 'active' programme on the SAME project
// would collide. A fresh project per test isolates them completely,
// and is cheap (one insert) compared to archiving/reusing one.
async function createProgramme(extra = {}) {
  projectCounter += 1;
  return as(OWNER, async (c) => {
    const project = await one(c, "insert into public.projects (name, org_id, created_by) values ($1, $2, $3) returning id", [`Site v99-${projectCounter}`, fx.orgId, OWNER]);
    fx.lastProjectId = project.id;
    return one(c, `
      insert into public.programmes (project_id, org_id, name, status, created_by) values ($1,$2,$3,'active',$4) returning *
    `, [project.id, fx.orgId, extra.name || "Programme", OWNER]);
  });
}

async function createActivity(programmeId, overrides = {}) {
  const f = {
    title: "Activity", is_milestone: false, planned_start: null, planned_finish: null,
    percent_complete: 0, status: "not_started", external_id: null,
    ...overrides,
  };
  return as(OWNER, (c) => one(c, `
    insert into public.programme_activities (programme_id, title, is_milestone, planned_start, planned_finish, percent_complete, status, external_id)
    values ($1,$2,$3,$4,$5,$6,$7,$8) returning *
  `, [programmeId, f.title, f.is_milestone, f.planned_start, f.planned_finish, f.percent_complete, f.status, f.external_id]));
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.orgId = (await one(c, "select public.create_organisation('Test Org v99', 'main_contractor') as id")).id;
  });
});

after(async () => { await dropTestDatabase(DB); });

// ─── Auto-tick rule ─────────────────────────────────────────────────

test("v99: a non-milestone activity spanning >= 90% of the programme's overall planned span is auto-ticked on creation", async () => {
  const prog = await createProgramme();
  // Header row: the WHOLE programme's own span, 2026-01-01..2027-12-31 (730 days).
  const header = await createActivity(prog.id, { title: "Red Dragon Batch Rev 07", planned_start: "2026-01-01", planned_finish: "2027-12-31" });
  // A short real task, 10 days — sets the span's floor, contributes almost nothing to it.
  await createActivity(prog.id, { title: "Snagging walk", planned_start: "2026-02-01", planned_finish: "2026-02-11" });

  const row = (await sql("select exclude_from_progress, exclude_from_progress_source from public.programme_activities where id = $1", [header.id])).rows[0];
  assert.equal(row.exclude_from_progress, true);
  assert.equal(row.exclude_from_progress_source, "auto");
});

test("v99: an activity spanning less than 90% of the overall span is never auto-ticked", async () => {
  const prog = await createProgramme();
  await createActivity(prog.id, { title: "Programme span setter", planned_start: "2026-01-01", planned_finish: "2026-12-31" }); // 364 days, sets the span
  const shortTask = await createActivity(prog.id, { title: "Roof covering", planned_start: "2026-02-01", planned_finish: "2026-03-01" }); // ~28 days, well under 90% of 364

  const row = (await sql("select exclude_from_progress, exclude_from_progress_source from public.programme_activities where id = $1", [shortTask.id])).rows[0];
  assert.equal(row.exclude_from_progress, false);
  assert.equal(row.exclude_from_progress_source, null);
});

test("v99: a milestone is NEVER auto-ticked, even with a planned span covering the whole programme", async () => {
  const prog = await createProgramme();
  await createActivity(prog.id, { title: "Short task", planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  const milestone = await createActivity(prog.id, { title: "Programme-spanning milestone", is_milestone: true, planned_start: "2026-01-01", planned_finish: "2027-01-01" });

  const row = (await sql("select exclude_from_progress, exclude_from_progress_source from public.programme_activities where id = $1", [milestone.id])).rows[0];
  assert.equal(row.exclude_from_progress, false, "a milestone is exempt from the auto rule regardless of its own span");
  assert.equal(row.exclude_from_progress_source, null);
});

test("v99: an 'auto' row that no longer qualifies (another row's dates WIDENED the overall span) is auto-UNticked — but a 'manual' row never is", async () => {
  // A row's own span can never exceed the programme's overall span (the
  // overall span always spans AT LEAST from that row's own start to its
  // own finish) — so a row already qualifying can only ever be
  // disqualified by the OVERALL span growing (another row WIDENING it),
  // never by another row's span shrinking.
  const prog = await createProgramme();
  const header = await createActivity(prog.id, { title: "Header Row", planned_start: "2026-01-01", planned_finish: "2026-02-01" }); // 31 days
  const spanSetter = await createActivity(prog.id, { title: "Same-span setter", planned_start: "2026-01-01", planned_finish: "2026-02-01" }); // 31 days too -> overall = 31 days, header ratio 100%
  let row = (await sql("select exclude_from_progress_source from public.programme_activities where id = $1", [header.id])).rows[0];
  assert.equal(row.exclude_from_progress_source, "auto", "sanity check: header starts out auto-ticked");

  // Widen the OTHER row's own finish out to 2030 — the overall span
  // balloons to ~4 years, so the header's own unchanged 31-day span is
  // now nowhere near 90% of it.
  await as(OWNER, (c) => c.query("update public.programme_activities set planned_finish = '2030-01-01' where id = $1", [spanSetter.id]));

  row = (await sql("select exclude_from_progress, exclude_from_progress_source from public.programme_activities where id = $1", [header.id])).rows[0];
  assert.equal(row.exclude_from_progress, false, "an 'auto' row that no longer qualifies must be un-ticked automatically");
  assert.equal(row.exclude_from_progress_source, null);
});

// ─── Manual override always wins ───────────────────────────────────

test("v99: a manual untick on an auto-qualifying row survives the auto rule re-running (another activity's dates change)", async () => {
  const prog = await createProgramme();
  const header = await createActivity(prog.id, { title: "Long Header Row", planned_start: "2026-01-01", planned_finish: "2027-12-31" });
  await createActivity(prog.id, { title: "Short task", planned_start: "2026-02-01", planned_finish: "2026-02-11" });

  // Editor deliberately says this long row IS real, countable work.
  await as(OWNER, (c) => c.query("update public.programme_activities set exclude_from_progress = false, exclude_from_progress_source = 'manual' where id = $1", [header.id]));

  // Re-trigger the auto rule by touching another activity's dates — the
  // header row still fully qualifies by span, but must stay manually un-ticked.
  await createActivity(prog.id, { title: "Another task", planned_start: "2026-03-01", planned_finish: "2026-03-11" });

  const row = (await sql("select exclude_from_progress, exclude_from_progress_source from public.programme_activities where id = $1", [header.id])).rows[0];
  assert.equal(row.exclude_from_progress, false, "a manual override must never be overwritten by the auto rule");
  assert.equal(row.exclude_from_progress_source, "manual");
});

test("v99: a manual tick on a short, genuinely-excluded-by-choice row survives the auto rule re-running", async () => {
  const prog = await createProgramme();
  const shortTask = await createActivity(prog.id, { title: "Deliberately excluded short task", planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  await createActivity(prog.id, { title: "Long span setter", planned_start: "2026-01-01", planned_finish: "2027-12-31" });

  await as(OWNER, (c) => c.query("update public.programme_activities set exclude_from_progress = true, exclude_from_progress_source = 'manual' where id = $1", [shortTask.id]));
  await createActivity(prog.id, { title: "Yet another task", planned_start: "2026-05-01", planned_finish: "2026-05-11" }); // re-triggers the rule

  const row = (await sql("select exclude_from_progress, exclude_from_progress_source from public.programme_activities where id = $1", [shortTask.id])).rows[0];
  assert.equal(row.exclude_from_progress, true, "a manual exclusion must never be cleared by the auto rule's own un-tick pass");
  assert.equal(row.exclude_from_progress_source, "manual");
});

// ─── RLS: non-editor can't change the tick ─────────────────────────

test("v99: a snagging-only member's attempt to change exclude_from_progress affects zero rows", async () => {
  const prog = await createProgramme();
  await sql("insert into public.project_members (project_id, user_id, role) values ($1,$2,'snagging') on conflict do nothing", [prog.project_id, SNAGGER]);
  const act = await createActivity(prog.id, { title: "Groundworks", planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  // A sibling activity spanning most of the programme, purely so
  // Groundworks' own 10-day span is nowhere near 90% of the overall
  // span and starts out NOT auto-ticked — otherwise, as the programme's
  // only activity, its own span would trivially BE the whole overall
  // span (ratio 100%), auto-ticking it before this test even begins.
  await createActivity(prog.id, { title: "Long setter", planned_start: "2026-01-01", planned_finish: "2027-12-31" });

  const r = await as(SNAGGER, (c) => c.query(
    "update public.programme_activities set exclude_from_progress = true, exclude_from_progress_source = 'manual' where id = $1",
    [act.id]
  ));
  assert.equal(r.rowCount, 0, "a non-editor's update must match zero rows under RLS");
  const row = (await sql("select exclude_from_progress from public.programme_activities where id = $1", [act.id])).rows[0];
  assert.equal(row.exclude_from_progress, false, "the blocked attempt must leave the row untouched");
});

// ─── Re-import preserves the tick; new rows get the auto rule ─────

test("v99: re-importing a revised programme preserves an existing row's tick (matched by external_id) even when its dates change", async () => {
  const prog = await createProgramme();
  const existing = await createActivity(prog.id, { title: "Site Manager", external_id: "ext-1", planned_start: "2026-01-01", planned_finish: "2026-06-01" });
  await as(OWNER, (c) => c.query("update public.programme_activities set exclude_from_progress = true, exclude_from_progress_source = 'manual' where id = $1", [existing.id]));

  // A revised import for the SAME external_id — different title/dates,
  // exactly the shape import_programme_activities() itself applies.
  const result = await as(OWNER, (c) => one(c, `
    select public.import_programme_activities($1, $2::jsonb) as r
  `, [prog.id, JSON.stringify([
    { client_row_index: 0, external_id: "ext-1", title: "Site Manager (revised)", planned_start: "2026-01-01", planned_finish: "2026-09-01", is_milestone: false },
  ])]));
  assert.equal(result.r.updated, 1, "the revised row must be recognised as the SAME activity and updated, not created fresh");

  const row = (await sql("select title, exclude_from_progress, exclude_from_progress_source from public.programme_activities where id = $1", [existing.id])).rows[0];
  assert.equal(row.title, "Site Manager (revised)", "sanity check: the import-owned fields DID change");
  assert.equal(row.exclude_from_progress, true, "the tick itself is not an import-owned field — it must survive the revision untouched");
  assert.equal(row.exclude_from_progress_source, "manual");
});

test("v99: a brand-new row created via import gets the auto rule applied, the same as one created by hand", async () => {
  const prog = await createProgramme();
  await createActivity(prog.id, { title: "Short task", planned_start: "2026-01-01", planned_finish: "2026-01-11" });

  const result = await as(OWNER, (c) => one(c, `
    select public.import_programme_activities($1, $2::jsonb) as r
  `, [prog.id, JSON.stringify([
    { client_row_index: 0, external_id: "ext-new", title: "Programme Title Row", planned_start: "2025-01-01", planned_finish: "2027-01-01", is_milestone: false },
  ])]));
  assert.equal(result.r.created, 1);

  const row = (await sql("select exclude_from_progress, exclude_from_progress_source from public.programme_activities where external_id = 'ext-new' and programme_id = $1", [prog.id])).rows[0];
  assert.equal(row.exclude_from_progress, true, "a newly-imported row spanning most of the programme must be auto-ticked, same as one created by hand");
  assert.equal(row.exclude_from_progress_source, "auto");
});

test("v99: an UNCHANGED row during a re-import (no import-owned field actually differs) is never re-evaluated — its tick is left exactly as it was", async () => {
  const prog = await createProgramme();
  const act = await createActivity(prog.id, { title: "Groundworks", external_id: "ext-unchanged", planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  await as(OWNER, (c) => c.query("update public.programme_activities set exclude_from_progress = true, exclude_from_progress_source = 'manual' where id = $1", [act.id]));

  const result = await as(OWNER, (c) => one(c, `
    select public.import_programme_activities($1, $2::jsonb) as r
  `, [prog.id, JSON.stringify([
    { client_row_index: 0, external_id: "ext-unchanged", title: "Groundworks", planned_start: "2026-01-01", planned_finish: "2026-01-11", is_milestone: false },
  ])]));
  assert.equal(result.r.unchanged, 1);

  const row = (await sql("select exclude_from_progress, exclude_from_progress_source from public.programme_activities where id = $1", [act.id])).rows[0];
  assert.equal(row.exclude_from_progress, true);
  assert.equal(row.exclude_from_progress_source, "manual");
});

// ─── compute_programme_complete_pct() excludes a ticked row ────────

test("v99: compute_programme_complete_pct() excludes a ticked row exactly like a cancelled one", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("update public.projects set progress_source = 'programme' where id = $1", [prog.project_id]));

  await createActivity(prog.id, { title: "Done", status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  const header = await createActivity(prog.id, { title: "Header", status: "not_started", percent_complete: 0, planned_start: "2025-01-01", planned_finish: "2027-01-01" }); // huge weight if it counted

  const row = (await sql("select exclude_from_progress from public.programme_activities where id = $1", [header.id])).rows[0];
  assert.equal(row.exclude_from_progress, true, "sanity check: the header row auto-qualified");

  const pct = (await sql("select public.compute_programme_complete_pct($1) as pct", [prog.project_id])).rows[0].pct;
  assert.equal(Number(pct), 100, "the excluded header row's huge span must not drag the figure down at all");
});

// ─── SQL/JS parity ──────────────────────────────────────────────────
// computeProgrammeComplete() extracted directly from app.js (never
// reimplemented) — same convention tests/frontend/programme_complete_figure.test.mjs
// already uses — run here against the EXACT SAME activity rows just
// stored in Postgres, converted to the plain-object shape it expects,
// to prove the two calculations genuinely agree, not just that each
// independently claims to follow "the same rule".
function loadComputeProgrammeComplete() {
  const src = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");
  const diffFn = src.match(/function diffCalendarDays\([\s\S]*?\n\}/);
  const weightFn = src.match(/function programmeActivityDurationWeight\([\s\S]*?\n\}/);
  const mainFn = src.match(/export function computeProgrammeComplete\([\s\S]*?\n\}/);
  return new Function(`
    ${diffFn[0]}
    ${weightFn[0]}
    ${mainFn[0].replace(/^export /, "")}
    return computeProgrammeComplete;
  `)();
}
const computeProgrammeComplete = loadComputeProgrammeComplete();

test("v99: SQL/JS parity — compute_programme_complete_pct() and computeProgrammeComplete() agree on real stored activity data, header rows excluded on both sides", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("update public.projects set progress_source = 'programme' where id = $1", [prog.project_id]));

  await createActivity(prog.id, { title: "Red Dragon Batch Rev 07", planned_start: "2025-06-01", planned_finish: "2027-01-01" }); // header
  await createActivity(prog.id, { title: "Prelims", planned_start: "2025-06-01", planned_finish: "2026-12-01" }); // header
  await createActivity(prog.id, { title: "Site Manager", planned_start: "2025-07-01", planned_finish: "2026-11-01" }); // header
  await createActivity(prog.id, { title: "Groundworks", status: "complete", percent_complete: 100, planned_start: "2026-01-05", planned_finish: "2026-02-04" });
  await createActivity(prog.id, { title: "Frame Erect", status: "in_progress", percent_complete: 60, planned_start: "2026-02-05", planned_finish: "2026-03-20" });
  await createActivity(prog.id, { title: "Roof Covering", status: "not_started", percent_complete: 0, planned_start: "2026-03-21", planned_finish: "2026-04-15" });
  await createActivity(prog.id, { title: "Site-wide milestone", is_milestone: true, status: "complete", percent_complete: 100, planned_start: "2026-01-01", planned_finish: "2026-01-01" });

  const sqlPct = Number((await sql("select public.compute_programme_complete_pct($1) as pct", [prog.project_id])).rows[0].pct);

  const rows = (await sql("select status, percent_complete, is_milestone, planned_start, planned_finish, forecast_start, forecast_finish, exclude_from_progress from public.programme_activities where programme_id = $1", [prog.id])).rows;
  const jsActivities = rows.map((r) => ({
    status: r.status,
    percent_complete: Number(r.percent_complete),
    is_milestone: r.is_milestone,
    planned_start: r.planned_start ? r.planned_start.toISOString().slice(0, 10) : null,
    planned_finish: r.planned_finish ? r.planned_finish.toISOString().slice(0, 10) : null,
    forecast_start: r.forecast_start ? r.forecast_start.toISOString().slice(0, 10) : null,
    forecast_finish: r.forecast_finish ? r.forecast_finish.toISOString().slice(0, 10) : null,
    exclude_from_progress: r.exclude_from_progress,
  }));
  const jsPct = computeProgrammeComplete(jsActivities);

  assert.ok(rows.some((r) => r.exclude_from_progress), "sanity check: at least one header row must have auto-qualified for this parity check to mean anything");
  assert.ok(Math.abs(sqlPct - jsPct) < 0.05, `SQL (${sqlPct}) and JS (${jsPct}) must agree to within rounding`);
});
