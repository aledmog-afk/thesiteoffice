// v70: deleting a project must not fail with a foreign key error on
// audit_log_project_id_fkey. Root cause was write_audit_log() trying to
// INSERT a new audit_log row referencing a project that, by the time
// that AFTER DELETE trigger's INSERT runs, is already gone (either the
// project row itself, or any child row cascade-deleted alongside it).
// This reproduced on a bare project with zero plots, not just ones
// with plots: project_members (the owner row, seed_project_owner())
// is the one child unconditionally seeded for every project regardless
// of plots, and it's independently audited (trg_audit_project_members)
// the same way quality_gates/handover_documents are once a plot
// exists (seed_plot_defaults()). See sql/schema.sql's v70 ADDITIONS
// block for the full root-cause writeup.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient } from "../lib/db.mjs";

async function seedOrgProjectUser(client, { projectName }) {
  const { rows: [org] } = await client.query(`insert into public.organisations (name) values ('Test Org') returning id`);
  const { rows: [userRow] } = await client.query(`insert into auth.users (email) values ('fk-test@example.com') returning id`);
  const { rows: [project] } = await client.query(
    `insert into public.projects (org_id, name, created_by) values ($1, $2, $3) returning id`,
    [org.id, projectName, userRow.id]
  );
  return { org, userRow, project };
}

test("v70: deleting a bare project (no plots) with prior audit history succeeds and keeps every audit row", async () => {
  const db = "tracker_test_v70_bare_project_delete";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db);

    const { project } = await seedOrgProjectUser(client, { projectName: "Bare Project" });
    // An UPDATE before deletion creates a pre-existing audit_log row
    // whose project_id points at this project — it must survive the
    // delete with project_id correctly nulled, not be lost.
    await client.query(`update public.projects set status = 'on hold' where id = $1`, [project.id]);

    await client.query(`delete from public.projects where id = $1`, [project.id]); // must not throw
    const { rows: deleted } = await client.query(`select id from public.projects where id = $1`, [project.id]);
    assert.equal(deleted.length, 0, "project should actually be gone");

    const { rows: audit } = await client.query(
      `select action, project_id from public.audit_log where record_id = $1 and table_name = 'projects' order by created_at`,
      [project.id]
    );
    assert.deepEqual(
      audit.map((r) => r.action),
      ["INSERT", "UPDATE", "DELETE"],
      "the project's full lifecycle must still be in the audit log"
    );
    assert.ok(audit.every((r) => r.project_id === null), "project_id is nulled once the project is gone, same as the FK's own ON DELETE SET NULL behaviour for every other row");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("v70: deleting a project WITH plots, blocks and auto-seeded children (quality_gates, handover_documents, project_members) succeeds", async () => {
  const db = "tracker_test_v70_project_with_plots_delete";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db);

    const { project } = await seedOrgProjectUser(client, { projectName: "Project With Plots" });
    const { rows: [block] } = await client.query(`insert into public.blocks (project_id, block_name) values ($1, 'Block A') returning id`, [project.id]);
    await client.query(`insert into public.plots (project_id, block_id, plot_number) values ($1, $2, '1')`, [project.id, block.id]);

    const beforeCounts = (
      await client.query(
        `select
           (select count(*) from public.quality_gates where project_id = $1) as gates,
           (select count(*) from public.handover_documents where project_id = $1) as handovers,
           (select count(*) from public.project_members where project_id = $1) as members`,
        [project.id]
      )
    ).rows[0];
    assert.ok(Number(beforeCounts.gates) > 0, "quality_gates should be auto-seeded");
    assert.ok(Number(beforeCounts.handovers) > 0, "handover_documents should be auto-seeded");
    assert.ok(Number(beforeCounts.members) > 0, "project_members should be auto-seeded");

    await client.query(`delete from public.projects where id = $1`, [project.id]); // must not throw

    const after = (
      await client.query(
        `select
           (select count(*) from public.plots where project_id = $1) as plots,
           (select count(*) from public.blocks where project_id = $1) as blocks,
           (select count(*) from public.quality_gates where project_id = $1) as gates,
           (select count(*) from public.handover_documents where project_id = $1) as handovers,
           (select count(*) from public.project_members where project_id = $1) as members`,
        [project.id]
      )
    ).rows[0];
    for (const [label, count] of Object.entries(after)) {
      assert.equal(Number(count), 0, `${label} should have cascade-deleted`);
    }

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("v70: no regression — deleting a single child row while its project stays alive still keeps project_id on the audit row", async () => {
  const db = "tracker_test_v70_no_regression";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db);

    const { project, userRow } = await seedOrgProjectUser(client, { projectName: "Still Alive Project" });
    // project_members is the one row seed_project_owner() unconditionally
    // creates for every project (its owner row) — unlike quality_gates/
    // handover_documents, which (per seed_plot_defaults()) only appear
    // once a plot exists, this needs no extra setup to be present.
    const { rows: members } = await client.query(`select id from public.project_members where project_id = $1 and user_id = $2`, [project.id, userRow.id]);
    assert.ok(members.length, "expected the auto-seeded owner project_members row to delete");

    await client.query(`delete from public.project_members where id = $1`, [members[0].id]);

    const { rows: audit } = await client.query(
      `select project_id from public.audit_log where table_name = 'project_members' and action = 'DELETE' order by created_at desc limit 1`
    );
    assert.equal(audit[0].project_id, project.id, "project_id must stay set when the project itself was never deleted");

    const { rows: stillThere } = await client.query(`select id from public.projects where id = $1`, [project.id]);
    assert.equal(stillThere.length, 1, "the project itself must be untouched");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});
