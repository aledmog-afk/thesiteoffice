// v67 (Aled's decisions, 17 Oct): on Dayworks & Variations a Viewer sees
// TOTALS ONLY — never quantities, hours, rates, line totals, markup, the
// direct subtotal, line ids or content hashes — by ANY route; Viewers get
// no commercial change history and no PDF data; the project OWNER (owner
// side only, via is_project_owner) is automatically a Contributor; org
// admins get nothing automatic. Real database, real non-superuser
// `authenticated` users through userClient — the same role PostgREST uses.
//
// Storage: commercial PDFs are generated in the browser and never stored;
// evidence files live in the controlled-documents bucket and carry no
// prices — so there is no storage route to price data to test (asserted
// below by checking no commercial bucket exists).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient, runSqlFile } from "../lib/db.mjs";

const DB = "tracker_test_commercial_viewer_totals_v67";
const SCHEMA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../sql/schema.sql");
const U = (n) => `a6700000-0000-0000-0000-0000000000${String(n).padStart(2, "0")}`;
const OWNER = U(1), VIEWER = U(2), CONTRIB = U(3), COLLAB = U(4), ORGADMIN = U(5), SUB = U(6), OUTSIDER = U(7), OWNER_VIEWER_GRANT = U(8);
const EMAIL = { [OWNER]: "own@v67.test", [VIEWER]: "view@v67.test", [CONTRIB]: "con@v67.test", [COLLAB]: "col@v67.test", [ORGADMIN]: "adm@v67.test", [SUB]: "sub@v67.test", [OUTSIDER]: "out@v67.test", [OWNER_VIEWER_GRANT]: "own2@v67.test" };

// Distinctive numbers so any leak is easy to spot in serialised output.
// DW1: 7.5 × 47.25 = 354.38 ; 3 × 13.33 = 39.99 ; 1 × TBC  → total 394.37
// DW2: 2 × 250.5 = 501.00 → total 501.00 (linked to V1; its TOTAL may show)
// V1 : 6.25 × 41.17 = 257.31 direct ; markup 12.5% → (257.31 + 501) × 1.125 = 853.10
const SECRETS = ["47.25", "7.5", "354.38", "13.33", "39.99", "250.5", "41.17", "6.25", "257.31", "12.5", "758.31"];
const FORBIDDEN_KEYS = ["quantity", "rate", "line_total", "markup_pct", "own_subtotal", "direct_subtotal", "record_hash", "bound_content_hash", "content_hash", "token", "token_hash"];

const fx = {};
async function as(u, fn) { const c = await userClient(DB, u); try { return await fn(c); } finally { await c.end(); } }
async function sql(q, p = []) { const a = adminClient(DB); await a.connect(); try { return await a.query(q, p); } finally { await a.end(); } }
const rows = (c, q, p) => c.query(q, p).then((r) => r.rows);
const one = (c, q, p) => c.query(q, p).then((r) => r.rows[0]);

// No secret number, line id, 64-hex hash or forbidden key anywhere in the
// value. Timestamps are stripped first (fractional seconds could otherwise
// contain e.g. "6.25" by coincidence).
function assertNoPriceData(value, label) {
  const json = JSON.stringify(value ?? null);
  const scrubbed = json.replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}(:?\d{2})?|Z)?/g, "<ts>");
  for (const s of SECRETS) assert.ok(!scrubbed.includes(s), `${label}: leaked price figure ${s} in ${scrubbed.slice(0, 400)}`);
  for (const id of fx.lineIds) assert.ok(!json.includes(id), `${label}: leaked a line id`);
  assert.ok(!/[0-9a-f]{64}/i.test(json), `${label}: leaked a content hash`);
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { assert.ok(!FORBIDDEN_KEYS.includes(k), `${label}: has forbidden key "${k}"`); walk(x); }
  };
  walk(value);
}

