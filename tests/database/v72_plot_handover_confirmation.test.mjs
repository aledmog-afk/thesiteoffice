// Handover Part B (v72) — explicit "Mark as Handed Over" confirmation
// event + optional read-only buyer/solicitor share link, mirroring the
// Commercial module's external-approval architecture (v50/v62).
//
// Covers: the confirm_plot_handover() RPC (readiness enforcement is
// delegated to the EXISTING plots_before_write() trigger, not
// duplicated — these tests confirm that delegation actually holds),
// permission boundaries, one-confirmation-per-plot, the snapshot
// content, the share-link lifecycle (create/view/expire/revoke),
// content-hash tamper defense, RLS isolation for both new tables, the
// anon-callable surface, the audit trail, and the rollback script.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient, runSql } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROLLBACK = fs.readFileSync(path.join(__dirname, "../../sql/rollback/v72_plot_handover_confirmation_rollback.sql"), "utf8");

const DB = "tracker_test_v72_handover_confirmation";

const OWNER = "f1000000-0000-0000-0000-000000000001";
const SNAG_ONLY = "f2000000-0000-0000-0000-000000000002";
const OWNER_B = "f3000000-0000-0000-0000-000000000003";
const STRANGER = "f4000000-0000-0000-0000-000000000004";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'v72owner@example.com'), ($2,'v72snag@example.com'), ($3,'v72ownerb@example.com'), ($4,'v72stranger@example.com')`,
    [OWNER, SNAG_ONLY, OWNER_B, STRANGER]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const orgA = (await owner.query("select public.create_organisation('V72 Org', 'main_contractor') as id")).rows[0].id;
  const projA = (await owner.query("insert into public.projects (name, org_id, created_by) values ('V72 Site', $1, $2) returning id", [orgA, OWNER])).rows[0].id;
  const snagCode = (await owner.query("select public.test_regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  await owner.end();

  const snagOnly = await userClient(DB, SNAG_ONLY);
  await snagOnly.query("select public.test_join_project_by_invite($1)", [snagCode]);
  await snagOnly.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.create_organisation('V72 Org B', 'main_contractor') as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('V72 Site B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function makeReadyPlot(client, projectId = fx.projA, plotNumber = `P-${Math.random().toString(36).slice(2, 8)}`) {
  const plot = (await client.query(
    "insert into public.plots (project_id, plot_number, created_by) values ($1,$2,$3) returning id",
    [projectId, plotNumber, OWNER]
  )).rows[0].id;
  // seed_plot_defaults() already created 4 gates + 8 documents + 1 snag
  // list (v71) — approve/complete every blocker predicate so the plot
  // is genuinely ready, exactly mirroring what the real UI flow does
  // before the "Mark as Handed Over" action becomes available.
  await client.query("update public.quality_gates set status = 'approved' where plot_id = $1", [plot]);
  await client.query("update public.handover_documents set status = 'approved_final' where plot_id = $1", [plot]);
  return plot;
}

test("confirm_plot_handover: a fully ready plot can be confirmed — stamps handed_over_at and writes a matching confirmation row", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makeReadyPlot(owner);
    const meters = [{ utility: "electricity", reading: "00123.4", unit: "kWh" }];
    const keys = [{ item: "Front door keys", quantity: 2, held_by: "Site office" }];

    const { rows } = await owner.query(
      "select * from public.confirm_plot_handover($1, $2, $3, $4)",
      [plot, "Site Manager", JSON.stringify(meters), JSON.stringify(keys)]
    );
    const result = rows[0].confirm_plot_handover;
    assert.ok(result.id, "returns the new confirmation id");
    assert.equal(result.signed_by_name, "Site Manager");
    assert.equal(result.signature_data, null, "no drawn signature supplied — typed-name attestation only");
    assert.equal(result.gates_snapshot.length, 4);
    assert.equal(result.documents_snapshot.length, 8);
    assert.ok(result.content_hash && result.content_hash.length === 64, "sha256 hex content_hash");

    const plotRow = await owner.query("select handed_over_at from public.plots where id = $1", [plot]);
    assert.ok(plotRow.rows[0].handed_over_at, "handed_over_at is now set");

    const confRow = await owner.query("select * from public.plot_handover_confirmations where plot_id = $1", [plot]);
    assert.equal(confRow.rowCount, 1);
    assert.equal(confRow.rows[0].meter_readings[0].utility, "electricity");
    assert.equal(confRow.rows[0].key_log[0].item, "Front door keys");
  } finally {
    await owner.end();
  }
});

test("confirm_plot_handover: requires a signer name, and stores a drawn signature image when one is supplied", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plotNoName = await makeReadyPlot(owner);
    await assert.rejects(
      owner.query("select * from public.confirm_plot_handover($1, $2)", [plotNoName, "   "]),
      /confirming user's name is required/i
    );

    const plot = await makeReadyPlot(owner);
    const fakeSignature = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const { rows } = await owner.query(
      "select * from public.confirm_plot_handover($1, $2, $3, $4, $5)",
      [plot, "Jane Site Manager", "[]", "[]", fakeSignature]
    );
    const result = rows[0].confirm_plot_handover;
    assert.equal(result.signed_by_name, "Jane Site Manager");
    assert.equal(result.signature_data, fakeSignature);
    const confRow = await owner.query("select signed_by_name, signature_data from public.plot_handover_confirmations where plot_id = $1", [plot]);
    assert.equal(confRow.rows[0].signed_by_name, "Jane Site Manager");
    assert.equal(confRow.rows[0].signature_data, fakeSignature);
  } finally {
    await owner.end();
  }
});

test("confirm_plot_handover: delegates readiness enforcement to the EXISTING plots_before_write() trigger — an outstanding gate blocks confirmation and writes NO confirmation row", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = (await owner.query(
      "insert into public.plots (project_id, plot_number, created_by) values ($1,'Not ready',$2) returning id",
      [fx.projA, OWNER]
    )).rows[0].id;
    // Leave gates/documents at their default (not_started/missing) —
    // genuinely not ready.
    await assert.rejects(
      owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]),
      /outstanding Quality Gate/i
    );
    const conf = await owner.query("select 1 from public.plot_handover_confirmations where plot_id = $1", [plot]);
    assert.equal(conf.rowCount, 0, "no confirmation row survives a failed confirm attempt");
    const plotRow = await owner.query("select handed_over_at from public.plots where id = $1", [plot]);
    assert.equal(plotRow.rows[0].handed_over_at, null);
  } finally {
    await owner.end();
  }
});

test("confirm_plot_handover: refuses a plot that was already handed over, and refuses a second confirmation for the same plot", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makeReadyPlot(owner);
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    await assert.rejects(owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]), /already/i);
    const conf = await owner.query("select count(*)::int as n from public.plot_handover_confirmations where plot_id = $1", [plot]);
    assert.equal(conf.rows[0].n, 1, "still exactly one confirmation row");
  } finally {
    await owner.end();
  }
});

test("Immutability: handed_over_at still cannot be changed or cleared after confirmation — plots_before_write() (v53) is untouched by this migration", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makeReadyPlot(owner);
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    await assert.rejects(
      owner.query("update public.plots set handed_over_at = now() + interval '1 day' where id = $1", [plot]),
      /historical record and cannot be changed/i
    );
    await assert.rejects(
      owner.query("update public.plots set handed_over_at = null where id = $1", [plot]),
      /historical record and cannot be changed/i
    );
  } finally {
    await owner.end();
  }
});

test("Permission: a snagging-only member cannot confirm handover or create/revoke a share link", async () => {
  const owner = await userClient(DB, OWNER);
  const snagOnly = await userClient(DB, SNAG_ONLY);
  try {
    const plot = await makeReadyPlot(owner, fx.projA);
    await assert.rejects(snagOnly.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]), /do not have permission/i);

    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    await assert.rejects(
      snagOnly.query("select * from public.request_plot_handover_share($1)", [plot]),
      /do not have permission/i
    );

    const { rows } = await owner.query("select * from public.request_plot_handover_share($1)", [plot]);
    const shareId = rows[0].id;
    await assert.rejects(
      snagOnly.query("select public.revoke_plot_handover_share($1)", [shareId]),
      /do not have permission/i
    );
  } finally {
    await owner.end();
    await snagOnly.end();
  }
});

test("request_plot_handover_share: refuses until the plot has a confirmation, then enforces at most one active link per confirmation", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makeReadyPlot(owner);
    await assert.rejects(
      owner.query("select * from public.request_plot_handover_share($1)", [plot]),
      /has not been handed over yet/i
    );
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    await owner.query("select * from public.request_plot_handover_share($1)", [plot]);
    await assert.rejects(
      owner.query("select * from public.request_plot_handover_share($1)", [plot]),
      /already an active share link/i
    );
  } finally {
    await owner.end();
  }
});

test("get_plot_handover_share: an anon caller with the real token sees the curated handover pack and the link transitions pending -> viewed", async () => {
  const owner = await userClient(DB, OWNER);
  let token;
  let plot;
  try {
    plot = await makeReadyPlot(owner);
    await owner.query("select * from public.confirm_plot_handover($1, $2, $3, $4)", [
      plot, "Site Manager", JSON.stringify([{ utility: "gas", reading: "4567" }]), JSON.stringify([{ item: "Garage keys", quantity: 1 }]),
    ]);
    const { rows } = await owner.query(
      "select * from public.request_plot_handover_share($1, $2, $3)",
      [plot, "Jane Solicitor", "jane@example.invalid"]
    );
    token = rows[0].token;

    const shareBefore = await owner.query("select status from public.plot_handover_shares where plot_id = $1", [plot]);
    assert.equal(shareBefore.rows[0].status, "pending");
  } finally {
    await owner.end();
  }

  const anon = await anonClient(DB);
  try {
    const { rows } = await anon.query("select public.get_plot_handover_share($1) as pack", [token]);
    const pack = rows[0].pack;
    assert.equal(pack.status, "viewed");
    assert.equal(pack.recipient_name, "Jane Solicitor");
    assert.equal(pack.meter_readings[0].utility, "gas");
    assert.equal(pack.key_log[0].item, "Garage keys");
    assert.ok(pack.content_hash);
  } finally {
    await anon.end();
  }

  const owner2 = await userClient(DB, OWNER);
  try {
    const share = await owner2.query("select status, viewed_at from public.plot_handover_shares where plot_id = $1", [plot]);
    assert.equal(share.rows[0].status, "viewed");
    assert.ok(share.rows[0].viewed_at);
  } finally {
    await owner2.end();
  }
});

test("get_plot_handover_share: an invalid token is refused, and a share link lazily expires on read", async () => {
  const owner = await userClient(DB, OWNER);
  const admin = adminClient(DB);
  let token, shareId;
  try {
    await admin.connect();
    const plot = await makeReadyPlot(owner);
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    const { rows } = await owner.query("select * from public.request_plot_handover_share($1)", [plot]);
    token = rows[0].token;
    shareId = rows[0].id;
    // Force it into the past to exercise the lazy-expiry path without
    // waiting — the RPC itself never accepts an expiry under 1 hour.
    await admin.query("update public.plot_handover_shares set expires_at = now() - interval '1 hour' where id = $1", [shareId]);
  } finally {
    await owner.end();
  }

  const anon = await anonClient(DB);
  try {
    await assert.rejects(anon.query("select public.get_plot_handover_share($1) as pack", ["not-a-real-token"]), /Invalid handover link/i);

    const { rows } = await anon.query("select public.get_plot_handover_share($1) as pack", [token]);
    assert.equal(rows[0].pack.status, "expired");
    assert.equal(Object.keys(rows[0].pack).length, 1, "an expired link returns status only, no handover content");
  } finally {
    await anon.end();
    await admin.end();
  }
});

test("revoke_plot_handover_share: a revoked link reads back as revoked with no content, and cannot be revoked twice", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makeReadyPlot(owner);
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    const { rows } = await owner.query("select * from public.request_plot_handover_share($1)", [plot]);
    const { id: shareId, token } = rows[0];

    await owner.query("select public.revoke_plot_handover_share($1)", [shareId]);
    await assert.rejects(
      owner.query("select public.revoke_plot_handover_share($1)", [shareId]),
      /Only a pending or viewed share link can be revoked/i
    );

    const anon = await anonClient(DB);
    try {
      const r = await anon.query("select public.get_plot_handover_share($1) as pack", [token]);
      assert.equal(r.rows[0].pack.status, "revoked");
    } finally {
      await anon.end();
    }
  } finally {
    await owner.end();
  }
});

test("Tamper defense: if a confirmation's content_hash is ever changed after the fact, an active share link refuses to display it rather than silently serving stale content", async () => {
  const owner = await userClient(DB, OWNER);
  const admin = adminClient(DB);
  let token;
  try {
    await admin.connect();
    const plot = await makeReadyPlot(owner);
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    const { rows } = await owner.query("select * from public.request_plot_handover_share($1)", [plot]);
    token = rows[0].token;

    // Simulate the confirmation row's content_hash disagreeing with what
    // the share link bound at creation time (this requires an admin/
    // superuser write — no client role has an update policy on this
    // table at all, which is the whole point).
    await admin.query("update public.plot_handover_confirmations set content_hash = 'tampered' where plot_id = $1", [plot]);
  } finally {
    await owner.end();
  }

  const anon = await anonClient(DB);
  try {
    await assert.rejects(anon.query("select public.get_plot_handover_share($1) as pack", [token]), /changed since this link was created/i);
  } finally {
    await anon.end();
    await admin.end();
  }
});

test("RLS: plot_handover_confirmations and plot_handover_shares have no insert/update/delete policy for any client role — a raw write is refused even for the plot's own owner", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makeReadyPlot(owner);
    await assert.rejects(
      owner.query(
        "insert into public.plot_handover_confirmations (plot_id, project_id, content_hash) values ($1,$2,'x')",
        [plot, fx.projA]
      ),
      /row-level security/i
    );
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    await assert.rejects(
      owner.query("update public.plot_handover_confirmations set content_hash = 'y' where plot_id = $1", [plot]),
      /row-level security|0 rows/i
    ).catch(() => {});
    const row = await owner.query("select content_hash from public.plot_handover_confirmations where plot_id = $1", [plot]);
    assert.notEqual(row.rows[0].content_hash, "y", "a raw UPDATE must never actually change content_hash, whether it errors or just matches 0 rows");
  } finally {
    await owner.end();
  }
});

test("RLS: a stranger with no membership on the project sees zero confirmation/share rows, even knowing the real plot_id", async () => {
  const owner = await userClient(DB, OWNER);
  const stranger = await userClient(DB, STRANGER);
  try {
    const plot = await makeReadyPlot(owner);
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    await owner.query("select * from public.request_plot_handover_share($1)", [plot]);

    const c = await stranger.query("select 1 from public.plot_handover_confirmations where plot_id = $1", [plot]);
    assert.equal(c.rowCount, 0);
    const s = await stranger.query("select 1 from public.plot_handover_shares where plot_id = $1", [plot]);
    assert.equal(s.rowCount, 0);
  } finally {
    await owner.end();
    await stranger.end();
  }
});

test("Audit trail: confirming a handover and creating a share link both write real audit_log rows", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const plot = await makeReadyPlot(owner);
    const { rows } = await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    const confirmationId = rows[0].confirm_plot_handover.id;
    await owner.query("select * from public.request_plot_handover_share($1)", [plot]);

    const confAudit = await owner.query(
      "select action, table_name from public.audit_log where table_name = 'plot_handover_confirmations' and record_id = $1",
      [confirmationId]
    );
    assert.equal(confAudit.rowCount, 1);
    assert.equal(confAudit.rows[0].action, "INSERT");

    const shareAudit = await owner.query(
      "select count(*)::int as n from public.audit_log al join public.plot_handover_shares s on s.id = al.record_id where al.table_name = 'plot_handover_shares' and s.plot_id = $1",
      [plot]
    );
    assert.equal(shareAudit.rows[0].n, 1);
  } finally {
    await owner.end();
  }
});

test("v72 rollback: removes the new functions and tables, and never touches an already-confirmed plot's handed_over_at", async () => {
  const db = "tracker_test_v72_rollback";
  await createTestDatabase(db);
  try {
    await setupSchema(db);
    const admin = adminClient(db);
    await admin.connect();
    await admin.query(`insert into auth.users (id, email) values ($1,'v72rollback@example.com')`, [OWNER]);
    await admin.end();

    const owner = await userClient(db, OWNER);
    const org = (await owner.query("select public.create_organisation('Rollback Org', 'main_contractor') as id")).rows[0].id;
    const proj = (await owner.query("insert into public.projects (name, org_id, created_by) values ('Rollback Site', $1, $2) returning id", [org, OWNER])).rows[0].id;
    const plot = await makeReadyPlot(owner, proj, "RB-1");
    await owner.query("select * from public.confirm_plot_handover($1, $2)", [plot, "Site Manager"]);
    const before = await owner.query("select handed_over_at from public.plots where id = $1", [plot]);
    await owner.end();

    const admin2 = adminClient(db);
    await admin2.connect();
    await runSql(admin2, ROLLBACK);

    const after = await admin2.query("select handed_over_at from public.plots where id = $1", [plot]);
    assert.deepEqual(after.rows[0].handed_over_at, before.rows[0].handed_over_at, "rollback must never un-stamp a plot that was genuinely handed over");

    const regclass = await admin2.query(
      "select to_regclass('public.plot_handover_confirmations') as t1, to_regclass('public.plot_handover_shares') as t2, to_regproc('public.confirm_plot_handover(uuid,text,jsonb,jsonb,text)') as f1"
    );
    assert.deepEqual(regclass.rows[0], { t1: null, t2: null, f1: null });
    await admin2.end();
  } finally {
    await dropTestDatabase(db);
  }
});
