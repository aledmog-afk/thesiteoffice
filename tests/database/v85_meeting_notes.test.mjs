// v85: org_meeting_notes (general, any org member reads/writes) and
// project_meeting_notes (per-site, any project member reads/writes —
// deliberately NOT tightened to contractor-side-only, unlike the
// personal diary; Aled's instruction only tightened diary visibility).
// Also covers actions.source_meeting_note_id, the link a site
// meeting's follow-up uses to tag the real Actions row it raised.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_v85_meeting_notes";
const U = (n) => `a8510000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), OSTAFF = U(2), SUBVIEW = U(3), OUTSIDER_ADMIN = U(4), STRANGER = U(5);
const EMAIL = {
  [OWNER]: "owner@x.test", [OSTAFF]: "ostaff@x.test", [SUBVIEW]: "subview@almo.test",
  [OUTSIDER_ADMIN]: "outsider@other.test", [STRANGER]: "stranger@x.test",
};

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
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1, $2, 'member')", [fx.ownerOrg, OSTAFF]);

  await as(SUBVIEW, async (c) => { fx.almoOrg = await newOrg(c, "Almo", "subcontractor"); });
  const inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[SUBVIEW], "subcontractor", "Carpentry"));
  await as(SUBVIEW, (c) => accept(c, inv.token, fx.almoOrg)); // stays default 'snagging' (viewer)

  await as(OUTSIDER_ADMIN, async (c) => { fx.outsiderOrg = await newOrg(c, "Totally Unrelated Co"); });
});

after(async () => { await dropTestDatabase(DB); });

// ── General (org-wide) meeting notes ────────────────────────────────
test("v85: an org member can create, read, edit and delete a general meeting note; an outsider never sees it", async () => {
  const row = await as(OWNER, (c) => one(c,
    "insert into public.org_meeting_notes (org_id, meeting_date, title, attendees, notes, follow_ups) values ($1, current_date, 'Monthly H&S review', 'Owner, OStaff', 'Discussed PPE compliance', '[{\"text\":\"Order more hi-vis\",\"done\":false}]'::jsonb) returning id, org_id",
    [fx.ownerOrg]));
  assert.equal(row.org_id, fx.ownerOrg);

  await as(OSTAFF, async (c) => {
    const { rows } = await c.query("select title from public.org_meeting_notes where id = $1", [row.id]);
    assert.equal(rows.length, 1, "any org member must be able to read a general meeting note");
    await c.query("update public.org_meeting_notes set notes = 'Updated notes' where id = $1", [row.id]);
  });
  const updated = await sql("select notes from public.org_meeting_notes where id = $1", [row.id]);
  assert.equal(updated.rows[0].notes, "Updated notes");

  await as(OUTSIDER_ADMIN, async (c) => {
    const { rows } = await c.query("select 1 from public.org_meeting_notes where id = $1", [row.id]);
    assert.equal(rows.length, 0, "an unrelated org must never see this organisation's meeting notes");
    await assert.rejects(
      c.query("insert into public.org_meeting_notes (org_id, meeting_date, title) values ($1, current_date, 'Trying to write into Owner Co')", [fx.ownerOrg]),
      denied
    );
  });

  await as(OWNER, (c) => c.query("delete from public.org_meeting_notes where id = $1", [row.id]));
  assert.equal((await sql("select 1 from public.org_meeting_notes where id = $1", [row.id])).rowCount, 0);
});

test("v85: org_meeting_notes.org_id is immutable and trigger-validated — a stranger can't write for an org they're not in", async () => {
  await as(STRANGER, async (c) => {
    await assert.rejects(
      c.query("insert into public.org_meeting_notes (org_id, meeting_date, title) values ($1, current_date, 'x')", [fx.ownerOrg]),
      denied
    );
  });
});

// ── Per-site meeting notes ──────────────────────────────────────────
test("v85: any project member — including a Viewer — can read and write site meeting notes (deliberately broader than the diary)", async () => {
  const row = await as(OWNER, (c) => one(c,
    "insert into public.project_meeting_notes (project_id, meeting_date, title, attendees, notes) values ($1, current_date, 'Weekly progress meeting', 'Owner, MC', 'Programme on track') returning id, org_id, project_id",
    [fx.job1]));
  assert.equal(row.project_id, fx.job1);
  assert.equal(row.org_id, fx.ownerOrg, "org_id must be trigger-derived from the project");

  await as(SUBVIEW, async (c) => {
    const { rows } = await c.query("select title from public.project_meeting_notes where id = $1", [row.id]);
    assert.equal(rows.length, 1, "even a snagging-only Viewer is a project member and must be able to read a site meeting note");
    const upd = await c.query("update public.project_meeting_notes set notes = 'Viewer added a note' where id = $1", [row.id]);
    assert.equal(upd.rowCount, 1, "any project member may write site meeting notes, not just editors");
  });

  await as(STRANGER, async (c) => {
    assert.equal((await c.query("select 1 from public.project_meeting_notes where id = $1", [row.id])).rowCount, 0);
    await assert.rejects(
      c.query("insert into public.project_meeting_notes (project_id, meeting_date, title) values ($1, current_date, 'x')", [fx.job1]),
      denied
    );
  });
});

test("v85: actions.source_meeting_note_id links a follow-up to the meeting that raised it, and clears (not cascades) if the note is deleted", async () => {
  const note = await as(OWNER, (c) => one(c,
    "insert into public.project_meeting_notes (project_id, meeting_date, title) values ($1, current_date, 'Follow-up test meeting') returning id",
    [fx.job1]));
  const action = await as(OWNER, (c) => one(c,
    "insert into public.actions (project_id, title, source_meeting_note_id) values ($1, 'Fix the fence', $2) returning id, org_id, source_meeting_note_id",
    [fx.job1, note.id]));
  assert.equal(action.org_id, fx.ownerOrg, "actions.org_id is still correctly trigger-derived with the new column present");
  assert.equal(action.source_meeting_note_id, note.id);

  await as(OWNER, (c) => c.query("delete from public.project_meeting_notes where id = $1", [note.id]));
  const after_ = await sql("select source_meeting_note_id from public.actions where id = $1", [action.id]);
  assert.equal(after_.rows[0].source_meeting_note_id, null, "deleting the meeting note must not delete the action it raised");
});