const PRICE_TABLES = ["commercial_line_items", "variations", "commercial_event_totals", "commercial_signatures", "commercial_approval_requests"];
const COMMERCIAL_AUDIT_TABLES = ["commercial_events", "commercial_line_items", "variations", "dayworks", "variation_dayworks", "commercial_evidence_links", "commercial_signatures", "commercial_approval_requests", "commercial_items"];

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  await sql(`insert into auth.users (id, email) select (e).key::uuid, (e).value from jsonb_each_text($1::jsonb) e`, [JSON.stringify(EMAIL)]);
  await as(OWNER, async (c) => {
    fx.org = (await one(c, "select public.create_organisation('Owner Co','main_contractor') as id")).id;
    fx.proj = (await one(c, "insert into public.projects (name, org_id, created_by) values ('v67 site',$1,$2) returning id", [fx.org, OWNER])).id;
    fx.invite = (await one(c, "select public.test_regenerate_invite_code($1) as code", [fx.proj])).code;
  });
  for (const u of [VIEWER, CONTRIB, COLLAB]) await as(u, (c) => c.query("select public.test_join_project_by_invite($1)", [fx.invite]));
  await as(OWNER, async (c) => {
    await c.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$3)`, [fx.proj, VIEWER, OWNER]);
    await c.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','contributor',$3)`, [fx.proj, CONTRIB, OWNER]);
  });
  // An org admin of the owner's company who is NOT on this project.
  await sql("insert into public.organisation_members (org_id, user_id, role) values ($1,$2,'admin')", [fx.org, ORGADMIN]);
  // A subcontractor-party user.
  const inv = await as(OWNER, (c) => one(c, "select * from public.create_party_invite($1,$2,'subcontractor','Carpentry',null)", [fx.proj, EMAIL[SUB]]));
  await as(SUB, async (c) => {
    const sorg = (await one(c, "select public.create_organisation('Sub Co','subcontractor') as id")).id;
    await c.query("select public.accept_party_invite($1,$2)", [inv.token, sorg]);
  });
  // A second owner-side project where the owner was ALSO given an explicit
  // viewer grant (pre-v67 data): ownership must still win → Contributor.
  await as(OWNER_VIEWER_GRANT, async (c) => {
    const org2 = (await one(c, "select public.create_organisation('Owner Two','main_contractor') as id")).id;
    fx.proj2 = (await one(c, "insert into public.projects (name, org_id, created_by) values ('v67 site 2',$1,$2) returning id", [org2, OWNER_VIEWER_GRANT])).id;
    await c.query(`insert into public.project_module_roles (project_id, user_id, module, role, granted_by) values ($1,$2,'commercial','viewer',$2)`, [fx.proj2, OWNER_VIEWER_GRANT]);
  });

  // Data, created by the Contributor through the real policies/triggers.
  await as(CONTRIB, async (c) => {
    const ev = async (type, title) => (await one(c, `insert into public.commercial_events (project_id, type, title) values ($1,$2,$3) returning id`, [fx.proj, type, title])).id;
    const line = async (e, d, q, r) => (await one(c, `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, unit, rate) values ($1,'labour',$2,$3,'hrs',$4) returning id`, [e, d, q, r])).id;
    fx.dw1 = await ev("daywork", "Drainage dig");
    await c.query(`insert into public.dayworks (commercial_event_id, date_undertaken) values ($1,'2026-10-01')`, [fx.dw1]);
    fx.lineIds = [await line(fx.dw1, "Groundworker", 7.5, 47.25), await line(fx.dw1, "Labourer", 3, 13.33), await line(fx.dw1, "Mini digger", 1, null)];
    fx.dw2 = await ev("daywork", "Extra skip");
    await c.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [fx.dw2]);
    fx.lineIds.push(await line(fx.dw2, "Skip hire", 2, 250.5));
    fx.v1 = await ev("variation", "Re-route drain");
    await c.query(`insert into public.variations (commercial_event_id, markup_pct, date_identified, instruction_reference, reason) values ($1,12.5,'2026-10-02','CI-007','Client change')`, [fx.v1]);
    fx.lineIds.push(await line(fx.v1, "Bricklayer", 6.25, 41.17));
    await c.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [fx.v1, fx.dw2]);
    for (const e of [fx.dw1, fx.v1]) await c.query(`update public.commercial_events set status='submitted' where id=$1`, [e]);
    // An internal signed approval (signature row with a record hash) and a
    // live client approval request (bound hash + token).
    await c.query(`update public.commercial_events set status='approved', pending_signature_typed_name='Con Tributor' where id=$1`, [fx.dw1]);
    const req = await one(c, `select * from public.request_commercial_approval($1,'client@v67.test','Jane Client','Client Co',168)`, [fx.v1]);
    fx.token = req.token;
  });
  fx.lineIds = fx.lineIds.map(String);
  const totals = (await sql(`select id, total_value::text t from public.commercial_events where id = any($1)`, [[fx.dw1, fx.dw2, fx.v1]])).rows;
  fx.totals = Object.fromEntries(totals.map((r) => [r.id, r.t]));
});
after(async () => { await dropTestDatabase(DB); });

