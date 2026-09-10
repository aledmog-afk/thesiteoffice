// Project-level roles: owner / collaborator / snagging-only. Same real-
// database-as-authenticated-user approach as org_isolation.test.mjs — see
// that file's header comment for why this matters.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_project_roles";

const OWNER = "10000000-0000-0000-0000-000000000001";
const COLLAB = "20000000-0000-0000-0000-000000000002";
const SNAGGER = "30000000-0000-0000-0000-000000000003";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'owner@example.com'), ($2,'collab@example.com'), ($3,'snagger@example.com')`,
    [OWNER, COLLAB, SNAGGER]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const org = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;
  const proj = (await owner.query(
    "insert into public.projects (name, org_id, created_by) values ('Test Site', $1, $2) returning id",
    [org, OWNER]
  )).rows[0].id;
  const inviteCode = (await owner.query("select public.regenerate_invite_code($1) as code", [proj])).rows[0].code;
  const snagCode = (await owner.query("select public.regenerate_snagging_invite_code($1) as code", [proj])).rows[0].code;
  const plotRow = await owner.query("insert into public.plots (project_id, plot_number) values ($1, 'Plot 1') returning id", [proj]);
  const plot = plotRow.rows[0].id;
  await owner.end();

  const admin3 = adminClient(DB);
  await admin3.connect();
  // seed_plot_defaults() auto-creates one snag_list per plot — the plot's
  // own list is what a snagging-only member actually works within; they
  // can't create a new NAMED snag_lists row themselves (that's editor-only,
  // "editors insert snag_lists" in sql/schema.sql — this fixture uses the
  // real seeded list rather than asserting the wrong capability).
  const seededList = await admin3.query("select id from public.snag_lists where plot_id = $1", [plot]);
  const plotSnagList = seededList.rows[0].id;
  await admin3.end();

  const collab = await userClient(DB, COLLAB);
  await collab.query("select public.join_project_by_invite($1)", [inviteCode]);
  await collab.end();

  const snagger = await userClient(DB, SNAGGER);
  await snagger.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagger.end();

  const admin2 = adminClient(DB);
  await admin2.connect();
  const gateRow = await admin2.query("select id from public.quality_gates where project_id = $1 limit 1", [proj]);
  const gate = gateRow.rows[0].id;
  await admin2.end();

  fx = { org, proj, gate, plot, plotSnagList };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("Owner: full read/write, including deleting the project", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const upd = await owner.query("update public.projects set name = 'Renamed' where id = $1", [fx.proj]);
    assert.equal(upd.rowCount, 1, "owner should be able to rename their project");
    const gate = await owner.query("update public.quality_gates set status = 'in_progress' where id = $1", [fx.gate]);
    assert.equal(gate.rowCount, 1, "owner should be able to update quality gates");
  } finally {
    await owner.end();
  }
});

test("Collaborator: can edit project content but not delete the project", async () => {
  const collab = await userClient(DB, COLLAB);
  try {
    const gate = await collab.query("update public.quality_gates set status = 'under_review' where id = $1", [fx.gate]);
    assert.equal(gate.rowCount, 1, "collaborator should be able to update quality gates");
    const del = await collab.query("delete from public.projects where id = $1", [fx.proj]);
    assert.equal(del.rowCount, 0, "collaborator should NOT be able to delete the project (owner-only)");
  } finally {
    await collab.end();
  }
});

test("Snagging-only member: can read plots and manage snag items", async () => {
  const snagger = await userClient(DB, SNAGGER);
  try {
    const plots = await snagger.query("select 1 from public.plots where project_id = $1", [fx.proj]);
    assert.equal(plots.rowCount, 1, "snagging member should be able to read the plot");
    const item = await snagger.query(
      "insert into public.snag_items (project_id, snag_list_id, description) values ($1, $2, 'Loose handle') returning id",
      [fx.proj, fx.plotSnagList]
    );
    assert.equal(item.rowCount, 1, "snagging member should be able to raise a snag item");
    const closeIt = await snagger.query("update public.snag_items set status = 'closed' where id = $1", [item.rows[0].id]);
    assert.equal(closeIt.rowCount, 1, "snagging member should be able to close a snag item");
  } finally {
    await snagger.end();
  }
});

test("Snagging-only member: cannot read weekly reports, quality gates, or the commercial ledger", async () => {
  const snagger = await userClient(DB, SNAGGER);
  try {
    const reports = await snagger.query("select 1 from public.weekly_reports where project_id = $1", [fx.proj]);
    assert.equal(reports.rowCount, 0, "editor-only table: weekly_reports");
    const gates = await snagger.query("select 1 from public.quality_gates where project_id = $1", [fx.proj]);
    assert.equal(gates.rowCount, 0, "editor-only table: quality_gates");
    const commercial = await snagger.query("select 1 from public.commercial_items where project_id = $1", [fx.proj]);
    assert.equal(commercial.rowCount, 0, "editor-only table: commercial_items");
  } finally {
    await snagger.end();
  }
});

test("Snagging-only member: cannot create a new weekly report or quality gate", async () => {
  const snagger = await userClient(DB, SNAGGER);
  try {
    await assert.rejects(
      () => snagger.query(
        "insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1,'2026-02-02','2026-02-06')",
        [fx.proj]
      ),
      (err) => isRlsError(err)
    );
  } finally {
    await snagger.end();
  }
});

test("Snagging-only member: cannot see the collaborators list (get_project_members)", async () => {
  const snagger = await userClient(DB, SNAGGER);
  try {
    const { rows } = await snagger.query("select * from public.get_project_members($1)", [fx.proj]);
    assert.equal(rows.length, 0, "get_project_members should reveal nothing to a snagging-only member, not even their own row");
  } finally {
    await snagger.end();
  }
});

test("Only the owner can manage invite links", async () => {
  const collab = await userClient(DB, COLLAB);
  try {
    await assert.rejects(
      () => collab.query("select public.regenerate_invite_code($1)", [fx.proj]),
      /Only the site owner/,
      "collaborator should not be able to regenerate the invite link"
    );
  } finally {
    await collab.end();
  }
});
