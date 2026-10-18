// Toolbox Talks import — runs the REAL scripts/toolbox-talks/import.mjs
// (a child process, not a reimplementation) against a real test
// database, then verifies its result the same way production's own
// import will be verified: every supplied document accounted for,
// titles/source references/content correct, no silent skips, and the
// whole thing idempotent on a second run.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, PG_CONFIG } from "../lib/db.mjs";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const IMPORT_SCRIPT = path.join(REPO_ROOT, "scripts/toolbox-talks/import.mjs");
const MANIFEST_PATH = path.join(REPO_ROOT, "scripts/toolbox-talks/manifest.json");

const DB = "tracker_test_toolbox_talks_import";

function runImport(extraArgs = []) {
  return execFileAsync("node", [IMPORT_SCRIPT, ...extraArgs], {
    cwd: REPO_ROOT,
    env: { ...process.env, PGHOST: PG_CONFIG.host, PGPORT: String(PG_CONFIG.port), PGUSER: PG_CONFIG.user, PGPASSWORD: PG_CONFIG.password, PGDATABASE: DB },
  });
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
});

after(async () => {
  await dropTestDatabase(DB);
});

test("Manifest exists and contains exactly 30 talks (the supplied source library)", () => {
  assert.ok(fs.existsSync(MANIFEST_PATH), "manifest.json must exist — run extract.py against the supplied .docx files first");
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  assert.equal(manifest.length, 30, "expected all 30 supplied Toolbox Talk documents");
  for (const record of manifest) {
    assert.ok(record.source_filename, "every record must retain its source filename");
    assert.ok(record.title, `${record.source_filename}: title must not be empty`);
    assert.ok(record.introduction, `${record.source_filename}: introduction must not be empty`);
    assert.ok(record.key_message, `${record.source_filename}: key_message must not be empty`);
    assert.ok(Array.isArray(record.key_points) && record.key_points.length > 0, `${record.source_filename}: key_points must not be empty`);
    assert.ok(Array.isArray(record.discussion_questions) && record.discussion_questions.length > 0, `${record.source_filename}: discussion_questions must not be empty`);
    assert.ok(Array.isArray(record.key_takeaways) && record.key_takeaways.length > 0, `${record.source_filename}: key_takeaways must not be empty`);
    assert.ok(Array.isArray(record.pre_task_checks) && record.pre_task_checks.length > 0, `${record.source_filename}: pre_task_checks must not be empty`);
    assert.ok(record.site_observations?.good_practice?.length > 0, `${record.source_filename}: good_practice must not be empty`);
    assert.ok(record.site_observations?.warning_signs?.length > 0, `${record.source_filename}: warning_signs must not be empty`);
  }
});

test("Import: running the real script against a fresh database creates all 30 as system templates with a version 1", async () => {
  const { stdout } = await runImport();
  assert.match(stdout, /Created:\s+30/, `expected all 30 to be created on a fresh database, got:\n${stdout}`);
  assert.match(stdout, /Failed:\s+0/);

  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows: countRow } = await admin.query("select count(*)::int as n from public.toolbox_talk_templates where org_id is null");
    assert.equal(countRow[0].n, 30, "exactly 30 system templates must exist");

    const { rows: versionCountRow } = await admin.query(
      `select count(*)::int as n from public.toolbox_talk_template_versions tv
       join public.toolbox_talk_templates t on t.id = tv.template_id
       where t.org_id is null`
    );
    assert.equal(versionCountRow[0].n, 30, "exactly one version per imported template");

    const { rows: sample } = await admin.query(
      "select title, source_filename, current_version_id is not null as has_current from public.toolbox_talk_templates where source_filename = 'TBT-01-WorkingAtHeight.docx'"
    );
    assert.equal(sample.length, 1);
    assert.equal(sample[0].title, "Working at Height");
    assert.ok(sample[0].has_current, "current_version_id must be set after import");

    const { rows: content } = await admin.query(
      `select tv.content from public.toolbox_talk_template_versions tv
       join public.toolbox_talk_templates t on t.id = tv.template_id
       where t.source_filename = 'TBT-01-WorkingAtHeight.docx' and tv.id = t.current_version_id`
    );
    assert.ok(content[0].content.introduction.includes("Falls from height"), "the real extracted introduction text must be present, not a placeholder");
    assert.ok(content[0].content.key_points.some((p) => p.includes("Work at Height Regulations 2005")), "real key points must be present");
  } finally {
    await admin.end();
  }
});

test("Import: is idempotent — re-running with unchanged content creates nothing new", async () => {
  const { stdout } = await runImport();
  assert.match(stdout, /Created:\s+0/);
  assert.match(stdout, /Unchanged \(no-op\):\s+30/, `expected all 30 to be reported unchanged on a repeat run, got:\n${stdout}`);
  assert.match(stdout, /Failed:\s+0/);

  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query("select count(*)::int as n from public.toolbox_talk_templates where org_id is null");
    assert.equal(rows[0].n, 30, "re-running must never create duplicate templates");
    const { rows: versions } = await admin.query(
      `select count(*)::int as n from public.toolbox_talk_template_versions tv
       join public.toolbox_talk_templates t on t.id = tv.template_id where t.org_id is null`
    );
    assert.equal(versions[0].n, 30, "re-running with unchanged content must never add a duplicate version");
  } finally {
    await admin.end();
  }
});

test("Import: every one of the 30 supplied documents is accounted for by source_filename (no silent skips)", async () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query("select source_filename from public.toolbox_talk_templates where org_id is null");
    const imported = new Set(rows.map((r) => r.source_filename));
    for (const record of manifest) {
      assert.ok(imported.has(record.source_filename), `${record.source_filename} from the manifest was not imported into the database`);
    }
    assert.equal(imported.size, manifest.length, "the database must contain exactly the manifest's documents, no more, no fewer");
  } finally {
    await admin.end();
  }
});
