// Commercial Module — Phase 0 (Database Foundation).
//
// PRICING ROUNDING TEST (mandatory): confirms the ACTUAL stored/
// generated results Postgres produces for commercial_line_items'
// `line_total numeric(12,2) generated always as (quantity * rate)
// stored` column, for every case the approved architecture flagged as
// needing empirical (not documentation-trusted) verification —
// including at the actual quantity numeric(10,2) / rate numeric(12,4)
// precisions this schema uses, not toy values.
//
// Also covers: total_value recompute correctness for a Variation with
// linked Daywork subtotals (no double-counting), the
// commercial_event_totals view always agreeing with the cached
// total_value column, and a structural (not merely empirical) argument
// that variation<->daywork linking cannot recurse.
//
// Uses the admin/superuser connection throughout — these are pure
// pricing-trigger and generated-column behaviours, not an RLS test
// (RLS is covered exhaustively in tests/security/commercial_*).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient } from "../lib/db.mjs";

const DB = "tracker_test_commercial_pricing";

let client;
let orgId, projectId;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  client = adminClient(DB);
  await client.connect();

  const { rows: org } = await client.query("insert into public.organisations (name) values ('Pricing Org') returning id");
  orgId = org[0].id;
  const { rows: proj } = await client.query(
    "insert into public.projects (name, org_id) values ('Pricing Project', $1) returning id",
    [orgId]
  );
  projectId = proj[0].id;
});

after(async () => {
  await client.end();
  await dropTestDatabase(DB);
});

async function newEvent(type, title) {
  const { rows } = await client.query(
    `insert into public.commercial_events (project_id, type, title) values ($1,$2,$3) returning id`,
    [projectId, type, title]
  );
  return rows[0].id;
}

async function addLineItem(eventId, { lineType = "labour", description = "line", quantity, rate }) {
  const { rows } = await client.query(
    `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,$2,$3,$4,$5) returning id, quantity, rate, line_total`,
    [eventId, lineType, description, quantity, rate]
  );
  return rows[0];
}

// ─── PRICING ROUNDING TEST — the six mandatory cases, plus zero qty ──

test("Rounding: quantity 1 x rate 2.005 -> line_total 2.01 (round-half-away-from-zero at scale coercion, not banker's rounding)", async () => {
  const eventId = await newEvent("daywork", "Rounding case 1");
  const li = await addLineItem(eventId, { quantity: 1, rate: 2.005 });
  assert.equal(li.quantity, "1.00");
  assert.equal(li.rate, "2.0050");
  assert.equal(li.line_total, "2.01", "1.00 * 2.0050 = 2.005000, which numeric(12,2) coercion must round to 2.01, not truncate to 2.00 or bank-round to 2.00");
});

test("Rounding: fractional quantity 2.5 x rate 10.00 -> line_total 25.00 (exact, no rounding artefact)", async () => {
  const eventId = await newEvent("daywork", "Rounding case 2");
  const li = await addLineItem(eventId, { quantity: 2.5, rate: 10.0 });
  assert.equal(li.line_total, "25.00");
});

test("Rounding: 4dp rate 12.3456 x quantity 3 -> line_total 37.04 (37.0368 rounds up)", async () => {
  const eventId = await newEvent("daywork", "Rounding case 3");
  const li = await addLineItem(eventId, { quantity: 3, rate: 12.3456 });
  assert.equal(li.rate, "12.3456");
  assert.equal(li.line_total, "37.04", "3 * 12.3456 = 37.0368, which must round to 37.04");
});

test("Rounding: negative rate (omission) -11.00 for quantity 2 x rate -5.50", async () => {
  const eventId = await newEvent("daywork", "Rounding case 4 (omission)");
  const li = await addLineItem(eventId, { quantity: 2, rate: -5.5 });
  assert.equal(li.line_total, "-11.00", "a negative rate must work correctly for omissions, not be rejected or produce an unexpected sign");
});

test("Rounding: NULL rate (TBC) produces NULL line_total, not an error, and is excluded from SUM()", async () => {
  const eventId = await newEvent("daywork", "Rounding case 5 (TBC)");
  const li = await addLineItem(eventId, { quantity: 5, rate: null });
  assert.equal(li.line_total, null, "a NULL rate must propagate to a NULL line_total via the generated column, not error");

  const priced = await addLineItem(eventId, { quantity: 1, rate: 100 });
  const { rows } = await client.query("select total_value from public.commercial_events where id=$1", [eventId]);
  assert.equal(rows[0].total_value, "100.00", "SUM() must silently skip the NULL line_total (SQL SUM semantics), leaving only the priced line item counted");
});

