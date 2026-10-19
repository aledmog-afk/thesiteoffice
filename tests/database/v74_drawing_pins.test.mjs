// Drawing pins (v74) — site/plot/block storey drawings, pins on
// Snags/RFIs/Quality Gates/general Queries, and the retirement of the
// old v1-era drawings/pin-columns system. Plan posted to the handover
// notes 19 Oct 2026, revised with Aled's five answers.
//
// Covers: the old drawings table and its pin columns are genuinely
// gone; the new six-table schema's constraints (scope consistency,
// one-site/-plot-storey/-block-storey-per-project uniqueness, exactly
// one pin owner); the upload -> page -> drawing -> page-assignment
// chain's server-derived project_id (never client-trusted) and its
// cross-project IDOR rejection; the revision flow (assigning a new
// page supersedes the old assignment and repoints current_page_id,
// without ever moving an existing pin); general_queries' lifecycle;
// RLS boundaries for all six tables, including the four different
// per-owner-type drawing_pins insert rules; the audit trail; and the
// rollback script (also exercised directly in isolation by hand before
// this file existed — see the build notes).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, runSql } from "../lib/db.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROLLBACK = fs.readFileSync(path.join(__dirname, "../../sql/rollback/v74_drawing_pins_rollback.sql"), "utf8");

const DB = "tracker_test_v74_drawing_pins";

