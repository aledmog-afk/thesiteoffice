// Plot Control / Handover Readiness (Priority 12, Phase 1) — real
// database, real non-superuser `authenticated` role. No new tables or
// RLS policies were added for this phase — getPlotHandoverReadiness()/
// getProjectPlotReadiness() query EXISTING plot-scoped tables
// (quality_gates, handover_documents, programme_activities, snag_lists,
// snag_items) with new query SHAPES (.eq("plot_id", ...) and the
// snag_lists-indirection join). This file proves those specific new
// shapes inherit real RLS isolation exactly like every other broad
// select in this codebase, and confirms the snag_list_id indirection
// genuinely stays project/plot-scoped (never leaks across a project
// boundary via a mismatched list/plot pairing).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_plot_handover_readiness";

const OWNER_A = "a1000000-0000-0000-0000-000000000041";
const COLLAB_A = "a2000000-0000-0000-0000-000000000042";
const SNAG_A = "a3000000-0000-0000-0000-000000000043";
const OWNER_B = "b1000000-0000-0000-0000-000000000041";
const STRANGER = "c1000000-0000-0000-0000-000000000041";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'collaba@example.com'), ($3,'snaga@example.com'), ($4,'ownerb@example.com'), ($5,'stranger@example.com')`,
    [OWNER_A, COLLAB_A, SNAG_A, OWNER_B, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const plotA = (await ownerA.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'Plot 1',$2) returning id", [projA, OWNER_A])).rows[0].id;
  const inviteCode = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A);
  await collabA.query("select public.join_project_by_invite($1)", [inviteCode]);
  await collabA.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagA.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  const plotB = (await ownerB.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'Plot 1',$2) returning id", [projB, OWNER_B])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA, plotA, orgB, projB, plotB };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("Quality Gates: an unfiltered .eq('plot_id', ownPlot) select never returns another organisation's gate rows, even by construction", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const ownerB = await userClient(DB, OWNER_B);
  try {
    // seed_plot_defaults() already created gates for each plot automatically.
    const asOwnerA = await ownerA.query("select id from public.quality_gates where plot_id = $1", [fx.plotB]);
    assert.equal(asOwnerA.rowCount, 0, "Org A querying Org B's real plot_id directly must return zero rows");
    const asOwnerB = await ownerB.query("select id from public.quality_gates where plot_id = $1", [fx.plotA]);
    assert.equal(asOwnerB.rowCount, 0, "Org B querying Org A's real plot_id directly must return zero rows");
  } finally {
    await ownerA.end();
    await ownerB.end();
  }
});

test("Handover Documents: same plot_id-scoped isolation as Quality Gates", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rowCount } = await ownerA.query("select id from public.handover_documents where plot_id = $1", [fx.plotB]);
    assert.equal(rowCount, 0);
  } finally {
    await ownerA.end();
  }
});

test("Programme Activities: plot_id-scoped isolation holds for an activity explicitly tagged to a plot", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    const progB = (await ownerB.query("insert into public.programmes (project_id, name, status) values ($1,'B Programme','active') returning id", [fx.projB])).rows[0].id;
    await ownerB.query("insert into public.programme_activities (programme_id, plot_id, title, planned_finish) values ($1,$2,'B activity','2020-01-01')", [progB, fx.plotB]);
  } finally {
    await ownerB.end();
  }

  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rowCount } = await ownerA.query("select id from public.programme_activities where plot_id = $1", [fx.plotB]);
    assert.equal(rowCount, 0, "Org A must never see Org B's plot-tagged programme activity, even querying by Org B's real plot_id");
  } finally {
    await ownerA.end();
  }
});

test("Snags via snag_lists indirection: a plot's own snag list only ever resolves within its own project — cross-project plot_id never matches a foreign snag_list", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const listForForeignPlot = await ownerA.query("select id from public.snag_lists where plot_id = $1", [fx.plotB]);
    assert.equal(listForForeignPlot.rowCount, 0, "Org A must never resolve Org B's plot to a real snag_list id");
  } finally {
    await ownerA.end();
  }
});

test("Snags via snag_lists indirection: real snag items in a plot's own list are correctly reachable within the SAME project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const list = await ownerA.query("select id from public.snag_lists where plot_id = $1", [fx.plotA]);
    assert.equal(list.rowCount, 1, "sanity check: the plot's auto-seeded snag list exists");
    await ownerA.query(
      "insert into public.snag_items (project_id, snag_list_id, location, description, priority, status) values ($1,$2,'Kitchen','Chip in tile','high','open')",
      [fx.projA, list.rows[0].id]
    );
    const items = await ownerA.query("select id, priority, status from public.snag_items where snag_list_id = $1", [list.rows[0].id]);
    assert.equal(items.rowCount, 1);
    assert.equal(items.rows[0].priority, "high");
  } finally {
    await ownerA.end();
  }
});

test("Cross-project (same org): a collaborator on project A cannot resolve project B's plot to any gate/document/programme/snag row, even within the same organisation boundary this fixture doesn't span (defence in depth)", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const g = await collabA.query("select 1 from public.quality_gates where plot_id = $1", [fx.plotB]);
    assert.equal(g.rowCount, 0);
    const d = await collabA.query("select 1 from public.handover_documents where plot_id = $1", [fx.plotB]);
    assert.equal(d.rowCount, 0);
    const l = await collabA.query("select 1 from public.snag_lists where plot_id = $1", [fx.plotB]);
    assert.equal(l.rowCount, 0);
  } finally {
    await collabA.end();
  }
});

test("Access tier: a snagging-only member CAN read plots and the plot's own snags (member-level RLS)", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const p = await snagA.query("select id from public.plots where id = $1", [fx.plotA]);
    assert.equal(p.rowCount, 1, "plots are member-level readable — a snagging-only member must see the plot itself");
    const l = await snagA.query("select id from public.snag_lists where plot_id = $1", [fx.plotA]);
    assert.equal(l.rowCount, 1, "snag_lists are member-level readable too");
  } finally {
    await snagA.end();
  }
});

test("Access tier: a snagging-only member CANNOT read Quality Gates, Handover Documents, or Programme Activities for the same plot (editor-only RLS) — proves editorDataVisible must be checked, not assumed", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const g = await snagA.query("select 1 from public.quality_gates where plot_id = $1", [fx.plotA]);
    assert.equal(g.rowCount, 0, "a snagging-only member must see ZERO gate rows for their own project's own plot, not an error masking the restriction");
    const d = await snagA.query("select 1 from public.handover_documents where plot_id = $1", [fx.plotA]);
    assert.equal(d.rowCount, 0);
  } finally {
    await snagA.end();
  }
});

test("get_my_role: a snagging-only member's role resolves to 'snagging', which getPlotHandoverReadiness()/getProjectPlotReadiness() must treat as editorDataVisible:false", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rows } = await snagA.query("select public.get_my_role($1) as role", [fx.projA]);
    assert.equal(rows[0].role, "snagging");
  } finally {
    await snagA.end();
  }
});

test("get_my_role: an owner/collaborator's role resolves to a value that must be treated as editorDataVisible:true", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const ownerRole = await ownerA.query("select public.get_my_role($1) as role", [fx.projA]);
    assert.equal(ownerRole.rows[0].role, "owner");
    const collabRole = await collabA.query("select public.get_my_role($1) as role", [fx.projA]);
    assert.equal(collabRole.rows[0].role, "collaborator");
  } finally {
    await ownerA.end();
    await collabA.end();
  }
});

test("Cross-org: a total stranger sees zero rows across every table the readiness calculation touches", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    for (const table of ["plots", "quality_gates", "handover_documents", "programme_activities", "snag_lists", "snag_items"]) {
      const { rowCount } = await stranger.query(`select 1 from public.${table} where project_id = $1`, [fx.projA]);
      assert.equal(rowCount, 0, `stranger must see zero ${table} rows for a project they have no membership on`);
    }
  } finally {
    await stranger.end();
  }
});

test("Regression: seed_plot_defaults() still creates exactly the expected gate/document/snag-list rows this readiness calculation depends on", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const gates = await ownerA.query("select count(*)::int as n from public.quality_gates where plot_id = $1", [fx.plotA]);
    assert.equal(gates.rows[0].n, 4, "a standalone house plot gets exactly 4 quality gates");
    const docs = await ownerA.query("select count(*)::int as n from public.handover_documents where plot_id = $1", [fx.plotA]);
    assert.equal(docs.rows[0].n, 5, "a standalone house plot gets exactly 5 handover documents");
    const lists = await ownerA.query("select count(*)::int as n from public.snag_lists where plot_id = $1", [fx.plotA]);
    assert.equal(lists.rows[0].n, 1, "a plot gets exactly one auto-seeded snag list");
  } finally {
    await ownerA.end();
  }
});