test("Rounding: zero rate and zero quantity both produce 0.00, not NULL and not an error", async () => {
  const eventId = await newEvent("daywork", "Rounding case 6 (zero)");
  const zeroRate = await addLineItem(eventId, { quantity: 5, rate: 0 });
  assert.equal(zeroRate.line_total, "0.00");
  const zeroQty = await addLineItem(eventId, { quantity: 0, rate: 100 });
  assert.equal(zeroQty.line_total, "0.00");
});

test("The quantity >= 0 check constraint rejects a negative quantity outright (quantity has no 'omission' meaning — only rate does)", async () => {
  const eventId = await newEvent("daywork", "Negative quantity rejection");
  await assert.rejects(
    client.query(
      `insert into public.commercial_line_items (commercial_event_id, line_type, description, quantity, rate) values ($1,'labour','bad',-1,10)`,
      [eventId]
    ),
    /violates check constraint|commercial_line_items_quantity_check/i
  );
});

// ─── recompute correctness: dayworks, variations, linking, view agreement ──

test("Daywork total_value is the simple sum of its own line items, and commercial_event_totals agrees", async () => {
  const eventId = await newEvent("daywork", "Daywork recompute test");
  await addLineItem(eventId, { quantity: 8, rate: 25 }); // 200.00
  await addLineItem(eventId, { quantity: 10, rate: 3.5 }); // 35.00

  const { rows } = await client.query("select total_value from public.commercial_events where id=$1", [eventId]);
  assert.equal(rows[0].total_value, "235.00");

  const { rows: view } = await client.query("select total from public.commercial_event_totals where commercial_event_id=$1", [eventId]);
  assert.equal(view[0].total, "235.00", "commercial_event_totals must agree exactly with the cached total_value");
});

test("Variation total_value applies markup_pct to (own line items + linked daywork subtotals), summed only once — no double counting", async () => {
  const daywork1 = await newEvent("daywork", "Linked daywork 1");
  await client.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [daywork1]);
  await addLineItem(daywork1, { quantity: 8, rate: 25 }); // 200.00

  const daywork2 = await newEvent("daywork", "Linked daywork 2");
  await client.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [daywork2]);
  await addLineItem(daywork2, { quantity: 10, rate: 3.5 }); // 35.00

  const variation = await newEvent("variation", "Variation with two linked dayworks");
  await client.query(`insert into public.variations (commercial_event_id, markup_pct) values ($1, 10)`, [variation]);
  await addLineItem(variation, { quantity: 1, rate: 500 }); // own subtotal 500.00

  // Before linking: total = own subtotal only, with markup.
  let { rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]);
  assert.equal(rows[0].total_value, "550.00", "500.00 * 1.10 = 550.00 before any daywork is linked");

  await client.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork1]);
  await client.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork2]);

  ({ rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]));
  assert.equal(rows[0].total_value, "808.50", "(500.00 + 200.00 + 35.00) * 1.10 = 808.50 — each linked daywork's already-computed total_value counted exactly once, not its line items re-summed a second time");

  const { rows: view } = await client.query("select own_subtotal, dayworks_subtotal, markup_pct, total from public.commercial_event_totals where commercial_event_id=$1", [variation]);
  assert.equal(view[0].own_subtotal, "500.00");
  assert.equal(view[0].dayworks_subtotal, "235.00");
  assert.equal(view[0].markup_pct, "10.00");
  assert.equal(view[0].total, "808.50", "the view's independently-computed total must agree exactly with the cached total_value");

  // Unlinking one daywork must recompute back down correctly.
  await client.query(`delete from public.variation_dayworks where variation_id=$1 and daywork_id=$2`, [variation, daywork2]);
  ({ rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]));
  assert.equal(rows[0].total_value, "770.00", "(500.00 + 200.00) * 1.10 = 770.00 after unlinking daywork2");

  await client.query(`delete from public.variation_dayworks where variation_id=$1 and daywork_id=$2`, [variation, daywork1]);
  ({ rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]));
  assert.equal(rows[0].total_value, "550.00", "back to the own-subtotal-only total after unlinking both dayworks");
});

