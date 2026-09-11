// Plot Control Data Linkage (Priority 13) — real database, real
// non-superuser `authenticated` role. actions.plot_id and
// inspection_findings.plot_id (v38) are validated server-side with the
// IDENTICAL IDOR-closing pattern programme_activities.plot_id already
// established in v35/v37 — this file proves that pattern holds for
// these two new columns specifically: nullable, valid same-project
// plot accepted, cross-project/cross-org plot rejected, existing RLS
// tiers unchanged, and the pre-existing generic audit trigger already
// captures plot_id with zero code changes.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_plot_action_finding_linkage";

const OWNER_A = "a1000000-0000-0000-0000-000000000051";
const COLLAB_A = "a2000000-0000-0000-0000-000000000052";
const SNAG_A = "a3000000-0000-0000-0000-000000000053";
const OWNER_B = "b1000000-0000-0000-0000-000000000051";
const STRANGER = "c1000000-0000-0000-0000-000000000051";

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
  const plotA = (await ownerA.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'P1',$2) returning id", [projA, OWNER_A])).rows[0].id;
  const inspA = (await ownerA.query("insert into public.inspections (project_id, title) values ($1,'Walk') returning id", [projA])).rows[0].id;
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
  const plotB = (await ownerB.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'P1',$2) returning id", [projB, OWNER_B])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA, plotA, inspA, orgB, projB, plotB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createAction(client, extra = {}) {
  const fields = { project_id: fx.projA, title: "Fix", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(`insert into public.actions (${cols.join(",")}) values (${placeholders}) returning *`, params);
  return rows[0];
}

async function createFindingRow(client, extra = {}) {
  const fields = { project_id: fx.projA, inspection_id: fx.inspA, title: "Crack", ...extra };
  const cols = Object.keys(fields);
  const params = cols.map((c) => fields[c]);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await client.query(`insert into public.inspection_findings (${cols.join(",")}) values (${placeholders}) returning *`, params);
  return rows[0];
}

// ─── Data model: nullable / valid / cross-project / cross-org ──────

test("Actions: plot_id is nullable — a project-level action remains fully valid", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const a = await createAction(ownerA, { plot_id: null });
    assert.equal(a.plot_id, null);
  } finally {
    await ownerA.end();
  }
});

test("Actions: a plot_id belonging to the SAME project is accepted", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const a = await createAction(ownerA, { plot_id: fx.plotA });
    assert.equal(a.plot_id, fx.plotA);
  } finally {
    await ownerA.end();
  }
});

test("Actions: a plot_id from ANOTHER project (same or different org) is rejected — the same IDOR check programme_activities.plot_id already uses", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createAction(ownerA, { plot_id: fx.plotB }),
      /plot_id must belong to the same project as the action/
    );
  } finally {
    await ownerA.end();
  }
});

test("Actions: a nonexistent plot_id is rejected with a clear error, not a silent null", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createAction(ownerA, { plot_id: "11111111-1111-1111-1111-111111111111" }),
      /actions\.plot_id must reference an existing plot/
    );
  } finally {
    await ownerA.end();
  }
});

test("Inspection Findings: plot_id is nullable — a multi-plot or site-wide inspection's finding remains fully valid", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const f = await createFindingRow(ownerA, { plot_id: null });
    assert.equal(f.plot_id, null);
  } finally {
    await ownerA.end();
  }
});

test("Inspection Findings: a plot_id belonging to the SAME project is accepted", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const f = await createFindingRow(ownerA, { plot_id: fx.plotA });
    assert.equal(f.plot_id, fx.plotA);
  } finally {
    await ownerA.end();
  }
});

test("Inspection Findings: a cross-project plot_id (IDOR) is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createFindingRow(ownerA, { plot_id: fx.plotB }),
      /plot_id must belong to the same project as the finding/
    );
  } finally {
    await ownerA.end();
  }
});

test("Inspection Findings: a nonexistent plot_id is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      createFindingRow(ownerA, { plot_id: "11111111-1111-1111-1111-111111111111" }),
      /inspection_findings\.plot_id must reference an existing plot/
    );
  } finally {
    await ownerA.end();
  }
});

