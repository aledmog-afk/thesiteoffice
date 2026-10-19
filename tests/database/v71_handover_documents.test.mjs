// v71: Handover document-set fixes (house EPC, split elec/gas certs,
// FENSA/CERTASS, block lift certificate, EWS1 behind a needs_ews1
// flag) plus the backfill for plots/blocks that already existed.
// Covers: the corrected set on freshly-created plots/blocks, the
// EWS1 flag's insert-time and update-time behaviour (and that turning
// it back off never removes the document), and — the part most likely
// to go wrong — that the backfill against a pre-v71 database adds the
// new rows without disturbing any status or file already recorded on
// the legacy combined document, and is a no-op the second time it runs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, runSqlFile, runSql, setupSchema, adminClient } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = path.join(__dirname, "../../sql/schema.sql");
const FULL = fs.readFileSync(SCHEMA, "utf8");
const V71_MARKER = "-- v71 ADDITIONS: Handover document-set fixes";
const PRE_V71 = FULL.slice(0, FULL.indexOf(V71_MARKER));
const V71_AND_LATER = FULL.slice(FULL.indexOf(V71_MARKER));
const ROLLBACK = fs.readFileSync(path.join(__dirname, "../../sql/rollback/v71_handover_document_set_rollback.sql"), "utf8");

assert.ok(PRE_V71.length > 0 && !PRE_V71.includes("v71 ADDITIONS"), "sanity: the pre-v71 slice must not contain v71 itself");

async function seedProjectWithPlotAndBlock(client) {
  const { rows: [org] } = await client.query(`insert into public.organisations (name) values ('Test Org') returning id`);
  const { rows: [project] } = await client.query(`insert into public.projects (name, org_id) values ('P', $1) returning id`, [org.id]);
  const { rows: [house] } = await client.query(`insert into public.plots (project_id, plot_number) values ($1, 'H1') returning id`, [project.id]);
  const { rows: [block] } = await client.query(`insert into public.blocks (project_id, block_name) values ($1, 'Block A') returning id`, [project.id]);
  const { rows: [flat] } = await client.query(`insert into public.plots (project_id, block_id, plot_number) values ($1, $2, 'F1') returning id`, [project.id, block.id]);
  return { project, house, block, flat };
}

async function docKeys(client, column, id) {
  const { rows } = await client.query(`select doc_key from public.handover_documents where ${column} = $1 order by doc_key`, [id]);
  return rows.map((r) => r.doc_key);
}