test("Editing a linked daywork's line items propagates through to the parent variation's total automatically", async () => {
  const daywork = await newEvent("daywork", "Propagation test daywork");
  await client.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [daywork]);
  const li = await addLineItem(daywork, { quantity: 2, rate: 50 }); // 100.00

  const variation = await newEvent("variation", "Propagation test variation");
  await client.query(`insert into public.variations (commercial_event_id, markup_pct) values ($1, 0)`, [variation]);
  await client.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variation, daywork]);

  let { rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]);
  assert.equal(rows[0].total_value, "100.00");

  await client.query(`update public.commercial_line_items set quantity=5 where id=$1`, [li.id]); // 5*50=250.00
  ({ rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]));
  assert.equal(rows[0].total_value, "250.00", "changing a linked daywork's line item must recompute the parent variation's total, not just the daywork's own total");
});

test("Changing a variation's markup_pct alone (no line item change) recomputes its total", async () => {
  const variation = await newEvent("variation", "Markup change test");
  await client.query(`insert into public.variations (commercial_event_id, markup_pct) values ($1, 0)`, [variation]);
  await addLineItem(variation, { quantity: 1, rate: 1000 });

  let { rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]);
  assert.equal(rows[0].total_value, "1000.00");

  await client.query(`update public.variations set markup_pct=15 where commercial_event_id=$1`, [variation]);
  ({ rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]));
  assert.equal(rows[0].total_value, "1150.00");
});

test("Markup rounding: subtotal 33.33 at 10% markup rounds the same way the generated column does (36.663 -> 36.66)", async () => {
  const variation = await newEvent("variation", "Markup rounding test");
  await client.query(`insert into public.variations (commercial_event_id, markup_pct) values ($1, 10)`, [variation]);
  await addLineItem(variation, { quantity: 1, rate: 33.33 });

  const { rows } = await client.query("select total_value from public.commercial_events where id=$1", [variation]);
  // 33.33 * 1.10 = 36.663 -> round() to 2dp is round-half-away-from-zero,
  // but 36.663 has no exact tie at the 3rd decimal (663 rounds down to
  // 66 on ordinary round-to-nearest regardless of tie rule) — assert the
  // actual value Postgres computes rather than assume it.
  assert.equal(rows[0].total_value, "36.66");

  const { rows: view } = await client.query("select total from public.commercial_event_totals where commercial_event_id=$1", [variation]);
  assert.equal(view[0].total, "36.66", "the view's round() must match the trigger's round() exactly");
});

// ─── structural no-recursion argument ──────────────────────────────

test("Structural: variation_dayworks.daywork_id cannot reference a variation-type event — the dayworks(commercial_event_id) FK makes a same-type or reverse cycle impossible", async () => {
  const variationA = await newEvent("variation", "Cycle attempt A");
  await client.query(`insert into public.variations (commercial_event_id, markup_pct) values ($1, 0)`, [variationA]);
  const variationB = await newEvent("variation", "Cycle attempt B");
  await client.query(`insert into public.variations (commercial_event_id, markup_pct) values ($1, 0)`, [variationB]);

  // Attempt to link variationA as if variationB's "daywork" — daywork_id
  // must satisfy the FK to dayworks(commercial_event_id), and variationA
  // was never inserted into the dayworks table (its type is 'variation'),
  // so this must fail at the foreign-key level, not merely be logically
  // discouraged.
  await assert.rejects(
    client.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [variationB, variationA]),
    /foreign key|violates/i,
    "a variation can never be linked as another variation's daywork — this is a structural FK guarantee, not an application-level check, so no recompute cycle through variation_dayworks is reachable at all"
  );
});

test("Structural: a variation cannot link a daywork to itself in a way that creates a cycle back through its own total", async () => {
  // There is no scenario in which commercial_event X's own recompute
  // depends on commercial_event X's own total_value, because
  // recompute_commercial_event_total() only ever reads a DAYWORK's
  // total_value while computing a VARIATION's total (never the other
  // direction), and variation_dayworks' FK shape (variation_id ->
  // variations, daywork_id -> dayworks) makes a single commercial_event
  // row satisfy both roles simultaneously impossible (type is exactly
  // one of 'variation' or 'daywork', and only a matching row exists in
  // the corresponding extension table). Confirm a daywork's own
  // recompute never consults variation_dayworks at all.
  const daywork = await newEvent("daywork", "Self-link structural test");
  await client.query(`insert into public.dayworks (commercial_event_id) values ($1)`, [daywork]);
  await assert.rejects(
    client.query(`insert into public.variation_dayworks (variation_id, daywork_id) values ($1,$2)`, [daywork, daywork]),
    /variation_dayworks\.variation_id must reference an existing variations row/,
    "a daywork row has no corresponding variations row, so it can never appear as variation_id either — self-linking is structurally impossible. variation_dayworks_before_insert() enforces this itself (raising before the underlying FK would even be checked), so the guarantee holds independent of the FK too"
  );
});
