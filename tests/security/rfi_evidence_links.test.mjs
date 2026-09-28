// RFI-1 — evidence-link architecture (rfi_evidence_links). Real
// database, real non-superuser `authenticated` role. Proves each of
// the four supported source_type values is genuinely validated
// server-side (not just accepted on the client's word), and that
// weekly-report photos — the one evidence type with no stable id
// until this migration — round-trip correctly through
// normalise_weekly_report_photo_ids(), including for reports saved
// BEFORE this migration existed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_rfi_evidence_links";

const OWNER_A = "a1000000-0000-0000-0000-000000000001";
const OWNER_B = "b1000000-0000-0000-0000-000000000001";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'ownerb@example.com')`,
    [OWNER_A, OWNER_B]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const rfiA = (await ownerA.query("insert into public.rfis (project_id, title, question) values ($1,'RFI A','Q?') returning id", [projA])).rows[0].id;

  const weeklyReportA = (await ownerA.query(
    `insert into public.weekly_reports (project_id, week_starting, week_ending, photos)
     values ($1,'2026-09-07','2026-09-11', $2::jsonb) returning id, photos`,
    [projA, JSON.stringify([{ url: "https://example.com/photo1.jpg", plot_area: "Plot 1", category: "Roofing", compliance_status: "Action Required", caption: "Cracked tile" }])]
  )).rows[0];

  const snagA = (await ownerA.query(
    "insert into public.snag_items (project_id, location, description) values ($1,'Kitchen','Cracked tile') returning id",
    [projA]
  )).rows[0].id;

  const inspA = (await ownerA.query("insert into public.inspections (project_id, title) values ($1,'Inspection A') returning id", [projA])).rows[0].id;
  const findingA = (await ownerA.query(
    "insert into public.inspection_findings (project_id, inspection_id, title, severity) values ($1,$2,'Missing DPC','high') returning id",
    [projA, inspA]
  )).rows[0].id;

  const docA = (await ownerA.query(
    "insert into public.documents (project_id, title, document_type) values ($1,'Spec A','specification') returning id",
    [projA]
  )).rows[0].id;
  await ownerA.end();

  // Org B: a fully separate org/project/RFI/weekly report, to prove
  // cross-org evidence rejection.
  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  const rfiB = (await ownerB.query("insert into public.rfis (project_id, title, question) values ($1,'RFI B','Q?') returning id", [projB])).rows[0].id;
  const weeklyReportB = (await ownerB.query(
    `insert into public.weekly_reports (project_id, week_starting, week_ending, photos)
     values ($1,'2026-09-07','2026-09-11', $2::jsonb) returning id, photos`,
    [projB, JSON.stringify([{ url: "https://example.com/photoB.jpg" }])]
  )).rows[0];
  await ownerB.end();

  fx = {
    orgA, projA, rfiA, weeklyReportA, snagA, inspA, findingA, docA,
    orgB, projB, rfiB, weeklyReportB,
  };
});

after(async () => {
  await dropTestDatabase(DB);
});

// ─── Schema ─────────────────────────────────────────────────────────

test("Schema: rfi_evidence_links table, constraints, foreign keys and indexes exist as designed", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const table = await admin.query("select 1 from information_schema.tables where table_schema = 'public' and table_name = 'rfi_evidence_links'");
    assert.equal(table.rowCount, 1);

    const checks = await admin.query(
      `select conname from pg_constraint where conrelid = 'public.rfi_evidence_links'::regclass and contype = 'c'`
    );
    const checkNames = checks.rows.map((r) => r.conname);
    assert.ok(checkNames.includes("rfi_evidence_links_source_type_check"), "the source_type allow-list constraint must exist");
    assert.ok(checkNames.includes("rfi_evidence_links_source_shape"), "the per-type column-shape constraint must exist");

    const fks = await admin.query(
      `select confrelid::regclass::text as target from pg_constraint where conrelid = 'public.rfi_evidence_links'::regclass and contype = 'f'`
    );
    const fkTargets = fks.rows.map((r) => r.target).sort();
    assert.deepEqual(fkTargets, ["auth.users", "projects", "rfis", "weekly_reports"].sort());

    const policies = await admin.query(`select cmd from pg_policies where tablename = 'rfi_evidence_links'`);
    assert.equal(policies.rowCount, 3, "select/insert/delete only, no update policy");
    assert.ok(!policies.rows.some((r) => r.cmd === "UPDATE"));
  } finally {
    await admin.end();
  }
});

// ─── Weekly-report photo identity ────────────────────────────────────

test("Photo identity: a newly-saved weekly report's photos each get a stable id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const photos = fx.weeklyReportA.photos;
    assert.equal(photos.length, 1);
    assert.ok(photos[0].id, "the photo must have been given a stable id on save");
    assert.equal(photos[0].url, "https://example.com/photo1.jpg", "the url must be untouched");
    assert.equal(photos[0].caption, "Cracked tile", "other fields must be untouched");
  } finally {
    await ownerA.end();
  }
});

test("Photo identity: re-saving a draft report never changes an already-assigned photo id", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const firstId = fx.weeklyReportA.photos[0].id;
    const resaved = await ownerA.query(
      "update public.weekly_reports set weather = 'Sunny' where id = $1 returning photos",
      [fx.weeklyReportA.id]
    );
    assert.equal(resaved.rows[0].photos[0].id, firstId, "an already-assigned photo id must never change on a later save");
  } finally {
    await ownerA.end();
  }
});

test("Backwards compatibility: a report inserted directly with a photo carrying NO id (simulating a pre-migration row) still works, and gets an id assigned on its next editable save", async () => {
  const admin = adminClient(DB); // bypasses the trigger's own INSERT path only in the sense of using a superuser role — the trigger itself still fires for every role
  await admin.connect();
  try {
    // Even a superuser insert goes through trg_weekly_reports_before_write
    // (triggers are not RLS), so to genuinely simulate a pre-migration
    // row with NO id at all we disable the trigger for this one insert,
    // exactly mirroring how this suite's own migration fixtures use
    // OLD_SCHEMA to represent pre-existing data shapes.
    await admin.query("alter table public.weekly_reports disable trigger trg_weekly_reports_before_write");
    const created = await admin.query(
      `insert into public.weekly_reports (project_id, week_starting, week_ending, photos, created_by)
       values ($1,'2026-08-01','2026-08-05', $2::jsonb, $3) returning id, photos`,
      [fx.projA, JSON.stringify([{ url: "https://example.com/legacy.jpg", plot_area: "", category: "", compliance_status: "", caption: "", snag_item_id: null, snag_list_id: null }]), OWNER_A]
    );
    await admin.query("alter table public.weekly_reports enable trigger trg_weekly_reports_before_write");

    assert.equal(created.rows[0].photos[0].id, undefined, "the legacy row genuinely has no photo id, matching real pre-migration data");

    const reportId = created.rows[0].id;
    const ownerA = await userClient(DB, OWNER_A);
    try {
      const resaved = await ownerA.query(
        "update public.weekly_reports set weather = 'Overcast' where id = $1 returning photos",
        [reportId]
      );
      assert.ok(resaved.rows[0].photos[0].id, "the legacy photo must be given a stable id the next time the (still-draft) report is saved");
      assert.equal(resaved.rows[0].photos[0].url, "https://example.com/legacy.jpg", "the url must never be touched by normalisation");
    } finally {
      await ownerA.end();
    }
  } finally {
    await admin.end();
  }
});

test("Backwards compatibility: normalisation is skipped once a report is approved/issued, so a status-only save is never blocked by the content-lock check", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  let id;
  try {
    // A legacy report, still missing photo ids, that's already
    // 'reviewed' (one step away from 'approved') — set up via the same
    // trigger-disabled technique as the earlier legacy-row test, so we
    // start from a genuinely id-less photo.
    await admin.query("alter table public.weekly_reports disable trigger trg_weekly_reports_before_write");
    const created = await admin.query(
      `insert into public.weekly_reports (project_id, week_starting, week_ending, status, photos, created_by)
       values ($1,'2026-06-01','2026-06-05','reviewed', $2::jsonb, $3) returning id`,
      [fx.projA, JSON.stringify([{ url: "https://example.com/frozen.jpg" }]), OWNER_A]
    );
    await admin.query("alter table public.weekly_reports enable trigger trg_weekly_reports_before_write");
    id = created.rows[0].id;
  } finally {
    await admin.end();
  }

  const ownerA = await userClient(DB, OWNER_A);
  try {
    // reviewed -> approved: a legitimate, content-preserving status
    // transition. If photo-id normalisation ran unconditionally here,
    // the freshly-added id would make new.photos differ from
    // old.photos, and the content-lock check that fires for this exact
    // transition would incorrectly reject an otherwise valid approval.
    const approved = await ownerA.query("update public.weekly_reports set status = 'approved' where id = $1 returning status, photos", [id]);
    assert.equal(approved.rows[0].status, "approved", "the approve transition itself must not be blocked by normalisation");
    assert.equal(approved.rows[0].photos[0].id, undefined, "photos must stay exactly as they were while the report is locked — normalisation is deferred, not skipped forever");
  } finally {
    await ownerA.end();
  }
});

// ─── Weekly Report photo evidence ────────────────────────────────────

test("Evidence: a valid weekly-report photo can be linked to an RFI in the same project", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const photoId = fx.weeklyReportA.photos[0].id;
    const linked = await ownerA.query(
      "insert into public.rfi_evidence_links (rfi_id, source_type, weekly_report_id, photo_id, caption) values ($1,'weekly_report_photo',$2,$3,'See cracked tile') returning *",
      [fx.rfiA, fx.weeklyReportA.id, photoId]
    );
    assert.equal(linked.rows[0].project_id, fx.projA, "project_id must be derived from the RFI, never client-supplied");
    assert.equal(linked.rows[0].linked_by, OWNER_A, "the actor must be the real authenticated user");
    assert.ok(linked.rows[0].linked_at);
  } finally {
    await ownerA.end();
  }
});

test("Evidence: an invalid (non-existent) photo_id inside a real weekly report is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query(
        "insert into public.rfi_evidence_links (rfi_id, source_type, weekly_report_id, photo_id) values ($1,'weekly_report_photo',$2,$3)",
        [fx.rfiA, fx.weeklyReportA.id, "00000000-0000-0000-0000-000000000000"]
      ),
      /photo_id .* was not found/
    );
  } finally {
    await ownerA.end();
  }
});

test("Evidence: a weekly report from a DIFFERENT project is rejected even if the RFI's own project is valid", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    // A second project under the SAME org, so this is a project-isolation
    // check, not an org one.
    const proj2 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A2', $1, $2) returning id", [fx.orgA, OWNER_A])).rows[0].id;
    const report2 = (await ownerA.query(
      `insert into public.weekly_reports (project_id, week_starting, week_ending, photos)
       values ($1,'2026-09-07','2026-09-11', $2::jsonb) returning id, photos`,
      [proj2, JSON.stringify([{ url: "https://example.com/other-project.jpg" }])]
    )).rows[0];
    await assert.rejects(
      () => ownerA.query(
        "insert into public.rfi_evidence_links (rfi_id, source_type, weekly_report_id, photo_id) values ($1,'weekly_report_photo',$2,$3)",
        [fx.rfiA, report2.id, report2.photos[0].id]
      ),
      /Evidence must belong to the same project as the RFI/
    );
  } finally {
    await ownerA.end();
  }
});

test("Evidence: Org B's weekly report/photo cannot be linked to Org A's RFI (cross-org)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query(
        "insert into public.rfi_evidence_links (rfi_id, source_type, weekly_report_id, photo_id) values ($1,'weekly_report_photo',$2,$3)",
        [fx.rfiA, fx.weeklyReportB.id, fx.weeklyReportB.photos[0]?.id || "00000000-0000-0000-0000-000000000000"]
      ),
      (err) => isRlsError(err) || /must belong to the same project|must reference an existing weekly_reports row/.test(err.message)
    );
  } finally {
    await ownerA.end();
  }
});

// ─── Snag / Inspection Finding / Document evidence ───────────────────

test("Evidence: a valid snag in the same project can be linked", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const linked = await ownerA.query(
      "insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'snag_item',$2) returning source_type, source_id",
      [fx.rfiA, fx.snagA]
    );
    assert.equal(linked.rows[0].source_type, "snag_item");
    assert.equal(linked.rows[0].source_id, fx.snagA);
  } finally {
    await ownerA.end();
  }
});

test("Evidence: a snag from another project is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const proj2 = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A3', $1, $2) returning id", [fx.orgA, OWNER_A])).rows[0].id;
    const snag2 = (await ownerA.query("insert into public.snag_items (project_id, location, description) values ($1,'Bathroom','x') returning id", [proj2])).rows[0].id;
    await assert.rejects(
      () => ownerA.query("insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'snag_item',$2)", [fx.rfiA, snag2]),
      /Evidence must belong to the same project as the RFI/
    );
  } finally {
    await ownerA.end();
  }
});

test("Evidence: a valid inspection finding in the same project can be linked", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const linked = await ownerA.query(
      "insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'inspection_finding',$2) returning source_type, source_id",
      [fx.rfiA, fx.findingA]
    );
    assert.equal(linked.rows[0].source_id, fx.findingA);
  } finally {
    await ownerA.end();
  }
});

test("Evidence: a valid document in the same project can be linked", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const linked = await ownerA.query(
      "insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'document',$2) returning source_type, source_id",
      [fx.rfiA, fx.docA]
    );
    assert.equal(linked.rows[0].source_id, fx.docA);
  } finally {
    await ownerA.end();
  }
});

test("Evidence: a non-existent source_id for any row-based type is rejected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await assert.rejects(
      () => ownerA.query("insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'document',$2)", [fx.rfiA, "00000000-0000-0000-0000-000000000000"]),
      /must reference an existing documents row/
    );
  } finally {
    await ownerA.end();
  }
});

test("Evidence: an unsupported source_type is rejected — both by rfi_evidence_links_before_write() (which runs first) and, independently, by the CHECK constraint underneath it", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    // The BEFORE INSERT trigger's own else-branch catches this with a
    // specific message before the CHECK constraint ever gets
    // evaluated (same "trigger validates before the raw constraint
    // would matter" relationship as rfis' own status CHECK — see that
    // Schema test's own note). The constraint's independent existence
    // is verified directly in the Schema test above via pg_constraint.
    await assert.rejects(
      () => ownerA.query("insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'random_table',$2)", [fx.rfiA, fx.docA]),
      /Unsupported rfi_evidence_links.source_type/
    );
  } finally {
    await ownerA.end();
  }
});

test("Evidence: mismatched column shape for a source_type is rejected — the trigger's own per-type validation catches a null source_id first", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    // A row-based source_type carrying weekly_report_id/photo_id
    // instead of source_id leaves source_id null, which the trigger's
    // 'document' branch rejects with its own specific message before
    // rfi_evidence_links_source_shape (verified to exist in the Schema
    // test) would ever need to fire.
    await assert.rejects(
      () => ownerA.query(
        "insert into public.rfi_evidence_links (rfi_id, source_type, weekly_report_id, photo_id) values ($1,'document',$2,$3)",
        [fx.rfiA, fx.weeklyReportA.id, fx.weeklyReportA.photos[0].id]
      ),
      /must reference an existing documents row/
    );
  } finally {
    await ownerA.end();
  }
});

// ─── RLS / security ───────────────────────────────────────────────

test("Security: an evidence link cannot be created against another organisation's RFI", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    await assert.rejects(
      () => ownerB.query("insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'document',$2)", [fx.rfiA, fx.docA]),
      (err) => isRlsError(err) || /must reference an existing rfis row/.test(err.message)
    );
  } finally {
    await ownerB.end();
  }
});

test("Security: Org B cannot read Org A's evidence links", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const created = await ownerA.query("insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'document',$2) returning id", [fx.rfiA, fx.docA]);
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const { rowCount } = await ownerB.query("select 1 from public.rfi_evidence_links where id = $1", [created.rows[0].id]);
    assert.equal(rowCount, 0);
  } finally {
    await ownerB.end();
  }
});

test("Security: an editor can delete an evidence link (replace-by-delete-and-readd convention)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'document',$2) returning id", [fx.rfiA, fx.docA]);
    const del = await ownerA.query("delete from public.rfi_evidence_links where id = $1", [created.rows[0].id]);
    assert.equal(del.rowCount, 1);
  } finally {
    await ownerA.end();
  }
});

// ─── Audit ────────────────────────────────────────────────────────

test("Audit: INSERT and DELETE on rfi_evidence_links are both captured", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const created = await ownerA.query("insert into public.rfi_evidence_links (rfi_id, source_type, source_id) values ($1,'document',$2) returning id", [fx.rfiA, fx.docA]);
    const id = created.rows[0].id;
    await ownerA.query("delete from public.rfi_evidence_links where id = $1", [id]);

    const { rows } = await ownerA.query(
      "select action from public.audit_log where table_name = 'rfi_evidence_links' and record_id = $1 order by created_at",
      [id]
    );
    assert.equal(rows.length, 2);
    assert.equal(rows[0].action, "INSERT");
    assert.equal(rows[1].action, "DELETE");
  } finally {
    await ownerA.end();
  }
});

// ─── RFI-2: the combined "Raise RFI from a weekly report photo" flow ──
// createRfiFromWeeklyReportPhoto() in tracker/js/app.js (RFI-2) does
// exactly this two-step sequence — insert into rfis, then insert into
// rfi_evidence_links referencing it — with no RPC/transaction wrapper
// of its own; each step is independently RLS/trigger-protected exactly
// as proven individually above and in tests/security/rfis.test.mjs.
// These tests prove the SEQUENCE as a whole behaves correctly and is
// rejected at the right point for the adversarial cases the RFI-2 UI
// brief specifically calls out — not a re-run of every actor variant
// already covered elsewhere.

test("RFI-2 flow: a legitimate owner can create an RFI and link it to a real photo in one sequence, ending up correctly connected", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const rfi = await ownerA.query(
      "insert into public.rfis (project_id, title, question) values ($1,'Flashing detail','Confirm flashing detail at eaves.') returning id, reference",
      [fx.projA]
    );
    const link = await ownerA.query(
      "insert into public.rfi_evidence_links (rfi_id, source_type, weekly_report_id, photo_id, caption) values ($1,'weekly_report_photo',$2,$3,'Eaves detail') returning *",
      [rfi.rows[0].id, fx.weeklyReportA.id, fx.weeklyReportA.photos[0].id]
    );
    assert.equal(link.rows[0].rfi_id, rfi.rows[0].id);
    assert.equal(link.rows[0].project_id, fx.projA, "the link's project_id must match, independently derived server-side");
  } finally {
    await ownerA.end();
  }
});

test("RFI-2 flow: client-supplied project/org identifiers cannot bypass server validation — a spoofed org_id on the RFI insert is silently overridden, not honoured", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const rfi = await ownerA.query(
      "insert into public.rfis (org_id, project_id, title, question) values ($1,$2,'x','Q?') returning org_id",
      [fx.orgB, fx.projA] // attempts to claim Org B as the RFI's own organisation
    );
    assert.equal(rfi.rows[0].org_id, fx.orgA, "org_id must always be derived from project_id server-side, exactly like RFI-1's own equivalent test");
  } finally {
    await ownerA.end();
  }
});

test("RFI-2 flow: an unauthorised user (no membership on the project at all) cannot even complete step one — the RFI itself is never created, so no evidence link can follow", async () => {
  const ownerB = await userClient(DB, OWNER_B);
  try {
    await assert.rejects(
      () => ownerB.query("insert into public.rfis (project_id, title, question) values ($1,'Sneaky','Q?') returning id", [fx.projA]),
      (err) => isRlsError(err)
    );
    // Confirms nothing was created for this attempt to (hypothetically)
    // link evidence to.
    const { rows } = await ownerB.query("select 1 from public.rfis where project_id = $1 and title = 'Sneaky'", [fx.projA]);
    assert.equal(rows.length, 0);
  } finally {
    await ownerB.end();
  }
});