test("fixture sanity: totals are what the comments say, and the price data really exists (so 'nothing returned' below means hidden, not absent)", async () => {
  assert.equal(fx.totals[fx.dw1], "394.37");
  assert.equal(fx.totals[fx.dw2], "501.00");
  assert.equal(fx.totals[fx.v1], "853.10");
  for (const t of PRICE_TABLES) {
    const n = Number((await sql(`select count(*) n from public.${t}`)).rows[0].n);
    assert.ok(n > 0, `${t} has rows`);
  }
  const auditRows = Number((await sql(`select count(*) n from public.audit_log where table_name = any($1)`, [COMMERCIAL_AUDIT_TABLES])).rows[0].n);
  assert.ok(auditRows > 0);
});

// ─── 1. direct selects ─────────────────────────────────────────────
test("Viewer: direct selects on commercial_line_items, variations, commercial_event_totals, commercial_signatures and commercial_approval_requests return NO rows", async () => {
  await as(VIEWER, async (c) => {
    for (const t of PRICE_TABLES) assert.deepEqual(await rows(c, `select * from public.${t}`), [], `${t} must be empty for a Viewer`);
  });
});

test("Viewer: no commercial change history — audit_log returns no rows for any commercial table, and no audit row anywhere carries price data", async () => {
  await as(VIEWER, async (c) => {
    assert.deepEqual(await rows(c, `select * from public.audit_log where table_name = any($1)`, [COMMERCIAL_AUDIT_TABLES]), []);
    const all = await rows(c, `select * from public.audit_log`);
    assertNoPriceData(all.map((r) => ({ t: r.table_name, o: r.old_data ?? r.old_values ?? null, n: r.new_data ?? r.new_values ?? null })), "audit_log (all visible rows)");
  });
});

test("Viewer: what they CAN read (commercial_events, dayworks, variation_dayworks, commercial_evidence_links) carries totals only — no price figures, line ids or hashes", async () => {
  await as(VIEWER, async (c) => {
    const events = await rows(c, `select * from public.commercial_events order by created_at`);
    assert.equal(events.length, 3, "a Viewer still sees the records");
    assert.deepEqual(Object.fromEntries(events.map((e) => [e.id, e.total_value])), fx.totals, "and their totals");
    assertNoPriceData(events, "commercial_events");
    for (const t of ["dayworks", "variation_dayworks", "commercial_evidence_links"]) assertNoPriceData(await rows(c, `select * from public.${t}`), t);
  });
});

test("completeness guard: every table with a foreign key to commercial_events is either hidden from Viewers or on the reviewed totals-only list", async () => {
  const refs = (await sql(`select distinct conrelid::regclass::text t from pg_constraint where contype='f' and confrelid='public.commercial_events'::regclass order by 1`)).rows.map((r) => r.t.replace(/^public\./, ""));
  const REVIEWED = new Set([...PRICE_TABLES, "dayworks", "variation_dayworks", "commercial_evidence_links", "commercial_events"]);
  assert.deepEqual(refs.filter((t) => !REVIEWED.has(t)), [], "a new table pointing at commercial_events must be reviewed for Viewer leaks");
});

