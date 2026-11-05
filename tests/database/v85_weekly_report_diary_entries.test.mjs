// v85: weekly_report_diary_entries — diary content attached to a
// weekly report. A dedicated child table, not a column on
// weekly_reports itself (see sql/schema.sql's own comment for why).
// The rule Aled asked for: a contractor-side editor can always read
// (and write) it; anyone else who can otherwise read the parent
// report at all (a client, via the weekly_reports_read capability)
// only once that report has genuinely transitioned to 'issued', and
// never write it regardless. A subcontractor Viewer — who has no
// weekly_reports_read/write capability at all (see
// party_role_capabilities) — never sees it, issued or not.
//
// OWNER here is a genuinely UNRESTRICTED owner-side user (no
// project_module_roles grant at all on Job 1) — is_contractor_side_
// editor() correctly counts them as contractor-side (same reasoning,
// and same fixture shape, as tests/database/v85_personal_diary_
// entries.test.mjs's own "single-company project" case), so they
// behave like MC throughout this file, not like CLIENTUSER.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_v85_weekly_report_diary";
const U = (n) => `a8520000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), MC = U(2), SUBVIEW = U(3), CLIENTUSER = U(4);
const EMAIL = { [OWNER]: "owner@x.test", [MC]: "mc@main.test", [SUBVIEW]: "subview@almo.test", [CLIENTUSER]: "client@clientco.test" };

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

  await as(MC, async (c) => { fx.mcOrg = await newOrg(c, "MainCo"); });
  let inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[MC], "main_contractor"));
  await as(MC, (c) => accept(c, inv.token, fx.mcOrg)); // default collaborator (editor), full mc_mode

  await as(SUBVIEW, async (c) => { fx.almoOrg = await newOrg(c, "Almo", "subcontractor"); });
  inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[SUBVIEW], "subcontractor", "Carpentry"));
  await as(SUBVIEW, (c) => accept(c, inv.token, fx.almoOrg)); // default snagging (viewer) — no weekly_reports capability at all

  await as(CLIENTUSER, async (c) => { fx.clientOrg = await newOrg(c, "ClientCo"); });
  inv = await as(OWNER, (c) => invite(c, fx.job1, EMAIL[CLIENTUSER], "client"));
  await as(CLIENTUSER, (c) => accept(c, inv.token, fx.clientOrg)); // default snagging, but 'client' has weekly_reports_read (any mc_mode)

  // The report itself, owned by the project, created by the (contractor-side) main contractor.
  fx.report = await as(MC, (c) => one(c,
    "insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1, current_date, current_date + 6) returning id",
    [fx.job1]));

  fx.diary = await as(MC, (c) => one(c,
    "insert into public.personal_diary_entries (project_id, entry_date, body) values ($1, current_date, 'Scaffolding went up on the east elevation.') returning id",
    [fx.job1]));
});

after(async () => { await dropTestDatabase(DB); });

test("v85: a contractor-side editor can attach a diary entry to a draft weekly report", async () => {
  await as(MC, async (c) => {
    const row = await one(c,
      "insert into public.weekly_report_diary_entries (weekly_report_id, diary_entry_id, entry_date, body) values ($1, $2, current_date, 'Scaffolding went up on the east elevation.') returning id, project_id, attached_by",
      [fx.report.id, fx.diary.id]);
    assert.equal(row.project_id, fx.job1, "project_id must be trigger-derived from the parent report");
    assert.equal(row.attached_by, MC);
    fx.attachedId = row.id;
  });
});

test("v85: an unrestricted owner-side editor (no commercial-module grant) is contractor-side here too — can read AND attach during draft, same as MC", async () => {
  // Owner Co owns Job 1 outright and OWNER has no project_module_roles
  // grant on it at all — the realistic "single company, no separate
  // parties" shape is_contractor_side_editor() is meant to include.
  await as(OWNER, async (c) => {
    const { rows } = await c.query("select body from public.weekly_report_diary_entries where id = $1", [fx.attachedId]);
    assert.equal(rows.length, 1, "an unrestricted owner-side editor must see the attached diary entry even while the report is still draft");
    const extra = await one(c,
      "insert into public.weekly_report_diary_entries (weekly_report_id, entry_date, body) values ($1, current_date, 'owner can attach too') returning id",
      [fx.report.id]);
    assert.ok(extra.id, "an unrestricted owner-side editor must be able to attach a diary entry too");
    await c.query("delete from public.weekly_report_diary_entries where id = $1", [extra.id]); // tidy up, doesn't affect fx.attachedId
  });
});

test("v85: a client CANNOT insert a diary entry onto the report, and CANNOT see it yet, while it's still draft", async () => {
  await as(CLIENTUSER, async (c) => {
    await assert.rejects(
      c.query("insert into public.weekly_report_diary_entries (weekly_report_id, entry_date, body) values ($1, current_date, 'sneaking one in')", [fx.report.id]),
      denied
    );
    const { rows } = await c.query("select 1 from public.weekly_report_diary_entries where id = $1", [fx.attachedId]);
    assert.equal(rows.length, 0, "a client must not see the attached diary entry while the report is still draft");
  });
});

test("v85: a subcontractor Viewer never sees it — no weekly_reports capability at all, draft or issued", async () => {
  await as(SUBVIEW, async (c) => {
    const { rows } = await c.query("select 1 from public.weekly_report_diary_entries where id = $1", [fx.attachedId]);
    assert.equal(rows.length, 0);
  });
});

test("v85: once the report is actually issued, an owner-side user and a client CAN read the attached diary entry — still only that, never write it", async () => {
  // Real transition, one step at a time: draft -> reviewed -> approved -> issued.
  await as(MC, async (c) => {
    for (const next of ["reviewed", "approved", "issued"]) {
      await c.query("update public.weekly_reports set status = $1 where id = $2", [next, fx.report.id]);
    }
    const { rows } = await c.query("select status from public.weekly_reports where id = $1", [fx.report.id]);
    assert.equal(rows[0].status, "issued");
  });

  // CLIENTUSER has no contractor-side write access at all — blocked
  // silently by RLS (0 rows), issued or not.
  await as(CLIENTUSER, async (c) => {
    const { rows } = await c.query("select body from public.weekly_report_diary_entries where id = $1", [fx.attachedId]);
    assert.equal(rows.length, 1, "a client must be able to read the diary entry once the report is issued");
    assert.equal(rows[0].body, "Scaffolding went up on the east elevation.");

    const upd = await c.query("update public.weekly_report_diary_entries set body = 'tampering' where id = $1", [fx.attachedId]);
    assert.equal(upd.rowCount, 0, "a client must still never be able to WRITE the diary entry, issued or not");
  });

  // OWNER, by contrast, IS contractor-side here (no commercial-module
  // restriction) — their write is refused by the same "content is
  // locked" trigger that blocks MC below, not by a silent RLS no-op.
  await as(OWNER, async (c) => {
    const { rows } = await c.query("select body from public.weekly_report_diary_entries where id = $1", [fx.attachedId]);
    assert.equal(rows.length, 1, "an unrestricted owner-side editor must be able to read the diary entry once the report is issued");

    await assert.rejects(
      c.query("update public.weekly_report_diary_entries set body = 'tampering' where id = $1", [fx.attachedId]),
      /content is locked/
    );
  });

  // The subcontractor Viewer still sees nothing — issuing the report never changes that.
  await as(SUBVIEW, async (c) => {
    assert.equal((await c.query("select 1 from public.weekly_report_diary_entries where id = $1", [fx.attachedId])).rowCount, 0);
  });

  // Once issued, the report itself is locked — even the contractor-side
  // editor who attached it can't edit it further until it's Revised
  // back to draft, exactly like every other issued-report field.
  await as(MC, async (c) => {
    await assert.rejects(
      c.query("update public.weekly_report_diary_entries set body = 'still editing after issue' where id = $1", [fx.attachedId]),
      /content is locked/
    );
  });
});

test("v85: attaching, editing or removing a diary entry is refused once the report is approved/issued, exactly like every other locked field", async () => {
  const report2 = await as(MC, (c) => one(c,
    "insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1, current_date, current_date + 6) returning id",
    [fx.job1]));
  const attached = await as(MC, (c) => one(c,
    "insert into public.weekly_report_diary_entries (weekly_report_id, entry_date, body) values ($1, current_date, 'before approval') returning id",
    [report2.id]));
  await as(MC, async (c) => {
    await c.query("update public.weekly_reports set status = 'reviewed' where id = $1", [report2.id]);
    await c.query("update public.weekly_reports set status = 'approved' where id = $1", [report2.id]);

    await assert.rejects(
      c.query("insert into public.weekly_report_diary_entries (weekly_report_id, entry_date, body) values ($1, current_date, 'too late')", [report2.id]),
      /content is locked/
    );
    await assert.rejects(
      c.query("update public.weekly_report_diary_entries set body = 'edited after approval' where id = $1", [attached.id]),
      /content is locked/
    );
    await assert.rejects(
      c.query("delete from public.weekly_report_diary_entries where id = $1", [attached.id]),
      /content is locked/
    );
  });
});

test("v85: the same diary entry can't be attached to the same report twice (unique index)", async () => {
  await as(MC, async (c) => {
    const report3 = await one(c, "insert into public.weekly_reports (project_id, week_starting, week_ending) values ($1, current_date, current_date + 6) returning id", [fx.job1]);
    await c.query("insert into public.weekly_report_diary_entries (weekly_report_id, diary_entry_id, entry_date, body) values ($1, $2, current_date, 'first')", [report3.id, fx.diary.id]);
    await assert.rejects(
      c.query("insert into public.weekly_report_diary_entries (weekly_report_id, diary_entry_id, entry_date, body) values ($1, $2, current_date, 'duplicate')", [report3.id, fx.diary.id]),
      /duplicate key|unique constraint/i
    );
  });
});

test("v85: get_unattached_diary_entries excludes anything already attached, allows an unrestricted owner-side caller, and refuses a client", async () => {
  let extraDiaryId;
  await as(MC, async (c) => {
    const extraDiary = await one(c, "insert into public.personal_diary_entries (project_id, entry_date, body) values ($1, current_date, 'A second, not-yet-attached note') returning id", [fx.job1]);
    extraDiaryId = extraDiary.id;
    const { rows } = await c.query("select * from public.get_unattached_diary_entries($1, current_date - 7, current_date + 7)", [fx.job1]);
    const ids = rows.map((r) => r.diary_entry_id);
    assert.ok(ids.includes(extraDiary.id), "a not-yet-attached entry must be offered");
    assert.ok(!ids.includes(fx.diary.id), "an already-attached entry must be excluded");
  });

  // OWNER is an unrestricted owner-side editor on Job 1 (no commercial
  // module grant) — contractor-side here too, so the RPC must work for
  // them exactly as it does for MC.
  await as(OWNER, async (c) => {
    const { rows } = await c.query("select * from public.get_unattached_diary_entries($1, current_date - 7, current_date + 7)", [fx.job1]);
    assert.ok(rows.map((r) => r.diary_entry_id).includes(extraDiaryId), "an unrestricted owner-side editor must be offered the same unattached entries as MC");
  });

  await as(CLIENTUSER, async (c) => {
    await assert.rejects(
      c.query("select * from public.get_unattached_diary_entries($1, current_date - 7, current_date + 7)", [fx.job1]),
      /Only a contractor-side project editor/
    );
  });
});
