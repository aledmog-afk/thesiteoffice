// v64 — old client-approval links stop showing prices. Real database,
// real non-superuser `anon` role (the logged-out client holding a link).
// A link is ACTIVE only while its request is pending/viewed, not expired,
// and the record is still 'submitted'. Every other state must return
// ONLY the short reply below — checked by exact key set and by scanning
// the whole JSON for anything sensitive (prices, email, line items,
// title, evidence).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient } from "../lib/db.mjs";

const DB = "tracker_test_commercial_approval_link_lockdown";
const OWNER = "e6400000-0000-0000-0000-000000000001";
const CONTRIBUTOR = "e6400000-0000-0000-0000-000000000002";

const RATE = 154.32; // 8 x 154.32 = 1234.56 — a value that can't appear by accident
const TOTAL_TEXT = "1234.56";
const TITLE = "Secret basement waterproofing";
const LINE_DESC = "confidential-line-description";
const ORG_NAME = "Lockdown Builders Ltd";

const INACTIVE_KEYS = ["active", "org_name", "reference", "status"];
const DECIDED_KEYS = ["active", "decided_at", "org_name", "reference", "signer_name", "status"];

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`insert into auth.users (id, email) values ($1,'v64owner@example.com'), ($2,'v64contrib@example.com')`, [OWNER, CONTRIBUTOR]);
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const org = (await owner.query("select public.create_organisation($1, 'main_contractor') as id", [ORG_NAME])).rows[0].id;
  const proj = (await owner.query("insert into public.projects (name, org_id, created_by) values ('v64 site', $1, $2) returning id", [org, OWNER])).rows[0].id;
  const invite = (await owner.query("select public.test_regenerate_invite_code($1) as code", [proj])).rows[0].code;
  const contributor = await userClient(DB, CONTRIBUTOR);
  await contributor.query("select public.test_join_project_by_invite($1)", [invite]);
  await contributor.end();
  await owner.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$2)`, [proj, OWNER]);
  await owner.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$3)`, [proj, CONTRIBUTOR, OWNER]);
  await owner.end();
  fx = { org, proj };
});

after(async () => {
  await dropTestDatabase(DB);
});

