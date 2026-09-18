// P18b — External Client Approval & Signing workflow (v50). Real
// database, real non-superuser `anon`/`authenticated` roles — this is
// the highest-stakes surface in the app: it is the ONLY place an
// unauthenticated internet caller can ever cause a commercial_events
// row to change status. Every test here either proves that boundary
// holds, or proves the financial/content-binding guarantees the
// external signer implicitly relies on when they click "Approve".
//
// Categories covered (see the P18b final report for the full matrix):
//   - Token security: validity, expiry, revocation, replay,
//     cross-request/cross-event isolation, GUC-forgery resistance,
//     EXECUTE-privilege boundaries for anon vs authenticated.
//   - Financial integrity: bound_total/bound_content_hash binding,
//     the material-change guard, defense-in-depth against a stale
//     cached total, and that no RPC parameter can ever smuggle a
//     different total through.
//   - Signature validation: drawn vs typed, required-field enforcement,
//     correct external attribution in commercial_signatures.
//   - Evidence isolation: correct/cross-event access, revoked/expired
//     denial, continued access once approved/rejected.
//   - State transitions, immutability of an externally-approved
//     record, concurrency (no double-approval), and audit trail.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient } from "../lib/db.mjs";

const DB = "tracker_test_commercial_approval_workflow";

const OWNER = "e1000000-0000-0000-0000-000000000101";
const CONTRIBUTOR = "e2000000-0000-0000-0000-000000000102";
const OUTSIDER = "e3000000-0000-0000-0000-000000000199"; // authenticated, zero grant on this project

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'p18bowner@example.com'), ($2,'p18bcontrib@example.com'), ($3,'p18boutsider@example.com')`,
    [OWNER, CONTRIBUTOR, OUTSIDER]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const orgA = (await owner.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await owner.query("insert into public.projects (name, org_id, created_by) values ('P18b', $1, $2) returning id", [orgA, OWNER])).rows[0].id;
  const invite = (await owner.query("select public.regenerate_invite_code($1) as code", [projA])).rows[0].code;

  const contributor = await userClient(DB, CONTRIBUTOR);
  await contributor.query("select public.join_project_by_invite($1)", [invite]);
  await contributor.end();

  await owner.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$2)`, [projA, OWNER]);
  await owner.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$3)`, [projA, CONTRIBUTOR, OWNER]);

  await owner.end();

  // A second, fully isolated org/project — used for cross-tenant
  // evidence isolation tests.
  const OWNER_B = "e4000000-0000-0000-0000-000000000104";
  const adminB = adminClient(DB);
  await adminB.connect();
  await adminB.query(`insert into auth.users (id, email) values ($1,'p18bownerb@example.com')`, [OWNER_B]);
  await adminB.end();
  const ownerB = await userClient(DB, OWNER_B);
  const orgC = (await ownerB.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('P18b-B', $1, $2) returning id", [orgC, OWNER_B])).rows[0].id;
  await ownerB.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$2)`, [projB, OWNER_B]);
  await ownerB.end();

  fx = { orgA, projA, projB, OWNER_B };
});

after(async () => {
  await dropTestDatabase(DB);
});

// ─── Fixtures ─────────────────────────────────────────────────────────
async function createSubmittedEvent(client, projectId = fx.projA, { rate = 20, title = "P18b test daywork" } = {}) {
  const { rows } = await client.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork',$2) returning id`,
    [projectId, title]
  );
  const eventId = rows[0].id;
  await client.query(
    `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','labour',8,$2)`,
    [eventId, rate]
  );
  await client.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
  return eventId;
}

async function requestApproval(client, eventId, { email = `client-${crypto.randomUUID()}@example.invalid`, name = null, company = null, hours = 168 } = {}) {
  const { rows } = await client.query(
    `select * from public.request_commercial_approval($1,$2,$3,$4,$5)`,
    [eventId, email, name, company, hours]
  );
  return rows[0]; // { id, token, expires_at }
}

// commercial_evidence_links' own INSERT policy only allows a write
// while the parent record is still draft/rejected (see
// commercial_child_locking.test.mjs) — so evidence must always be
// attached BEFORE submission, never after.
async function addEvidence(client, eventId, projectId) {
  const doc = (await client.query(
    `insert into public.documents (project_id, title) values ($1,'Evidence doc') returning id`,
    [projectId]
  )).rows[0];
  await client.query(
    `insert into public.document_revisions (document_id, file_url, file_name) values ($1,'some/real/path.pdf','evidence.pdf')`,
    [doc.id]
  );
  const link = (await client.query(
    `insert into public.commercial_evidence_links (commercial_event_id, source_table, source_id, caption) values ($1,'documents',$2,'evidence') returning id`,
    [eventId, doc.id]
  )).rows[0];
  return link.id;
}