test("v71: a fresh house plot gets exactly the corrected 8-document set", async () => {
  const db = "tracker_test_v71_fresh_house";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db);
    const { house } = await seedProjectWithPlotAndBlock(client);
    const keys = await docKeys(client, "plot_id", house.id);
    assert.deepEqual(
      keys,
      ["air_acoustic_test", "building_control", "elec_cert", "epc", "fensa_certass", "gas_cert", "om_manuals", "warranty_cover_note"].sort(),
      "house doc set must be exactly these 8 keys, no elec_gas_certs"
    );
    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("v71: a fresh flat gets the corrected 7-document set", async () => {
  const db = "tracker_test_v71_fresh_flat";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db);
    const { flat } = await seedProjectWithPlotAndBlock(client);
    const keys = await docKeys(client, "plot_id", flat.id);
    assert.deepEqual(
      keys,
      ["flat_air_acoustic_test", "flat_elec_cert", "flat_epc", "flat_fensa_certass", "flat_gas_cert", "flat_om_manuals", "flat_warranty"].sort(),
      "flat doc set must be exactly these 7 keys, no flat_elec_gas_certs"
    );
    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("v71: a fresh block gets block_lift_cert but not block_ews1 unless needs_ews1 was set", async () => {
  const db = "tracker_test_v71_fresh_block";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db);
    const { block } = await seedProjectWithPlotAndBlock(client);
    const keys = await docKeys(client, "block_id", block.id);
    assert.ok(keys.includes("block_lift_cert"), "block_lift_cert must always be seeded");
    assert.ok(!keys.includes("block_ews1"), "block_ews1 must not appear when needs_ews1 is false");
    assert.equal(keys.length, 6, "6 block documents: the original 5 plus block_lift_cert");
    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("v71: a block created with needs_ews1=true gets block_ews1 immediately", async () => {
  const db = "tracker_test_v71_block_ews1_at_creation";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db);
    const { rows: [org] } = await client.query(`insert into public.organisations (name) values ('O') returning id`);
    const { rows: [project] } = await client.query(`insert into public.projects (name, org_id) values ('P', $1) returning id`, [org.id]);
    const { rows: [block] } = await client.query(`insert into public.blocks (project_id, block_name, needs_ews1) values ($1, 'B', true) returning id`, [project.id]);
    const keys = await docKeys(client, "block_id", block.id);
    assert.ok(keys.includes("block_ews1"), "block_ews1 must be seeded at creation when needs_ews1 was true up front");
    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("v71: toggling needs_ews1 on later adds block_ews1; toggling it back off never removes it", async () => {
  const db = "tracker_test_v71_block_ews1_toggle";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db);
    const { block } = await seedProjectWithPlotAndBlock(client);
    assert.ok(!(await docKeys(client, "block_id", block.id)).includes("block_ews1"), "sanity: not seeded yet");

    await client.query(`update public.blocks set needs_ews1 = true where id = $1`, [block.id]);
    assert.ok((await docKeys(client, "block_id", block.id)).includes("block_ews1"), "toggling on must seed block_ews1");

    await client.query(`update public.blocks set needs_ews1 = false where id = $1`, [block.id]);
    assert.ok((await docKeys(client, "block_id", block.id)).includes("block_ews1"), "toggling back off must NOT remove the already-created document");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("v71 backfill: preserves an existing (pre-v71) legacy document's status and file, adds the new split/EPC/FENSA rows, relabels the legacy title, and is a no-op run twice", async () => {
  const db = "tracker_test_v71_backfill";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    // Build the database exactly as it was just before v71: mock auth
    // environment, then every schema statement up to (not including)
    // the v71 block.
    const mockSetup = fs.readFileSync(path.join(__dirname, "../lib/mock_setup.sql"), "utf8");
    await runSql(client, mockSetup);
    await runSql(client, PRE_V71);
    const legacyShim = fs.readFileSync(path.join(__dirname, "../lib/legacy_invite_shim.sql"), "utf8");
    await runSql(client, legacyShim);

    const { house, flat, block } = await seedProjectWithPlotAndBlock(client);

    // Simulate real pre-v71 usage: the legacy combined document has
    // already been uploaded and approved on the house plot.
    const { rows: [legacyDoc] } = await client.query(
      `select id, status, file_url, file_name from public.handover_documents where plot_id = $1 and doc_key = 'elec_gas_certs'`,
      [house.id]
    );
    assert.ok(legacyDoc, "sanity: pre-v71 schema must have seeded the combined elec_gas_certs row");
    await client.query(
      `update public.handover_documents set status = 'approved_final', file_url = 'https://example.test/cert.pdf', file_name = 'cert.pdf' where id = $1`,
      [legacyDoc.id]
    );

    const preKeys = (await docKeys(client, "plot_id", house.id)).sort();
    assert.deepEqual(preKeys, ["air_acoustic_test", "building_control", "elec_gas_certs", "om_manuals", "warranty_cover_note"].sort(), "sanity: pre-v71 house set is the original 5");

    // Now apply v71 itself (the migration block plus everything after
    // it in the file, since nothing later depends on this specific
    // ordering in a way that would break the test).
    await runSql(client, V71_AND_LATER);

    // The legacy row: status and file untouched, title now says legacy.
    const { rows: [afterLegacy] } = await client.query(`select status, file_url, file_name, title from public.handover_documents where id = $1`, [legacyDoc.id]);
    assert.equal(afterLegacy.status, "approved_final", "legacy document's status must survive the backfill untouched");
    assert.equal(afterLegacy.file_url, "https://example.test/cert.pdf", "legacy document's file_url must survive untouched");
    assert.equal(afterLegacy.file_name, "cert.pdf", "legacy document's file_name must survive untouched");
    assert.match(afterLegacy.title, /legacy combined/, "legacy document's title must be relabelled to say so");

    // The new rows exist, start empty (missing, no file).
    const afterKeys = (await docKeys(client, "plot_id", house.id)).sort();
    assert.deepEqual(
      afterKeys,
      ["air_acoustic_test", "building_control", "elec_cert", "elec_gas_certs", "epc", "fensa_certass", "gas_cert", "om_manuals", "warranty_cover_note"].sort(),
      "house plot must end up with the 4 original (minus nothing removed) plus elec_cert/gas_cert/fensa_certass/epc — 9 rows total, nothing deleted"
    );
    const { rows: [newCert] } = await client.query(`select status, file_url from public.handover_documents where plot_id = $1 and doc_key = 'elec_cert'`, [house.id]);
    assert.equal(newCert.status, "missing");
    assert.equal(newCert.file_url, null);

    // Flat and block backfills too.
    const flatKeys = (await docKeys(client, "plot_id", flat.id)).sort();
    assert.ok(flatKeys.includes("flat_elec_cert") && flatKeys.includes("flat_gas_cert") && flatKeys.includes("flat_fensa_certass"));
    const blockKeys = (await docKeys(client, "block_id", block.id)).sort();
    assert.ok(blockKeys.includes("block_lift_cert"));

    const countBefore = (await client.query(`select count(*)::int as n from public.handover_documents`)).rows[0].n;
    await runSql(client, V71_AND_LATER); // re-running must change nothing
    const countAfter = (await client.query(`select count(*)::int as n from public.handover_documents`)).rows[0].n;
    assert.equal(countAfter, countBefore, "running the v71 block a second time must be a no-op");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});

test("v71 rollback: restores the pre-v71 seeding behaviour without deleting anything v71 created", async () => {
  const db = "tracker_test_v71_rollback";
  await createTestDatabase(db);
  try {
    const client = adminClient(db);
    await client.connect();
    await setupSchema(db); // full current schema, including v71

    const { house, block } = await seedProjectWithPlotAndBlock(client);
    const beforeRollbackKeys = (await docKeys(client, "plot_id", house.id)).sort();
    const beforeRollbackCount = (await client.query(`select count(*)::int as n from public.handover_documents`)).rows[0].n;

    await runSql(client, ROLLBACK);

    // Existing data untouched: same rows, same count.
    const afterRollbackKeys = (await docKeys(client, "plot_id", house.id)).sort();
    assert.deepEqual(afterRollbackKeys, beforeRollbackKeys, "rollback must not delete any document already created by v71");
    const afterRollbackCount = (await client.query(`select count(*)::int as n from public.handover_documents`)).rows[0].n;
    assert.equal(afterRollbackCount, beforeRollbackCount, "rollback must not delete any row anywhere");

    // But NEW plots/blocks now get the pre-v71 (original) set again.
    const { house: house2, block: block2 } = await seedProjectWithPlotAndBlock(client);
    const newHouseKeys = (await docKeys(client, "plot_id", house2.id)).sort();
    assert.deepEqual(newHouseKeys, ["air_acoustic_test", "building_control", "elec_gas_certs", "om_manuals", "warranty_cover_note"].sort(), "after rollback, a NEW house plot must get the original 5-document set again");
    const newBlockKeys = (await docKeys(client, "block_id", block2.id)).sort();
    assert.ok(!newBlockKeys.includes("block_lift_cert"), "after rollback, a NEW block must not get block_lift_cert");

    await client.end();
  } finally {
    await dropTestDatabase(db);
  }
});
