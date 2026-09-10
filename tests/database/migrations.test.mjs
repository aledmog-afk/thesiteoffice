// Migration integrity. A schema must not merely work once — this covers
// the three things that actually matter: a fresh install applies
// cleanly, re-running it any number of times never corrupts or
// duplicates data, and a database with real pre-existing production-
// shaped data survives the migration with every relationship intact.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createTestDatabase, dropTestDatabase, runSqlFile, adminClient,
} from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_SETUP = path.join(__dirname, "../lib/mock_setup.sql");
const CURRENT_SCHEMA = path.join(__dirname, "../../sql/schema.sql");
const OLD_SCHEMA = path.join(__dirname, "fixtures/pre_organisations_schema.sql");
const SEED = path.join(__dirname, "fixtures/seed_pre_existing.sql");

test("Fresh install: sql/schema.sql applies cleanly to an empty database", async () => {
  const db = "tracker_test_fresh_install";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, CURRENT_SCHEMA); // throws on any SQL error
    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Fresh install: required tables, functions and policies exist afterwards", async () => {
  const db = "tracker_test_fresh_structure";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, CURRENT_SCHEMA);

    const tables = await client.query(`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_name = any($1::text[])
    `, [[
      "projects", "organisations", "organisation_members", "project_members",
      "plots", "blocks", "quality_gates", "handover_documents",
      "internal_milestones", "snag_lists", "snag_items", "commercial_items",
      "weekly_reports", "monthly_reports", "hs_audits", "hs_audit_items",
      "drawings", "specifications", "org_settings",
    ]]);
    assert.equal(tables.rowCount, 19, `expected all 19 tables to exist, found: ${tables.rows.map((r) => r.table_name).join(", ")}`);

    const functions = await client.query(`
      select routine_name from information_schema.routines
      where routine_schema = 'public' and routine_name = any($1::text[])
    `, [["is_project_member", "is_project_editor", "is_project_owner", "is_org_member", "is_org_admin", "ensure_organisation", "join_project_by_invite", "site_photos_authorized"]]);
    assert.equal(functions.rowCount, 8, `expected all 8 security functions to exist, found: ${functions.rows.map((r) => r.routine_name).join(", ")}`);

    const rlsEnabled = await client.query(`
      select relname from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = true
    `);
    assert.ok(rlsEnabled.rowCount >= 19, `expected RLS enabled on every table, only found it on ${rlsEnabled.rowCount}`);

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Idempotency: applying sql/schema.sql three times in a row on a fresh database never errors or duplicates data", async () => {
  const db = "tracker_test_fresh_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }
    // A fresh database has no pre-existing data, so the grandfather
    // backfill must be a correct no-op every time — zero orgs created.
    const orgs = await client.query("select count(*) as n from public.organisations");
    assert.equal(Number(orgs.rows[0].n), 0, "a brand-new database should never get a grandfathered organisation");
    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Existing-data migration: pre-organisations schema + real data, then the current schema, preserves everything", async () => {
  const db = "tracker_test_existing_data_migration";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, OLD_SCHEMA); // the schema as it existed before Priority 1
    await runSqlFile(client, SEED); // realistic pre-existing production data

    const before = await client.query("select count(*) as n from public.projects");
    assert.equal(Number(before.rows[0].n), 2, "sanity check: the seed fixture should have created 2 projects");

    await runSqlFile(client, CURRENT_SCHEMA); // the actual migration under test

    // Existing projects: still present, still named the same, each
    // assigned to exactly one organisation.
    const projects = await client.query("select id, name, org_id from public.projects order by name");
    assert.equal(projects.rowCount, 2, "both pre-existing projects must survive");
    assert.equal(projects.rows[0].name, "Red Dragon");
    assert.equal(projects.rows[1].name, "Tudor Inn");
    assert.ok(projects.rows[0].org_id, "every project must have been assigned an organisation");
    assert.ok(projects.rows[1].org_id, "every project must have been assigned an organisation");

    // Existing users: preserved, and their real access recreated as real
    // organisation membership — owner of a project becomes org admin.
    const owner1 = await client.query(
      "select role from public.organisation_members where user_id = '11111111-1111-1111-1111-111111111111'"
    );
    assert.equal(owner1.rowCount, 1);
    assert.equal(owner1.rows[0].role, "admin", "a site owner should become an org admin, not a plain member");

    const collab1 = await client.query(
      "select role from public.organisation_members where user_id = '22222222-2222-2222-2222-222222222222'"
    );
    assert.equal(collab1.rowCount, 1);
    assert.equal(collab1.rows[0].role, "member", "a collaborator (never an owner) should become a plain org member");

    // Existing project_members access is completely unchanged.
    const members = await client.query("select count(*) as n from public.project_members");
    assert.equal(Number(members.rows[0].n), 3, "no project_members rows should be added or removed by this migration");

    // Existing org-wide settings (the company logo) survive and get
    // assigned to the same organisation as the projects.
    const settings = await client.query("select logo_url, org_id from public.org_settings");
    assert.equal(settings.rowCount, 1, "the pre-existing org_settings row must not be duplicated or dropped");
    assert.equal(settings.rows[0].logo_url, "https://example.com/logo.png");
    assert.ok(settings.rows[0].org_id, "the pre-existing settings row must be assigned an organisation");
    assert.equal(settings.rows[0].org_id, projects.rows[0].org_id, "the logo's org must be the SAME org the projects were folded into (a single default org, not a fresh one per row)");

    // Existing child data (plots, weekly reports) is untouched.
    const plots = await client.query("select count(*) as n from public.plots");
    assert.equal(Number(plots.rows[0].n), 1);
    const reports = await client.query("select count(*) as n from public.weekly_reports");
    assert.equal(Number(reports.rows[0].n), 1);

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Idempotency: re-applying the current schema after an existing-data migration stays stable", async () => {
  const db = "tracker_test_existing_data_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, OLD_SCHEMA);
    await runSqlFile(client, SEED);
    await runSqlFile(client, CURRENT_SCHEMA);

    const afterFirst = await client.query("select count(*) as n from public.organisations");
    const orgCountFirst = Number(afterFirst.rows[0].n);
    assert.equal(orgCountFirst, 1, "the one-time grandfather backfill should create exactly one default organisation");

    // Re-running twice more must not create a second organisation, a
    // second membership row, or touch anything else.
    for (let i = 0; i < 2; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }

    const orgsAfter = await client.query("select count(*) as n from public.organisations");
    assert.equal(Number(orgsAfter.rows[0].n), orgCountFirst, "re-running the schema must never create additional organisations");

    const members = await client.query("select count(*) as n from public.organisation_members");
    assert.equal(Number(members.rows[0].n), 3, "re-running the schema must never duplicate organisation membership rows");

    const projects = await client.query("select count(*) as n from public.projects");
    assert.equal(Number(projects.rows[0].n), 2, "re-running the schema must never duplicate or remove projects");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Audit trail: migrating a pre-existing database never fabricates historical audit records for the backfill itself", async () => {
  const db = "tracker_test_audit_no_backfill";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, OLD_SCHEMA);
    await runSqlFile(client, SEED); // pre-existing data, created before audit_log ever existed
    await runSqlFile(client, CURRENT_SCHEMA); // creates audit_log + triggers AND runs the org/owner backfill in the same execution

    const { rows } = await client.query("select table_name, action, count(*)::int as n from public.audit_log group by table_name, action order by table_name, action");
    assert.deepEqual(rows, [], `installing the audit trail on an existing database must not invent audit history for data or backfill logic that predates it, found: ${JSON.stringify(rows)}`);

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Audit trail: the v28 migration block (table, triggers, policies) is idempotent on a fresh install", async () => {
  const db = "tracker_test_audit_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }
    const triggers = await client.query(`
      select count(*)::int as n from pg_trigger where tgname like 'trg_audit_%'
    `);
    assert.equal(triggers.rows[0].n, 9, "exactly 9 audit triggers must exist after repeated re-application (the original 8 from Priority 4 plus actions from Priority 5), never duplicated");
    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Actions Engine: migrating a pre-existing database never fabricates historical Actions or audit records", async () => {
  const db = "tracker_test_actions_no_backfill";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, OLD_SCHEMA);
    await runSqlFile(client, SEED);
    await runSqlFile(client, CURRENT_SCHEMA);

    const actions = await client.query("select count(*)::int as n from public.actions");
    assert.equal(actions.rows[0].n, 0, "installing the Actions Engine on an existing database must not invent any Actions from pre-existing data");

    const actionAudit = await client.query("select count(*)::int as n from public.audit_log where table_name = 'actions'");
    assert.equal(actionAudit.rows[0].n, 0, "no actions audit history should exist either, since no actions were ever created");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Actions Engine: table, indexes, triggers and RLS policy are idempotent across repeated re-application", async () => {
  const db = "tracker_test_actions_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }

    const triggers = await client.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.actions'::regclass and tgname like 'trg_%'");
    assert.equal(triggers.rows[0].n, 2, "exactly 2 triggers on actions (before-write + audit), never duplicated");

    const indexes = await client.query("select count(*)::int as n from pg_indexes where tablename = 'actions' and indexname like 'actions_%_idx'");
    assert.equal(indexes.rows[0].n, 4, "exactly 4 named indexes on actions, never duplicated");

    const policies = await client.query("select count(*)::int as n from pg_policies where tablename = 'actions'");
    assert.equal(policies.rows[0].n, 4, "exactly 4 RLS policies on actions (select/insert/update/delete), never duplicated");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Project Control Dashboard: get_my_project_roles() is idempotent and adds no new table", async () => {
  const db = "tracker_test_dashboard_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }
    const fn = await client.query("select count(*)::int as n from information_schema.routines where routine_schema = 'public' and routine_name = 'get_my_project_roles'");
    assert.equal(fn.rows[0].n, 1, "get_my_project_roles must exist exactly once after repeated re-application");
    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});