async function createSubmittedEventWithEvidence(client, projectId = fx.projA, { rate = 20, title = "P18b test daywork with evidence" } = {}) {
  const { rows } = await client.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,'daywork',$2) returning id`,
    [projectId, title]
  );
  const eventId = rows[0].id;
  await client.query(
    `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','labour',8,$2)`,
    [eventId, rate]
  );
  const evidenceLinkId = await addEvidence(client, eventId, projectId);
  await client.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
  return { eventId, evidenceLinkId };
}

// ═══════════════════════ TOKEN SECURITY ═══════════════════════════════

test("Token security 1: a fresh request is created pending, with a token distinct from the request id", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  assert.ok(req.token && req.token.length >= 32, "token should be a long random string");
  assert.notEqual(req.token, req.id, "the token must never equal the request's own uuid (id is not a secret, token is)");
  const { rows } = await contributor.query(`select status, commercial_event_id from public.commercial_approval_requests where id=$1`, [req.id]);
  assert.equal(rows[0].status, "pending");
  assert.equal(rows[0].commercial_event_id, eventId);
  await contributor.end();
});

test("Token security 2: two requests for two different events never produce the same token (structural non-collision check)", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const e1 = await createSubmittedEvent(contributor);
  const e2 = await createSubmittedEvent(contributor);
  const r1 = await requestApproval(contributor, e1);
  const r2 = await requestApproval(contributor, e2);
  assert.notEqual(r1.token, r2.token);
  await contributor.end();
});

test("Token security 3: an empty token is rejected with a generic error, not a crash", async () => {
  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select public.get_commercial_approval_request('')`), /invalid approval link/i);
  await anon.end();
});

test("Token security 4: a well-formed but entirely made-up token is rejected — no information about whether ANY request exists is leaked", async () => {
  const anon = await anonClient(DB);
  const fake = crypto.randomBytes(32).toString("base64");
  await assert.rejects(anon.query(`select public.get_commercial_approval_request($1)`, [fake]), /invalid approval link/i);
  await assert.rejects(anon.query(`select public.approve_commercial_approval_request($1,'Someone',null,null)`, [fake]), /invalid approval link/i);
  await anon.end();
});

test("Token security 5: a malformed (non-base64, garbage) token is rejected the same way as any other invalid token — no different error path", async () => {
  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select public.get_commercial_approval_request($1)`, ["not-a-real-token-!!!@@@"]), /invalid approval link/i);
  await anon.end();
});

test("Token security 6: a REVOKED token cannot approve, and the underlying event is left completely untouched", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.query(`select public.revoke_commercial_approval_request($1)`, [req.id]);
  await contributor.end();

  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select public.approve_commercial_approval_request($1,'Someone',null,null)`, [req.token]), /already been actioned|no longer valid/i);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const { rows } = await check.query(`select status from public.commercial_events where id=$1`, [eventId]);
  assert.equal(rows[0].status, "submitted");
  await check.end();
});

test("Token security 7: an EXPIRED token cannot approve, and get_commercial_approval_request lazily marks it expired", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId, { hours: 1 });
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`update public.commercial_approval_requests set expires_at = now() - interval '1 hour' where id=$1`, [req.id]);
  await admin.end();
  await contributor.end();

  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select public.approve_commercial_approval_request($1,'Someone',null,null)`, [req.token]), /expired/i);
  const { rows } = await anon.query(`select public.get_commercial_approval_request($1) as r`, [req.token]);
  assert.equal(rows[0].r.status, "expired");
  await anon.end();

  const check = await userClient(DB, OWNER);
  const dbRow = (await check.query(`select status from public.commercial_approval_requests where id=$1`, [req.id])).rows[0];
  assert.equal(dbRow.status, "expired", "the request row itself must end up labelled expired, not silently stay pending");
  await check.end();
});

test("Token security 8: an already-APPROVED token cannot be approved again (no double-approval via replay)", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  await assert.rejects(anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]), /already been actioned|no longer valid/i);
  await anon.end();
});

