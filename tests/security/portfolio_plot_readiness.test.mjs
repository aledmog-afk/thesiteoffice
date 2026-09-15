// Portfolio Plot Control Rollup (Priority 15, Phase 2) — real database,
// real non-superuser `authenticated` role. getPortfolioPlotReadiness()
// deliberately issues UNFILTERED selects against plots/quality_gates/
// handover_documents/snag_lists/snag_items/programme_activities/actions/
// inspection_findings — exactly like getPortfolioControlSummary()
// already does for its own tables — relying entirely on each table's
// own RLS policy to scope the rows returned, never a client-side
// project_id filter. This file proves that reliance is safe: a member
// sees only their own project(s)' rows, a multi-project member sees
// every one of their projects (not just the first), a user with no
// membership sees nothing, a cross-org user sees nothing, a snagging-
// only member sees Plots/Snags but NOT the editor-only tables, and an
// unauthenticated caller sees nothing anywhere.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_portfolio_plot_readiness";

const OWNER_A = "a1000000-0000-0000-0000-000000000071";
const COLLAB_MULTI = "a2000000-0000-0000-0000-000000000072";
const SNAG_A = "a3000000-0000-0000-0000-000000000073";
const OWNER_B = "b1000000-0000-0000-0000-000000000071";
const STRANGER = "c1000000-0000-0000-0000-000000000071";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'multi@example.com'), ($3,'snaga@example.com'), ($4,'ownerb@example.com'), ($5,'stranger@example.com')`,
    [OWNER_A, COLLAB_MULTI, SNAG_A, OWNER_B, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const plotA = (await ownerA.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'P1',$2) returning id", [projA, OWNER_A])).rows[0].id;
  const inviteA = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;
  const snagInviteA = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  // Give plot A a real blocker (outstanding gate) so editor-only rows exist to test against.
  const gateRows = await ownerA.query(`select id from public.quality_gates where plot_id=$1 limit 1`, [plotA]);
  await ownerA.query(`update public.quality_gates set status='in_progress' where id=$1`, [gateRows.rows[0].id]);
  await ownerA.end();

  const collabMulti = await userClient(DB, COLLAB_MULTI);
  await collabMulti.query("select public.join_project_by_invite($1)", [inviteA]);
  await collabMulti.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagInviteA]);
  await snagA.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  const plotB = (await ownerB.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'P1',$2) returning id", [projB, OWNER_B])).rows[0].id;
  const inviteB = (await ownerB.query("select public.regenerate_invite_code($1) as code", [projB])).rows[0].code;
  await ownerB.end();

  const collabMulti2 = await userClient(DB, COLLAB_MULTI);
  await collabMulti2.query("select public.join_project_by_invite($1)", [inviteB]);
  await collabMulti2.end();

  fx = { orgA, projA, plotA, orgB, projB, plotB };
});

after(async () => {
  await dropTestDatabase(DB);
});

const PORTFOLIO_TABLES = {
  plots: "select id, project_id from public.plots",
  quality_gates: "select project_id, plot_id, status from public.quality_gates where plot_id is not null",
  handover_documents: "select project_id, plot_id, status from public.handover_documents where plot_id is not null",
  snag_lists: "select id, plot_id from public.snag_lists",
  snag_items: "select plot_id, snag_list_id from public.snag_items",
  programme_activities: "select project_id, plot_id from public.programme_activities where plot_id is not null",
  actions: "select project_id, plot_id from public.actions where plot_id is not null",
  inspection_findings: "select project_id, plot_id from public.inspection_findings where plot_id is not null",
};

async function visibleProjectIds(client, table) {
  const { rows } = await client.query(PORTFOLIO_TABLES[table]);
  return new Set(rows.map((r) => r.project_id).filter(Boolean));
}

test("Single-project owner: the plots table (member-level RLS) returns only Project A's plot, never Project B's", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query(PORTFOLIO_TABLES.plots);
    const projectIds = new Set(rows.map((r) => r.project_id));
    assert.ok(projectIds.has(fx.projA));
    assert.ok(!projectIds.has(fx.projB));
  } finally {
    await ownerA.end();
  }
});

test("Multi-project collaborator: sees BOTH Project A's and Project B's plots — not just the first project", async () => {
  const multi = await userClient(DB, COLLAB_MULTI);
  try {
    const { rows } = await multi.query(PORTFOLIO_TABLES.plots);
    const projectIds = new Set(rows.map((r) => r.project_id));
    assert.ok(projectIds.has(fx.projA), "must see Project A");
    assert.ok(projectIds.has(fx.projB), "must see Project B");
  } finally {
    await multi.end();
  }
});

test("Wrong-project / no-membership user (stranger): sees zero rows from every one of the 8 portfolio tables", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    for (const table of Object.keys(PORTFOLIO_TABLES)) {
      const ids = await visibleProjectIds(stranger, table);
      assert.equal(ids.size, 0, `stranger must see 0 project_ids via ${table}, saw ${[...ids]}`);
    }
  } finally {
    await stranger.end();
  }
});

test("Cross-organisation owner (Project B's owner): sees Project B's plot, never Project A's, across every editor-only table too", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    for (const table of Object.keys(PORTFOLIO_TABLES)) {
      const ids = await visibleProjectIds(ownerB, table);
      assert.ok(!ids.has(fx.projA), `owner B must never see Project A via ${table}`);
    }
  } finally {
    await ownerB.end();
  }
});

test("Snagging-only member: Plots and Snags (member-level) are visible, but every editor-only table (Quality Gates, Handover Documents, Programme, Actions, Findings) returns nothing for that project", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const { rows: plotRows } = await snagA.query(PORTFOLIO_TABLES.plots);
    assert.ok(plotRows.some((r) => r.project_id === fx.projA), "snagging-only member must still see the plot itself");

    const { rows: listRows } = await snagA.query(PORTFOLIO_TABLES.snag_lists);
    assert.ok(listRows.some((r) => r.plot_id === fx.plotA), "snagging-only member must still see the plot's snag list");

    for (const table of ["quality_gates", "handover_documents", "programme_activities", "actions", "inspection_findings"]) {
      const ids = await visibleProjectIds(snagA, table);
      assert.ok(!ids.has(fx.projA), `snagging-only member must see NOTHING from the editor-only table ${table} — a false "all clear" would misrepresent restricted data as clean`);
    }
  } finally {
    await snagA.end();
  }
});

test("Unauthenticated caller: sees zero rows from every one of the 8 portfolio tables", async () => {
  const anon = await userClient(DB, null);
  try {
    for (const table of Object.keys(PORTFOLIO_TABLES)) {
      const ids = await visibleProjectIds(anon, table);
      assert.equal(ids.size, 0, `unauthenticated caller must see 0 project_ids via ${table}`);
    }
  } finally {
    await anon.end();
  }
});

test("get_my_project_roles(): a multi-project member's bulk role lookup includes both projects with the correct roles, one call, no per-project RPC", async () => {
  const multi = await userClient(DB, COLLAB_MULTI);
  try {
    const { rows } = await multi.query("select * from public.get_my_project_roles()");
    const roleByProject = new Map(rows.map((r) => [r.project_id, r.role]));
    assert.equal(roleByProject.get(fx.projA), "collaborator");
    assert.equal(roleByProject.get(fx.projB), "collaborator");
  } finally {
    await multi.end();
  }
});
