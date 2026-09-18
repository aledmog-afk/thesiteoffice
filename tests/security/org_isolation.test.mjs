// Organisation isolation — the highest-priority test suite in this repo.
// Exercises the ACTUAL database boundary: every query below runs as a
// real, non-superuser `authenticated` Postgres role (never the schema-
// applying superuser, which bypasses RLS and would make every assertion
// here a false positive — see tests/lib/db.mjs:isRlsError and the
// "Prevent False Positives" note in tests/README.md).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_org_isolation";

const USER_A = "a0000000-0000-0000-0000-00000000000a";
const USER_B = "b0000000-0000-0000-0000-00000000000b";
const STRANGER = "c0000000-0000-0000-0000-00000000000c";

let fx; // fixture ids, populated in before()

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'usera@a.example'), ($2,'userb@b.example'), ($3,'stranger@nobody.example')`,
    [USER_A, USER_B, STRANGER]
  );
  await admin.end();

  // Real, RLS-checked fixture creation — not a superuser shortcut — so
  // these tests also prove the normal "create my first project" path
  // still works (Priority 1/2 regression, for free).
  const a = await userClient(DB, USER_A);
  const orgA = (await a.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await a.query(
    "insert into public.projects (name, org_id, created_by) values ('Org A Site', $1, $2) returning id",
    [orgA, USER_A]
  )).rows[0].id;
  const plotA = (await a.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id", [projA])).rows[0].id;
  const reportA = (await a.query(
    "insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1,'2026-01-05','2026-01-09') returning id",
    [projA]
  )).rows[0].id;
  const snagListA = (await a.query("insert into public.snag_lists (project_id, title) values ($1,'General A') returning id", [projA])).rows[0].id;
  const snagA = (await a.query("insert into public.snag_items (project_id, snag_list_id, description) values ($1,$2,'Cracked tile') returning id", [projA, snagListA])).rows[0].id;
  const commA = (await a.query("insert into public.commercial_items (project_id, title, type) values ($1,'EW-1','early_warning') returning id", [projA])).rows[0].id;
  await a.query("insert into public.org_settings (org_id, logo_url) values ($1, 'https://example.com/logo-a.png') on conflict (org_id) do update set logo_url = excluded.logo_url", [orgA]);
  await a.end();

  const b = await userClient(DB, USER_B);
  const orgB = (await b.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await b.query(
    "insert into public.projects (name, org_id, created_by) values ('Org B Site', $1, $2) returning id",
    [orgB, USER_B]
  )).rows[0].id;
  await b.end();

  fx = { orgA, projA, plotA, reportA, snagListA, snagA, commA, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("User A can read everything in their own organisation", async () => {
  const a = await userClient(DB, USER_A);
  try {
    const checks = [
      ["projects", "id", fx.projA],
      ["plots", "id", fx.plotA],
      ["weekly_reports", "id", fx.reportA],
      ["snag_items", "id", fx.snagA],
      ["commercial_items", "id", fx.commA],
      ["organisations", "id", fx.orgA],
    ];
    for (const [table, col, id] of checks) {
      const { rowCount } = await a.query(`select 1 from public.${table} where ${col} = $1`, [id]);
      assert.equal(rowCount, 1, `expected to see own-org row in ${table}`);
    }
    const gates = await a.query("select 1 from public.quality_gates where project_id = $1", [fx.projA]);
    assert.ok(gates.rowCount > 0, "expected auto-seeded quality_gates for own project");
    const milestones = await a.query("select 1 from public.internal_milestones where plot_id = $1", [fx.plotA]);
    assert.ok(milestones.rowCount > 0, "expected auto-seeded internal_milestones for own plot");
    const settings = await a.query("select 1 from public.org_settings where org_id = $1", [fx.orgA]);
    assert.equal(settings.rowCount, 1, "expected to see own org_settings");
  } finally {
    await a.end();
  }
});

test("User A cannot SELECT any Organisation B data, including child tables", async () => {
  const a = await userClient(DB, USER_A);
  try {
    const checks = [
      ["projects", "id", fx.projB],
      ["organisations", "id", fx.orgB],
      ["organisation_members", "org_id", fx.orgB],
    ];
    for (const [table, col, id] of checks) {
      const { rowCount } = await a.query(`select 1 from public.${table} where ${col} = $1`, [id]);
      assert.equal(rowCount, 0, `expected 0 rows reading Org B's ${table}`);
    }
  } finally {
    await a.end();
  }
});

test("User A cannot UPDATE or DELETE Organisation B's project", async () => {
  const a = await userClient(DB, USER_A);
  try {
    const upd = await a.query("update public.projects set name = 'HACKED' where id = $1", [fx.projB]);
    assert.equal(upd.rowCount, 0, "UPDATE on Org B's project should affect 0 rows");
    const del = await a.query("delete from public.projects where id = $1", [fx.projB]);
    assert.equal(del.rowCount, 0, "DELETE on Org B's project should affect 0 rows");
  } finally {
    await a.end();
  }
});

test("User A cannot INSERT into Organisation B's project (snag_items) even knowing its real id", async () => {
  const a = await userClient(DB, USER_A);
  try {
    await assert.rejects(
      () => a.query("insert into public.snag_items (project_id, description) values ($1, 'injected')", [fx.projB]),
      (err) => isRlsError(err),
      "expected an RLS violation, not a silent success"
    );
  } finally {
    await a.end();
  }
});

test("User A cannot create a new project claiming Organisation B as its org_id", async () => {
  const a = await userClient(DB, USER_A);
  try {
    await assert.rejects(
      () => a.query("insert into public.projects (name, org_id, created_by) values ('Hostile', $1, $2)", [fx.orgB, USER_A]),
      (err) => isRlsError(err)
    );
  } finally {
    await a.end();
  }
});

test("User B (mirror image): reading and writing Organisation A fails the same way", async () => {
  const b = await userClient(DB, USER_B);
  try {
    const proj = await b.query("select 1 from public.projects where id = $1", [fx.projA]);
    assert.equal(proj.rowCount, 0);
    const settings = await b.query("select 1 from public.org_settings where org_id = $1", [fx.orgA]);
    assert.equal(settings.rowCount, 0);
    const upd = await b.query("update public.projects set name = 'HACKED-BY-B' where id = $1", [fx.projA]);
    assert.equal(upd.rowCount, 0);
    const own = await b.query("select 1 from public.projects where id = $1", [fx.projB]);
    assert.equal(own.rowCount, 1, "User B should still see their own project");
  } finally {
    await b.end();
  }
});

test("A stranger (no membership of either org) sees and can touch neither", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    const all = await stranger.query("select 1 from public.projects");
    assert.equal(all.rowCount, 0, "a stranger should see zero projects, not just zero of a specific one");
    await assert.rejects(
      () => stranger.query("insert into public.projects (name, org_id, created_by) values ('Stranger Project', $1, $2)", [fx.orgA, STRANGER]),
      (err) => isRlsError(err)
    );
  } finally {
    await stranger.end();
  }
});

test("A completely unauthenticated request (no JWT sub at all) sees zero rows too", async () => {
  const anon = await userClient(DB, null);
  try {
    const all = await anon.query("select 1 from public.projects");
    assert.equal(all.rowCount, 0);
  } finally {
    await anon.end();
  }
});