test("Token security 9: an already-REJECTED token cannot then be used to approve", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.reject_commercial_approval_request($1,'Jane Client','Too expensive')`, [req.token]);
  await assert.rejects(anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]), /already been actioned|no longer valid/i);
  await anon.end();
});

test("Token security 10: two concurrent, unrelated requests never cross-contaminate — approving request A's token only ever touches event A", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventA = await createSubmittedEvent(contributor, fx.projA, { title: "Event A" });
  const eventB = await createSubmittedEvent(contributor, fx.projA, { title: "Event B" });
  const reqA = await requestApproval(contributor, eventA);
  const reqB = await requestApproval(contributor, eventB);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [reqA.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const a = (await check.query(`select status from public.commercial_events where id=$1`, [eventA])).rows[0];
  const b = (await check.query(`select status from public.commercial_events where id=$1`, [eventB])).rows[0];
  assert.equal(a.status, "approved");
  assert.equal(b.status, "submitted", "an unrelated event's request must be completely unaffected by another approval");
  const reqBRow = (await check.query(`select status from public.commercial_approval_requests where id=$1`, [reqB.id])).rows[0];
  assert.equal(reqBRow.status, "pending", "the unrelated request itself must also be untouched");
  await check.end();
});

test("Token security 11: resolve_commercial_approval_evidence rejects an evidence link that belongs to a DIFFERENT event than the token's own (cross-event isolation)", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventA = await createSubmittedEvent(contributor, fx.projA, { title: "Evidence owner event" });
  const { evidenceLinkId: evidenceOnB } = await createSubmittedEventWithEvidence(contributor, fx.projA, { title: "Unrelated event" });
  const reqA = await requestApproval(contributor, eventA);
  await contributor.end();

  const anon = await anonClient(DB);
  // A wrong-but-real token and a wrong-but-real evidence_link_id both
  // individually pass their own existence check — the join condition
  // `el.commercial_event_id = v_req.commercial_event_id` is what must
  // reject this combination, returning zero rows rather than raising.
  const { rows } = await anon.query(`select * from public.resolve_commercial_approval_evidence($1,$2)`, [reqA.token, evidenceOnB]);
  assert.equal(rows.length, 0, "an evidence link from a different event must resolve to nothing, never that other event's real file");
  await anon.end();
});

test("Token security 12: resolve_commercial_approval_evidence rejects a cross-PROJECT (and cross-org) evidence link the same way", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventA = await createSubmittedEvent(contributor, fx.projA);
  const reqA = await requestApproval(contributor, eventA);
  await contributor.end();

  const ownerB = await userClient(DB, fx.OWNER_B);
  const { evidenceLinkId: evidenceOtherOrg } = await createSubmittedEventWithEvidence(ownerB, fx.projB, { title: "Different org entirely" });
  await ownerB.end();

  const anon = await anonClient(DB);
  const { rows } = await anon.query(`select * from public.resolve_commercial_approval_evidence($1,$2)`, [reqA.token, evidenceOtherOrg]);
  assert.equal(rows.length, 0, "evidence from a completely different org/project must never resolve for someone else's token");
  await anon.end();
});

test("Token security 13: resolve_commercial_approval_evidence denies access once the request is REVOKED", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const { eventId, evidenceLinkId: evidenceLink } = await createSubmittedEventWithEvidence(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.query(`select public.revoke_commercial_approval_request($1)`, [req.id]);
  await contributor.end();

  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select * from public.resolve_commercial_approval_evidence($1,$2)`, [req.token, evidenceLink]), /no longer valid/i);
  await anon.end();
});

test("Token security 14: resolve_commercial_approval_evidence denies access once EXPIRED", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const { eventId, evidenceLinkId: evidenceLink } = await createSubmittedEventWithEvidence(contributor);
  const req = await requestApproval(contributor, eventId, { hours: 1 });
  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(`update public.commercial_approval_requests set expires_at = now() - interval '1 hour' where id=$1`, [req.id]);
  await admin.end();
  await contributor.end();

  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select * from public.resolve_commercial_approval_evidence($1,$2)`, [req.token, evidenceLink]), /expired/i);
  await anon.end();
});

test("Token security 15: evidence remains accessible AFTER a successful approval — a completed record's evidence stays reviewable", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const { eventId, evidenceLinkId: evidenceLink } = await createSubmittedEventWithEvidence(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  const { rows } = await anon.query(`select * from public.resolve_commercial_approval_evidence($1,$2)`, [req.token, evidenceLink]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].object_path, "some/real/path.pdf");
  await anon.end();
});

test("Token security 16: evidence remains accessible AFTER a rejection too", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const { eventId, evidenceLinkId: evidenceLink } = await createSubmittedEventWithEvidence(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.reject_commercial_approval_request($1,'Jane Client','No good')`, [req.token]);
  const { rows } = await anon.query(`select * from public.resolve_commercial_approval_evidence($1,$2)`, [req.token, evidenceLink]);
  assert.equal(rows.length, 1);
  await anon.end();
});

