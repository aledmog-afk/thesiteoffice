// Project Control Dashboard (Priority 6) — real database, real
// non-superuser `authenticated` role. The dashboard's own query shape is
// deliberately UNFILTERED by project_id (see getPortfolioControlSummary()
// in tracker/js/app.js) — it relies entirely on each table's existing
// RLS to return only rows the caller can already see, the same pattern
// dashboard.html already used for snag_items before this priority. This
// file proves that shape genuinely can't leak another org's or
// project's rows, or counts derived from them, through this broader
// (no `eq("project_id", ...)`) query — every prior security suite in
// this repo always filtered by project_id explicitly, so this is a
// distinct query shape worth its own adversarial proof.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_dashboard";

const OWNER_A = "a1000000-0000-0000-0000-000000000001";
const COLLAB_A = "a2000000-0000-0000-0000-000000000002";
const SNAG_A = "a3000000-0000-0000-0000-000000000003";
const OWNER_B = "b1000000-0000-0000-0000-000000000001";
const STRANGER = "c1000000-0000-0000-0000-000000000001";

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

  // Org A: Project A1 (owner + collaborator + snagging-only) and A2
  // (owner only, same org) — A2 proves cross-project isolation within
  // the same organisation even under an unfiltered dashboard query.
  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA1 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A1', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const projA2 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A2', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const inviteCode = (await ownerA.query("select public.regenerate_invite_code($1) as code", [projA1])).rows[0].code;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA1])).rows[0].code;
  // Seed actions and an H&S audit item on both A1 and A2.
  await ownerA.query("insert into public.actions (project_id, title, status, priority, due_date) values ($1,'A1 overdue','open','critical','2020-01-01')", [projA1]);
  await ownerA.query("insert into public.actions (project_id, title, status) values ($1,'A2 open','open')", [projA2]);
  const auditA2 = await ownerA.query("insert into public.hs_audits (project_id, audit_type, month) values ($1,'internal','2026-09-01') returning id", [projA2]);
  await ownerA.query(
    "insert into public.hs_audit_items (audit_id, project_id, section, item_name, status, severity) values ($1,$2,'General','Bad scaffold','non_compliant','high')",
    [auditA2.rows[0].id, projA2]
  );
  await ownerA.end();

  const collabA = await userClient(DB, COLLAB_A);
  await collabA.query("select public.join_project_by_invite($1)", [inviteCode]);
  await collabA.end();

  const snagA = await userClient(DB, SNAG_A);
  await snagA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagA.end();

  // Org B: fully separate, with its own actions/hs data.
  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  await ownerB.query("insert into public.actions (project_id, title, status, priority) values ($1,'B critical','open','critical')", [projB]);
  const auditB = await ownerB.query("insert into public.hs_audits (project_id, audit_type, month) values ($1,'internal','2026-09-01') returning id", [projB]);
  await ownerB.query(
    "insert into public.hs_audit_items (audit_id, project_id, section, item_name, status, severity) values ($1,$2,'General','B issue','non_compliant','high')",
    [auditB.rows[0].id, projB]
  );
  await ownerB.end();

  fx = { orgA, projA1, projA2, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("Dashboard query shape: an unfiltered actions select never returns another organisation's rows", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query("select project_id, title from public.actions");
    assert.ok(rows.length >= 2, "sanity check: Org A's own actions should be present");
    assert.ok(rows.every((r) => r.project_id === fx.projA1 || r.project_id === fx.projA2), "no row from Org B's project must ever appear in an unfiltered select as Org A");
    assert.ok(!rows.some((r) => r.title === "B critical"), "Org B's action title must never leak through");
  } finally {
    await ownerA.end();
  }
});

test("Dashboard query shape: an unfiltered hs_audit_items select never returns another organisation's rows", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query("select project_id, item_name from public.hs_audit_items");
    assert.ok(rows.length >= 1);
    assert.ok(!rows.some((r) => r.item_name === "B issue"), "Org B's H&S item must never leak through an unfiltered select");
  } finally {
    await ownerA.end();
  }
});

test("Dashboard query shape: cross-project isolation holds even without an explicit project_id filter", async () => {
  // COLLAB_A is an editor on A1 but has no membership on A2 at all —
  // an unfiltered select must still only ever return A1's rows.
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const { rows } = await collabA.query("select project_id from public.actions");
    assert.ok(rows.length >= 1, "sanity check: should see A1's own action");
    assert.ok(rows.every((r) => r.project_id === fx.projA1), "a project A1 editor must never see project A2's rows via the same-org, unfiltered dashboard query shape");
  } finally {
    await collabA.end();
  }
});

test("Dashboard query shape: a snagging-only member's unfiltered actions/hs_audit_items selects return zero rows (not fewer — none)", async () => {
  const snagA = await userClient(DB, SNAG_A);
  try {
    const actions = await snagA.query("select 1 from public.actions");
    assert.equal(actions.rowCount, 0, "Actions is editor-only — a snagging-only member's dashboard must compute from zero rows, not partial/leaked ones");
    const hs = await snagA.query("select 1 from public.hs_audit_items");
    assert.equal(hs.rowCount, 0);
  } finally {
    await snagA.end();
  }
});

test("Dashboard query shape: a stranger with no membership anywhere sees zero rows from every source table", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    const actions = await stranger.query("select 1 from public.actions");
    assert.equal(actions.rowCount, 0);
    const projects = await stranger.query("select 1 from public.projects");
    assert.equal(projects.rowCount, 0);
  } finally {
    await stranger.end();
  }
});

test("Aggregate counts cannot leak inaccessible records: a count(*) grouped by project_id excludes Org B entirely", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query("select project_id, count(*)::int as n from public.actions group by project_id order by project_id");
    const projectIds = rows.map((r) => r.project_id);
    assert.ok(!projectIds.includes(fx.projB), "Org B's project must never appear in an aggregate grouped by project_id, proving counts can't be used to infer its existence or size");
  } finally {
    await ownerA.end();
  }
});

test("get_project_members (used to resolve assignee emails on the dashboard) stays editor-gated across organisations", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rows } = await ownerB.query("select * from public.get_project_members($1)", [fx.projA1]);
    assert.equal(rows.length, 0, "Org B must not be able to resolve Org A's member emails via the same RPC the dashboard uses");
  } finally {
    await ownerB.end();
  }
});
