// Audit trail (Priority 4) — same real-database-as-authenticated-user
// approach as org_isolation.test.mjs: every assertion here runs against
// the actual audit_log RLS policy and the actual write_audit_log()
// trigger, never a mock standing in for either.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_audit_log";

const OWNER_A = "a1000000-0000-0000-0000-000000000001";
const SNAGGER_A = "a2000000-0000-0000-0000-000000000002";
const OWNER_B = "b1000000-0000-0000-0000-000000000001";
const STRANGER = "c1000000-0000-0000-0000-000000000001";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'snaggera@example.com'), ($3,'ownerb@example.com'), ($4,'stranger@example.com')`,
    [OWNER_A, SNAGGER_A, OWNER_B, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query(
    "insert into public.projects (name, org_id, created_by) values ('Org A Site', $1, $2) returning id",
    [orgA, OWNER_A]
  )).rows[0].id;
  const plotA = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id", [projA])).rows[0].id;
  const snagCode = (await ownerA.query("select public.regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  await ownerA.end();

  const snaggerA = await userClient(DB, SNAGGER_A);
  await snaggerA.query("select public.join_project_by_invite($1)", [snagCode]);
  await snaggerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query(
    "insert into public.projects (name, org_id, created_by) values ('Org B Site', $1, $2) returning id",
    [orgB, OWNER_B]
  )).rows[0].id;
  await ownerB.end();

  const admin2 = adminClient(DB);
  await admin2.connect();
  const gateRow = await admin2.query("select id from public.quality_gates where project_id = $1 limit 1", [projA]);
  const gate = gateRow.rows[0].id;
  const snagListRow = await admin2.query("select id from public.snag_lists where plot_id = $1", [plotA]);
  const snagList = snagListRow.rows[0].id;
  await admin2.end();

  fx = { orgA, projA, plotA, gate, snagList, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("INSERT: a new commercial_items row produces an audit_log row with old_data null and new_data matching", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const item = await ownerA.query(
      "insert into public.commercial_items (project_id, title, type) values ($1,'EW-1','early_warning') returning id",
      [fx.projA]
    );
    const itemId = item.rows[0].id;

    const { rows } = await ownerA.query(
      "select action, table_name, old_data, new_data, project_id, org_id, user_id from public.audit_log where table_name = 'commercial_items' and record_id = $1",
      [itemId]
    );
    assert.equal(rows.length, 1, "exactly one audit row for the insert");
    assert.equal(rows[0].action, "INSERT");
    assert.equal(rows[0].old_data, null, "INSERT must not record an old_data value");
    assert.equal(rows[0].new_data.title, "EW-1");
    assert.equal(rows[0].new_data.type, "early_warning");
    assert.equal(rows[0].project_id, fx.projA);
    assert.equal(rows[0].org_id, fx.orgA);
    assert.equal(rows[0].user_id, OWNER_A, "actor must be the real authenticated user, not client-supplied");
  } finally {
    await ownerA.end();
  }
});

test("UPDATE: changing a quality_gate's status produces an audit_log row with both old_data and new_data reflecting the real change", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await ownerA.query("update public.quality_gates set status = 'in_progress' where id = $1", [fx.gate]);

    const { rows } = await ownerA.query(
      "select action, old_data, new_data from public.audit_log where table_name = 'quality_gates' and record_id = $1 order by created_at desc limit 1",
      [fx.gate]
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, "UPDATE");
    assert.equal(rows[0].old_data.status, "not_started", "old_data must reflect the value before the change");
    assert.equal(rows[0].new_data.status, "in_progress", "new_data must reflect the value after the change");
  } finally {
    await ownerA.end();
  }
});

test("DELETE: removing a snag_item produces an audit_log row with new_data null and old_data preserving the deleted row", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const item = await ownerA.query(
      "insert into public.snag_items (project_id, snag_list_id, description) values ($1,$2,'Cracked tile') returning id",
      [fx.projA, fx.snagList]
    );
    const itemId = item.rows[0].id;
    await ownerA.query("delete from public.snag_items where id = $1", [itemId]);

    const { rows } = await ownerA.query(
      "select action, old_data, new_data from public.audit_log where table_name = 'snag_items' and record_id = $1 order by created_at",
      [itemId]
    );
    assert.equal(rows.length, 2, "one row for the insert, one for the delete");
    assert.equal(rows[1].action, "DELETE");
    assert.equal(rows[1].new_data, null, "DELETE must not record a new_data value");
    assert.equal(rows[1].old_data.description, "Cracked tile", "old_data must preserve the deleted row's content");
  } finally {
    await ownerA.end();
  }
});

test("Multiple changes to the same record are recorded in chronological order", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    // Note: earlier fixture setup (regenerate_snagging_invite_code) also
    // performs a real UPDATE on this same project row — genuinely
    // audited, as it should be — so this asserts only on the rows this
    // test itself adds, not the table's full history.
    const before = await ownerA.query("select count(*)::int as n from public.audit_log where table_name = 'projects' and record_id = $1", [fx.projA]);

    await ownerA.query("update public.projects set name = 'Renamed Once' where id = $1", [fx.projA]);
    await ownerA.query("update public.projects set name = 'Renamed Twice' where id = $1", [fx.projA]);
    await ownerA.query("update public.projects set name = 'Renamed Thrice' where id = $1", [fx.projA]);

    const { rows } = await ownerA.query(
      "select new_data->>'name' as name, created_at from public.audit_log where table_name = 'projects' and record_id = $1 order by created_at offset $2",
      [fx.projA, before.rows[0].n]
    );
    const names = rows.map((r) => r.name);
    assert.deepEqual(names, ["Renamed Once", "Renamed Twice", "Renamed Thrice"], "each successive name change must appear in the order it actually happened");
  } finally {
    await ownerA.end();
  }
});

test("Bulk operation: a single multi-row UPDATE produces one audit row per affected row, not a runaway or missing rows", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const extraGates = await admin.query(
    "select id from public.quality_gates where project_id = $1",
    [fx.projA]
  );
  await admin.end();
  const totalGates = extraGates.rows.length;
  assert.ok(totalGates > 1, "sanity check: a plot seeds more than one quality gate");

  const ownerA = await userClient(DB, OWNER_A);
  try {
    const before = await ownerA.query(
      "select count(*)::int as n from public.audit_log where table_name = 'quality_gates'"
    );
    await ownerA.query("update public.quality_gates set status = 'under_review' where project_id = $1", [fx.projA]);
    const after = await ownerA.query(
      "select count(*)::int as n from public.audit_log where table_name = 'quality_gates'"
    );
    assert.equal(after.rows[0].n - before.rows[0].n, totalGates, "exactly one audit row per row touched by the bulk UPDATE — no recursion, no missing rows");
  } finally {
    await ownerA.end();
  }
});

test("Cross-org isolation: Organisation A cannot read Organisation B's audit_log rows", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    await ownerB.query("update public.projects set name = 'Org B Renamed' where id = $1", [fx.projB]);
  } finally {
    await ownerB.end();
  }

  const ownerA = await userClient(DB, OWNER_A);
  try {
    const byProject = await ownerA.query("select 1 from public.audit_log where project_id = $1", [fx.projB]);
    assert.equal(byProject.rowCount, 0, "Org A must not see Org B's audit rows even by project_id");
    const byOrg = await ownerA.query("select 1 from public.audit_log where org_id = $1", [fx.orgB]);
    assert.equal(byOrg.rowCount, 0, "Org A must not see Org B's audit rows even by org_id");
    const all = await ownerA.query("select count(*)::int as n from public.audit_log where table_name = 'projects' and record_id = $1", [fx.projB]);
    assert.equal(all.rows[0].n, 0);
  } finally {
    await ownerA.end();
  }
});

test("A stranger with no organisation membership sees zero audit_log rows", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    const { rows } = await stranger.query("select 1 from public.audit_log");
    assert.equal(rows.length, 0, "a user with no membership anywhere must see no audit history at all");
  } finally {
    await stranger.end();
  }
});

test("Audit visibility mirrors the underlying table's own read access: a snagging-only member cannot read quality_gates audit history", async () => {
  const snaggerA = await userClient(DB, SNAGGER_A);
  try {
    const gates = await snaggerA.query("select 1 from public.audit_log where table_name = 'quality_gates' and project_id = $1", [fx.projA]);
    assert.equal(gates.rowCount, 0, "quality_gates is editor-only to read — a snagging-only member must not see its audit history either");
  } finally {
    await snaggerA.end();
  }
});

test("Audit visibility mirrors the underlying table's own read access: a snagging-only member CAN read snag_items audit history (member-level table)", async () => {
  const snaggerA = await userClient(DB, SNAGGER_A);
  try {
    const rows = await snaggerA.query("select 1 from public.audit_log where table_name = 'snag_items' and project_id = $1", [fx.projA]);
    assert.ok(rows.rowCount >= 1, "snag_items is member-level to read — a snagging-only member should see its audit history, matching their existing snag-list access");
  } finally {
    await snaggerA.end();
  }
});

test("Tamper prevention: an ordinary authenticated user cannot INSERT a fabricated audit_log row", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query(
        "insert into public.audit_log (org_id, project_id, user_id, action, table_name, record_id) values ($1,$2,$3,'DELETE','projects',$4)",
        [fx.orgA, fx.projA, OWNER_A, fx.projA]
      ),
      (err) => isRlsError(err),
      "audit_log has no INSERT policy for ordinary clients — only the security-definer trigger function can write to it"
    );
  } finally {
    await ownerA.end();
  }
});

test("Tamper prevention: an ordinary authenticated user cannot UPDATE an existing audit_log row", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const target = await ownerA.query(
      "select id from public.audit_log where table_name = 'projects' and record_id = $1 limit 1",
      [fx.projA]
    );
    assert.ok(target.rowCount >= 1, "sanity check: there is a real audit row to attempt to tamper with");
    const upd = await ownerA.query("update public.audit_log set old_data = '{}'::jsonb where id = $1", [target.rows[0].id]);
    assert.equal(upd.rowCount, 0, "audit_log has no UPDATE policy — the row must be left completely unmodified");
  } finally {
    await ownerA.end();
  }
});

test("Tamper prevention: an ordinary authenticated user cannot DELETE an audit_log row", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const before = await ownerA.query("select count(*)::int as n from public.audit_log where project_id = $1", [fx.projA]);
    const del = await ownerA.query("delete from public.audit_log where project_id = $1", [fx.projA]);
    assert.equal(del.rowCount, 0, "audit_log has no DELETE policy — historical records must be undeletable by any authenticated client");
    const after = await ownerA.query("select count(*)::int as n from public.audit_log where project_id = $1", [fx.projA]);
    assert.equal(after.rows[0].n, before.rows[0].n, "row count must be unchanged");
  } finally {
    await ownerA.end();
  }
});

test("Regression: existing project/plot/quality-gate creation flow still works with audit triggers attached", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const newProj = await ownerA.query(
      "insert into public.projects (name, org_id, created_by) values ('Second Site', $1, $2) returning id",
      [fx.orgA, OWNER_A]
    );
    assert.equal(newProj.rowCount, 1, "creating a second project must still succeed with the audit triggers in place");
    const gates = await ownerA.query("select count(*)::int as n from public.quality_gates where project_id = $1", [newProj.rows[0].id]);
    // No plot created for this project yet, so no gates seeded — this just
    // confirms the insert itself (and its trigger chain) didn't error out.
    assert.equal(gates.rows[0].n, 0);
  } finally {
    await ownerA.end();
  }
});