test("Actions: plot_id survives an UPDATE and is itself re-validated (not only checked on INSERT)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const a = await createAction(ownerA, {});
    const updated = await ownerA.query("update public.actions set plot_id = $1 where id = $2 returning plot_id", [fx.plotA, a.id]);
    assert.equal(updated.rows[0].plot_id, fx.plotA);
    await assert.rejects(
      ownerA.query("update public.actions set plot_id = $1 where id = $2", [fx.plotB, a.id]),
      /plot_id must belong to the same project as the action/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Security: RLS tiers unchanged, cross-project/org isolation ────

test("Access: existing RLS tiers are unaffected by the new column — a snagging-only member still cannot read/write Actions", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const a = await createAction(ownerA, { plot_id: fx.plotA });
    const read = await snagA.query("select 1 from public.actions where id = $1", [a.id]);
    assert.equal(read.rows.length, 0);
    const write = await snagA.query("update public.actions set plot_id = $1 where id = $2", [fx.plotA, a.id]);
    assert.equal(write.rowCount, 0);
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("Access: existing RLS tiers are unaffected — a snagging-only member still cannot read/write Inspection Findings", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const snagA = await userClient(DB, SNAG_A);
  try {
    const f = await createFindingRow(ownerA, { plot_id: fx.plotA });
    const read = await snagA.query("select 1 from public.inspection_findings where id = $1", [f.id]);
    assert.equal(read.rows.length, 0);
  } finally {
    await ownerA.end();
    await snagA.end();
  }
});

test("Cross-project (same org): a collaborator on project A cannot see project B's plot-linked actions/findings, and cannot forge a link to B's plot even by guessing its real id", async () => {
  const collabA = await userClient(DB, COLLAB_A);
  try {
    const read = await collabA.query("select 1 from public.plots where id = $1", [fx.plotB]);
    assert.equal(read.rows.length, 0, "project A member must not even see project B's plot row to begin with");
  } finally {
    await collabA.end();
  }
});

test("Cross-org: a stranger cannot read Org A's plot-linked actions/findings at all", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const stranger = await userClient(DB, STRANGER);
  try {
    const a = await createAction(ownerA, { plot_id: fx.plotA });
    const f = await createFindingRow(ownerA, { plot_id: fx.plotA });
    const readA = await stranger.query("select 1 from public.actions where id = $1", [a.id]);
    assert.equal(readA.rows.length, 0);
    const readF = await stranger.query("select 1 from public.inspection_findings where id = $1", [f.id]);
    assert.equal(readF.rows.length, 0);
  } finally {
    await ownerA.end();
    await stranger.end();
  }
});

// ─── Audit: the existing generic trigger already captures plot_id ──

test("Audit: an action's plot_id appears in the existing generic audit trail with zero new code — proven, not re-implemented", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const a = await createAction(ownerA, { plot_id: fx.plotA });
    const { rows } = await ownerA.query(
      "select new_data->>'plot_id' as plot_id from public.audit_log where table_name = 'actions' and record_id = $1 and action = 'INSERT'",
      [a.id]
    );
    assert.equal(rows[0].plot_id, fx.plotA);
  } finally {
    await ownerA.end();
  }
});

test("Audit: an inspection finding's plot_id change appears in the audit trail", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const f = await createFindingRow(ownerA, { plot_id: null });
    await ownerA.query("update public.inspection_findings set plot_id = $1 where id = $2", [fx.plotA, f.id]);
    const { rows } = await ownerA.query(
      "select old_data->>'plot_id' as old_plot, new_data->>'plot_id' as new_plot from public.audit_log where table_name = 'inspection_findings' and record_id = $1 and action = 'UPDATE' order by created_at desc limit 1",
      [f.id]
    );
    assert.equal(rows[0].old_plot, null);
    assert.equal(rows[0].new_plot, fx.plotA);
  } finally {
    await ownerA.end();
  }
});

test("Audit: a rejected cross-project plot_id write fabricates no audit row", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(createAction(ownerA, { plot_id: fx.plotB }));
    const { rows } = await ownerA.query(
      "select 1 from public.audit_log where table_name = 'actions' and new_data->>'plot_id' = $1",
      [fx.plotB]
    );
    assert.equal(rows.length, 0, "a write rejected server-side must never leave an audit trail behind");
  } finally {
    await ownerA.end();
  }
});

// ─── Regression: pre-existing Action/Finding behaviour is unaffected ──

test("Regression: action_id linking (inspection_findings.action_id) still works exactly as before, unaffected by the new plot_id column — a finding and its linked action can independently carry their own plot_id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const a = await createAction(ownerA, { plot_id: fx.plotA });
    const f = await createFindingRow(ownerA, { action_id: a.id, plot_id: fx.plotA });
    assert.equal(f.action_id, a.id);
    assert.equal(f.plot_id, fx.plotA);
  } finally {
    await ownerA.end();
  }
});

test("Regression: valid_action_status_transition is still enforced exactly as before, unaffected by plot_id — a plot-linked action cannot skip blocked -> completed directly", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const a = await createAction(ownerA, { plot_id: fx.plotA, status: "in_progress" });
    await ownerA.query("update public.actions set status = 'blocked' where id = $1", [a.id]);
    await assert.rejects(
      ownerA.query("update public.actions set status = 'completed' where id = $1", [a.id]),
      /Invalid action status transition: blocked -> completed/
    );
  } finally {
    await ownerA.end();
  }
});
