// Invite/join flow — both the collaborator and snagging-only links, and
// the Priority 1 behaviour that accepting either also enrols the joiner
// into the project's organisation (never a different one).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_invites";

const OWNER = "40000000-0000-0000-0000-000000000001";
const JOINER = "50000000-0000-0000-0000-000000000002";
const OTHER_ORG_USER = "60000000-0000-0000-0000-000000000003";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'owner@example.com'), ($2,'joiner@example.com'), ($3,'other@example.com')`,
    [OWNER, JOINER, OTHER_ORG_USER]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const org = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;
  const proj = (await owner.query(
    "insert into public.projects (name, org_id, created_by) values ('Invite Test Site', $1, $2) returning id",
    [org, OWNER]
  )).rows[0].id;
  const inviteCode = (await owner.query("select public.regenerate_invite_code($1) as code", [proj])).rows[0].code;
  const snagCode = (await owner.query("select public.regenerate_snagging_invite_code($1) as code", [proj])).rows[0].code;
  await owner.end();

  // A second, unrelated organisation, to prove joining Org A's project
  // never enrols anyone into Org B.
  const other = await userClient(DB, OTHER_ORG_USER);
  const otherOrg = (await other.query("select public.ensure_organisation() as id")).rows[0].id;
  await other.end();

  fx = { org, proj, inviteCode, snagCode, otherOrg };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("Accepting a valid collaborator invite grants project access AND organisation membership", async () => {
  const joiner = await userClient(DB, JOINER);
  try {
    const { rows } = await joiner.query("select public.join_project_by_invite($1) as project_id", [fx.inviteCode]);
    assert.equal(rows[0].project_id, fx.proj);

    const proj = await joiner.query("select 1 from public.projects where id = $1", [fx.proj]);
    assert.equal(proj.rowCount, 1, "joiner should now see the project");

    const role = await joiner.query("select public.get_my_role($1) as role", [fx.proj]);
    assert.equal(role.rows[0].role, "collaborator");
  } finally {
    await joiner.end();
  }
});

test("Joining is enrolled into the PROJECT's organisation, never a different one", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const membership = await admin.query(
      "select 1 from public.organisation_members where org_id = $1 and user_id = $2",
      [fx.org, JOINER]
    );
    assert.equal(membership.rowCount, 1, "joiner should be enrolled into the invite's own organisation");
    const wrongOrg = await admin.query(
      "select 1 from public.organisation_members where org_id = $1 and user_id = $2",
      [fx.otherOrg, JOINER]
    );
    assert.equal(wrongOrg.rowCount, 0, "joiner should NOT be enrolled into an unrelated organisation");
  } finally {
    await admin.end();
  }
});

test("A snagging invite grants the snagging role, not collaborator", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`insert into auth.users (id, email) values ('70000000-0000-0000-0000-000000000007','snagjoiner@example.com') on conflict do nothing`);
  await admin.end();

  const snagJoiner = await userClient(DB, "70000000-0000-0000-0000-000000000007");
  try {
    const { rows } = await snagJoiner.query("select public.join_project_by_invite($1) as project_id", [fx.snagCode]);
    assert.equal(rows[0].project_id, fx.proj);
    const role = await snagJoiner.query("select public.get_my_role($1) as role", [fx.proj]);
    assert.equal(role.rows[0].role, "snagging");
  } finally {
    await snagJoiner.end();
  }
});

test("An invalid/unknown invite code returns null and grants nothing", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`insert into auth.users (id, email) values ('80000000-0000-0000-0000-000000000008','baduser@example.com') on conflict do nothing`);
  await admin.end();

  const user = await userClient(DB, "80000000-0000-0000-0000-000000000008");
  try {
    const { rows } = await user.query("select public.join_project_by_invite('not-a-real-code') as project_id");
    assert.equal(rows[0].project_id, null);
    const proj = await user.query("select 1 from public.projects where id = $1", [fx.proj]);
    assert.equal(proj.rowCount, 0, "an invalid code must not grant access");
  } finally {
    await user.end();
  }
});

test("A revoked invite link stops working", async () => {
  const owner = await userClient(DB, OWNER);
  let revokedCode;
  try {
    revokedCode = (await owner.query("select public.regenerate_invite_code($1) as code", [fx.proj])).rows[0].code;
    await owner.query("select public.revoke_invite_code($1)", [fx.proj]);
  } finally {
    await owner.end();
  }

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`insert into auth.users (id, email) values ('90000000-0000-0000-0000-000000000009','late@example.com') on conflict do nothing`);
  await admin.end();

  const late = await userClient(DB, "90000000-0000-0000-0000-000000000009");
  try {
    const { rows } = await late.query("select public.join_project_by_invite($1) as project_id", [revokedCode]);
    assert.equal(rows[0].project_id, null, "a revoked code must no longer work");
  } finally {
    await late.end();
  }
});

test("Re-opening an invite you've already accepted never downgrades your role", async () => {
  // JOINER is already a collaborator (first test). Accepting the
  // snagging-only link for the same project must not demote them.
  const joiner = await userClient(DB, JOINER);
  try {
    await joiner.query("select public.join_project_by_invite($1)", [fx.snagCode]);
    const role = await joiner.query("select public.get_my_role($1) as role", [fx.proj]);
    assert.equal(role.rows[0].role, "collaborator", "an existing collaborator opening a snagging link must stay a collaborator");
  } finally {
    await joiner.end();
  }
});
