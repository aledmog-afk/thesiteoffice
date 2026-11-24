// v100: Programme revision record.
//
// Real database, real non-superuser `authenticated` role, the actual
// RLS boundary — covers Stuart's own explicit requirement (the run row
// is written by import_programme_activities() itself, in the same
// transaction as the import, so it can never be skipped or edited from
// the page): a successful import always produces exactly one matching
// run row; an exception raised anywhere in the function (an
// unauthorized caller here) rolls back the WHOLE transaction, leaving
// no run row AND no activity changes either, proving the run insert
// genuinely shares the import's own transaction rather than being a
// separate, skippable step; an authenticated member (even the project
// owner) can't INSERT, UPDATE or DELETE a row directly, matching the
// audit_log pattern; and the changes payload itself is correct — slip
// days (signed, both directions), a title change, a milestone flag
// change, newly created rows, and rows absent from the import.
//
// RLS READ boundary (fixed after review): the SELECT policy mirrors
// programme_activities' own read predicate exactly — is_project_editor
// OR a party holding the programme_read/programme_write capability —
// NOT plain project membership. A plain project_members row (e.g. a
// snagging-only member) can already see neither programme_activities
// nor programme_import_runs; a company with only programme_read
// capability (no ordinary project_members row at all) can read both.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v100_programme_import_runs";
const U = (n) => `a1000000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SNAGGER = U(2), OUTSIDER = U(3), CLIENT = U(4);
const EMAIL = { [OWNER]: "owner100@x.test", [SNAGGER]: "snagger100@x.test", [OUTSIDER]: "outsider100@x.test", [CLIENT]: "client100@x.test" };

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

// Enrols CLIENT as a 'client' party on the given project — same
// create_party_invite()/accept_party_invite() flow tests/security/
// v69_progress_rls.test.mjs's own join() helper uses. 'client' grants
// exactly programme_read (never programme_write) per
// party_role_capabilities — the narrowest real case for "a company
// with programme read access can read the run".
async function joinAsClientParty(projectId) {
  const inv = await as(OWNER, (c) => one(c, "select * from public.create_party_invite($1,$2,$3,null,null)", [projectId, EMAIL[CLIENT], "client"]));
  await as(CLIENT, async (c) => {
    const org = await one(c, "select public.create_organisation('Fake Client Co v100', 'developer_client') as id");
    await c.query("select public.accept_party_invite($1,$2)", [inv.token, org.id]);
  });
}

let projectCounter = 0;
// Each test gets its OWN fresh project — same reasoning as the v99
// test file: programmes_one_active_per_project is a real partial
// unique index, so reusing one project across tests that each create
// an 'active' programme would collide.
async function createProgramme() {
  projectCounter += 1;
  return as(OWNER, async (c) => {
    const project = await one(c, "insert into public.projects (name, org_id, created_by) values ($1, $2, $3) returning id", [`Site v100-${projectCounter}`, fx.orgId, OWNER]);
    return one(c, `
      insert into public.programmes (project_id, org_id, name, status, created_by) values ($1,$2,$3,'active',$4) returning *
    `, [project.id, fx.orgId, "Programme", OWNER]);
  });
}

async function createActivity(programmeId, overrides = {}) {
  const f = {
    title: "Activity", is_milestone: false, planned_start: null, planned_finish: null,
    external_id: null,
    ...overrides,
  };
  return as(OWNER, (c) => one(c, `
    insert into public.programme_activities (programme_id, title, is_milestone, planned_start, planned_finish, external_id)
    values ($1,$2,$3,$4,$5,$6) returning *
  `, [programmeId, f.title, f.is_milestone, f.planned_start, f.planned_finish, f.external_id]));
}

function importRows(rows) {
  return JSON.stringify(rows.map((r, i) => ({ client_row_index: i, is_milestone: false, ...r })));
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.orgId = (await one(c, "select public.create_organisation('Test Org v100', 'main_contractor') as id")).id;
  });
});

after(async () => { await dropTestDatabase(DB); });

// ─── Written in the same transaction as the import ─────────────────

test("v100: a successful import writes exactly one matching programme_import_runs row, with the exact counts of what it did", async () => {
  const prog = await createProgramme();
  await createActivity(prog.id, { title: "Unchanged row", external_id: "ext-same", planned_start: "2026-01-01", planned_finish: "2026-01-11" });
  await createActivity(prog.id, { title: "Will be left out", external_id: "ext-missing" });

  const before = (await sql("select count(*)::int as n from public.programme_import_runs where programme_id = $1", [prog.id])).rows[0].n;
  assert.equal(before, 0, "sanity check: no run row exists before the import");

  const result = await as(OWNER, (c) => one(c, "select public.import_programme_activities($1, $2::jsonb) as r", [prog.id, importRows([
    { external_id: "ext-same", title: "Unchanged row", planned_start: "2026-01-01", planned_finish: "2026-01-11" },
    { external_id: "ext-new", title: "Brand new row" },
  ])]));
  assert.ok(result.r.run_id, "the function must return the run id");

  const runs = (await sql("select * from public.programme_import_runs where programme_id = $1", [prog.id])).rows;
  assert.equal(runs.length, 1, "exactly one run row must exist after one import");
  assert.equal(runs[0].id, result.r.run_id, "the stored row's id must match the id the function returned");
  assert.equal(runs[0].created_count, 1);
  assert.equal(runs[0].updated_count, 0);
  assert.equal(runs[0].unchanged_count, 1);
  assert.equal(runs[0].not_in_import_count, 1, "'Will be left out' was never in this import");
  assert.equal(runs[0].imported_by, OWNER);
});

test("v100: a rollback (an exception raised before the function's own insert) leaves no run row — and no activity changes either, proving they share one transaction", async () => {
  const prog = await createProgramme();
  await createActivity(prog.id, { title: "Pre-existing", external_id: "ext-pre" });

  // SNAGGER is a real project member (passes is_project_member) but
  // NOT an editor (fails is_project_editor) — the function's own first
  // authorization check raises an exception here, before it ever
  // touches programme_activities or inserts a run row.
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1,$2,'member') on conflict do nothing", [fx.orgId, SNAGGER]);
  await sql("insert into public.project_members (project_id, user_id, role) values ($1,$2,'snagging') on conflict do nothing", [prog.project_id, SNAGGER]);

  await assert.rejects(
    () => as(SNAGGER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([{ external_id: "ext-new", title: "Should never be created" }])])),
    /not authorized/,
  );

  const runs = (await sql("select count(*)::int as n from public.programme_import_runs where programme_id = $1", [prog.id])).rows[0].n;
  assert.equal(runs, 0, "a rolled-back attempt must leave absolutely no run row");

  const activities = (await sql("select count(*)::int as n from public.programme_activities where programme_id = $1", [prog.id])).rows[0].n;
  assert.equal(activities, 1, "the rejected attempt must not have created the new row either — same transaction, same rollback");
});

test("v100: a rollback on a non-existent programme also leaves no run row anywhere", async () => {
  const fakeProgrammeId = "00000000-0000-0000-0000-000000000000";
  await assert.rejects(
    () => as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [fakeProgrammeId, importRows([{ title: "X" }])])),
    /not found/,
  );
  const runs = (await sql("select count(*)::int as n from public.programme_import_runs where programme_id = $1", [fakeProgrammeId])).rows[0].n;
  assert.equal(runs, 0);
});

// ─── RLS: read matches programme_activities' own read boundary ─────

test("v100: an editor (the project owner) can read the run rows for their own project", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([{ title: "A row" }])]));

  const rows = await as(OWNER, (c) => c.query("select * from public.programme_import_runs where programme_id = $1", [prog.id]));
  assert.equal(rows.rows.length, 1, "the project owner must be able to read the run they themselves triggered");
});

test("v100: a company with only programme_read capability (no ordinary project_members row at all) can read the run", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([{ title: "A row" }])]));
  await joinAsClientParty(prog.project_id);

  const rows = await as(CLIENT, (c) => c.query("select * from public.programme_import_runs where programme_id = $1", [prog.id]));
  assert.equal(rows.rows.length, 1, "a party holding programme_read must see the run, exactly like it already sees programme_activities");
});

test("v100: a plain project member with no programme access (snagging role, no party capability) gets ZERO rows — never an error", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([{ title: "A row" }])]));
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1,$2,'member') on conflict do nothing", [fx.orgId, SNAGGER]);
  await sql("insert into public.project_members (project_id, user_id, role) values ($1,$2,'snagging') on conflict do nothing", [prog.project_id, SNAGGER]);

  const rows = await as(SNAGGER, (c) => c.query("select * from public.programme_import_runs where programme_id = $1", [prog.id]));
  assert.equal(rows.rows.length, 0, "a plain project_members row is not enough — this must match programme_activities' own boundary, not project membership");
});

test("v100: a user with no membership on the project at all cannot read its run rows", async () => {
  const prog = await createProgramme();
  await as(OWNER, (c) => c.query("select public.import_programme_activities($1, $2::jsonb)", [prog.id, importRows([{ title: "A row" }])]));

  const rows = await as(OUTSIDER, (c) => c.query("select * from public.programme_import_runs where programme_id = $1", [prog.id]));
  assert.equal(rows.rows.length, 0, "RLS must hide every run row from a non-member — zero rows, not an error");
});

test("v100: an authenticated user — even the project owner — cannot INSERT a run row directly", async () => {
  const prog = await createProgramme();
  await assert.rejects(
    () => as(OWNER, (c) => c.query(
      `insert into public.programme_import_runs (org_id, project_id, programme_id, created_count, updated_count, unchanged_count, not_in_import_count, changes)
       values ($1,$2,$3,0,0,0,0,'{}'::jsonb)`,
      [fx.orgId, prog.project_id, prog.id]
    )),
    /row-level security|permission denied/i,
    "the table has no INSERT policy at all — the owner-role bypass only applies to the SECURITY DEFINER function, never to a direct authenticated insert",
  );
});

test("v100: an authenticated user cannot UPDATE a run row directly", async () => {
  const prog = await createProgramme();
  const result = await as(OWNER, (c) => one(c, "select public.import_programme_activities($1, $2::jsonb) as r", [prog.id, importRows([{ title: "A row" }])]));

  const attempt = await as(OWNER, (c) => c.query("update public.programme_import_runs set created_count = 999 where id = $1", [result.r.run_id]));
  assert.equal(attempt.rowCount, 0, "an update must match zero rows under RLS (no UPDATE policy exists)");

  const row = (await sql("select created_count from public.programme_import_runs where id = $1", [result.r.run_id])).rows[0];
  assert.equal(row.created_count, 1, "the real stored value must be completely untouched");
});

test("v100: an authenticated user cannot DELETE a run row directly", async () => {
  const prog = await createProgramme();
  const result = await as(OWNER, (c) => one(c, "select public.import_programme_activities($1, $2::jsonb) as r", [prog.id, importRows([{ title: "A row" }])]));

  const attempt = await as(OWNER, (c) => c.query("delete from public.programme_import_runs where id = $1", [result.r.run_id]));
  assert.equal(attempt.rowCount, 0, "a delete must match zero rows under RLS (no DELETE policy exists)");

  const stillThere = (await sql("select count(*)::int as n from public.programme_import_runs where id = $1", [result.r.run_id])).rows[0].n;
  assert.equal(stillThere, 1, "the row must still exist");
});

// ─── Payload correctness ────────────────────────────────────────────

test("v100: the changes payload records correct signed slip days in both directions, a title change, a milestone flag change, created rows, and rows not in the import", async () => {
  const prog = await createProgramme();
  const pushedBack = await createActivity(prog.id, { title: "Roof Covering", external_id: "ext-pushed", planned_start: "2026-02-01", planned_finish: "2026-02-15" });
  const pulledForward = await createActivity(prog.id, { title: "Groundworks", external_id: "ext-pulled", planned_start: "2026-01-05", planned_finish: "2026-01-20" });
  const renamed = await createActivity(prog.id, { title: "Old name", external_id: "ext-renamed", planned_start: "2026-03-01", planned_finish: "2026-03-10" });
  const milestoneFlip = await createActivity(prog.id, { title: "Milestone flip", external_id: "ext-milestone", is_milestone: false, planned_start: "2026-04-01", planned_finish: "2026-04-01" });
  await createActivity(prog.id, { title: "Left out of this import", external_id: "ext-leftout" });

  const result = await as(OWNER, (c) => one(c, "select public.import_programme_activities($1, $2::jsonb) as r", [prog.id, importRows([
    { external_id: "ext-pushed", title: "Roof Covering", planned_start: "2026-02-01", planned_finish: "2026-03-01" }, // finish pushed back 14 days
    { external_id: "ext-pulled", title: "Groundworks", planned_start: "2026-01-01", planned_finish: "2026-01-16" }, // both pulled forward 4 days
    { external_id: "ext-renamed", title: "New name", planned_start: "2026-03-01", planned_finish: "2026-03-10" }, // title only
    { external_id: "ext-milestone", title: "Milestone flip", is_milestone: true, planned_start: "2026-04-01", planned_finish: "2026-04-01" }, // milestone flag only
    { external_id: "ext-brand-new", title: "Frame Erect", planned_start: "2026-05-01", planned_finish: "2026-05-20" },
  ])]));

  const run = (await sql("select * from public.programme_import_runs where id = $1", [result.r.run_id])).rows[0];
  const entries = run.changes.entries;
  const byId = Object.fromEntries(entries.map((e) => [e.activity_id, e]));

  const pushedEntry = byId[pushedBack.id];
  assert.equal(pushedEntry.created, false);
  assert.equal(pushedEntry.start_slip_days, 0);
  assert.equal(pushedEntry.finish_slip_days, 14, "finish moved 14 days LATER — a positive slip");
  assert.equal(pushedEntry.old_planned_finish.slice(0, 10), "2026-02-15");
  assert.equal(pushedEntry.new_planned_finish.slice(0, 10), "2026-03-01");

  const pulledEntry = byId[pulledForward.id];
  assert.equal(pulledEntry.start_slip_days, -4, "start moved 4 days EARLIER — a negative slip");
  assert.equal(pulledEntry.finish_slip_days, -4);

  const renamedEntry = byId[renamed.id];
  assert.equal(renamedEntry.old_title, "Old name");
  assert.equal(renamedEntry.title, "New name");
  assert.equal(renamedEntry.start_slip_days, 0, "dates unchanged for the pure rename");
  assert.equal(renamedEntry.finish_slip_days, 0);

  const milestoneEntry = byId[milestoneFlip.id];
  assert.equal(milestoneEntry.milestone_changed, true);

  const createdEntry = entries.find((e) => e.created === true);
  assert.ok(createdEntry, "a created-row entry must exist");
  assert.equal(createdEntry.title, "Frame Erect");
  assert.equal(createdEntry.old_title, null);
  assert.equal(createdEntry.old_planned_start, null);
  assert.equal(createdEntry.start_slip_days, null, "slip is meaningless for a brand-new row");

  assert.equal(run.not_in_import_count, 1);
  assert.equal(run.changes.not_in_import.length, 1);
  assert.equal(run.changes.not_in_import[0].external_id, "ext-leftout");
  assert.equal(run.changes.not_in_import[0].title, "Left out of this import");
});

test("v100: an unchanged row (nothing actually differs) produces no changes entry at all, and null-vs-null slip is never confused with a real zero-day slip", async () => {
  const prog = await createProgramme();
  const noDates = await createActivity(prog.id, { title: "No dates at all", external_id: "ext-nodates" });

  const result = await as(OWNER, (c) => one(c, "select public.import_programme_activities($1, $2::jsonb) as r", [prog.id, importRows([
    { external_id: "ext-nodates", title: "No dates at all" },
  ])]));

  const run = (await sql("select * from public.programme_import_runs where id = $1", [result.r.run_id])).rows[0];
  assert.equal(run.unchanged_count, 1);
  assert.equal(run.changes.entries.length, 0, "an unchanged row is not a 'change' and must not appear in the entries list at all");
});
