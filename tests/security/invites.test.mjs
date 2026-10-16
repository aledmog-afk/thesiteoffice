// v61: the old per-project invite codes are RETIRED. Opening one must
// refuse with a friendly message and must never add anyone to any
// organisation or project — the auto-add into the owner's company that
// stage 1 left in place is gone. Company invites replace them (see
// tests/security/project_parties.test.mjs).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_invites";
const OWNER = "40000000-0000-0000-0000-000000000001";
const JOINER = "50000000-0000-0000-0000-000000000002";
let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`insert into auth.users (id, email) values ($1,'owner@example.com'), ($2,'joiner@example.com')`, [OWNER, JOINER]);
  const owner = await userClient(DB, OWNER);
  const org = (await owner.query("select public.create_organisation('Owner Co', 'main_contractor') as id")).rows[0].id;
  const proj = (await owner.query("insert into public.projects (name, org_id, created_by) values ('Site', $1, $2) returning id", [org, OWNER])).rows[0].id;
  await owner.end();
  // A code left over from before v61 (as on a real database).
  await admin.query("update public.projects set invite_code = 'legacy-code', snagging_invite_code = 'legacy-snag' where id = $1", [proj]);
  await admin.end();
  fx = { org, proj };
});
after(async () => { await dropTestDatabase(DB); });

for (const code of ["legacy-code", "legacy-snag", "unknown-code"]) {
  test(`A retired invite code (${code}) refuses with the friendly message and grants nothing`, async () => {
    const joiner = await userClient(DB, JOINER);
    try {
      await assert.rejects(joiner.query("select public.join_project_by_invite($1)", [code]), /no longer used.*company invite/);
      const proj = await joiner.query("select 1 from public.projects where id = $1", [fx.proj]);
      assert.equal(proj.rowCount, 0);
    } finally { await joiner.end(); }
    const admin = adminClient(DB); await admin.connect();
    const om = await admin.query("select 1 from public.organisation_members where user_id = $1", [JOINER]);
    const pm = await admin.query("select 1 from public.project_members where user_id = $1", [JOINER]);
    await admin.end();
    assert.equal(om.rowCount, 0, "must never add the joiner to any organisation");
    assert.equal(pm.rowCount, 0, "must never add the joiner to the project");
  });
}

test("Even the owner can no longer generate new invite codes", async () => {
  const owner = await userClient(DB, OWNER);
  try {
    await assert.rejects(owner.query("select public.regenerate_invite_code($1)", [fx.proj]), /invite_retired/);
    await assert.rejects(owner.query("select public.regenerate_snagging_invite_code($1)", [fx.proj]), /invite_retired/);
  } finally { await owner.end(); }
});