// A submitted daywork with one priced line and one evidence document,
// plus a live approval request. Returns ids, token, recipient email and
// the auto-assigned reference.
async function setup() {
  const c = await userClient(DB, CONTRIBUTOR);
  try {
    const eventId = (await c.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork',$2) returning id`, [fx.proj, TITLE])).rows[0].id;
    await c.query(`insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour',$2,8,$3)`, [eventId, LINE_DESC, RATE]);
    const doc = (await c.query(`insert into public.documents (project_id, title) values ($1,'Evidence doc') returning id`, [fx.proj])).rows[0].id;
    await c.query(`insert into public.document_revisions (document_id, file_url, file_name) values ($1,'some/real/path.pdf','evidence.pdf')`, [doc]);
    const evidenceLinkId = (await c.query(`insert into public.commercial_evidence_links (commercial_event_id, source_table, source_id, caption) values ($1,'documents',$2,'evidence') returning id`, [eventId, doc])).rows[0].id;
    await c.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
    const email = `client-${crypto.randomUUID()}@example.invalid`;
    const req = (await c.query(`select * from public.request_commercial_approval($1,$2,'Jane Client','Client Co',168)`, [eventId, email])).rows[0];
    const reference = (await c.query(`select reference from public.commercial_events where id=$1`, [eventId])).rows[0].reference;
    return { eventId, evidenceLinkId, token: req.token, requestId: req.id, email, reference };
  } finally {
    await c.end();
  }
}

async function anonGet(token) {
  const anon = await anonClient(DB);
  try {
    return (await anon.query(`select public.get_commercial_approval_request($1) as r`, [token])).rows[0].r;
  } finally {
    await anon.end();
  }
}

async function anonCall(sql, params) {
  const anon = await anonClient(DB);
  try {
    return await anon.query(sql, params);
  } finally {
    await anon.end();
  }
}

async function adminRun(sql, params) {
  const a = adminClient(DB);
  await a.connect();
  try {
    return await a.query(sql, params);
  } finally {
    await a.end();
  }
}

function assertNothingSensitive(reply, s) {
  const json = JSON.stringify(reply);
  for (const bad of [TOTAL_TEXT, "154.32", TITLE, LINE_DESC, s.email, "Client Co", "line_items", "evidence", "total_value", "recipient", "markup", "expires_at", "project_name", "rejection_reason", "event"]) {
    assert.ok(!json.includes(bad), `inactive reply must not contain ${JSON.stringify(bad)}: ${json}`);
  }
}

async function assertEvidenceRefused(s) {
  await assert.rejects(
    anonCall(`select * from public.resolve_commercial_approval_evidence($1,$2)`, [s.token, s.evidenceLinkId]),
    /no longer valid|expired/i
  );
}

test("v64: an ACTIVE link still returns the full record, now with active:true, and evidence still resolves", async () => {
  const s = await setup();
  const r = await anonGet(s.token);
  assert.equal(r.active, true);
  assert.equal(r.status, "viewed");
  assert.equal(r.org_name, ORG_NAME);
  assert.equal(r.recipient_email, s.email);
  assert.equal(r.event.reference, s.reference);
  assert.equal(r.event.title, TITLE);
  assert.equal(Number(r.event.total_value), 1234.56);
  assert.equal(r.line_items.length, 1);
  assert.equal(r.evidence.length, 1);
  for (const k of ["expires_at", "recipient_name", "recipient_company", "project_name", "linked_dayworks"]) assert.ok(k in r, `active reply keeps ${k}`);
  const { rows } = await anonCall(`select * from public.resolve_commercial_approval_evidence($1,$2)`, [s.token, s.evidenceLinkId]);
  assert.equal(rows.length, 1);
});

test("v64: APPROVED link returns only active/status/org_name/reference/decided_at/signer_name; evidence refused", async () => {
  const s = await setup();
  await anonCall(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [s.token]);
  const r = await anonGet(s.token);
  assert.deepEqual(Object.keys(r).sort(), DECIDED_KEYS);
  assert.equal(r.active, false);
  assert.equal(r.status, "approved");
  assert.equal(r.org_name, ORG_NAME);
  assert.equal(r.reference, s.reference);
  assert.match(r.reference, /^DW-\d+/);
  assert.equal(r.signer_name, "Jane Client");
  assert.ok(r.decided_at, "decided_at is the approval time");
  assertNothingSensitive(r, s);
  await assertEvidenceRefused(s);
});

test("v64: REJECTED link returns the same short shape (no reason, no prices); evidence refused", async () => {
  const s = await setup();
  await anonCall(`select public.reject_commercial_approval_request($1,'Jane Client','Too expensive')`, [s.token]);
  const r = await anonGet(s.token);
  assert.deepEqual(Object.keys(r).sort(), DECIDED_KEYS);
  assert.equal(r.status, "rejected");
  assert.equal(r.signer_name, "Jane Client");
  assert.equal(r.reference, s.reference);
  assert.ok(!JSON.stringify(r).includes("Too expensive"), "the rejection reason is not echoed back to the link");
  assertNothingSensitive(r, s);
  await assertEvidenceRefused(s);
});

test("v64: EXPIRED-by-time link returns only active/status/org_name/reference, and is still lazily marked expired", async () => {
  const s = await setup();
  await adminRun(`update public.commercial_approval_requests set expires_at = now() - interval '1 minute' where id=$1`, [s.requestId]);
  const r = await anonGet(s.token);
  assert.deepEqual(Object.keys(r).sort(), INACTIVE_KEYS);
  assert.equal(r.status, "expired");
  assert.equal(r.reference, s.reference);
  assertNothingSensitive(r, s);
  const row = (await adminRun(`select status from public.commercial_approval_requests where id=$1`, [s.requestId])).rows[0];
  assert.equal(row.status, "expired");
  await assertEvidenceRefused(s);
});

test("v64: REVOKED link returns only active/status/org_name/reference; evidence refused", async () => {
  const s = await setup();
  const c = await userClient(DB, CONTRIBUTOR);
  await c.query(`select public.revoke_commercial_approval_request($1)`, [s.requestId]);
  await c.end();
  const r = await anonGet(s.token);
  assert.deepEqual(Object.keys(r).sort(), INACTIVE_KEYS);
  assert.equal(r.status, "revoked");
  assertNothingSensitive(r, s);
  await assertEvidenceRefused(s);
});

test("v64: a link made stale by RESUBMISSION (trigger marks it expired) returns the short reply", async () => {
  const s = await setup();
  const c = await userClient(DB, CONTRIBUTOR);
  await c.query(`update public.commercial_events set status='rejected' where id=$1`, [s.eventId]);
  await c.query(`update public.commercial_events set status='draft' where id=$1`, [s.eventId]);
  await c.query(`update public.commercial_events set status='submitted' where id=$1`, [s.eventId]);
  await c.end();
  const r = await anonGet(s.token);
  assert.deepEqual(Object.keys(r).sort(), INACTIVE_KEYS);
  assert.equal(r.status, "expired");
  assertNothingSensitive(r, s);
  await assertEvidenceRefused(s);
});

test("v64: a pending link whose record was APPROVED INSIDE THE APP reports status 'closed', short reply, row not rewritten", async () => {
  const s = await setup();
  const c = await userClient(DB, CONTRIBUTOR);
  await c.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Site Manager' where id=$1`, [s.eventId]);
  await c.end();
  const r = await anonGet(s.token);
  assert.deepEqual(Object.keys(r).sort(), INACTIVE_KEYS);
  assert.equal(r.status, "closed");
  assert.equal(r.reference, s.reference);
  assertNothingSensitive(r, s);
  const row = (await adminRun(`select status from public.commercial_approval_requests where id=$1`, [s.requestId])).rows[0];
  assert.equal(row.status, "viewed", "the derived 'closed' state is reported, never written back (only the existing view flip ran)");
  await assertEvidenceRefused(s);
  await assert.rejects(anonCall(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [s.token]), /no longer awaiting approval/i);
});

test("v64: a pending link whose record was REJECTED inside the app is also 'closed'", async () => {
  const s = await setup();
  const c = await userClient(DB, CONTRIBUTOR);
  await c.query(`update public.commercial_events set status='rejected' where id=$1`, [s.eventId]);
  await c.end();
  const r = await anonGet(s.token);
  assert.deepEqual(Object.keys(r).sort(), INACTIVE_KEYS);
  assert.equal(r.status, "closed");
  assertNothingSensitive(r, s);
});

test("v64: REJECT is refused after the record's content drifted from what the link was bound to — same message as approve", async () => {
  const s = await setup();
  // Content can't legitimately change while 'submitted' (child locking),
  // so drift is simulated on the binding itself — exactly what approve's
  // own defence-in-depth check compares against.
  await adminRun(`update public.commercial_approval_requests set bound_content_hash = 'drifted' where id=$1`, [s.requestId]);
  const msg = /This record has changed since this approval request was created\. A new approval request is needed\./;
  await assert.rejects(anonCall(`select public.reject_commercial_approval_request($1,'Jane Client','No')`, [s.token]), msg);
  await assert.rejects(anonCall(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [s.token]), msg);
  const ev = (await adminRun(`select status from public.commercial_events where id=$1`, [s.eventId])).rows[0];
  assert.equal(ev.status, "submitted");
});

test("v64: REJECT is refused when only the bound total drifted", async () => {
  const s = await setup();
  await adminRun(`update public.commercial_approval_requests set bound_total = bound_total + 1 where id=$1`, [s.requestId]);
  await assert.rejects(
    anonCall(`select public.reject_commercial_approval_request($1,'Jane Client','No')`, [s.token]),
    /This record has changed since this approval request was created/
  );
});

test("v64: an unknown token is still 'Invalid approval link.' (no shape leak for garbage tokens)", async () => {
  await assert.rejects(anonCall(`select public.get_commercial_approval_request($1)`, ["not-a-real-token-xyz"]), /Invalid approval link/);
});

test("v64: the three changed functions keep SECURITY DEFINER, a fixed search_path, and exactly anon+authenticated (no PUBLIC) EXECUTE", async () => {
  const sigs = [
    "public.get_commercial_approval_request(text)",
    "public.resolve_commercial_approval_evidence(text,uuid)",
    "public.reject_commercial_approval_request(text,text,text)",
  ];
  for (const sig of sigs) {
    const { rows } = await adminRun(
      `select p.prosecdef, p.proconfig,
              has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok,
              has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok,
              exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                       where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_ok
         from pg_proc p where p.oid = to_regprocedure($1)`,
      [sig]
    );
    assert.equal(rows.length, 1, sig);
    assert.equal(rows[0].prosecdef, true, `${sig} stays SECURITY DEFINER`);
    assert.ok((rows[0].proconfig || []).some((c) => c.startsWith("search_path=")), `${sig} keeps a fixed search_path`);
    assert.equal(rows[0].anon_ok, true);
    assert.equal(rows[0].auth_ok, true);
    assert.equal(rows[0].public_ok, false);
  }
});

test("v64 block sits at the very end of schema.sql (after v63), so a re-run can't restore the old bodies", () => {
  const schema = fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8");
  const v63 = schema.indexOf("-- ─── v63 ADDITIONS");
  const v64 = schema.indexOf("-- ─── v64 ADDITIONS");
  assert.ok(v63 > 0 && v64 > v63);
  for (const fn of ["get_commercial_approval_request", "resolve_commercial_approval_evidence", "reject_commercial_approval_request"]) {
    const last = schema.lastIndexOf(`create or replace function public.${fn}(`);
    assert.ok(last > v64, `the last definition of ${fn} is the v64 one`);
  }
});