test("Token security 17: a malicious anon caller cannot forge authorization by directly setting the internal GUC the trigger reads — only a token that genuinely re-validates against a real, active request row grants anything", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  await contributor.end();

  // A caller with zero legitimate token tries to set the exact GUC the
  // trigger inspects, to whatever value they like, then attempts a raw
  // status UPDATE directly — bypassing the RPCs entirely.
  const anon = await anonClient(DB);
  await anon.query("select set_config('app.commercial_external_approval_token', 'totally-made-up-value', true)");
  // Either the UPDATE affects 0 rows (RLS silently filters it) or it throws — both are acceptable "denied" outcomes; only a real row change is not.
  await anon.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Hacker' where id=$1`, [eventId]).catch(() => {});
  const check = await userClient(DB, OWNER);
  const { rows } = await check.query(`select status from public.commercial_events where id=$1`, [eventId]);
  assert.equal(rows[0].status, "submitted", "setting the GUC to a fabricated value must never grant approval — only genuine possession of a real, hashed-and-matched token can");
  await check.end();
  await anon.end();
});

test("Token security 18: EXECUTE privilege boundary — anon and authenticated both CAN call the four external RPCs, catalog-verified, not just incidentally", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const externalFns = ["get_commercial_approval_request", "resolve_commercial_approval_evidence", "approve_commercial_approval_request", "reject_commercial_approval_request"];
  const { rows } = await admin.query(
    `select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok
       from pg_proc p where p.proname = any($1)`,
    [externalFns]
  );
  assert.equal(rows.length, externalFns.length);
  for (const r of rows) {
    assert.equal(r.anon_ok, true, `${r.proname} must be anon-callable — this is the whole point of the external workflow`);
    assert.equal(r.auth_ok, true, `${r.proname} must also remain callable by a signed-in internal user (e.g. testing/preview)`);
  }
  await admin.end();
});

