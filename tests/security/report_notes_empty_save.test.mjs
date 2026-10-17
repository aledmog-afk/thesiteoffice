// v62 fix: a save from a pre-v62 front end (weekly/monthly report form
// sending commercial_items = '[]') must never delete or overwrite notes
// already moved into report_commercial_notes. Non-empty saves still
// replace them. Real non-superuser `authenticated` role throughout.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(__dirname, "../../sql/schema.sql"), "utf8");
const DB = "tracker_test_report_notes_empty_save";
const OWNER = "a6600000-0000-0000-0000-000000000001";
const fx = {};
const sql = async (q, p = []) => { const a = adminClient(DB); await a.connect(); try { return await a.query(q, p); } finally { await a.end(); } };
const as = async (uid, f) => { const c = await userClient(DB, uid); try { return await f(c); } finally { await c.end(); } };
const notes = (kind) => sql("select items from public.report_commercial_notes where report_kind = $1", [kind]).then((r) => r.rows.map((x) => x.items));

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql("insert into auth.users (id, email) values ($1, 'o@x.test')", [OWNER]);
  await as(OWNER, async (c) => {
    const org = (await c.query("select public.create_organisation('Tai Tarian','developer_client') as id")).rows[0].id;
    fx.job = (await c.query("insert into public.projects (name, org_id, created_by) values ('County Flats',$1,$2) returning id", [org, OWNER])).rows[0].id;
    fx.wr = (await c.query(`insert into public.weekly_reports (project_id, week_starting, week_ending, commercial_items) values ($1,'2026-10-05','2026-10-11','[{"title":"98 Moorland Road"}]') returning id`, [fx.job])).rows[0].id;
    fx.mr = (await c.query(`insert into public.monthly_reports (project_id, month, commercial_items) values ($1,'2026-10-01','[{"title":"Dayworks"}]') returning id`, [fx.job])).rows[0].id;
  });
});
after(async () => { await dropTestDatabase(DB); });

test("the role used is the real non-superuser authenticated role", async () => {
  await as(OWNER, async (c) => {
    const r = (await c.query("select current_user u, (select rolsuper from pg_roles where rolname = current_user) s")).rows[0];
    assert.equal(r.u, "authenticated"); assert.equal(r.s, false);
  });
});

test("an old-form weekly save with an empty list keeps the saved note", async () => {
  assert.deepEqual(await notes("weekly"), [[{ title: "98 Moorland Road" }]]);
  await as(OWNER, (c) => c.query("update public.weekly_reports set commercial_items = '[]'::jsonb, progress_summary = 'old form save' where id = $1", [fx.wr]));
  assert.deepEqual(await notes("weekly"), [[{ title: "98 Moorland Road" }]]);
  assert.deepEqual((await sql("select commercial_items c from public.weekly_reports where id = $1", [fx.wr])).rows[0].c, []);
});

test("an old-form monthly save with an empty list keeps the saved note", async () => {
  await as(OWNER, (c) => c.query("update public.monthly_reports set commercial_items = '[]'::jsonb where id = $1", [fx.mr]));
  assert.deepEqual(await notes("monthly"), [[{ title: "Dayworks" }]]);
});

test("a non-empty save still replaces the notes as before", async () => {
  await as(OWNER, (c) => c.query(`update public.weekly_reports set commercial_items = '[{"title":"VO 8"}]'::jsonb where id = $1`, [fx.wr]));
  assert.deepEqual(await notes("weekly"), [[{ title: "VO 8" }]]);
});

test("re-running the schema is a no-op for saved notes and the trigger guard", async () => {
  const before = (await sql("select report_kind, report_id, items, updated_at from public.report_commercial_notes order by 1,2")).rows;
  await sql(SCHEMA);
  const after = (await sql("select report_kind, report_id, items, updated_at from public.report_commercial_notes order by 1,2")).rows;
  assert.deepEqual(after, before);
  await as(OWNER, (c) => c.query("update public.weekly_reports set commercial_items = '[]'::jsonb where id = $1", [fx.wr]));
  assert.deepEqual(await notes("weekly"), [[{ title: "VO 8" }]]);
});