// ─── 2. PostgREST-style embedded selects ───────────────────────────
test("Viewer: PostgREST-style embedded selects from commercial_events (?select=*,commercial_line_items(*),variations(*),…) embed nothing — RLS applies to each embedded table", async () => {
  await as(VIEWER, async (c) => {
    // This is the shape PostgREST generates for resource embedding: a
    // lateral sub-select per relation, each run under the caller's RLS.
    const r = await rows(c, `
      select ce.id, ce.total_value,
        coalesce((select json_agg(li) from public.commercial_line_items li where li.commercial_event_id = ce.id), '[]') as commercial_line_items,
        (select row_to_json(v) from public.variations v where v.commercial_event_id = ce.id) as variations,
        coalesce((select json_agg(s) from public.commercial_signatures s where s.commercial_event_id = ce.id), '[]') as commercial_signatures,
        coalesce((select json_agg(a) from public.commercial_approval_requests a where a.commercial_event_id = ce.id), '[]') as commercial_approval_requests,
        (select row_to_json(t) from public.commercial_event_totals t where t.commercial_event_id = ce.id) as commercial_event_totals,
        coalesce((select json_agg(vd) from public.variation_dayworks vd where vd.variation_id = ce.id or vd.daywork_id = ce.id), '[]') as variation_dayworks
      from public.commercial_events ce`);
    assert.equal(r.length, 3);
    for (const e of r) {
      assert.deepEqual(e.commercial_line_items, []);
      assert.equal(e.variations, null);
      assert.deepEqual(e.commercial_signatures, []);
      assert.deepEqual(e.commercial_approval_requests, []);
      assert.equal(e.commercial_event_totals, null);
    }
    assertNoPriceData(r, "embedded select");
    // Reverse embedding (from a line item up to its event) has nothing to start from.
    assert.deepEqual(await rows(c, `select li.*, row_to_json(ce) from public.commercial_line_items li join public.commercial_events ce on ce.id = li.commercial_event_id`), []);
  });
});

// ─── 3. every client-callable function ─────────────────────────────
const REVIEWED_FUNCTIONS = [
  "approve_commercial_approval_request(text,text,text,text)",
  "can_read_audit_row(text,uuid,uuid)",
  "commercial_tbc_event_ids(uuid)",
  "get_commercial_approval_request(text)",
  "get_commercial_event_view(uuid)",
  "list_commercial_variation_facts(uuid)",
  "reject_commercial_approval_request(text,text,text)",
  "request_commercial_approval(uuid,text,text,text,integer)",
  "resolve_commercial_approval_evidence(text,uuid)",
  "revoke_commercial_approval_request(uuid)",
];

test("completeness guard: every function a signed-in user can call that touches price tables, the totals view, audit_log or the hashes is on the reviewed list below", async () => {
  const found = (await sql(`
    select p.oid::regprocedure::text sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f' and has_function_privilege('authenticated', p.oid, 'execute')
      and pg_get_function_result(p.oid) <> 'trigger'
      and p.prosrc ~* '(commercial_line_items|\\yvariations\\y|commercial_event_totals|commercial_signatures|commercial_approval_requests|audit_log|markup_pct|line_total|commercial_event_hash|record_hash)'
    order by 1`)).rows.map((r) => r.sig);
  assert.deepEqual(found, REVIEWED_FUNCTIONS, "a new client-callable function over price data must be reviewed (and tested below) before it ships");
});

test("Viewer: get_commercial_event_view returns exactly the allowed keys — totals, descriptions, signer names, linked-daywork totals — and no price data", async () => {
  await as(VIEWER, async (c) => {
    const dw = (await one(c, "select public.get_commercial_event_view($1) v", [fx.dw1])).v;
    const v = (await one(c, "select public.get_commercial_event_view($1) v", [fx.v1])).v;
    const base = ["id", "project_id", "org_id", "plot_id", "type", "reference", "title", "status", "total_value", "submitted_by", "submitted_at", "approved_by", "approved_at", "rejected_by", "rejected_at", "rejection_reason", "supersedes_id", "created_by", "created_at", "updated_at", "prices_hidden", "has_tbc", "tbc_count", "lines", "signatures", "approval_requests"];
    assert.deepEqual(Object.keys(dw).sort(), [...base, "date_undertaken"].sort());
    assert.deepEqual(Object.keys(v).sort(), [...base, "date_identified", "date_instructed", "instruction_reference", "instructed_by", "reason", "linked_dayworks"].sort());
    for (const l of [...dw.lines, ...v.lines]) assert.deepEqual(Object.keys(l).sort(), ["description", "line_type", "position", "trade", "unit"]);
    for (const s of dw.signatures) assert.deepEqual(Object.keys(s).sort(), ["action", "signed_at", "signed_by_name", "signed_by_user_id"]);
    for (const a of v.approval_requests) assert.deepEqual(Object.keys(a).sort(), ["approved_at", "created_at", "expires_at", "recipient_company", "recipient_email", "recipient_name", "rejected_at", "rejection_reason", "signer_name", "status", "viewed_at"]);
    for (const d of v.linked_dayworks) assert.deepEqual(Object.keys(d).sort(), ["created_at", "daywork_id", "linked_at", "reference", "status", "title", "total_value"]);
    assert.equal(Number(dw.total_value), 394.37);
    assert.equal(dw.tbc_count, 1);
    assert.equal(dw.has_tbc, true);
    assert.equal(dw.lines.length, 3);
    assert.ok(dw.signatures.length >= 1 && dw.signatures.every((x) => x.signed_by_name), "signatures (who signed) are shown");
    assert.equal(Number(v.total_value), 853.1);
    assert.deepEqual(v.linked_dayworks.map((d) => Number(d.total_value)), [501], "decision 2: linked-daywork totals ARE shown");
    assert.equal(v.approval_requests.length, 1);
    assertNoPriceData(dw, "get_commercial_event_view(daywork)");
    assertNoPriceData(v, "get_commercial_event_view(variation)");
  });
});