test("Token security 19: EXECUTE privilege boundary — anon CANNOT call the two internal-only RPCs (request/revoke), even accounting for this project's default-ACL auto-grant gotcha", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const internalFns = ["request_commercial_approval", "revoke_commercial_approval_request"];
  const { rows } = await admin.query(
    `select p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') as anon_ok, has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_ok
       from pg_proc p where p.proname = any($1)`,
    [internalFns]
  );
  assert.equal(rows.length, internalFns.length);
  for (const r of rows) {
    assert.equal(r.anon_ok, false, `${r.proname} must NOT be anon-callable — requesting or revoking a client approval is an internal-only action`);
    assert.equal(r.auth_ok, true, `${r.proname} must remain callable by an authenticated internal user`);
  }
  await admin.end();

  // Behavioural confirmation, not just catalog metadata.
  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select * from public.request_commercial_approval($1,'x@example.invalid',null,null,168)`, [crypto.randomUUID()]), /permission denied for function/i);
  await anon.end();
});

test("Token security 20: an authenticated user with ZERO grant on the project cannot mint an approval token for someone else's record (cross-tenant token minting)", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  await contributor.end();

  const outsider = await userClient(DB, OUTSIDER);
  await assert.rejects(
    outsider.query(`select * from public.request_commercial_approval($1,'attacker@example.invalid',null,null,168)`, [eventId]),
    /do not have permission/i
  );
  await outsider.end();

  const check = await userClient(DB, OWNER);
  const { rows } = await check.query(`select count(*)::int as n from public.commercial_approval_requests where commercial_event_id=$1`, [eventId]);
  assert.equal(rows[0].n, 0, "no request row should have been created by the unauthorized attempt");
  await check.end();
});

test("Token security 21: anon cannot read commercial_approval_requests, commercial_events, or commercial_line_items directly — every read goes through the curated RPC", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  const r1 = await anon.query(`select * from public.commercial_approval_requests`);
  const r2 = await anon.query(`select * from public.commercial_events`);
  const r3 = await anon.query(`select * from public.commercial_line_items`);
  assert.equal(r1.rows.length, 0);
  assert.equal(r2.rows.length, 0);
  assert.equal(r3.rows.length, 0);
  await anon.end();
});

// ═══════════════════════ FINANCIAL INTEGRITY ═══════════════════════════

test("Financial 1: bound_total captured at request creation matches the authoritative commercial_event_totals view exactly", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 37.5 });
  const req = await requestApproval(contributor, eventId);
  const { rows } = await contributor.query(
    `select r.bound_total, t.total from public.commercial_approval_requests r
       join public.commercial_event_totals t on t.commercial_event_id = r.commercial_event_id
       where r.id=$1`,
    [req.id]
  );
  assert.equal(Number(rows[0].bound_total), Number(rows[0].total));
  assert.equal(Number(rows[0].bound_total), 300.0); // 8h * 37.5
  await contributor.end();
});

test("Financial 2: the total the external signer sees via get_commercial_approval_request equals the authoritative total_value, never a separately computed figure", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 42 });
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  const { rows } = await anon.query(`select public.get_commercial_approval_request($1) as r`, [req.token]);
  const dbTotal = (await (async () => {
    const c = await userClient(DB, OWNER);
    const t = (await c.query(`select total_value from public.commercial_events where id=$1`, [eventId])).rows[0].total_value;
    await c.end();
    return Number(t);
  })());
  assert.equal(Number(rows[0].r.event.total_value), dbTotal);
  await anon.end();
});

test("Financial 3: approving with content unchanged locks in exactly the bound total — the real, line-item-derived figure", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 20 });
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const { rows } = await check.query(`select status, total_value from public.commercial_events where id=$1`, [eventId]);
  assert.equal(rows[0].status, "approved");
  assert.equal(Number(rows[0].total_value), 160.0);
  await check.end();
});

test("Financial 4 (MATERIAL-CHANGE GUARD): approving after the record's content genuinely changed since the request was created is refused — the stale request is separately invalidated on resubmission", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 20 });
  const req = await requestApproval(contributor, eventId);

  await contributor.query(`update public.commercial_events set status='rejected' where id=$1`, [eventId]);
  await contributor.query(`update public.commercial_events set status='draft' where id=$1`, [eventId]);
  await contributor.query(`insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'material','extra material added later',1,500)`, [eventId]);
  await contributor.query(`update public.commercial_events set status='submitted' where id=$1`, [eventId]);
  await contributor.end();

  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select public.approve_commercial_approval_request($1,'Someone',null,null)`, [req.token]), /already been actioned|no longer valid/i);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const event = (await check.query(`select status from public.commercial_events where id=$1`, [eventId])).rows[0];
  assert.equal(event.status, "submitted", "the stale approval attempt must never silently approve the NEW content");
  const reqRow = (await check.query(`select status from public.commercial_approval_requests where id=$1`, [req.id])).rows[0];
  assert.equal(reqRow.status, "expired", "resubmission must proactively invalidate the stale request");
  await check.end();
});

test("Financial 5: request_commercial_approval() itself refuses to run if the cached total ever disagrees with the authoritative view (defense in depth against a stale cache)", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 20 });

  // Force a genuine cache/view disagreement using the SAME trusted-writer
  // GUC recompute_commercial_event_total() itself uses — simulating a
  // hypothetical stale cache without disabling any trigger. Must be
  // session-level (is_local=false): each separate client.query() call
  // is its own implicit transaction, so a transaction-local (true) GUC
  // would already have reverted before the UPDATE below even runs.
  await contributor.query("select set_config('app.allow_commercial_total_change','on',false)");
  await contributor.query(`update public.commercial_events set total_value = 999999.99 where id=$1`, [eventId]);
  await contributor.query("select set_config('app.allow_commercial_total_change','off',false)");

  await assert.rejects(
    contributor.query(`select * from public.request_commercial_approval($1,'client@example.invalid',null,null,168)`, [eventId]),
    /cached and authoritative totals disagree/i
  );
  const { rows } = await contributor.query(`select count(*)::int as n from public.commercial_approval_requests where commercial_event_id=$1`, [eventId]);
  assert.equal(rows[0].n, 0, "no request should ever be created against a record whose total cannot be trusted");
  await contributor.end();
});