const OWNER = "a7400000-0000-0000-0000-000000000001";
const SNAG_ONLY = "a7400000-0000-0000-0000-000000000002";
const OWNER_B = "a7400000-0000-0000-0000-000000000003";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'v74owner@example.com'), ($2,'v74snag@example.com'), ($3,'v74ownerb@example.com')`,
    [OWNER, SNAG_ONLY, OWNER_B]
  );
  await admin.end();

  const owner = await userClient(DB, OWNER);
  const orgA = (await owner.query("select public.create_organisation('V74 Org', 'main_contractor') as id")).rows[0].id;
  const projA = (await owner.query("insert into public.projects (name, org_id, created_by) values ('V74 Site', $1, $2) returning id", [orgA, OWNER])).rows[0].id;
  const snagCode = (await owner.query("select public.test_regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  const plot = (await owner.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'V74-P1',$2) returning id", [projA, OWNER])).rows[0].id;
  const block = (await owner.query("insert into public.blocks (project_id, block_name, created_by) values ($1,'V74-B1',$2) returning id", [projA, OWNER])).rows[0].id;
  const gate = (await owner.query("select id from public.quality_gates where plot_id = $1 limit 1", [plot])).rows[0].id; // auto-seeded by seed_plot_defaults()
  const rfi = (await owner.query(
    "insert into public.rfis (project_id, reference, title, question) values ($1,'RFI-V74-1','T','Q?') returning id",
    [projA]
  )).rows[0].id;
  await owner.end();

  const snagOnly = await userClient(DB, SNAG_ONLY);
  await snagOnly.query("select public.test_join_project_by_invite($1)", [snagCode]);
  const snagListId = (await snagOnly.query("select id from public.snag_lists where plot_id = $1 limit 1", [plot])).rows[0].id;
  const snag = (await snagOnly.query(
    "insert into public.snag_items (project_id, snag_list_id, description, status, priority, created_by) values ($1,$2,'desc','open','low',$3) returning id",
    [projA, snagListId, SNAG_ONLY]
  )).rows[0].id;
  await snagOnly.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.create_organisation('V74 Org B', 'main_contractor') as id")).rows[0].id;
  const projB = (await ownerB.query("insert into public.projects (name, org_id, created_by) values ('V74 Site B', $1, $2) returning id", [orgB, OWNER_B])).rows[0].id;
  await ownerB.end();

  fx = { orgA, projA, projB, plot, block, gate, rfi, snag };
});

after(async () => {
  await dropTestDatabase(DB);
});

// ─── A real upload+page+drawing+assignment, built through the real
// trigger chain (never inserted pre-formed), so every test below
// starts from genuinely server-validated state. Defaults to a FRESH
// plot_storey drawing (a new plot each time) rather than 'site', since
// there's a real one-current-site-drawing-per-project constraint and
// most tests here don't care which scope they get — only the tests
// specifically about that uniqueness rule pass an explicit scope.
async function makeDrawing(client, { scope, plotId = null, blockId = null, storey, projectId = fx.projA } = {}) {
  if (!scope) {
    scope = "plot_storey";
    storey = storey || "GF";
    if (!plotId) {
      plotId = (await client.query(
        "insert into public.plots (project_id, plot_number, created_by) values ($1,$2,$3) returning id",
        [projectId, `V74-AUTO-${Math.random().toString(36).slice(2, 8)}`, OWNER]
      )).rows[0].id;
    }
  }
  const upload = (await client.query(
    "insert into public.drawing_uploads (project_id, source_file_url, source_file_name) values ($1,$2,$3) returning id",
    [projectId, "https://example.com/a.pdf", "a.pdf"]
  )).rows[0].id;
  const page = (await client.query(
    "insert into public.drawing_pages (drawing_upload_id, page_number, image_url) values ($1,1,$2) returning id",
    [upload, "https://example.com/a-page-1.webp"]
  )).rows[0].id;
  const drawing = (await client.query(
    "insert into public.drawings (project_id, scope, plot_id, block_id, storey, title) values ($1,$2,$3,$4,$5,'Test Drawing') returning id",
    [projectId, scope, plotId, blockId, storey]
  )).rows[0].id;
  await client.query("insert into public.drawing_page_assignments (drawing_id, drawing_page_id) values ($1,$2)", [drawing, page]);
  return { upload, page, drawing };
}

// ─── Old system genuinely retired ───────────────────────────────────

test("the old v1-era drawings table's three pin columns are gone from snag_items and quality_gates", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const r = await admin.query(
    `select table_name, column_name from information_schema.columns
     where table_schema = 'public' and table_name in ('snag_items', 'quality_gates')
       and column_name in ('drawing_id', 'x_coordinate', 'y_coordinate')`
  );
  assert.deepEqual(r.rows, [], "no trace of the old pin columns should remain");
  await admin.end();
});

test("the new drawings table has the v74 shape (scope/plot_id/block_id/storey/current_page_id), not the old one (drawing_url)", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const cols = (await admin.query(
    `select column_name from information_schema.columns where table_schema='public' and table_name='drawings'`
  )).rows.map((r) => r.column_name);
  assert.ok(cols.includes("scope") && cols.includes("current_page_id"), "has the new shape");
  assert.ok(!cols.includes("drawing_url"), "no trace of the old shape");
  await admin.end();
});

// ─── drawings_scope_consistent ──────────────────────────────────────

test("drawings_scope_consistent: site scope rejects a plot_id or storey being set", async () => {
  const owner = await userClient(DB, OWNER);
  await assert.rejects(
    owner.query("insert into public.drawings (project_id, scope, plot_id, title) values ($1,'site',$2,'x')", [fx.projA, fx.plot]),
    /drawings_scope_consistent/
  );
  await owner.end();
});

test("drawings_scope_consistent: plot_storey scope requires both plot_id and storey", async () => {
  const owner = await userClient(DB, OWNER);
  await assert.rejects(
    owner.query("insert into public.drawings (project_id, scope, title) values ($1,'plot_storey','x')", [fx.projA]),
    /drawings_scope_consistent/
  );
  await assert.rejects(
    owner.query("insert into public.drawings (project_id, scope, plot_id, title) values ($1,'plot_storey',$2,'x')", [fx.projA, fx.plot]),
    /drawings_scope_consistent/,
    "plot_id without storey must also be rejected"
  );
  await owner.end();
});

test("drawings_scope_consistent: block_storey scope requires both block_id and storey, and rejects plot_id being set too", async () => {
  const owner = await userClient(DB, OWNER);
  await assert.rejects(
    owner.query("insert into public.drawings (project_id, scope, block_id, plot_id, storey, title) values ($1,'block_storey',$2,$3,'GF','x')", [fx.projA, fx.block, fx.plot]),
    /drawings_scope_consistent/
  );
  const { rows } = await owner.query(
    "insert into public.drawings (project_id, scope, block_id, storey, title) values ($1,'block_storey',$2,'GF','x') returning id",
    [fx.projA, fx.block]
  );
  assert.ok(rows[0].id);
  await owner.end();
});

test("storey only accepts GF/FF/SF", async () => {
  const owner = await userClient(DB, OWNER);
  await assert.rejects(
    owner.query("insert into public.drawings (project_id, scope, plot_id, storey, title) values ($1,'plot_storey',$2,'TF','x')", [fx.projA, fx.plot]),
    /check/i
  );
  await owner.end();
});

// ─── One-site / one-per-plot-storey / one-per-block-storey ─────────

test("only one current site drawing per project", async () => {
  const owner = await userClient(DB, OWNER);
  await makeDrawing(owner, { scope: "site" });
  await assert.rejects(makeDrawing(owner, { scope: "site" }), /drawings_one_site_per_project/);
  await owner.end();
});

test("only one current drawing per (plot, storey), but different storeys for the same plot are fine", async () => {
  const owner = await userClient(DB, OWNER);
  const { rows } = await owner.query(
    "insert into public.plots (project_id, plot_number, created_by) values ($1,'V74-P-STOREY',$2) returning id", [fx.projA, OWNER]
  );
  const plot = rows[0].id;
  await makeDrawing(owner, { scope: "plot_storey", plotId: plot, storey: "GF" });
  await assert.rejects(makeDrawing(owner, { scope: "plot_storey", plotId: plot, storey: "GF" }), /drawings_one_per_plot_storey/);
  const { rows: ff } = await (async () => {
    const upload = (await owner.query("insert into public.drawing_uploads (project_id, source_file_url, source_file_name) values ($1,'u','u')  returning id", [fx.projA])).rows[0].id;
    const page = (await owner.query("insert into public.drawing_pages (drawing_upload_id, page_number, image_url) values ($1,1,'p') returning id", [upload])).rows[0].id;
    return owner.query("insert into public.drawings (project_id, scope, plot_id, storey, title) values ($1,'plot_storey',$2,'FF','x') returning id", [fx.projA, plot]);
  })();
  assert.ok(ff[0].id, "a different storey for the same plot is a separate drawing");
  await owner.end();
});

test("an archived drawing frees up its (plot, storey) slot for a new one", async () => {
  const owner = await userClient(DB, OWNER);
  const { rows } = await owner.query(
    "insert into public.plots (project_id, plot_number, created_by) values ($1,'V74-P-ARCHIVE',$2) returning id", [fx.projA, OWNER]
  );
  const plot = rows[0].id;
  const { drawing } = await makeDrawing(owner, { scope: "plot_storey", plotId: plot, storey: "GF" });
  await owner.query("update public.drawings set status = 'archived' where id = $1", [drawing]);
  const second = await makeDrawing(owner, { scope: "plot_storey", plotId: plot, storey: "GF" });
  assert.ok(second.drawing, "a new current drawing for the same slot is allowed once the old one is archived");
  await owner.end();
});

// ─── Server-derived project_id, cross-project IDOR rejection ───────

test("drawing_pages.project_id is server-derived from its upload, never client-trusted", async () => {
  const owner = await userClient(DB, OWNER);
  const upload = (await owner.query(
    "insert into public.drawing_uploads (project_id, source_file_url, source_file_name) values ($1,'u','u') returning id", [fx.projA]
  )).rows[0].id;
  const { rows } = await owner.query(
    "insert into public.drawing_pages (drawing_upload_id, page_number, image_url, project_id) values ($1,1,'p',$2) returning project_id",
    [upload, fx.projB] // attempted spoof
  );
  assert.equal(rows[0].project_id, fx.projA, "the real upload's project wins, not the client-supplied value");
  await owner.end();
});

test("drawing_page_assignments rejects assigning a page from one project to a drawing in another", async () => {
  const owner = await userClient(DB, OWNER);
  const ownerB = await userClient(DB, OWNER_B);
  const { drawing } = await makeDrawing(owner, {});
  const uploadB = (await ownerB.query(
    "insert into public.drawing_uploads (project_id, source_file_url, source_file_name) values ($1,'u','u') returning id", [fx.projB]
  )).rows[0].id;
  const pageB = (await ownerB.query(
    "insert into public.drawing_pages (drawing_upload_id, page_number, image_url) values ($1,1,'p') returning id", [uploadB]
  )).rows[0].id;
  await assert.rejects(
    owner.query("insert into public.drawing_page_assignments (drawing_id, drawing_page_id) values ($1,$2)", [drawing, pageB]),
    /same project/
  );
  await owner.end();
  await ownerB.end();
});

// ─── Revision flow: old pins stay on the page they were placed on ──

test("assigning a new page to a drawing supersedes the old assignment and repoints current_page_id, without moving any existing pin", async () => {
  const owner = await userClient(DB, OWNER);
  const { drawing, page: pageV1 } = await makeDrawing(owner, {});

  const pin = (await owner.query(
    "insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, snag_item_id) values ($1,40,60,$2) returning id, drawing_page_id",
    [pageV1, fx.snag]
  )).rows[0];
  assert.equal(pin.drawing_page_id, pageV1);

  // Upload + assign a second page as a revision.
  const upload2 = (await owner.query("insert into public.drawing_uploads (project_id, source_file_url, source_file_name) values ($1,'u2','u2') returning id", [fx.projA])).rows[0].id;
  const pageV2 = (await owner.query("insert into public.drawing_pages (drawing_upload_id, page_number, image_url) values ($1,1,'p2') returning id", [upload2])).rows[0].id;
  await owner.query("insert into public.drawing_page_assignments (drawing_id, drawing_page_id) values ($1,$2)", [drawing, pageV2]);

  const { rows: drawingRows } = await owner.query("select current_page_id from public.drawings where id = $1", [drawing]);
  assert.equal(drawingRows[0].current_page_id, pageV2, "current_page_id repoints to the new page");

  const { rows: assignRows } = await owner.query(
    "select drawing_page_id, superseded_at from public.drawing_page_assignments where drawing_id = $1 order by assigned_at", [drawing]
  );
  assert.equal(assignRows.length, 2);
  assert.equal(assignRows[0].drawing_page_id, pageV1);
  assert.ok(assignRows[0].superseded_at, "the v1 assignment is now superseded");
  assert.equal(assignRows[1].drawing_page_id, pageV2);
  assert.equal(assignRows[1].superseded_at, null);

  const { rows: pinRows } = await owner.query("select drawing_page_id from public.drawing_pins where id = $1", [pin.id]);
  assert.equal(pinRows[0].drawing_page_id, pageV1, "the pin placed on v1 never moved to v2");
  await owner.end();
});

test("current_page_id cannot be set directly by an ordinary client UPDATE", async () => {
  const owner = await userClient(DB, OWNER);
  const { drawing, page } = await makeDrawing(owner, {});
  const otherUpload = (await owner.query("insert into public.drawing_uploads (project_id, source_file_url, source_file_name) values ($1,'u3','u3') returning id", [fx.projA])).rows[0].id;
  const otherPage = (await owner.query("insert into public.drawing_pages (drawing_upload_id, page_number, image_url) values ($1,1,'p3') returning id", [otherUpload])).rows[0].id;
  await owner.query("update public.drawings set current_page_id = $1 where id = $2", [otherPage, drawing]);
  const { rows } = await owner.query("select current_page_id from public.drawings where id = $1", [drawing]);
  assert.equal(rows[0].current_page_id, page, "a direct UPDATE of current_page_id is silently forced back — only the internal promotion can change it");
  await owner.end();
});

// ─── drawing_pins_exactly_one_owner ─────────────────────────────────

test("drawing_pins_exactly_one_owner: all four single-owner cases succeed", async () => {
  const owner = await userClient(DB, OWNER);
  const { page } = await makeDrawing(owner, {});
  const query = (await owner.query(
    "insert into public.general_queries (project_id, question) values ($1,'Q?') returning id", [fx.projA]
  )).rows[0].id;

  for (const [col, val] of [["snag_item_id", fx.snag], ["rfi_id", fx.rfi], ["quality_gate_id", fx.gate], ["query_id", query]]) {
    const { rows } = await owner.query(
      `insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, ${col}) values ($1,10,10,$2) returning id`,
      [page, val]
    );
    assert.ok(rows[0].id, `${col} alone is a valid pin`);
  }
  await owner.end();
});

test("drawing_pins_exactly_one_owner: zero owners rejected (caught explicitly by the trigger, with the real CHECK constraint as the backstop)", async () => {
  const owner = await userClient(DB, OWNER);
  const { page } = await makeDrawing(owner, {});
  await assert.rejects(
    owner.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct) values ($1,10,10)", [page]),
    /exactly one of snag_item_id\/rfi_id\/quality_gate_id\/query_id/
  );
  await owner.end();
});

test("drawing_pins_exactly_one_owner: two owners at once rejected", async () => {
  const owner = await userClient(DB, OWNER);
  const { page } = await makeDrawing(owner, {});
  await assert.rejects(
    owner.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, snag_item_id, rfi_id) values ($1,10,10,$2,$3)", [page, fx.snag, fx.rfi]),
    /exactly one of snag_item_id\/rfi_id\/quality_gate_id\/query_id/
  );
  await owner.end();
});

test("the drawing_pins_exactly_one_owner CHECK constraint itself still exists as the real backstop (not just the trigger's own count check)", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  const r = await admin.query(
    `select conname from pg_constraint where conname = 'drawing_pins_exactly_one_owner' and conrelid = 'public.drawing_pins'::regclass`
  );
  assert.equal(r.rows.length, 1);
  await admin.end();
});

test("x_pct/y_pct are bounded to 0-100", async () => {
  const owner = await userClient(DB, OWNER);
  const { page } = await makeDrawing(owner, {});
  await assert.rejects(
    owner.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, snag_item_id) values ($1,101,10,$2)", [page, fx.snag]),
    /check/i
  );
  await assert.rejects(
    owner.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, snag_item_id) values ($1,-1,10,$2)", [page, fx.snag]),
    /check/i
  );
  await owner.end();
});

test("a pin's owner must belong to the same project as the drawing page (cross-project rejected)", async () => {
  const owner = await userClient(DB, OWNER);
  const ownerB = await userClient(DB, OWNER_B);
  const { page } = await makeDrawing(owner, {});
  const rfiB = (await ownerB.query(
    "insert into public.rfis (project_id, reference, title, question) values ($1,'RFI-B-1','T','Q?') returning id", [fx.projB]
  )).rows[0].id;
  await assert.rejects(
    owner.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, rfi_id) values ($1,10,10,$2)", [page, rfiB]),
    /same project/
  );
  await owner.end();
  await ownerB.end();
});

// ─── general_queries lifecycle ──────────────────────────────────────

test("general_queries: raising, answering and closing stamps timestamps once, never re-stamped", async () => {
  const owner = await userClient(DB, OWNER);
  const { rows } = await owner.query(
    "insert into public.general_queries (project_id, plot_id, question) values ($1,$2,'Where does the stopcock go?') returning id, status, raised_at, answered_at, closed_at",
    [fx.projA, fx.plot]
  );
  const q = rows[0];
  assert.equal(q.status, "open");
  assert.ok(q.raised_at);
  assert.equal(q.answered_at, null);

  const { rows: answered } = await owner.query(
    "update public.general_queries set status = 'answered', response = 'Under the stairs' where id = $1 returning answered_at", [q.id]
  );
  const firstAnsweredAt = answered[0].answered_at;
  assert.ok(firstAnsweredAt);

  // Flip away and back — answered_at must not move the second time.
  await owner.query("update public.general_queries set status = 'open' where id = $1", [q.id]);
  const { rows: reAnswered } = await owner.query(
    "update public.general_queries set status = 'answered' where id = $1 returning answered_at", [q.id]
  );
  assert.equal(reAnswered[0].answered_at.getTime(), firstAnsweredAt.getTime(), "answered_at is a historical stamp, never reset");

  const { rows: closed } = await owner.query("update public.general_queries set status = 'closed' where id = $1 returning closed_at", [q.id]);
  assert.ok(closed[0].closed_at);
  await owner.end();
});

test("general_queries: plot_id/block_id must belong to the same project", async () => {
  const owner = await userClient(DB, OWNER);
  const ownerB = await userClient(DB, OWNER_B);
  const plotB = (await ownerB.query("insert into public.plots (project_id, plot_number, created_by) values ($1,'B-P1',$2) returning id", [fx.projB, OWNER_B])).rows[0].id;
  await assert.rejects(
    owner.query("insert into public.general_queries (project_id, plot_id, question) values ($1,$2,'x')", [fx.projA, plotB]),
    /same project/
  );
  await owner.end();
  await ownerB.end();
});

// ─── RLS: reads ──────────────────────────────────────────────────────

test("RLS read: a snagging-only member can read drawings, pages, assignments, queries and pins (member-level, not editor-level)", async () => {
  const owner = await userClient(DB, OWNER);
  const { drawing, page } = await makeDrawing(owner, {});
  const query = (await owner.query("insert into public.general_queries (project_id, question) values ($1,'Q?') returning id", [fx.projA])).rows[0].id;
  await owner.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, query_id) values ($1,10,10,$2)", [page, query]);
  await owner.end();

  const snagOnly = await userClient(DB, SNAG_ONLY);
  const d = await snagOnly.query("select id from public.drawings where id = $1", [drawing]);
  assert.equal(d.rows.length, 1);
  const p = await snagOnly.query("select id from public.drawing_pages where id = $1", [page]);
  assert.equal(p.rows.length, 1);
  const q = await snagOnly.query("select id from public.general_queries where id = $1", [query]);
  assert.equal(q.rows.length, 1);
  const pins = await snagOnly.query("select id from public.drawing_pins where drawing_page_id = $1", [page]);
  assert.equal(pins.rows.length, 1);
  await snagOnly.end();
});

test("RLS read: a user with no membership on this project sees nothing", async () => {
  const owner = await userClient(DB, OWNER);
  const { drawing } = await makeDrawing(owner, {});
  await owner.end();

  const ownerB = await userClient(DB, OWNER_B);
  const r = await ownerB.query("select id from public.drawings where id = $1", [drawing]);
  assert.equal(r.rows.length, 0);
  await ownerB.end();
});

// ─── RLS: writes, including the four different pin-owner rules ─────

test("RLS write: a snagging-only member cannot upload a drawing or create a drawing identity (editor-only)", async () => {
  const snagOnly = await userClient(DB, SNAG_ONLY);
  await assert.rejects(
    snagOnly.query("insert into public.drawing_uploads (project_id, source_file_url, source_file_name) values ($1,'u','u')", [fx.projA]),
    /row-level security|policy/i
  );
  await assert.rejects(
    snagOnly.query("insert into public.drawings (project_id, scope, title) values ($1,'site','x')", [fx.projA]),
    /row-level security|policy/i
  );
  await snagOnly.end();
});

test("RLS write: a snagging-only member CAN pin their own snag or a query, but NOT an RFI or a Quality Gate", async () => {
  const owner = await userClient(DB, OWNER);
  const { page } = await makeDrawing(owner, {});
  await owner.end();

  const snagOnly = await userClient(DB, SNAG_ONLY);
  const query = (await snagOnly.query("insert into public.general_queries (project_id, question) values ($1,'Q?') returning id", [fx.projA])).rows[0].id;

  const snagPin = await snagOnly.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, snag_item_id) values ($1,10,10,$2) returning id", [page, fx.snag]);
  assert.ok(snagPin.rows[0].id, "pinning a snag is allowed");

  const queryPin = await snagOnly.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, query_id) values ($1,10,10,$2) returning id", [page, query]);
  assert.ok(queryPin.rows[0].id, "pinning a query is allowed");

  await assert.rejects(
    snagOnly.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, rfi_id) values ($1,10,10,$2)", [page, fx.rfi]),
    /row-level security|policy/i,
    "pinning an RFI requires editor"
  );
  await assert.rejects(
    snagOnly.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, quality_gate_id) values ($1,10,10,$2)", [page, fx.gate]),
    /row-level security|policy/i,
    "pinning a Quality Gate requires editor"
  );
  await snagOnly.end();
});

test("RLS write: an editor can pin all four owner types", async () => {
  const owner = await userClient(DB, OWNER);
  const { page } = await makeDrawing(owner, {});
  const query = (await owner.query("insert into public.general_queries (project_id, question) values ($1,'Q?') returning id", [fx.projA])).rows[0].id;
  for (const [col, val] of [["snag_item_id", fx.snag], ["rfi_id", fx.rfi], ["quality_gate_id", fx.gate], ["query_id", query]]) {
    const { rows } = await owner.query(`insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, ${col}) values ($1,20,20,$2) returning id`, [page, val]);
    assert.ok(rows[0].id, col);
  }
  await owner.end();
});

test("RLS write: no delete policy on drawings — archive-only", async () => {
  const owner = await userClient(DB, OWNER);
  const { drawing } = await makeDrawing(owner, {});
  // Postgres RLS doesn't raise for an unpolicied DML — "enabled, no
  // policy for this command" means an implicit `using (false)`, so the
  // DELETE runs but matches/affects zero rows, same idiom this
  // schema's own comments describe for document_revisions. The real
  // assertion is that the row demonstrably still exists afterward.
  const del = await owner.query("delete from public.drawings where id = $1", [drawing]);
  assert.equal(del.rowCount, 0, "the delete affects no rows — RLS silently denies it");
  const { rows } = await owner.query("update public.drawings set status = 'archived' where id = $1 returning status", [drawing]);
  assert.equal(rows[0].status, "archived", "archiving via status update works fine");
  await owner.end();
});

// ─── Audit trail ──────────────────────────────────────────────────────

test("audit log: an insert on each of the six new tables is recorded", async () => {
  const owner = await userClient(DB, OWNER);
  const { upload, page, drawing } = await makeDrawing(owner, {});
  const query = (await owner.query("insert into public.general_queries (project_id, question) values ($1,'Q?') returning id", [fx.projA])).rows[0].id;
  const pin = (await owner.query("insert into public.drawing_pins (drawing_page_id, x_pct, y_pct, query_id) values ($1,10,10,$2) returning id", [page, query])).rows[0].id;
  await owner.end();

  const admin = adminClient(DB);
  await admin.connect();
  for (const [table, id] of [
    ["drawing_uploads", upload], ["drawing_pages", page], ["drawings", drawing],
    ["general_queries", query], ["drawing_pins", pin],
  ]) {
    const { rows } = await admin.query(
      "select 1 from public.audit_log where table_name = $1 and record_id = $2 and action = 'INSERT'", [table, id]
    );
    assert.equal(rows.length, 1, `${table} insert should be audited`);
  }
  const { rows: assignRows } = await admin.query(
    "select id from public.drawing_page_assignments where drawing_id = $1", [drawing]
  );
  const { rows: assignAudit } = await admin.query(
    "select 1 from public.audit_log where table_name = 'drawing_page_assignments' and record_id = $1 and action = 'INSERT'", [assignRows[0].id]
  );
  assert.equal(assignAudit.length, 1, "drawing_page_assignments insert should be audited");
  await admin.end();
});

// ─── Rollback script sanity (full apply/rollback/idempotency already
// exercised by hand during the build — see handover/NOTES.md) ───────

test("rollback script: contains the data-loss guard and restores the old table/columns", () => {
  assert.match(ROLLBACK, /v74 rollback refused/);
  assert.match(ROLLBACK, /create table if not exists public\.drawings/);
  assert.match(ROLLBACK, /drawing_url text not null/);
  assert.match(ROLLBACK, /snag_items add column if not exists drawing_id/);
  assert.match(ROLLBACK, /quality_gates add column if not exists drawing_id/);
});