test("Viewer: commercial_tbc_event_ids returns only record ids (the TBC flag), list_commercial_variation_facts only dates/instruction ref — no price data", async () => {
  await as(VIEWER, async (c) => {
    const ids = (await rows(c, "select * from public.commercial_tbc_event_ids($1) id", [fx.proj])).map((r) => r.id);
    assert.deepEqual(ids, [fx.dw1]);
    const facts = await rows(c, "select * from public.list_commercial_variation_facts($1)", [fx.proj]);
    assert.deepEqual(facts.map((f) => Object.keys(f).sort()), [["commercial_event_id", "date_identified", "date_instructed", "instruction_reference"]]);
    assert.equal(facts[0].instruction_reference, "CI-007");
    assertNoPriceData(ids, "commercial_tbc_event_ids");
    assertNoPriceData(facts, "list_commercial_variation_facts");
  });
});

test("Viewer: the remaining reviewed functions give nothing — approval-request management is refused, the token functions need a token the Viewer can't read, can_read_audit_row is false", async () => {
  await as(VIEWER, async (c) => {
    await assert.rejects(c.query(`select * from public.request_commercial_approval($1,'x@v67.test','X','X',168)`, [fx.v1]));
    const reqId = (await sql("select id from public.commercial_approval_requests limit 1")).rows[0].id;
    await assert.rejects(c.query(`select public.revoke_commercial_approval_request($1)`, [reqId]));
    for (const q of ["select public.get_commercial_approval_request($1)", "select public.approve_commercial_approval_request($1,'V',null,null)", "select public.reject_commercial_approval_request($1,'V','no')"]) {
      await assert.rejects(c.query(q, ["guessed-token"]), /Invalid approval link/i);
    }
    await assert.rejects(c.query("select * from public.resolve_commercial_approval_evidence($1, gen_random_uuid())", ["guessed-token"]));
    const auditIds = (await sql(`select id, table_name, project_id from public.audit_log where table_name = any($1) limit 5`, [COMMERCIAL_AUDIT_TABLES])).rows;
    for (const a of auditIds) assert.equal((await one(c, "select public.can_read_audit_row($1,$2,$3) ok", [a.table_name, a.project_id, VIEWER])).ok, false);
  });
});

test("Viewer: there are no other views over commercial data, and no storage bucket for commercial PDFs", async () => {
  const views = (await sql(`select c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('v','m') order by 1`)).rows.map((r) => r.relname);
  for (const v of views) {
    const def = (await sql(`select pg_get_viewdef($1::regclass) d`, [`public.${v}`])).rows[0].d;
    if (/commercial|variations|line_items/.test(def)) assert.equal(v, "commercial_event_totals", `unreviewed view over commercial data: ${v}`);
  }
  const buckets = (await sql(`select id from storage.buckets where id ~* 'commercial|pdf|daywork|variation'`)).rows;
  assert.deepEqual(buckets, []);
});

test("Viewer: the PDF data is unavailable — the event's line items, variation row and signatures (what the PDF is built from) all come back empty", async () => {
  await as(VIEWER, async (c) => {
    for (const id of [fx.dw1, fx.v1]) {
      assert.deepEqual(await rows(c, `select * from public.commercial_line_items where commercial_event_id=$1`, [id]), []);
      assert.deepEqual(await rows(c, `select * from public.commercial_signatures where commercial_event_id=$1`, [id]), []);
    }
    assert.deepEqual(await rows(c, `select * from public.variations where commercial_event_id=$1`, [fx.v1]), []);
  });
});

