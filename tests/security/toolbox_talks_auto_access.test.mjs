// Toolbox Talks — v46 automatic project-editor access (real, non-superuser
// `authenticated` Postgres role throughout — see toolbox_talks.test.mjs's
// header for why this matters).
//
// Before v46, Toolbox Talks access was a fully separate, explicit
// project_module_roles opt-in from project membership — the same model
// Commercial correctly uses for its sensitive financial data, but wrong
// for H&S content that needs to be seen and delivered by everyone
// genuinely working on a site. v46 makes every project owner/collaborator
// (is_project_editor()) get 'contributor' access automatically, with an
// explicit project_module_roles row still able to override it either way
// (up to 'editor', or down to 'viewer'). Covers: the auto-grant itself,
// explicit-grant-always-wins in both directions, snagging-only members
// staying excluded by default, Commercial staying completely untouched,
// and the higher-trust template-library 'editor' tier staying opt-in.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_toolbox_talks_auto_access";

const OWNER = "c1000000-0000-0000-0000-000000000001";
const PLAIN_COLLAB = "c2000000-0000-0000-0000-000000000002"; // collaborator, zero explicit grants anywhere
const DOWNGRADED_COLLAB = "c3000000-0000-0000-0000-000000000003"; // collaborator, explicit 'viewer' (below the contributor default)
const UPGRADED_COLLAB = "c4000000-0000-0000-0000-000000000004"; // collaborator, explicit 'editor' (above the contributor default)
const SNAGGING_MEMBER = "c5000000-0000-0000-0000-000000000005"; // snagging-only, zero explicit grants

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values
       ($1,'owner@example.com'), ($2,'plain-collab@example.com'),
       ($3,'downgraded-collab@example.com'), ($4,'upgraded-collab@example.com'),
       ($5,'snagging@example.com')`,
    [OWNER, PLAIN_COLLAB, DOWNGRADED_COLLAB, UPGRADED_COLLAB, SNAGGING_MEMBER]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const org = (await owner.query("select public.create_organisation('Auto Access Ltd', 'main_contractor') as id")).rows[0].id;
  const proj = (await owner.query(
    "insert into public.projects (name, org_id, created_by) values ('Auto Access Site', $1, $2) returning id", [org, OWNER]
  )).rows[0].id;
  const inviteCode = (await owner.query("select public.regenerate_invite_code($1) as code", [proj])).rows[0].code;
  const snaggingInviteCode = (await owner.query("select public.regenerate_snagging_invite_code($1) as code", [proj])).rows[0].code;
  await owner.end();

  for (const uid of [PLAIN_COLLAB, DOWNGRADED_COLLAB, UPGRADED_COLLAB]) {
    const c = await userClient(DB, uid);
    await c.query("select public.join_project_by_invite($1)", [inviteCode]);
    await c.end();
  }
  const snagging = await userClient(DB, SNAGGING_MEMBER);
  await snagging.query("select public.join_project_by_invite($1)", [snaggingInviteCode]);
  await snagging.end();

  const owner2 = await userClient(DB, OWNER);
  await owner2.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','viewer',$3)",
    [proj, DOWNGRADED_COLLAB, OWNER]
  );
  await owner2.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','editor',$3)",
    [proj, UPGRADED_COLLAB, OWNER]
  );
  await owner2.end();

  // System template (org_id null) — direct superuser write, bypassing
  // RLS, exactly as the real import process runs (see
  // toolbox_talks.test.mjs's own fixture for the same pattern).
  const admin2 = adminClient(DB);
  await admin2.connect();
  const sysTemplateId = (await admin2.query(
    "insert into public.toolbox_talk_templates (org_id, title) values (null, 'Site Induction') returning id"
  )).rows[0].id;
  const sysV1 = (await admin2.query(
    "insert into public.toolbox_talk_template_versions (template_id, content) values ($1, $2) returning id",
    [sysTemplateId, JSON.stringify({ introduction: "intro" })]
  )).rows[0].id;
  await admin2.end();

  fx = { org, proj, sysTemplateId, sysV1 };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("AUTO ACCESS: the project owner gets 'contributor' automatically with zero explicit project_module_roles grant", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const { rows } = await owner.query("select public.effective_toolbox_talk_role($1) as role", [fx.proj]);
    assert.equal(rows[0].role, "contributor");
    const view = await owner.query("select public.can_view_toolbox_talks($1) as ok", [fx.proj]);
    assert.equal(view.rows[0].ok, true);
    const edit = await owner.query("select public.can_edit_toolbox_talks($1) as ok", [fx.proj]);
    assert.equal(edit.rows[0].ok, true);
  } finally {
    await owner.end();
  }
});

test("AUTO ACCESS: a plain collaborator (no explicit grant) also gets 'contributor' automatically, and can really start/read a talk", async () => {
  const collab = await userClient(DB, PLAIN_COLLAB);
  try {
    const { rows } = await collab.query("select public.effective_toolbox_talk_role($1) as role", [fx.proj]);
    assert.equal(rows[0].role, "contributor");

    const insert = await collab.query(
      "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'Induction') returning id",
      [fx.proj, fx.sysTemplateId, fx.sysV1]
    );
    assert.equal(insert.rowCount, 1, "a plain collaborator must be able to start a talk with no explicit grant at all");

    const read = await collab.query("select 1 from public.toolbox_talks where id=$1", [insert.rows[0].id]);
    assert.equal(read.rowCount, 1);
  } finally {
    await collab.end();
  }
});

test("AUTO ACCESS: an explicit grant below the automatic default still restricts — a collaborator with an explicit 'viewer' row can view but cannot start a talk", async () => {
  const viewer = await userClient(DB, DOWNGRADED_COLLAB);
  try {
    const { rows } = await viewer.query("select public.effective_toolbox_talk_role($1) as role", [fx.proj]);
    assert.equal(rows[0].role, "viewer", "an explicit grant must always win over the automatic default, even downward");

    const view = await viewer.query("select public.can_view_toolbox_talks($1) as ok", [fx.proj]);
    assert.equal(view.rows[0].ok, true);
    const edit = await viewer.query("select public.can_edit_toolbox_talks($1) as ok", [fx.proj]);
    assert.equal(edit.rows[0].ok, false, "an explicit viewer grant must not be upgraded to contributor by membership");

    const insertAttempt = await viewer.query(
      "insert into public.toolbox_talks (project_id, template_id, template_version_id, title) values ($1,$2,$3,'x')",
      [fx.proj, fx.sysTemplateId, fx.sysV1]
    ).catch((e) => e);
    assert.ok(insertAttempt instanceof Error, "an explicitly-downgraded viewer must not be able to start a talk");
  } finally {
    await viewer.end();
  }
});

test("AUTO ACCESS: an explicit 'editor' grant still elevates above the automatic contributor default, and unlocks template-library editing", async () => {
  const editor = await userClient(DB, UPGRADED_COLLAB);
  try {
    const { rows } = await editor.query("select public.effective_toolbox_talk_role($1) as role", [fx.proj]);
    assert.equal(rows[0].role, "editor");

    const canEditLibrary = await editor.query("select public.can_edit_toolbox_talk_template_library($1) as ok", [fx.org]);
    assert.equal(canEditLibrary.rows[0].ok, true);
  } finally {
    await editor.end();
  }
});

test("AUTO ACCESS: a snagging-only member gets NO automatic Toolbox Talks access — the auto-grant is scoped to is_project_editor() (owner/collaborator), not general membership", async () => {
  const snagging = await userClient(DB, SNAGGING_MEMBER);
  try {
    const { rows } = await snagging.query("select public.effective_toolbox_talk_role($1) as role", [fx.proj]);
    assert.equal(rows[0].role, null);
    const view = await snagging.query("select public.can_view_toolbox_talks($1) as ok", [fx.proj]);
    assert.ok(!view.rows[0].ok, "can_view_toolbox_talks() must be falsy (SQL NULL propagates from a null effective role, treated as false by RLS)");

    const talks = await snagging.query("select 1 from public.toolbox_talks where project_id=$1", [fx.proj]);
    assert.equal(talks.rowCount, 0, "a snagging-only member must see zero toolbox talks with no explicit grant");
  } finally {
    await snagging.end();
  }
});

test("AUTO ACCESS: an explicit grant still lets an owner extend access to a snagging-only member as an exception", async () => {
  const owner = await userClient(DB, OWNER);
  await owner.query(
    "insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'toolbox_talks','viewer',$3)",
    [fx.proj, SNAGGING_MEMBER, OWNER]
  );
  await owner.end();

  const snagging = await userClient(DB, SNAGGING_MEMBER);
  try {
    const view = await snagging.query("select public.can_view_toolbox_talks($1) as ok", [fx.proj]);
    assert.equal(view.rows[0].ok, true, "an explicit grant must still work for a snagging-only member exactly as before v46");
  } finally {
    await snagging.end();
  }
});

test("COMMERCIAL UNAFFECTED: the same owner/collaborator who now gets automatic Toolbox Talks access still gets nothing for Commercial without an explicit grant", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    const role = await owner.query("select public.project_module_role($1, 'commercial') as role", [fx.proj]);
    assert.equal(role.rows[0].role, null);
    const view = await owner.query("select public.can_view_commercial($1) as ok", [fx.proj]);
    assert.ok(!view.rows[0].ok, "Commercial must remain fully opt-in for everyone, including the project owner — v46 only touches Toolbox Talks");
  } finally {
    await owner.end();
  }

  const collab = await userClient(DB, PLAIN_COLLAB);
  try {
    const view = await collab.query("select public.can_view_commercial($1) as ok", [fx.proj]);
    assert.ok(!view.rows[0].ok);
  } finally {
    await collab.end();
  }
});

test("TEMPLATE LIBRARY UNAFFECTED: mere project ownership/collaboration does NOT grant org-level template-library editing — that higher-trust tier still requires org admin or an explicit 'editor' grant", async () => {
  const collab = await userClient(DB, PLAIN_COLLAB);
  try {
    const canEditLibrary = await collab.query("select public.can_edit_toolbox_talk_template_library($1) as ok", [fx.org]);
    assert.equal(canEditLibrary.rows[0].ok, false, "a plain collaborator's automatic 'contributor' role must never imply org-wide template-library editing rights");
  } finally {
    await collab.end();
  }
});
