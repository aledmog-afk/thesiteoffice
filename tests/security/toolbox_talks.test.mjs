// Toolbox Talks — real, non-superuser `authenticated`/`anon` Postgres
// roles throughout (see tests/security/org_isolation.test.mjs's header
// comment for why this matters: UI hiding proves nothing).
//
// Covers: template library (system + org-owned, versioning, permissions),
// the full talk lifecycle (start/snapshot/attendees/site-notes/signing/
// completion/immutability), signature integrity, cross-organisation and
// cross-project isolation, and SECURITY DEFINER EXECUTE privileges.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_toolbox_talks";

const ORGA_ADMIN = "a1000000-0000-0000-0000-000000000001";
const ORGA_EDITOR = "a2000000-0000-0000-0000-000000000002"; // 'editor' toolbox_talks role on PROJ_A only
const ORGA_CONTRIBUTOR = "a3000000-0000-0000-0000-000000000003";
const ORGA_VIEWER = "a4000000-0000-0000-0000-000000000004";
const ORGB_ADMIN = "b1000000-0000-0000-0000-000000000001";
const ORGB_CONTRIBUTOR = "b2000000-0000-0000-0000-000000000002";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values
       ($1,'orga-admin@example.com'), ($2,'orga-editor@example.com'),
       ($3,'orga-contributor@example.com'), ($4,'orga-viewer@example.com'),
       ($5,'orgb-admin@example.com'), ($6,'orgb-contributor@example.com')`,
    [ORGA_ADMIN, ORGA_EDITOR, ORGA_CONTRIBUTOR, ORGA_VIEWER, ORGB_ADMIN, ORGB_CONTRIBUTOR]
  );
  await admin.end();

  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  const orgA = (await orgAAdmin.query("select public.create_organisation('Org A Ltd', 'main_contractor') as id")).rows[0].id;
  const projA = (await orgAAdmin.query(
    "insert into public.projects (name, org_id, created_by) values ('Org A Site 1', $1, $2) returning id", [orgA, ORGA_ADMIN]
  )).rows[0].id;
  const projA2 = (await orgAAdmin.query(
    "insert into public.projects (name, org_id, created_by) values ('Org A Site 2', $1, $2) returning id", [orgA, ORGA_ADMIN]
  )).rows[0].id;
  const inviteA = (await orgAAdmin.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;
  const inviteA2 = (await orgAAdmin.query("select public.regenerate_invite_code($1) as code", [projA2])).rows[0].code;
  await orgAAdmin.end();

  // Join everyone into Org A's project(s), then grant module roles.
  for (const [uid, code] of [[ORGA_EDITOR, inviteA], [ORGA_CONTRIBUTOR, inviteA], [ORGA_VIEWER, inviteA]]) {
    const c = await userClient(DB, uid);
    await c.query("select public.join_project_by_invite($1)", [code]);
    await c.end();
  }

  const orgAAdmin2 = await userClient(DB, ORGA_ADMIN);
  await orgAAdmin2.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','editor',$3)",
    [projA, ORGA_EDITOR, ORGA_ADMIN]
  );
  await orgAAdmin2.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','contributor',$3)",
    [projA, ORGA_CONTRIBUTOR, ORGA_ADMIN]
  );
  await orgAAdmin2.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','viewer',$3)",
    [projA, ORGA_VIEWER, ORGA_ADMIN]
  );
  await orgAAdmin2.end();

  const orgBAdmin = await userClient(DB, ORGB_ADMIN);
  const orgB = (await orgBAdmin.query("select public.create_organisation('Org B Ltd', 'subcontractor') as id")).rows[0].id;
  const projB = (await orgBAdmin.query(
    "insert into public.projects (name, org_id, created_by) values ('Org B Site', $1, $2) returning id", [orgB, ORGB_ADMIN]
  )).rows[0].id;
  const inviteB = (await orgBAdmin.query("select public.regenerate_invite_code($1) as code", [projB])).rows[0].code;
  await orgBAdmin.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','editor',$2)",
    [projB, ORGB_ADMIN]
  );
  await orgBAdmin.end();
  const orgBContributor = await userClient(DB, ORGB_CONTRIBUTOR);
  await orgBContributor.query("select public.join_project_by_invite($1)", [inviteB]);
  await orgBContributor.end();
  const orgBAdmin2 = await userClient(DB, ORGB_ADMIN);
  await orgBAdmin2.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','contributor',$3)",
    [projB, ORGB_CONTRIBUTOR, ORGB_ADMIN]
  );
  await orgBAdmin2.end();

  // System template (org_id null) with 2 versions, created as the
  // import process would — direct superuser writes, bypassing RLS
  // (exactly as production's real import will run).
  const admin2 = adminClient(DB);
  await admin2.connect();
  const sysTemplateId = (await admin2.query(
    "insert into public.toolbox_talk_templates (org_id, title, source_filename) values (null, 'Working at Height', 'TBT-01-WorkingAtHeight.docx') returning id"
  )).rows[0].id;
  const sysV1 = (await admin2.query(
    "insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2) returning id",
    [sysTemplateId, JSON.stringify({ introduction: "v1 intro", key_points: ["a", "b"] })]
  )).rows[0].id;

  // An Org A-owned template (created via the real RLS-checked path).
  const orgAEditor = await userClient(DB, ORGA_EDITOR);
  const orgTemplateId = (await orgAEditor.query(
    "insert into public.toolbox_talk_templates (org_id, title) values ($1, 'Org A Custom Talk') returning id", [orgA]
  )).rows[0].id;
  await orgAEditor.query(
    "insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2)",
    [orgTemplateId, JSON.stringify({ introduction: "custom v1" })]
  );
  await orgAEditor.end();

  // An Org B-owned private template (for cross-org tests).
  const orgBAdmin3 = await userClient(DB, ORGB_ADMIN);
  const orgBTemplateId = (await orgBAdmin3.query(
    "insert into public.toolbox_talk_templates (org_id, title) values ($1, 'Org B Private Talk') returning id", [orgB]
  )).rows[0].id;
  const orgBVersionId = (await orgBAdmin3.query(
    "insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2) returning id",
    [orgBTemplateId, JSON.stringify({ introduction: "org b secret" })]
  )).rows[0].id;
  await orgBAdmin3.end();

  await admin2.end();

  fx = { orgA, projA, projA2, orgB, projB, sysTemplateId, sysV1, orgTemplateId, orgBTemplateId, orgBVersionId };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function adminGetTemplateVersionId(templateId) {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query("select current_version_id from public.toolbox_talk_templates where id=$1", [templateId]);
    return rows[0].current_version_id;
  } finally {
    await admin.end();
  }
}

// ─── Templates ─────────────────────────────────────────────────────
test("Templates: any org member (including a viewer) can read the system template library", async () => {
  const viewer = await userClient(DB, ORGA_VIEWER);
  try {
    const { rows } = await viewer.query("select title from public.toolbox_talk_templates where id=$1", [fx.sysTemplateId]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].title, "Working at Height");
  } finally {
    await viewer.end();
  }
});

test("Templates: Org A cannot read Org B's private template", async () => {
  const orgAViewer = await userClient(DB, ORGA_VIEWER);
  try {
    const { rows } = await orgAViewer.query("select 1 from public.toolbox_talk_templates where id=$1", [fx.orgBTemplateId]);
    assert.equal(rows.length, 0);
  } finally {
    await orgAViewer.end();
  }
});

test("Templates: no client role can insert a system template (org_id null) directly", async () => {
  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  try {
    await assert.rejects(
      () => orgAAdmin.query("insert into public.toolbox_talk_templates (org_id, title) values (null, 'Sneaky System Template')"),
      (err) => isRlsError(err)
    );
  } finally {
    await orgAAdmin.end();
  }
});

test("Templates: an 'editor' can create a new version of their org's template, and it becomes current", async () => {
  const editor = await userClient(DB, ORGA_EDITOR);
  try {
    const before = await adminGetTemplateVersionId(fx.orgTemplateId);
    const { rows } = await editor.query(
      "insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2) returning id, version_number",
      [fx.orgTemplateId, JSON.stringify({ introduction: "custom v2 — amended" })]
    );
    assert.equal(rows[0].version_number, 2, "must auto-number as version 2");
    const after = await adminGetTemplateVersionId(fx.orgTemplateId);
    assert.equal(after, rows[0].id, "the new version must become current_version_id");
    assert.notEqual(after, before);
  } finally {
    await editor.end();
  }
});

test("Templates: an ordinary contributor (not editor) cannot create or edit templates", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    await assert.rejects(
      () => contributor.query("insert into public.toolbox_talk_templates (org_id, title) values ($1, 'Should Fail')", [fx.orgA]),
      (err) => isRlsError(err)
    );
    await assert.rejects(
      () => contributor.query("insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2)", [fx.orgTemplateId, "{}"]),
      (err) => isRlsError(err)
    );
  } finally {
    await contributor.end();
  }
});

test("Templates: Org B's admin cannot create a version for Org A's template", async () => {
  const orgBAdmin = await userClient(DB, ORGB_ADMIN);
  try {
    await assert.rejects(
      () => orgBAdmin.query("insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2)", [fx.orgTemplateId, "{}"]),
      (err) => isRlsError(err)
    );
  } finally {
    await orgBAdmin.end();
  }
});

test("Templates: an existing version is never mutated by a later edit — historical version content is preserved verbatim", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "select version_number, content from public.toolbox_talk_template_versions where template_id=$1 order by version_number",
      [fx.orgTemplateId]
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(rows[0].content, { introduction: "custom v1" }, "version 1's content must be exactly what it always was");
    assert.deepEqual(rows[1].content, { introduction: "custom v2 — amended" });
  } finally {
    await admin.end();
  }
});

test("Templates: a version row cannot be updated or deleted by any client role", async () => {
  const editor = await userClient(DB, ORGA_EDITOR);
  try {
    const upd = await editor.query("update public.toolbox_talk_template_versions set content=$1 where template_id=$2 and version_number=1", ["{}", fx.orgTemplateId]);
    assert.equal(upd.rowCount, 0, "versions must be immutable — even to the template's own editor");
    const del = await editor.query("delete from public.toolbox_talk_template_versions where template_id=$1 and version_number=1", [fx.orgTemplateId]);
    assert.equal(del.rowCount, 0);
  } finally {
    await editor.end();
  }
});

// ─── Talk lifecycle ─────────────────────────────────────────────────
test("Talk lifecycle: a contributor can start a talk from a system template, and content is snapshotted server-side", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const { rows } = await contributor.query(
      "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,null) returning id, title, content_snapshot, status, delivered_by",
      [fx.projA, fx.sysTemplateId, fx.sysV1]
    );
    assert.equal(rows[0].title, "Working at Height", "an unspecified title must default to the template's own title");
    assert.deepEqual(rows[0].content_snapshot, { introduction: "v1 intro", key_points: ["a", "b"] });
    assert.equal(rows[0].status, "in_progress");
    assert.equal(rows[0].delivered_by, ORGA_CONTRIBUTOR);
    fx.talk1 = rows[0].id;
  } finally {
    await contributor.end();
  }
});

test("Talk lifecycle: the evidence reference is generated server-side, sequential per-project, and independent between projects (v45 — needed for the PDF export's own header)", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  try {
    const first = await contributor.query(
      "select reference from public.toolbox_talks where id=$1", [fx.talk1]
    );
    assert.equal(first.rows[0].reference, "TT-001", "the very first talk started on this project");

    const second = await contributor.query(
      "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x') returning reference",
      [fx.projA, fx.sysTemplateId, fx.sysV1]
    );
    assert.equal(second.rows[0].reference, "TT-002", "the second talk on the SAME project must continue the sequence");

    // projA2 has never had a talk started on it before — its own
    // sequence must start fresh at TT-001, not continue projA's.
    await orgAAdmin.query(
      "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','contributor',$2) on conflict do nothing",
      [fx.projA2, ORGA_ADMIN]
    );
    const onOtherProject = await orgAAdmin.query(
      "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x') returning reference",
      [fx.projA2, fx.sysTemplateId, fx.sysV1]
    );
    assert.equal(onOtherProject.rows[0].reference, "TT-001", "a different project's own sequence must not be affected by projA's talks");
  } finally {
    await contributor.end();
    await orgAAdmin.end();
  }
});

test("Talk lifecycle: a viewer cannot start a talk", async () => {
  const viewer = await userClient(DB, ORGA_VIEWER);
  try {
    await assert.rejects(
      () => viewer.query("insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x')", [fx.projA, fx.sysTemplateId, fx.sysV1]),
      (err) => isRlsError(err)
    );
  } finally {
    await viewer.end();
  }
});

test("CRITICAL — cross-org template linking: Org A cannot start a talk using Org B's private template version", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    await assert.rejects(
      () => contributor.query(
        "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x')",
        [fx.projA, fx.orgBTemplateId, fx.orgBVersionId]
      ),
      /does not belong to your organisation/i,
      "starting a talk against another organisation's private template must be rejected, not silently copy its content in"
    );
  } finally {
    await contributor.end();
  }
});

test("Talk lifecycle: attendees are individual rows, site notes are stored separately from the template snapshot", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    await contributor.query("update public.toolbox_talks set site_notes=$1 where id=$2", ["Windy today, extra care on the scaffold.", fx.talk1]);
    const { rows: att } = await contributor.query(
      "insert into public.toolbox_talk_attendees (toolbox_talk_id, name, company) values ($1,'Joe Bloggs','ABC Plumbing Ltd') returning id, name, company, added_by",
      [fx.talk1]
    );
    fx.attendee1 = att[0].id;
    const { rows: att2 } = await contributor.query(
      "insert into public.toolbox_talk_attendees (toolbox_talk_id, name) values ($1,'Jane Smith') returning id",
      [fx.talk1]
    );
    fx.attendee2 = att2[0].id;

    const { rows: talk } = await contributor.query("select content_snapshot, site_notes from public.toolbox_talks where id=$1", [fx.talk1]);
    assert.deepEqual(talk[0].content_snapshot, { introduction: "v1 intro", key_points: ["a", "b"] }, "content_snapshot must remain exactly the template content, unaffected by site notes");
    assert.equal(talk[0].site_notes, "Windy today, extra care on the scaffold.");
  } finally {
    await contributor.end();
  }
});

test("Talk lifecycle: completing with unsigned attendees is refused, with the count shown", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    await assert.rejects(
      () => contributor.query("update public.toolbox_talks set status='completed' where id=$1", [fx.talk1]),
      /2 attendee\(s\) have not yet signed/i
    );
  } finally {
    await contributor.end();
  }
});

test("Signatures: an individual attendee signs — timestamped, and the signer identity is recorded", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const { rows } = await contributor.query(
      "update public.toolbox_talk_attendees set signed_at=now(), signature_data=$1, signature_typed_name='Joe Bloggs' where id=$2 returning signed_at, signed_by, signature_typed_name",
      ["data:image/svg+xml;base64,AAA", fx.attendee1]
    );
    assert.ok(rows[0].signed_at, "signed_at must be set");
    assert.equal(rows[0].signed_by, ORGA_CONTRIBUTOR, "the signer/recorder must be captured");
    assert.equal(rows[0].signature_typed_name, "Joe Bloggs");
  } finally {
    await contributor.end();
  }
});

test("Signatures: a second attempt to change an already-signed attendee's signature is silently refused, not overwritten", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const original = await contributor.query("select signed_at, signature_data from public.toolbox_talk_attendees where id=$1", [fx.attendee1]);
    await contributor.query(
      "update public.toolbox_talk_attendees set signature_data=$1 where id=$2",
      ["data:image/svg+xml;base64,TAMPERED", fx.attendee1]
    );
    const after = await contributor.query("select signed_at, signature_data from public.toolbox_talk_attendees where id=$1", [fx.attendee1]);
    assert.equal(after.rows[0].signature_data, original.rows[0].signature_data, "an already-recorded signature must never change, even via a direct UPDATE");
    assert.deepEqual(after.rows[0].signed_at, original.rows[0].signed_at);
  } finally {
    await contributor.end();
  }
});

test("Attendee exceptions: recording an exception resolves the attendee for completion purposes, without a signature", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const { rows } = await contributor.query(
      "update public.toolbox_talk_attendees set exception_reason=$1 where id=$2 returning exception_reason, exception_recorded_by, exception_at, signed_at",
      ["Left site before the talk finished — informed separately by phone.", fx.attendee2]
    );
    assert.equal(rows[0].exception_reason, "Left site before the talk finished — informed separately by phone.");
    assert.equal(rows[0].exception_recorded_by, ORGA_CONTRIBUTOR);
    assert.ok(rows[0].exception_at);
    assert.equal(rows[0].signed_at, null, "an exception must never itself count as a signature");
  } finally {
    await contributor.end();
  }
});

test("Attendee exceptions: an attendee cannot be both signed and excepted", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    await assert.rejects(
      () => contributor.query(
        "update public.toolbox_talk_attendees set exception_reason='too late now' where id=$1",
        [fx.attendee1] // already signed
      ),
      /both signed and recorded as an exception/i
    );
  } finally {
    await contributor.end();
  }
});

test("Talk lifecycle: completion succeeds once every attendee has signed or been excepted, and locks the record", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const { rows } = await contributor.query(
      "update public.toolbox_talks set status='completed' where id=$1 returning status, completed_by, completed_at",
      [fx.talk1]
    );
    assert.equal(rows[0].status, "completed");
    assert.equal(rows[0].completed_by, ORGA_CONTRIBUTOR);
    assert.ok(rows[0].completed_at);
  } finally {
    await contributor.end();
  }
});

test("PDF export data layer: a viewer (view-only, no edit rights) can read every field the PDF export needs from a completed talk — same SELECT policy as the detail page itself, since PDF generation goes through no separate endpoint", async () => {
  const viewer = await userClient(DB, ORGA_VIEWER);
  try {
    const talk = await viewer.query(
      "select reference, title, content_snapshot, site_notes, status, started_at, completed_at, delivered_by from public.toolbox_talks where id=$1",
      [fx.talk1]
    );
    assert.equal(talk.rowCount, 1, "a viewer must be able to read the completed talk itself");
    assert.equal(talk.rows[0].status, "completed");
    assert.ok(talk.rows[0].reference, "reference must be readable");
    assert.ok(talk.rows[0].content_snapshot, "content_snapshot must be readable");

    const attendees = await viewer.query(
      "select name, company, signed_at, signature_data, signature_typed_name, exception_reason, exception_at from public.toolbox_talk_attendees where toolbox_talk_id=$1",
      [fx.talk1]
    );
    assert.ok(attendees.rowCount > 0, "a viewer must be able to read the attendee/signature evidence");

    const org = await viewer.query("select name from public.organisations where id=$1", [fx.orgA]);
    assert.equal(org.rowCount, 1, "a viewer must be able to resolve the organisation name for the PDF header");
  } finally {
    await viewer.end();
  }
});

test("IMMUTABILITY: a completed talk's content, status, and timestamps cannot be changed", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    await assert.rejects(
      () => contributor.query("update public.toolbox_talks set site_notes='tampering attempt' where id=$1", [fx.talk1]),
      /is completed and is immutable/i
    );
    await assert.rejects(
      () => contributor.query("update public.toolbox_talks set status='in_progress' where id=$1", [fx.talk1]),
      /is completed and is immutable/i
    );
  } finally {
    await contributor.end();
  }
});

test("IMMUTABILITY: the evidence reference on a completed talk cannot be changed by any update attempt", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const before = await contributor.query("select reference from public.toolbox_talks where id=$1", [fx.talk1]);
    // The talk is already completed at this point in the suite, so this
    // whole UPDATE is refused outright (the same "is completed and is
    // immutable" guard as the test above) — the reference was already
    // proven immutable-by-construction (never re-derived, never
    // overwritten by the trigger) back when it was still in_progress;
    // this closes the loop for the fully-locked, PDF-eligible state.
    await assert.rejects(
      () => contributor.query("update public.toolbox_talks set reference='HACKED' where id=$1", [fx.talk1]),
      /is completed and is immutable/i
    );
    const after = await contributor.query("select reference from public.toolbox_talks where id=$1", [fx.talk1]);
    assert.equal(after.rows[0].reference, before.rows[0].reference);
  } finally {
    await contributor.end();
  }
});

test("IMMUTABILITY: attendees of a completed talk cannot be added, changed, or removed", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    await assert.rejects(
      () => contributor.query("insert into public.toolbox_talk_attendees (toolbox_talk_id, name) values ($1,'Late Attendee')", [fx.talk1]),
      /attendees cannot be added to a completed toolbox talk/i
    );
    const upd = await contributor.query("update public.toolbox_talk_attendees set attendance_status='left_early' where id=$1", [fx.attendee1]);
    assert.equal(upd.rowCount, 0, "no client-visible row should be updatable once the parent talk is completed");
    const del = await contributor.query("delete from public.toolbox_talk_attendees where id=$1", [fx.attendee1]);
    assert.equal(del.rowCount, 0);
  } finally {
    await contributor.end();
  }
});

test("Talk lifecycle: completing with zero attendees is refused", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const { rows } = await contributor.query(
      "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x') returning id",
      [fx.projA, fx.sysTemplateId, fx.sysV1]
    );
    const emptyTalk = rows[0].id;
    await assert.rejects(
      () => contributor.query("update public.toolbox_talks set status='completed' where id=$1", [emptyTalk]),
      /add at least one attendee/i
    );
    fx.emptyTalk = emptyTalk;
  } finally {
    await contributor.end();
  }
});

test("Talk lifecycle: cancellation requires a reason, and locks the record just like completion", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    await assert.rejects(
      () => contributor.query("update public.toolbox_talks set status='cancelled' where id=$1", [fx.emptyTalk]),
      /cancellation reason is required/i
    );
    const { rows } = await contributor.query(
      "update public.toolbox_talks set status='cancelled', cancellation_reason='Started by mistake — wrong site' where id=$1 returning status, cancelled_by, cancelled_at",
      [fx.emptyTalk]
    );
    assert.equal(rows[0].status, "cancelled");
    assert.equal(rows[0].cancelled_by, ORGA_CONTRIBUTOR);
    assert.ok(rows[0].cancelled_at);

    await assert.rejects(
      () => contributor.query("update public.toolbox_talks set status='in_progress' where id=$1", [fx.emptyTalk]),
      /is cancelled and is immutable/i
    );
  } finally {
    await contributor.end();
  }
});

test("Talk lifecycle: editing a template AFTER a talk started never changes that talk's already-delivered content (version snapshot preservation)", async () => {
  // fx.talk1 was delivered against sysV1 ("v1 intro"). Add a v2 to the
  // same system template (as an admin, simulating a later content edit)
  // and confirm the completed talk's snapshot is untouched.
  const admin = adminClient(DB);
  await admin.connect();
  try {
    await admin.query(
      "insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2)",
      [fx.sysTemplateId, JSON.stringify({ introduction: "v2 intro — completely rewritten", key_points: ["x"] })]
    );
  } finally {
    await admin.end();
  }

  const viewer = await userClient(DB, ORGA_VIEWER);
  try {
    const { rows } = await viewer.query("select content_snapshot, template_version_id from public.toolbox_talks where id=$1", [fx.talk1]);
    assert.deepEqual(rows[0].content_snapshot, { introduction: "v1 intro", key_points: ["a", "b"] }, "a completed talk must keep the exact content it was delivered with, forever");
    assert.equal(rows[0].template_version_id, fx.sysV1);
  } finally {
    await viewer.end();
  }
});

// ─── Cross-organisation isolation (dedicated) ────────────────────────
test("CROSS-ORG: Org A admin cannot see Org B's private template", async () => {
  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  try {
    const t = await orgAAdmin.query("select 1 from public.toolbox_talk_templates where id=$1", [fx.orgBTemplateId]);
    assert.equal(t.rowCount, 0);
  } finally {
    await orgAAdmin.end();
  }
});

test("CROSS-ORG: Org A cannot read, sign, modify, or complete Org B's actual delivered talk", async () => {
  const orgBContributor = await userClient(DB, ORGB_CONTRIBUTOR);
  let orgBTalkId, orgBAttendeeId;
  try {
    const { rows } = await orgBContributor.query(
      "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x') returning id",
      [fx.projB, fx.orgBTemplateId, fx.orgBVersionId]
    );
    orgBTalkId = rows[0].id;
    const att = await orgBContributor.query(
      "insert into public.toolbox_talk_attendees (toolbox_talk_id, name) values ($1,'Org B Worker') returning id",
      [orgBTalkId]
    );
    orgBAttendeeId = att.rows[0].id;
  } finally {
    await orgBContributor.end();
  }

  const orgAContributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const readTalk = await orgAContributor.query("select 1 from public.toolbox_talks where id=$1", [orgBTalkId]);
    assert.equal(readTalk.rowCount, 0, "Org A must not see Org B's delivered talk");

    const readAttendee = await orgAContributor.query("select 1 from public.toolbox_talk_attendees where id=$1", [orgBAttendeeId]);
    assert.equal(readAttendee.rowCount, 0, "Org A must not see Org B's attendees");

    const signAttempt = await orgAContributor.query(
      "update public.toolbox_talk_attendees set signed_at=now() where id=$1", [orgBAttendeeId]
    );
    assert.equal(signAttempt.rowCount, 0, "Org A must not be able to sign Org B's attendee");

    const modifyAttempt = await orgAContributor.query(
      "update public.toolbox_talks set site_notes='hacked' where id=$1", [orgBTalkId]
    );
    assert.equal(modifyAttempt.rowCount, 0, "Org A must not be able to modify Org B's talk");

    const completeAttempt = await orgAContributor.query(
      "update public.toolbox_talks set status='completed' where id=$1", [orgBTalkId]
    );
    assert.equal(completeAttempt.rowCount, 0, "Org A must not be able to complete Org B's talk");

    const insertAttendeeAttempt = await orgAContributor.query(
      "insert into public.toolbox_talk_attendees (toolbox_talk_id, name) values ($1,'Injected') returning id",
      [orgBTalkId]
    ).catch((e) => e);
    assert.ok(isRlsError(insertAttendeeAttempt) || insertAttendeeAttempt.rowCount === undefined, "Org A must not be able to add an attendee to Org B's talk");
  } finally {
    await orgAContributor.end();
  }
});

// ─── Project-level isolation ──────────────────────────────────────────
test("PROJECT ISOLATION: a contributor granted toolbox_talks only on Project A1 cannot see or act on Project A2's talks (same organisation)", async () => {
  const orgAAdmin = await userClient(DB, ORGA_ADMIN);
  let talkOnProjA2;
  try {
    // Org A admin has no explicit toolbox_talks grant anywhere, but IS
    // org admin — start a talk on projA2 using the admin's own org-admin
    // authority path instead: grant the admin a role there directly for
    // fixture purposes.
    await orgAAdmin.query(
      "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','contributor',$2) on conflict do nothing",
      [fx.projA2, ORGA_ADMIN]
    );
    const { rows } = await orgAAdmin.query(
      "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x') returning id",
      [fx.projA2, fx.sysTemplateId, fx.sysV1]
    );
    talkOnProjA2 = rows[0].id;
  } finally {
    await orgAAdmin.end();
  }

  const contributor = await userClient(DB, ORGA_CONTRIBUTOR); // only granted on projA
  try {
    const { rowCount } = await contributor.query("select 1 from public.toolbox_talks where id=$1", [talkOnProjA2]);
    assert.equal(rowCount, 0, "module access on one project must not leak visibility into a sibling project in the same organisation");
  } finally {
    await contributor.end();
  }
});

// ─── SECURITY DEFINER privileges ──────────────────────────────────────
test("SECURITY DEFINER: can_edit_toolbox_talk_template_library() is callable by authenticated, rejected for anon", async () => {
  const authed = await userClient(DB, ORGA_EDITOR);
  try {
    const { rows } = await authed.query("select public.can_edit_toolbox_talk_template_library($1) as ok", [fx.orgA]);
    assert.equal(rows[0].ok, true);
  } finally {
    await authed.end();
  }

  const anon = await anonClient(DB);
  try {
    await assert.rejects(
      () => anon.query("select public.can_edit_toolbox_talk_template_library($1)", [fx.orgA]),
      (err) => /permission denied for function/i.test(err.message)
    );
  } finally {
    await anon.end();
  }
});

test("SECURITY DEFINER: anon cannot read, write, sign, or complete anything in this feature", async () => {
  const anon = await anonClient(DB);
  try {
    const templates = await anon.query("select 1 from public.toolbox_talk_templates where id=$1", [fx.sysTemplateId]);
    assert.equal(templates.rowCount, 0, "anon must see zero templates — even system ones");

    const talks = await anon.query("select 1 from public.toolbox_talks where id=$1", [fx.talk1]);
    assert.equal(talks.rowCount, 0);

    await assert.rejects(
      () => anon.query("insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x')", [fx.projA, fx.sysTemplateId, fx.sysV1]),
      (err) => isRlsError(err)
    );
    const signAttempt = await anon.query("update public.toolbox_talk_attendees set signed_at=now() where id=$1", [fx.attendee1]);
    assert.equal(signAttempt.rowCount, 0, "anon must never be able to sign an attendee");
  } finally {
    await anon.end();
  }
});

test("PRIVILEGE ESCALATION: a contributor cannot grant themselves the 'editor' toolbox_talks role", async () => {
  const contributor = await userClient(DB, ORGA_CONTRIBUTOR);
  try {
    const upd = await contributor.query(
      "update public.project_module_roles set role='editor' where project_id=$1 and user_id=$2 and module='toolbox_talks'",
      [fx.projA, ORGA_CONTRIBUTOR]
    );
    assert.equal(upd.rowCount, 0, "only a project owner may grant/revoke project_module_roles — a contributor must not be able to self-escalate");
    const { rows } = await contributor.query(
      "select role from public.project_module_roles where project_id=$1 and user_id=$2 and module='toolbox_talks'",
      [fx.projA, ORGA_CONTRIBUTOR]
    );
    assert.equal(rows[0].role, "contributor", "role must remain unchanged — only a project owner can grant project_module_roles, unchanged by this feature");
  } finally {
    await contributor.end();
  }
});