test("Financial 6: a direct UPDATE...SET total_value while an approval request is actively pending is still silently forced back (v49 protection is unconditional)", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 20 });
  await requestApproval(contributor, eventId);
  await contributor.query(`update public.commercial_events set total_value = 1.00 where id=$1`, [eventId]);
  const { rows } = await contributor.query(`select total_value from public.commercial_events where id=$1`, [eventId]);
  assert.equal(Number(rows[0].total_value), 160.0, "a tamper attempt mid-approval-window must still be ignored, exactly as for the internal flow");
  await contributor.end();
});

test("Financial 7: approve_commercial_approval_request() accepts no total/amount parameter at all — there is no argument through which a different figure could ever be smuggled", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const { rows } = await admin.query(
    `select pg_get_function_arguments(oid) as args from pg_proc where proname='approve_commercial_approval_request'`
  );
  assert.match(rows[0].args, /^p_token text, p_signer_name text, p_signer_company text, p_signature_data text$/, "the function signature must carry no total/amount parameter whatsoever");
  await admin.end();
});

test("Financial 8: rejecting a record does not alter or reset its total_value", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 20 });
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.reject_commercial_approval_request($1,'Jane Client','No good')`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const { rows } = await check.query(`select status, total_value from public.commercial_events where id=$1`, [eventId]);
  assert.equal(rows[0].status, "rejected");
  assert.equal(Number(rows[0].total_value), 160.0);
  await check.end();
});

test("Financial 9: an approved record's total remains fully immutable afterward, including against a would-be 'PDF used a manipulated total' attempt", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 20 });
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  await assert.rejects(check.query(`update public.commercial_events set total_value = 1.00 where id=$1`, [eventId]), /immutable/i);
  const { rows } = await check.query(`select total_value from public.commercial_events where id=$1`, [eventId]);
  assert.equal(Number(rows[0].total_value), 160.0, "the figure any PDF export reads after approval can only ever be the real, locked-in total");
  await check.end();
});

// ═══════════════════════ SIGNATURE VALIDATION ═══════════════════════════

test("Signature 1: approving with a drawn signature records signature_type='drawn' and the raw signature data, no typed name", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client','Acme','data:image/png;base64,ABC123')`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const reqRow = (await check.query(`select signature_type from public.commercial_approval_requests where id=$1`, [req.id])).rows[0];
  assert.equal(reqRow.signature_type, "drawn");
  const sig = (await check.query(`select signature_data, signature_typed_name from public.commercial_signatures where commercial_event_id=$1 and action='approved'`, [eventId])).rows[0];
  assert.equal(sig.signature_data, "data:image/png;base64,ABC123");
  assert.equal(sig.signature_typed_name, null);
  await check.end();
});

test("Signature 2: approving with only a typed name (no drawing) records signature_type='typed', matching the existing internal typed-name fallback exactly", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const reqRow = (await check.query(`select signature_type from public.commercial_approval_requests where id=$1`, [req.id])).rows[0];
  assert.equal(reqRow.signature_type, "typed");
  const sig = (await check.query(`select signature_data, signature_typed_name from public.commercial_signatures where commercial_event_id=$1 and action='approved'`, [eventId])).rows[0];
  assert.equal(sig.signature_data, null);
  assert.equal(sig.signature_typed_name, "Jane Client");
  await check.end();
});

test("Signature 3: a blank or whitespace-only name is rejected for both approve and reject", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select public.approve_commercial_approval_request($1,'   ',null,null)`, [req.token]), /name is required/i);
  await assert.rejects(anon.query(`select public.reject_commercial_approval_request($1,$2,$3)`, [req.token, "", "Bad price"]), /name is required/i);
  await anon.end();
});

test("Signature 4: rejection requires a non-blank reason as well as a name", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await assert.rejects(anon.query(`select public.reject_commercial_approval_request($1,'Jane Client','   ')`, [req.token]), /reason is required/i);
  await anon.end();
});

test("Signature 5: an externally-signed commercial_signatures row is attributed to the approval_request, never a fabricated internal user, and is clearly labelled external", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId, { email: "jane@clientco.example", name: "Jane Client" });
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client','Acme',null)`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const sig = (await check.query(`select signed_by_user_id, approval_request_id, signed_by_name from public.commercial_signatures where commercial_event_id=$1 and action='approved'`, [eventId])).rows[0];
  assert.equal(sig.signed_by_user_id, null);
  assert.equal(sig.approval_request_id, req.id);
  assert.match(sig.signed_by_name, /\(external\)/);
  assert.match(sig.signed_by_name, /jane@clientco\.example/);
  await check.end();
});

