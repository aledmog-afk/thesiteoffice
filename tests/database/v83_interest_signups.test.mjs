// v83: public.interest_signups — "Register your interest" on the
// public front page. The table has RLS enabled with NO policies for
// anon or authenticated at all: only a service-role client (the
// register-interest edge function) or the table owner (Aled, via the
// Supabase SQL editor) can ever touch it. See the table's own comment
// in sql/schema.sql for why a direct client write isn't possible here
// in the first place (no apikey header from a scriptless public form).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_v83_interest_signups";
const STRANGER = "c1000000-0000-0000-0000-000000000001";

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`insert into auth.users (id, email) values ($1,'stranger@example.com')`, [STRANGER]);
  await admin.end();
});

after(async () => {
  await dropTestDatabase(DB);
});

test("v83: anon cannot read or write interest_signups at all — not even insert", async () => {
  const anon = await anonClient(DB);
  try {
    let insertErr = null;
    try { await anon.query("insert into public.interest_signups (name, email) values ('Someone', 'someone@example.com')"); }
    catch (err) { insertErr = err; }
    assert.ok(isRlsError(insertErr), "anon insert must be denied, not silently succeed");

    let selectErr = null;
    try { await anon.query("select * from public.interest_signups"); }
    catch (err) { selectErr = err; }
    assert.ok(isRlsError(selectErr), "anon select must be denied, not return (even empty) rows");
  } finally {
    await anon.end();
  }
});

test("v83: a signed-in user (authenticated role) also cannot read or write it — this is not even org/project-scoped, it's fully locked", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    let insertErr = null;
    try { await stranger.query("insert into public.interest_signups (name, email) values ('Someone', 'someone@example.com')"); }
    catch (err) { insertErr = err; }
    assert.ok(isRlsError(insertErr), "authenticated insert must be denied");

    let selectErr = null;
    try { await stranger.query("select * from public.interest_signups"); }
    catch (err) { selectErr = err; }
    assert.ok(isRlsError(selectErr), "authenticated select must be denied");
  } finally {
    await stranger.end();
  }
});

test("v83: the table itself works correctly for a privileged (owner/service-role-equivalent) connection, including the email format check", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query(
      "insert into public.interest_signups (name, email, company, message) values ('Jo Smith', 'jo@example.com', 'Smith Builders', 'Looking for a snagging tool') returning id, created_at, source"
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source, "landing_page");
    assert.ok(rows[0].created_at);

    await assert.rejects(
      admin.query("insert into public.interest_signups (name, email) values ('Bad Email', 'not-an-email')"),
      /violates check constraint/i
    );
  } finally {
    await admin.end();
  }
});
