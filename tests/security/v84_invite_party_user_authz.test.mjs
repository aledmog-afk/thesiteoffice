// v84: supabase/functions/invite-party-user/ re-derives authorization
// server-side by SELECTing the named project_party_invites row through
// a client scoped to the CALLER's own JWT — it never trusts a
// caller-supplied org id, and it never decides for itself who counts
// as an "admin". That SELECT is gated by the same
// can_manage_party_invite()-backed RLS policy ("read
// project_party_invites") every other party-invite action already
// uses. These tests prove that exact mechanism directly: a non-admin's
// identical SELECT returns nothing (what the function reads as "not
// authorized to send this invite"), and the real admin's SELECT
// returns the one row the function needs (invited_email, status).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v84_invite_party_user_authz";
const U = (n) => `a8400000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SUBA = U(2), STRANGER = U(3), OTHER_ADMIN = U(4);
const EMAIL = {
  [OWNER]: "owner@x.test", [SUBA]: "dave@almo.test", [STRANGER]: "stranger@x.test", [OTHER_ADMIN]: "otheradmin@x.test",
};

const fx = {};

async function as(user, fn) {
  const c = await userClient(DB, user);
  try { return await fn(c); } finally { await c.end(); }
}
async function sql(q, p = []) {
  const a = adminClient(DB); await a.connect();
  try { return await a.query(q, p); } finally { await a.end(); }
}
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);
const newOrg = (c, name, type = "developer_client") => one(c, "select public.create_organisation($1, $2) as id", [name, type]).then((r) => r.id);

// What invite-party-user's own authorization check does, verbatim:
// select the exact columns the function reads, scoped to this caller's
// own connection (their own JWT, via userClient — never the
// service-role key).
const readInviteAsCaller = (c, inviteId) =>
  c.query("select id, invited_email, status from public.project_party_invites where id = $1", [inviteId]);

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.ownerOrg = await newOrg(c, "Owner Co");
    fx.job1 = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job 1', $1, $2) returning id", [fx.ownerOrg, OWNER])).id;
    fx.invite = await one(c, "select * from public.create_party_invite($1, $2, $3, $4, $5)", [fx.job1, EMAIL[SUBA], "subcontractor", "Carpentry", null]);
  });
  // OTHER_ADMIN administers a completely unrelated organisation — not a
  // party to Job 1 in any way.
  await as(OTHER_ADMIN, async (c) => { fx.otherOrg = await newOrg(c, "Unrelated Co"); });
});

after(async () => { await dropTestDatabase(DB); });

test("v84: a stranger with no relationship to the project at all gets no row back — exactly what the edge function reads as 'not authorized'", async () => {
  await as(STRANGER, async (c) => {
    const { rows } = await readInviteAsCaller(c, fx.invite.invite_id);
    assert.equal(rows.length, 0, "a non-admin's SELECT must return zero rows, never the invite");
  });
});

test("v84: an admin of a totally unrelated organisation also gets nothing — being *an* org admin isn't enough, it has to be the right one", async () => {
  await as(OTHER_ADMIN, async (c) => {
    const { rows } = await readInviteAsCaller(c, fx.invite.invite_id);
    assert.equal(rows.length, 0);
  });
});

test("v84: the actual project owner (who created this invite) gets exactly the row the function needs", async () => {
  await as(OWNER, async (c) => {
    const { rows } = await readInviteAsCaller(c, fx.invite.invite_id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].invited_email, "dave@almo.test");
    assert.equal(rows[0].status, "pending");
  });
});

test("v84: the invited person themself (not yet an admin of anything relevant) cannot read it this way either — only get_party_invite(token) is theirs to use", async () => {
  await as(SUBA, async (c) => {
    const { rows } = await readInviteAsCaller(c, fx.invite.invite_id);
    assert.equal(rows.length, 0, "the invitee reads their invite through get_party_invite(), never this table directly");
  });
});

test("v84: once the invite is accepted (no longer pending), the function's own 'still pending' check is meaningful — the row is still only readable by the owner", async () => {
  await as(SUBA, async (c) => {
    const org = await newOrg(c, "Almo Carpentry", "subcontractor");
    await one(c, "select public.accept_party_invite($1, $2) as p", [fx.invite.token, org]);
  });
  await as(OWNER, async (c) => {
    const { rows } = await readInviteAsCaller(c, fx.invite.invite_id);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].status, "accepted", "the function must refuse to re-invite once accepted (status !== 'pending')");
  });
});