test("Signature 6: the commercial_signatures identity CHECK constraint refuses a row with neither a user nor a request — the DB-level backstop actually works", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  await contributor.end();
  await assert.rejects(
    admin.query(
      `insert into public.commercial_signatures (commercial_event_id, project_id, action, signed_by_name, org_id, statement_version, record_hash) values ($1,$2,'approved','Nobody',$3,'v1','hash')`,
      [eventId, fx.projA, fx.orgA]
    ),
    /commercial_signatures_signer_identity_check|violates check constraint/i
  );
  await admin.end();
});

// ═══════════════════════ STATE TRANSITIONS / IMMUTABILITY ═══════════════

test("State 1: an externally-approved record ends up with approved_by NULL (no internal actor exists) but approved_at correctly set — true attribution lives in commercial_signatures instead", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const { rows } = await check.query(`select approved_by, approved_at from public.commercial_events where id=$1`, [eventId]);
  assert.equal(rows[0].approved_by, null);
  assert.notEqual(rows[0].approved_at, null);
  await check.end();
});

test("State 2 (COMPREHENSIVE IMMUTABILITY): every material field on an externally-approved record is rejected on a direct write attempt", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const { eventId, evidenceLinkId: evidenceLink } = await createSubmittedEventWithEvidence(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  await anon.end();

  const owner = await userClient(DB, OWNER);
  const attempts = [
    ["title", `update public.commercial_events set title='hacked' where id=$1`, [eventId]],
    ["total_value", `update public.commercial_events set total_value=1 where id=$1`, [eventId]],
    // A real, different project — proves the field itself is locked,
    // not merely that a nonsensical/nonexistent id gets rejected by
    // the unrelated FK-validation branch instead.
    ["project_id", `update public.commercial_events set project_id=$2 where id=$1`, [eventId, fx.projB]],
    ["status", `update public.commercial_events set status='draft' where id=$1`, [eventId]],
    ["approved_by", `update public.commercial_events set approved_by=$2 where id=$1`, [eventId, OWNER]],
  ];
  try {
    for (const [label, sql, params] of attempts) {
      await assert.rejects(owner.query(sql, params), /immutable/i, `field "${label}" must be rejected once approved`);
    }
    // Child-row locking is enforced via RLS's UPDATE policy, not a
    // raising trigger — a locked-out UPDATE matches zero rows rather
    // than throwing (see commercial_child_locking.test.mjs, which
    // establishes this exact pattern for the same tables).
    const lineUpd = await owner.query(`update public.commercial_line_items set rate=999 where commercial_event_id=$1`, [eventId]);
    assert.equal(lineUpd.rowCount, 0, "line items must be locked once the parent is approved");
    const evidenceUpd = await owner.query(`update public.commercial_evidence_links set caption='hacked' where id=$1`, [evidenceLink]);
    assert.equal(evidenceUpd.rowCount, 0, "evidence links must be locked once the parent is approved");
    const sig = (await owner.query(`select id from public.commercial_signatures where commercial_event_id=$1 and action='approved'`, [eventId])).rows[0];
    const del = await owner.query(`delete from public.commercial_signatures where id=$1`, [sig.id]);
    assert.equal(del.rowCount, 0, "an approval signature must be undeletable by any client role");
  } finally {
    await owner.end();
  }
});