test("Viewer: cannot write anything commercial (unchanged: still read-only)", async () => {
  await as(VIEWER, async (c) => {
    await assert.rejects(c.query(`insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','x',1,1)`, [fx.dw2]));
    await assert.rejects(c.query(`insert into public.commercial_events (project_id, type, title) values ($1,'daywork','x')`, [fx.proj]));
  });
});

// ─── 4. Contributors and owners keep everything ────────────────────
for (const [who, uid] of [["Contributor", CONTRIB], ["project owner with NO commercial grant", OWNER]]) {
  test(`${who}: keeps everything — line rates and totals, markup, the totals view, signatures, approval requests, change history`, async () => {
    await as(uid, async (c) => {
      assert.equal((await one(c, "select public.commercial_access_role($1) r", [fx.proj])).r, "contributor");
      assert.equal((await one(c, "select public.can_see_commercial_prices($1) r", [fx.proj])).r, true);
      const lines = await rows(c, `select rate::text, line_total::text from public.commercial_line_items where commercial_event_id=$1 order by created_at`, [fx.dw1]);
      assert.deepEqual(lines.map((l) => l.line_total), ["354.38", "39.99", null]);
      assert.deepEqual(lines.map((l) => (l.rate === null ? null : Number(l.rate))), [47.25, 13.33, null]);
      assert.equal((await one(c, `select markup_pct::text m from public.variations where commercial_event_id=$1`, [fx.v1])).m.replace(/0+$/, ""), "12.5");
      assert.equal((await rows(c, `select * from public.commercial_event_totals where commercial_event_id = any($1)`, [[fx.dw1, fx.dw2, fx.v1]])).length, 3);
      assert.ok((await rows(c, `select * from public.commercial_signatures`)).length >= 1);
      assert.equal((await rows(c, `select * from public.commercial_approval_requests`)).length, 1);
      assert.ok((await rows(c, `select * from public.audit_log where table_name = any($1)`, [COMMERCIAL_AUDIT_TABLES])).length > 0, "change history visible");
    });
  });
}

test("project owner with no grant can actually work as a Contributor (create a record and a priced line)", async () => {
  await as(OWNER, async (c) => {
    const e = (await one(c, `insert into public.commercial_events (project_id, type, title) values ($1,'daywork','Owner made') returning id`, [fx.proj])).id;
    const li = await one(c, `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','x',2,30) returning line_total::text`, [e]);
    assert.equal(li.line_total, "60.00");
    await c.query("delete from public.commercial_line_items where commercial_event_id=$1", [e]);
    await c.query("delete from public.commercial_events where id=$1", [e]);
  });
});

test("a project owner who was explicitly given only 'viewer' is still a Contributor — ownership wins", async () => {
  await as(OWNER_VIEWER_GRANT, async (c) => {
    assert.equal((await one(c, "select public.commercial_access_role($1) r", [fx.proj2])).r, "contributor");
    // …and that ownership never reaches another company's project.
    assert.equal((await one(c, "select public.commercial_access_role($1) r", [fx.proj])).r, null);
  });
});

// ─── 5. people who get nothing ─────────────────────────────────────
for (const [who, uid] of [["a subcontractor-party user", SUB], ["an org admin of the owner company who is not on the project", ORGADMIN], ["a project collaborator with no commercial grant", COLLAB], ["a stranger", OUTSIDER]]) {
  test(`${who} gets nothing — no events, no totals, no view, no TBC flags, no history`, async () => {
    await as(uid, async (c) => {
      assert.equal((await one(c, "select public.commercial_access_role($1) r", [fx.proj])).r, null);
      assert.equal((await one(c, "select public.can_see_commercial_prices($1) r", [fx.proj])).r, false);
      assert.deepEqual(await rows(c, "select * from public.commercial_events"), []);
      for (const t of PRICE_TABLES) assert.deepEqual(await rows(c, `select * from public.${t}`), [], t);
      await assert.rejects(c.query("select public.get_commercial_event_view($1)", [fx.dw1]), /not found/i);
      assert.deepEqual(await rows(c, "select * from public.commercial_tbc_event_ids($1)", [fx.proj]), []);
      assert.deepEqual(await rows(c, "select * from public.list_commercial_variation_facts($1)", [fx.proj]), []);
      assert.deepEqual(await rows(c, `select * from public.audit_log where table_name = any($1)`, [COMMERCIAL_AUDIT_TABLES]), []);
    });
  });
}

