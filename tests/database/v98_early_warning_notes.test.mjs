// v98: Early warning reasons.
//
// weekly_reports.early_warning_notes is a plain jsonb column (see
// sql/schema.sql's own v98 ADDITIONS comment) — no new trigger or RLS
// policy was added for it. This proves that's actually sufficient: an
// editor can set/update it while a report is still draft, the existing
// weekly_reports_before_write() whole-row content-lock already blocks
// any change to it once the report is approved/issued, and the
// existing editor-level RLS already covers it (a non-editor's write is
// rejected the same way it would be for any other column).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v98_early_warning_notes";
const U = (n) => `a9800000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), SNAGGER = U(2);
const EMAIL = { [OWNER]: "owner98@x.test", [SNAGGER]: "snagger98@x.test" };

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

async function createReport(overrides = {}) {
  const f = { week_starting: "2026-03-02", week_ending: "2026-03-06", ...overrides };
  return as(OWNER, (c) => one(c, `
    insert into public.weekly_reports (project_id, week_starting, week_ending, created_by)
    values ($1, $2, $3, $4) returning id
  `, [fx.projectId, f.week_starting, f.week_ending, OWNER]));
}

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);

  await as(OWNER, async (c) => {
    fx.orgId = (await one(c, "select public.create_organisation('Test Org v98', 'main_contractor') as id")).id;
    fx.projectId = (await one(c, "insert into public.projects (name, org_id, created_by) values ('Site A', $1, $2) returning id", [fx.orgId, OWNER])).id;
  });
  await sql("insert into public.project_members (project_id, user_id, role) values ($1,$2,'snagging') on conflict do nothing", [fx.projectId, SNAGGER]);
});

after(async () => { await dropTestDatabase(DB); });

test("v98: a brand-new report defaults early_warning_notes to {}", async () => {
  const rep = await createReport();
  const row = (await sql("select early_warning_notes from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.deepEqual(row.early_warning_notes, {}, "a new report must never be fabricated any early warning notes");
});

test("v98: an editor can set and update early_warning_notes while the report is draft", async () => {
  const rep = await createReport();
  await as(OWNER, (c) => c.query(
    "update public.weekly_reports set early_warning_notes = $2::jsonb where id = $1",
    [rep.id, JSON.stringify({ behind_two_weeks: { text: "Subcontractor delay", updated_at: "2026-03-03T10:00:00Z", updated_by: OWNER } })]
  ));
  let row = (await sql("select early_warning_notes from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.equal(row.early_warning_notes.behind_two_weeks.text, "Subcontractor delay");

  await as(OWNER, (c) => c.query(
    "update public.weekly_reports set early_warning_notes = $2::jsonb where id = $1",
    [rep.id, JSON.stringify({ behind_two_weeks: { text: "Updated reason", updated_at: "2026-03-04T10:00:00Z", updated_by: OWNER } })]
  ));
  row = (await sql("select early_warning_notes from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.equal(row.early_warning_notes.behind_two_weeks.text, "Updated reason", "a draft report's notes can be freely revised");
});

test("v98: a snagging-only member's attempt to set early_warning_notes affects zero rows — existing editor-level RLS already covers the new column", async () => {
  const rep = await createReport();
  const r = await as(SNAGGER, (c) => c.query(
    "update public.weekly_reports set early_warning_notes = $2::jsonb where id = $1",
    [rep.id, JSON.stringify({ labour_drop: { text: "Should never land" } })]
  ));
  assert.equal(r.rowCount, 0, "a non-editor's update must match zero rows under RLS");
  const row = (await sql("select early_warning_notes from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.deepEqual(row.early_warning_notes, {}, "the blocked attempt must leave early_warning_notes untouched");
});

test("v98: once a report is issued, early_warning_notes cannot be changed — the existing whole-row content-lock already blocks it, with no new trigger code", async () => {
  const rep = await createReport();
  await as(OWNER, (c) => c.query(
    "update public.weekly_reports set early_warning_notes = $2::jsonb where id = $1",
    [rep.id, JSON.stringify({ weather_lost: { text: "Three days of rain, crane idle" } })]
  ));
  await as(OWNER, async (c) => {
    await c.query("update public.weekly_reports set status = 'reviewed' where id = $1", [rep.id]);
    await c.query("update public.weekly_reports set status = 'approved' where id = $1", [rep.id]);
    await c.query("update public.weekly_reports set status = 'issued' where id = $1", [rep.id]);
  });

  await assert.rejects(
    as(OWNER, (c) => c.query(
      "update public.weekly_reports set early_warning_notes = $2::jsonb where id = $1",
      [rep.id, JSON.stringify({ weather_lost: { text: "Trying to sneak a change in after issue" } })]
    )),
    /content is locked/i,
    "editing early_warning_notes on an issued report must be rejected by the existing weekly_reports_before_write() lock, the same as any other column"
  );

  const row = (await sql("select early_warning_notes from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.equal(row.early_warning_notes.weather_lost.text, "Three days of rain, crane idle", "the pre-issue value must survive the rejected write untouched");
});

test("v98: an issued report CAN still have its status itself revised back to draft (Revise), independent of early_warning_notes", async () => {
  const rep = await createReport();
  await as(OWNER, async (c) => {
    await c.query("update public.weekly_reports set status = 'reviewed' where id = $1", [rep.id]);
    await c.query("update public.weekly_reports set status = 'approved' where id = $1", [rep.id]);
    await c.query("update public.weekly_reports set status = 'issued' where id = $1", [rep.id]);
  });
  await as(OWNER, (c) => c.query("update public.weekly_reports set status = 'draft' where id = $1", [rep.id]));
  const row = (await sql("select status from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.equal(row.status, "draft");

  // and once back in draft, early_warning_notes is editable again
  await as(OWNER, (c) => c.query(
    "update public.weekly_reports set early_warning_notes = $2::jsonb where id = $1",
    [rep.id, JSON.stringify({ labour_drop: { text: "Now editable again after Revise" } })]
  ));
  const after_ = (await sql("select early_warning_notes from public.weekly_reports where id = $1", [rep.id])).rows[0];
  assert.equal(after_.early_warning_notes.labour_drop.text, "Now editable again after Revise");
});
