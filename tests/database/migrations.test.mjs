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
    assert.equal(triggers.rows[0].n, 13, "exactly 13 audit triggers must exist after repeated re-application (the original 8 from Priority 4, actions from Priority 5, inspections + inspection_findings from Priority 7, documents + document_revisions from Priority 10), never duplicated");
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

test("Inspections: migrating a pre-existing database never fabricates historical inspections, findings, or audit records", async () => {
  const db = "tracker_test_inspections_no_backfill";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, OLD_SCHEMA);
    await runSqlFile(client, SEED);
    await runSqlFile(client, CURRENT_SCHEMA);

    const inspections = await client.query("select count(*)::int as n from public.inspections");
    assert.equal(inspections.rows[0].n, 0, "installing Inspections on an existing database must not invent any inspections from pre-existing data");

    const findings = await client.query("select count(*)::int as n from public.inspection_findings");
    assert.equal(findings.rows[0].n, 0);

    const auditRows = await client.query("select count(*)::int as n from public.audit_log where table_name in ('inspections', 'inspection_findings')");
    assert.equal(auditRows.rows[0].n, 0, "no inspection audit history should exist either, since nothing was ever created");

    // hs_audits/hs_audit_items — a genuinely different, pre-existing
    // mechanism — must be completely untouched by this migration.
    const hsAudits = await client.query("select count(*)::int as n from public.hs_audits");
    assert.equal(hsAudits.rows[0].n, 0, "hs_audits must not gain any rows from the Inspections migration");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Inspections: tables, indexes, triggers and RLS policies are idempotent across repeated re-application", async () => {
  const db = "tracker_test_inspections_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }

    const tables = await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('inspections', 'inspection_findings', 'inspection_finding_photos')");
    assert.equal(tables.rows[0].n, 3);

    const inspectionTriggers = await client.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.inspections'::regclass and tgname like 'trg_%'");
    assert.equal(inspectionTriggers.rows[0].n, 2, "exactly 2 triggers on inspections (before-write + audit), never duplicated");

    const findingTriggers = await client.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.inspection_findings'::regclass and tgname like 'trg_%'");
    assert.equal(findingTriggers.rows[0].n, 2, "exactly 2 triggers on inspection_findings (before-write + audit), never duplicated");

    const inspectionPolicies = await client.query("select count(*)::int as n from pg_policies where tablename = 'inspections'");
    assert.equal(inspectionPolicies.rows[0].n, 4);

    const findingPolicies = await client.query("select count(*)::int as n from pg_policies where tablename = 'inspection_findings'");
    assert.equal(findingPolicies.rows[0].n, 4);

    const photoPolicies = await client.query("select count(*)::int as n from pg_policies where tablename = 'inspection_finding_photos'");
    assert.equal(photoPolicies.rows[0].n, 3, "inspection_finding_photos has select/insert/delete only, no update policy");

    const indexes = await client.query("select count(*)::int as n from pg_indexes where tablename in ('inspections', 'inspection_findings', 'inspection_finding_photos') and indexname like '%_idx'");
    assert.equal(indexes.rows[0].n, 7, "2 on inspections + 4 on inspection_findings + 1 on inspection_finding_photos, never duplicated");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

// ─── Defects / Snagging rationalisation (Priority 8) ────────────────
// snag_items is NOT a new table — it's existed since before Priority 1
// (OLD_SCHEMA below). This migration only ADDS nullable columns, so the
// critical thing to prove is that real pre-existing rows survive with
// every existing field untouched, IDs preserved, and the new columns
// simply null (never fabricated) — the opposite of the Actions/
// Inspections tests above, which prove NO historical rows are invented.

test("Defects / Snagging: existing snag_items rows survive the migration with IDs, fields and photos preserved, and new columns default to null", async () => {
  const db = "tracker_test_snags_existing_data";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, OLD_SCHEMA);
    await runSqlFile(client, SEED);

    // A realistic pre-existing snag, exactly as the old schema (and the
    // real production database) could have recorded one, with a fixed
    // id so it can be re-identified after the migration.
    const snagId = "99999999-0000-0000-0000-000000000001";
    const projectRow = await client.query("select id from public.projects order by name limit 1");
    const projectId = projectRow.rows[0].id;
    await client.query(
      `insert into public.snag_items (id, project_id, item_no, location, description, trade, priority, status, photo_url, raised_date, notes, created_by)
       values ($1,$2,1,'Kitchen','Cracked tile','Tiling','high','open','https://example.com/photo.jpg','2025-01-15','Chase up with tiler','11111111-1111-1111-1111-111111111111')`,
      [snagId, projectId]
    );

    const before = await client.query("select count(*)::int as n from public.snag_items");

    await runSqlFile(client, CURRENT_SCHEMA); // the actual migration under test

    const after = await client.query("select count(*)::int as n from public.snag_items");
    assert.equal(after.rows[0].n, before.rows[0].n, "the migration must not add, remove, or duplicate any snag_items rows");

    const snag = await client.query("select * from public.snag_items where id = $1", [snagId]);
    assert.equal(snag.rowCount, 1, "the pre-existing snag's id must be preserved exactly");
    assert.equal(snag.rows[0].location, "Kitchen");
    assert.equal(snag.rows[0].description, "Cracked tile");
    assert.equal(snag.rows[0].trade, "Tiling");
    assert.equal(snag.rows[0].priority, "high");
    assert.equal(snag.rows[0].status, "open");
    assert.equal(snag.rows[0].photo_url, "https://example.com/photo.jpg");
    assert.equal(snag.rows[0].notes, "Chase up with tiler");
    assert.equal(snag.rows[0].assigned_to, null, "a pre-existing snag must never be fabricated an assignee");
    assert.equal(snag.rows[0].due_date, null);
    assert.equal(snag.rows[0].action_id, null, "the migration must never invent an Action link for pre-existing snags");
    assert.equal(snag.rows[0].inspection_finding_id, null);
    assert.equal(snag.rows[0].verified_at, null, "a pre-existing closed/open snag must never be fabricated as verified");
    assert.equal(snag.rows[0].verified_by, null);

    // No Actions, audit history, or anything else invented as a side
    // effect of this migration.
    const actions = await client.query("select count(*)::int as n from public.actions");
    assert.equal(actions.rows[0].n, 0, "installing the accountability columns must not invent any Actions from pre-existing snags");
    const snagAudit = await client.query("select count(*)::int as n from public.audit_log where table_name = 'snag_items'");
    assert.equal(snagAudit.rows[0].n, 0, "adding columns to an existing table must not fabricate any audit history for the backfill itself");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Defects / Snagging: new columns, indexes, helper function and trigger are idempotent across repeated re-application", async () => {
  const db = "tracker_test_snags_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }

    const columns = await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'snag_items'
        and column_name = any($1::text[])
    `, [["assigned_to", "due_date", "action_id", "inspection_finding_id", "verified_at", "verified_by"]]);
    assert.equal(columns.rowCount, 6, "all 6 new columns must exist exactly once");

    const indexes = await client.query("select count(*)::int as n from pg_indexes where tablename = 'snag_items' and indexname like 'snag_items_%_idx'");
    assert.equal(indexes.rows[0].n, 4, "exactly 4 new named indexes on snag_items, never duplicated");

    const triggers = await client.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.snag_items'::regclass and tgname like 'trg_%'");
    assert.equal(triggers.rows[0].n, 3, "exactly 3 triggers on snag_items (pre-existing item-numbering + pre-existing audit + the new before-write trigger), never duplicated");

    const fn = await client.query("select count(*)::int as n from information_schema.routines where routine_schema = 'public' and routine_name = 'is_project_member_user'");
    assert.equal(fn.rows[0].n, 1, "is_project_member_user must exist exactly once after repeated re-application");

    // RLS on snag_items is deliberately UNCHANGED by this priority —
    // still member-level, still 4 policies (select/insert/update/delete).
    const policies = await client.query("select count(*)::int as n from pg_policies where tablename = 'snag_items'");
    assert.equal(policies.rows[0].n, 4, "snag_items RLS policy count must be unchanged by this priority");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

// ─── Weekly Reporting (Priority 9) ──────────────────────────────────
// weekly_reports, like snag_items before it, already existed pre-
// migration — this proves a realistic PRE-EXISTING report survives
// with its human-entered content untouched, and is given the correct,
// non-destructive default status ('draft') rather than retroactively
// becoming "issued" or gaining a fabricated system_position.

test("Weekly Reporting: an existing weekly_reports row survives the migration with its content preserved and status defaulted to draft", async () => {
  const db = "tracker_test_weekly_reports_existing_data";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, OLD_SCHEMA);
    await runSqlFile(client, SEED);

    const reportId = "99999999-0000-0000-0000-000000000002";
    const projectRow = await client.query("select id from public.projects order by name limit 1");
    const projectId = projectRow.rows[0].id;
    await client.query(
      `insert into public.weekly_reports (id, project_id, week_starting, week_ending, prepared_by, programme_status, progress_summary, created_by)
       values ($1,$2,'2025-01-13','2025-01-17','Jane Doe','on-track','Frame complete on Plot 3','11111111-1111-1111-1111-111111111111')`,
      [reportId, projectId]
    );

    const before = await client.query("select count(*)::int as n from public.weekly_reports");

    await runSqlFile(client, CURRENT_SCHEMA); // the actual migration under test

    const after = await client.query("select count(*)::int as n from public.weekly_reports");
    assert.equal(after.rows[0].n, before.rows[0].n, "the migration must not add, remove, or duplicate any weekly_reports rows");

    const report = await client.query("select * from public.weekly_reports where id = $1", [reportId]);
    assert.equal(report.rowCount, 1, "the pre-existing report's id must be preserved exactly");
    assert.equal(report.rows[0].prepared_by, "Jane Doe");
    assert.equal(report.rows[0].programme_status, "on-track");
    assert.equal(report.rows[0].progress_summary, "Frame complete on Plot 3");
    assert.equal(report.rows[0].status, "draft", "a pre-existing report must default to draft, never be retroactively marked reviewed/approved/issued");
    assert.deepEqual(report.rows[0].system_position, {}, "a pre-existing report must never be fabricated a system position");
    assert.equal(report.rows[0].position_generated_at, null);

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Weekly Reporting: new columns, indexes, trigger, and inspection_findings.resolved_at are idempotent across repeated re-application", async () => {
  const db = "tracker_test_weekly_reports_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }

    const columns = await client.query(`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'weekly_reports'
        and column_name = any($1::text[])
    `, [["status", "system_position", "position_generated_at", "updated_at"]]);
    assert.equal(columns.rowCount, 4, "all 4 new columns must exist exactly once");

    const indexes = await client.query("select count(*)::int as n from pg_indexes where tablename = 'weekly_reports' and indexname like 'weekly_reports_%_idx'");
    assert.equal(indexes.rows[0].n, 2, "exactly 2 new named indexes on weekly_reports, never duplicated");

    const triggers = await client.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.weekly_reports'::regclass and tgname like 'trg_%'");
    assert.equal(triggers.rows[0].n, 2, "exactly 2 triggers on weekly_reports (pre-existing audit + the new before-write trigger), never duplicated");

    const fn = await client.query("select count(*)::int as n from information_schema.routines where routine_schema = 'public' and routine_name = 'valid_weekly_report_status_transition'");
    assert.equal(fn.rows[0].n, 1);

    // RLS on weekly_reports is deliberately UNCHANGED by this priority —
    // still editor-only, still 4 policies.
    const policies = await client.query("select count(*)::int as n from pg_policies where tablename = 'weekly_reports'");
    assert.equal(policies.rows[0].n, 4, "weekly_reports RLS policy count must be unchanged by this priority");

    const resolvedAtColumn = await client.query(`
      select count(*)::int as n from information_schema.columns
      where table_schema = 'public' and table_name = 'inspection_findings' and column_name = 'resolved_at'
    `);
    assert.equal(resolvedAtColumn.rows[0].n, 1, "inspection_findings.resolved_at must exist exactly once");

    const findingTriggers = await client.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.inspection_findings'::regclass and tgname like 'trg_%'");
    assert.equal(findingTriggers.rows[0].n, 2, "inspection_findings keeps exactly 2 triggers (before-write + audit) — resolved_at reused the existing before-write trigger, no new one added");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

// ─── Document Management foundation (Priority 10) ───────────────────
// drawings/specifications are NOT new — they predate this priority and
// are NOT replaced by it (see sql/schema.sql v34's own comment: their
// ids are load-bearing for pinpoint snagging). What's new is an
// ADDITIVE backfill into documents/document_revisions, run every time
// schema.sql is applied. The critical things to prove: pre-existing
// drawings/specifications rows get backfilled correctly exactly once
// (never duplicated on repeated re-application), the legacy tables and
// their rows are completely untouched by the backfill, and the old
// drawing_id foreign keys (snag_items, quality_gates) keep working
// afterwards.

test("Document Management: pre-existing drawings/specifications rows are backfilled into documents/document_revisions correctly", async () => {
  const db = "tracker_test_documents_backfill";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    await runSqlFile(client, CURRENT_SCHEMA); // creates drawings/specifications/documents tables; backfill no-ops (nothing to migrate yet)

    const orgId = (await client.query("insert into public.organisations (name) values ('Backfill Org') returning id")).rows[0].id;
    const userId = "11111111-1111-1111-1111-111111111111";
    await client.query("insert into auth.users (id, email) values ($1, 'legacy@example.com') on conflict (id) do nothing", [userId]);
    const projectId = (await client.query(
      "insert into public.projects (name, org_id, created_by) values ('Legacy Site', $1, $2) returning id",
      [orgId, userId]
    )).rows[0].id;

    const drawingId = (await client.query(
      `insert into public.drawings (project_id, plot_number, drawing_name, drawing_url, created_by, created_at)
       values ($1, 'Plot 4', 'Plot 4 Ground Floor', 'https://example.com/storage/v1/object/public/site-photos/drawings/plot4.pdf', $2, '2025-06-01')
       returning id`,
      [projectId, userId]
    )).rows[0].id;
    const specId = (await client.query(
      `insert into public.specifications (project_id, spec_name, spec_url, created_by, created_at)
       values ($1, 'House Type A Spec', 'https://example.com/storage/v1/object/public/site-photos/specifications/typea.pdf', $2, '2025-06-02')
       returning id`,
      [projectId, userId]
    )).rows[0].id;

    // Re-applying schema.sql (idempotent, additive) is the actual
    // migration event that discovers and backfills these pre-existing
    // rows — run it 3 times to prove no duplicates ever appear.
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }

    const docs = await client.query("select * from public.documents where project_id = $1 order by document_type", [projectId]);
    assert.equal(docs.rowCount, 2, "exactly one document per legacy row, never duplicated across 3 re-applications");

    const drawingDoc = docs.rows.find((d) => d.document_type === "drawing");
    assert.equal(drawingDoc.title, "Plot 4 Ground Floor");
    assert.equal(drawingDoc.doc_number, "Plot 4", "the drawing's plot_number is carried over as the backfilled document's doc_number");
    assert.equal(drawingDoc.status, "current");
    assert.ok(drawingDoc.current_revision_id, "the backfilled document must have a current revision set");

    const specDoc = docs.rows.find((d) => d.document_type === "specification");
    assert.equal(specDoc.title, "House Type A Spec");
    assert.equal(specDoc.doc_number, null);

    const drawingRev = (await client.query("select * from public.document_revisions where id = $1", [drawingDoc.current_revision_id])).rows[0];
    assert.equal(drawingRev.storage_bucket, "site-photos", "a migrated legacy file must keep pointing at its real, already-public site-photos object, never be silently re-hosted");
    assert.equal(drawingRev.file_url, "https://example.com/storage/v1/object/public/site-photos/drawings/plot4.pdf", "the original drawing_url must be preserved byte-for-byte, unchanged");
    assert.equal(drawingRev.revision_number, 1);

    // The legacy tables themselves must be completely untouched —
    // this is an additive backfill, not a cutover.
    const drawingsCount = await client.query("select count(*)::int as n from public.drawings where project_id = $1", [projectId]);
    assert.equal(drawingsCount.rows[0].n, 1, "the original drawings row must still exist, untouched");
    const specsCount = await client.query("select count(*)::int as n from public.specifications where project_id = $1", [projectId]);
    assert.equal(specsCount.rows[0].n, 1, "the original specifications row must still exist, untouched");

    // The old drawing_id foreign keys (pinpoint snagging) must still
    // work exactly as before — this priority must not have broken them.
    const plotId = (await client.query("insert into public.plots (project_id, plot_number) values ($1, 'Plot 4') returning id", [projectId])).rows[0].id;
    const listId = (await client.query("select id from public.snag_lists where plot_id = $1", [plotId])).rows[0].id;
    await assert.doesNotReject(
      client.query("insert into public.snag_items (project_id, snag_list_id, location, description, drawing_id) values ($1,$2,'Loc','Issue',$3)", [projectId, listId, drawingId]),
      "snag_items.drawing_id must still accept the legacy drawings.id after this migration"
    );
    await assert.doesNotReject(
      client.query("update public.quality_gates set drawing_id = $1 where plot_id = $2", [drawingId, plotId]),
      "quality_gates.drawing_id must still accept the legacy drawings.id after this migration"
    );

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("Document Management: tables, indexes, triggers, RLS policies and the storage bucket are idempotent across repeated re-application", async () => {
  const db = "tracker_test_documents_idempotent";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await runSqlFile(client, MOCK_SETUP);
    for (let i = 0; i < 3; i++) {
      await runSqlFile(client, CURRENT_SCHEMA);
    }

    const tables = await client.query("select count(*)::int as n from information_schema.tables where table_schema = 'public' and table_name in ('documents', 'document_revisions')");
    assert.equal(tables.rows[0].n, 2);

    const docTriggers = await client.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.documents'::regclass and tgname like 'trg_%'");
    assert.equal(docTriggers.rows[0].n, 2, "exactly 2 triggers on documents (before-write + audit), never duplicated");

    const revTriggers = await client.query("select count(*)::int as n from pg_trigger where tgrelid = 'public.document_revisions'::regclass and tgname like 'trg_%'");
    assert.equal(revTriggers.rows[0].n, 3, "exactly 3 triggers on document_revisions (before-insert + after-insert + audit), never duplicated");

    const docPolicies = await client.query("select count(*)::int as n from pg_policies where tablename = 'documents'");
    assert.equal(docPolicies.rows[0].n, 3, "documents has select/insert/update only, no delete policy");

    const revPolicies = await client.query("select count(*)::int as n from pg_policies where tablename = 'document_revisions'");
    assert.equal(revPolicies.rows[0].n, 2, "document_revisions has select/insert only — no update, no delete");

    const indexes = await client.query("select count(*)::int as n from pg_indexes where tablename in ('documents', 'document_revisions') and indexname like '%_idx'");
    assert.equal(indexes.rows[0].n, 5, "3 on documents + 2 on document_revisions, never duplicated");

    const bucket = await client.query("select count(*)::int as n from storage.buckets where id = 'controlled-documents'");
    assert.equal(bucket.rows[0].n, 1, "the controlled-documents bucket must exist exactly once, never duplicated");

    const storagePolicies = await client.query("select count(*)::int as n from pg_policies where tablename = 'objects' and schemaname = 'storage' and policyname like '%controlled-documents%'");
    assert.equal(storagePolicies.rows[0].n, 2, "exactly 2 storage policies for controlled-documents (read + write), never duplicated");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});