test("a subcontractor-party user whose project_members row says 'owner' still gets nothing — 'owner' means owner side only", async () => {
  await sql("update public.project_members set role='owner' where project_id=$1 and user_id=$2", [fx.proj, SUB]);
  try {
    await as(SUB, async (c) => {
      assert.equal((await one(c, "select public.is_project_owner($1) o", [fx.proj])).o, false);
      assert.equal((await one(c, "select public.commercial_access_role($1) r", [fx.proj])).r, null);
      for (const t of PRICE_TABLES) assert.deepEqual(await rows(c, `select * from public.${t}`), [], t);
      await assert.rejects(c.query("select public.get_commercial_event_view($1)", [fx.v1]), /not found/i);
    });
  } finally {
    await sql("update public.project_members set role='collaborator' where project_id=$1 and user_id=$2", [fx.proj, SUB]);
  }
});

// ─── 6. the anon approval link is unchanged ────────────────────────
test("the anonymous client approval link is unchanged — the recipient still sees the priced lines, and can approve", async () => {
  const anon = await anonClient(DB);
  try {
    const r = (await one(anon, "select public.get_commercial_approval_request($1) r", [fx.token])).r;
    assert.ok(JSON.stringify(r).includes("41.17"), "the client still sees the rates they are approving");
    const ok = (await one(anon, "select public.approve_commercial_approval_request($1,'Jane Client',null,null) r", [fx.token])).r;
    assert.ok(ok);
  } finally { await anon.end(); }
  assert.equal((await sql("select status from public.commercial_events where id=$1", [fx.v1])).rows[0].status, "approved");
  // And anon can't call any of the new v67 functions.
  for (const f of ["commercial_access_role(uuid)", "can_see_commercial_prices(uuid)", "get_commercial_event_view(uuid)", "commercial_tbc_event_ids(uuid)", "list_commercial_variation_facts(uuid)"]) {
    assert.equal((await sql(`select has_function_privilege('anon', $1::regprocedure, 'execute') x`, [`public.${f}`])).rows[0].x, false, f);
    assert.equal((await sql(`select has_function_privilege('authenticated', $1::regprocedure, 'execute') x`, [`public.${f}`])).rows[0].x, true, f);
  }
});

// ─── 7. idempotent ─────────────────────────────────────────────────
test("schema.sql runs twice cleanly with Supabase-style default grants, and v67's policies, view filter and grants come out the same", async () => {
  const snap = async () => (await sql(`
    select
      (select string_agg(tablename||':'||policyname||':'||cmd||':'||array_to_string(roles,','), ' | ' order by tablename, policyname) from pg_policies where schemaname='public' and tablename = any($1)) pols,
      md5(pg_get_viewdef('public.commercial_event_totals'::regclass)) viewdef,
      (select string_agg(p.oid::regprocedure::text||'='||coalesce(array_to_string(p.proacl,','),'default'), ' | ' order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('commercial_access_role','can_view_commercial','can_edit_commercial','can_submit_commercial','can_see_commercial_prices','get_commercial_event_view','commercial_tbc_event_ids','list_commercial_variation_facts','can_read_audit_row')) acl`, [PRICE_TABLES])).rows[0];
  const a = adminClient(DB); await a.connect();
  try {
    await a.query("alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated");
    const before1 = await snap();
    await runSqlFile(a, SCHEMA);
    const after1 = await snap();
    await runSqlFile(a, SCHEMA);
    const after2 = await snap();
    assert.deepEqual(after1, before1);
    assert.deepEqual(after2, before1);
  } finally {
    await a.query("alter default privileges for role postgres in schema public revoke execute on functions from anon, authenticated");
    await a.end();
  }
  assert.ok(!/commercial viewers read/.test((await snap()).pols), "no old 'viewers read' policy survives");
  // And the Viewer is still locked out after the re-runs.
  await as(VIEWER, async (c) => { for (const t of PRICE_TABLES) assert.deepEqual(await rows(c, `select * from public.${t}`), [], t); });
});