test("State 3: a rejected-externally record correctly carries the rejection reason and signer identity on both the event and the request row", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.reject_commercial_approval_request($1,'Jane Client','Pricing looks too high')`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const event = (await check.query(`select status, rejection_reason from public.commercial_events where id=$1`, [eventId])).rows[0];
  assert.equal(event.status, "rejected");
  assert.equal(event.rejection_reason, "Pricing looks too high");
  const reqRow = (await check.query(`select status, signer_name, rejection_reason from public.commercial_approval_requests where id=$1`, [req.id])).rows[0];
  assert.equal(reqRow.status, "rejected");
  assert.equal(reqRow.signer_name, "Jane Client");
  assert.equal(reqRow.rejection_reason, "Pricing looks too high");
  await check.end();
});

test("State 4: only one ACTIVE (pending/viewed) request can exist per event at a time — a second attempt is refused", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  await requestApproval(contributor, eventId);
  await assert.rejects(
    requestApproval(contributor, eventId, { email: "second@example.invalid" }),
    /already an active approval request/i
  );
  await contributor.end();
});

// ═══════════════════════ CONCURRENCY ═══════════════════════════════════

test("Concurrency: two simultaneous approve attempts with the SAME token — exactly one succeeds, no double signature, no double-processing", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anonA = await anonClient(DB);
  const anonB = await anonClient(DB);
  const results = await Promise.allSettled([
    anonA.query(`select public.approve_commercial_approval_request($1,'Racer A',null,null)`, [req.token]),
    anonB.query(`select public.approve_commercial_approval_request($1,'Racer B',null,null)`, [req.token]),
  ]);
  await anonA.end();
  await anonB.end();

  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1, "exactly one of the two concurrent approvals must succeed");
  assert.equal(rejected.length, 1, "the other must fail cleanly, not silently double-apply");

  const check = await userClient(DB, OWNER);
  const event = (await check.query(`select status from public.commercial_events where id=$1`, [eventId])).rows[0];
  assert.equal(event.status, "approved");
  const sigCount = (await check.query(`select count(*)::int as n from public.commercial_signatures where commercial_event_id=$1 and action='approved'`, [eventId])).rows[0].n;
  assert.equal(sigCount, 1, "there must be exactly one approval signature row, never two, regardless of the race");
  await check.end();
});

// ═══════════════════════ AUDIT TRAIL ═══════════════════════════════════

test("Audit 1: creating, and later externally approving, a request each write a commercial_approval_requests audit_log entry, with the external UPDATE correctly carrying a NULL actor", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'Jane Client',null,null)`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const rows = (await check.query(
    `select action, user_id from public.audit_log where table_name='commercial_approval_requests' and record_id=$1 order by created_at`,
    [req.id]
  )).rows;
  assert.ok(rows.some((r) => r.action === "INSERT" && r.user_id === CONTRIBUTOR), "the creation must be attributed to the internal user who requested it");
  assert.ok(rows.some((r) => r.action === "UPDATE" && r.user_id === null), "the external approval's own UPDATE must carry a null actor — there is no internal user to attribute it to, by design");
  await check.end();
});

test("Audit 2: revoking a request writes an audit_log entry attributed to the internal user who revoked it", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor);
  const req = await requestApproval(contributor, eventId);
  await contributor.query(`select public.revoke_commercial_approval_request($1)`, [req.id]);
  const rows = (await contributor.query(
    `select action, user_id from public.audit_log where table_name='commercial_approval_requests' and record_id=$1 and action='UPDATE' order by created_at desc limit 1`,
    [req.id]
  )).rows;
  assert.equal(rows[0].user_id, CONTRIBUTOR);
  await contributor.end();
});

// ═══════════════════════ PDF DATA CORRECTNESS ═══════════════════════════
// buildCommercialEventPdfDocument()/generateCommercialEventPdfBlob() are
// unmodified, pure/reused code (confirmed during P18b — see the final
// report); this proves the DATA they will read for an externally
// approved record is exactly correct, which is what actually
// determines PDF correctness here.

test("PDF data 1: after external approval, the row generateCommercialEventPdfBlob() would read has the real total and a PDF-consumable signature (signerLabel-null-safe, signed_by_name carries the external identity)", async () => {
  const contributor = await userClient(DB, CONTRIBUTOR);
  const eventId = await createSubmittedEvent(contributor, fx.projA, { rate: 55 });
  const req = await requestApproval(contributor, eventId, { email: "pdfcheck@example.invalid", name: "PDF Checker" });
  await contributor.end();

  const anon = await anonClient(DB);
  await anon.query(`select public.approve_commercial_approval_request($1,'PDF Checker',null,'data:image/png;base64,XYZ')`, [req.token]);
  await anon.end();

  const check = await userClient(DB, OWNER);
  const event = (await check.query(`select total_value, status from public.commercial_events where id=$1`, [eventId])).rows[0];
  assert.equal(event.status, "approved");
  assert.equal(Number(event.total_value), 440.0); // 8h * 55
  const sig = (await check.query(`select signed_by_user_id, signed_by_name, signature_data, signature_typed_name from public.commercial_signatures where commercial_event_id=$1 and action='approved'`, [eventId])).rows[0];
  // Mirrors buildCommercialEventPdfDocument()'s own `signerLabel(sig.signed_by_user_id) || sig.signed_by_name` — signerLabel of a null uid must fall through to signed_by_name.
  assert.equal(sig.signed_by_user_id, null);
  assert.match(sig.signed_by_name, /PDF Checker.*pdfcheck@example\.invalid.*\(external\)/);
  assert.equal(sig.signature_data, "data:image/png;base64,XYZ");
  await check.end();
});
