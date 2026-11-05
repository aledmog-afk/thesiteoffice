// v86: actions.source_diary_entry_id — the link a site-assigned diary
// entry's follow-up uses to tag the real Actions row it raised. Mirrors
// actions.source_meeting_note_id exactly (v85, see
// tests/database/v85_meeting_notes.test.mjs's own version of this
// test) — reuses the shared Actions engine rather than adding
// assignee/due/status fields to personal_diary_entries itself.
//
// Privacy (Stuart, non-negotiable, checked here): the column is inert
// metadata only — an Action never carries diary CONTENT, just this FK
// id, which is useless without a separate read of
// personal_diary_entries (gated by its own tighter, contractor-side-
// only RLS — see v85). Actions keep their EXISTING RLS unchanged
// (is_project_editor()-gated); this file proves the new column opens
// no new read/write pathway into actions, and that a plain `select *`
// on an action never returns diary body/title.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_v86_diary_raise_action";
const U = (n) => `a8600000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), MC = U(2), STRANGER = U(3);
const EMAIL = { [OWNER]: "owner@x.test", [MC]: "mc@main.test", [STRANGER]: "stranger@x.test" };

const fx = {};
const denied = (e) => isRlsError(e) || e?.code === "42501";

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
const invite = (c, job, email, role, trade = null) => one(c, "select * from public.create_party_invite($1, $2, $3, $4)", [job, email, role, trade]);
const accept = (c, token, org) => one(c, "select public.accept_party_invite($1, $2) as p", [token, org]).then((r) => r.p);

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.ownerOrg = await newOrg(c, "Owner Co");
    fx.job1 = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Job 1', $1, $2) returning id", [fx.ownerOrg, OWNER])).id;
  });

  // Main contractor — defaults to 'collaborator' (full mc_mode), a
  // genuine contractor-side editor.
  await as(MC, async (c) => { fx.mcOrg = await newOrg(c, "MainCo"); });
  let inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[MC], "main_contractor"));
  await as(MC, (c) => accept(c, inv.token, fx.mcOrg));

  // STRANGER has no relationship to the project at all — no editor
  // access, no party, no project_members row, none of the v62
  // party-capability grants (e.g. a subcontractor Viewer has their own
  // 'actions_own' capability via party_role_capabilities and legitimately
  // CAN raise actions — a real, pre-existing feature, not something
  // this column should touch — so STRANGER is the clean "definitely
  // cannot write" case, not a Viewer).

  // A site-assigned diary entry, authored by MC, to raise follow-ups from.
  fx.diary = await as(MC, (c) => one(c,
    "insert into public.personal_diary_entries (project_id, entry_date, body) values ($1, current_date, 'Scaffolding went up on the east elevation.') returning id",
    [fx.job1]));
});

after(async () => { await dropTestDatabase(DB); });

test("v86: a contractor-side editor can raise an action from a site-assigned diary entry, and the action carries no diary content", async () => {
  const action = await as(MC, (c) => one(c,
    "insert into public.actions (project_id, title, source_diary_entry_id) values ($1, 'Fix the scaffolding gap', $2) returning *",
    [fx.job1, fx.diary.id]));
  assert.equal(action.org_id, fx.ownerOrg, "actions.org_id is still correctly trigger-derived (from the project, not the diary entry) with the new column present");
  assert.equal(action.source_diary_entry_id, fx.diary.id);
  assert.equal(action.title, "Fix the scaffolding gap", "the title is whatever the user typed — never copied from the diary note's own body/title");
  assert.equal(action.body, undefined, "an action never carries diary body content — select * on actions has no such column at all");
});

test("v86: actions.source_diary_entry_id clears (not cascades) if the diary entry is deleted — the action itself survives", async () => {
  const action = await as(MC, (c) => one(c,
    "insert into public.actions (project_id, title, source_diary_entry_id) values ($1, 'Order more hi-vis', $2) returning id",
    [fx.job1, fx.diary.id]));

  await as(MC, (c) => c.query("delete from public.personal_diary_entries where id = $1", [fx.diary.id]));

  const after_ = await sql("select id, title, source_diary_entry_id from public.actions where id = $1", [action.id]);
  assert.equal(after_.rows.length, 1, "deleting the diary entry must not delete the action it raised");
  assert.equal(after_.rows[0].title, "Order more hi-vis");
  assert.equal(after_.rows[0].source_diary_entry_id, null, "the link clears to null, not a dangling/cascaded reference");

  // Restore the fixture entry for subsequent tests in this file.
  fx.diary = await as(MC, (c) => one(c,
    "insert into public.personal_diary_entries (project_id, entry_date, body) values ($1, current_date, 'Scaffolding went up on the east elevation.') returning id",
    [fx.job1]));
});

test("v86: a stranger with no relationship to the project cannot raise an action at all — the new column opens no new write pathway around actions' existing RLS", async () => {
  await as(STRANGER, async (c) => {
    await assert.rejects(
      c.query("insert into public.actions (project_id, title, source_diary_entry_id) values ($1, 'Sneaking one in', $2)", [fx.job1, fx.diary.id]),
      denied
    );
  });
});

test("v86: get_actions_for_diary_entry-equivalent query (select * from actions where source_diary_entry_id = ...) returns only what a contractor-side editor is already allowed to see via actions' own RLS", async () => {
  const a1 = await as(MC, (c) => one(c,
    "insert into public.actions (project_id, title, source_diary_entry_id) values ($1, 'First follow-up', $2) returning id",
    [fx.job1, fx.diary.id]));
  const a2 = await as(MC, (c) => one(c,
    "insert into public.actions (project_id, title, source_diary_entry_id) values ($1, 'Second follow-up', $2) returning id",
    [fx.job1, fx.diary.id]));

  await as(MC, async (c) => {
    const { rows } = await c.query("select id, title from public.actions where source_diary_entry_id = $1 order by created_at", [fx.diary.id]);
    assert.deepEqual(rows.map((r) => r.id).sort(), [a1.id, a2.id].sort());
  });

  // A stranger with no relationship to the project gets nothing back
  // for the same query — actions' own read policy, unaffected by this
  // new column.
  await as(STRANGER, async (c) => {
    const { rows } = await c.query("select 1 from public.actions where source_diary_entry_id = $1", [fx.diary.id]);
    assert.equal(rows.length, 0, "an unrelated stranger must not see follow-up actions raised from a diary entry, same as they see no actions at all");
  });
});
