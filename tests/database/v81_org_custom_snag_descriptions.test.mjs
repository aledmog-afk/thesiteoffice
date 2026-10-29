// v81: add_org_custom_snag_description(uuid, text) + org_custom_snag_descriptions
// — a snag's Description field gets a "Save as quick-add" option: type
// it once, it's saved company-wide so a recurring issue doesn't need
// re-typing from scratch next time. See the function's own comment in
// sql/schema.sql for why this mirrors v80's custom trades exactly.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v81_org_custom_snag_descriptions";

const OWNER_A = "a1000000-0000-0000-0000-000000000001";
const OWNER_B = "b1000000-0000-0000-0000-000000000001";
const STRANGER = "c1000000-0000-0000-0000-000000000001";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'ownerb@example.com'), ($3,'stranger@example.com')`,
    [OWNER_A, OWNER_B, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.create_organisation('Org A', 'main_contractor') as id")).rows[0].id;
  await ownerA.end();

  const ownerB = await userClient(DB, OWNER_B);
  const orgB = (await ownerB.query("select public.create_organisation('Org B', 'main_contractor') as id")).rows[0].id;
  await ownerB.end();

  fx = { orgA, orgB };
});

after(async () => {
  await dropTestDatabase(DB);
});

test("v81: saving a description stores it and returns the trimmed value", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const { rows } = await ownerA.query(
      "select public.add_org_custom_snag_description($1, $2) as description",
      [fx.orgA, "  Skirting gap at external corner  "]
    );
    assert.equal(rows[0].description, "Skirting gap at external corner");

    const stored = await ownerA.query(
      "select description, org_id, created_by from public.org_custom_snag_descriptions where org_id = $1",
      [fx.orgA]
    );
    assert.equal(stored.rows.length, 1);
    assert.equal(stored.rows[0].description, "Skirting gap at external corner");
    assert.equal(stored.rows[0].created_by, OWNER_A);
  } finally {
    await ownerA.end();
  }
});

test("v81: saving the same description again (same or different case/whitespace) doesn't create a duplicate", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await ownerA.query("select public.add_org_custom_snag_description($1, $2)", [fx.orgA, "Door doesn't close properly"]);
    const second = (await ownerA.query(
      "select public.add_org_custom_snag_description($1, $2) as description",
      [fx.orgA, "  DOOR DOESN'T CLOSE PROPERLY "]
    )).rows[0].description;
    assert.equal(second, "Door doesn't close properly", "the FIRST stored spelling/casing wins");

    const count = (await ownerA.query(
      "select count(*)::int n from public.org_custom_snag_descriptions where org_id = $1 and lower(btrim(description)) = $2",
      [fx.orgA, "door doesn't close properly"]
    )).rows[0].n;
    assert.equal(count, 1);
  } finally {
    await ownerA.end();
  }
});

test("v81: blank or whitespace-only input is a harmless no-op, not an empty-string row", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const result = (await ownerA.query("select public.add_org_custom_snag_description($1, $2) as description", [fx.orgA, "   "])).rows[0].description;
    assert.equal(result, null);
    const result2 = (await ownerA.query("select public.add_org_custom_snag_description($1, $2) as description", [fx.orgA, null])).rows[0].description;
    assert.equal(result2, null);
  } finally {
    await ownerA.end();
  }
});

test("v81: a description saved under one organisation is invisible to another — this is company-wide, not global", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    await ownerA.query("select public.add_org_custom_snag_description($1, $2)", [fx.orgA, "Hinge squeaks"]);
  } finally {
    await ownerA.end();
  }

  const ownerB = await userClient(DB, OWNER_B);
  try {
    const visible = await ownerB.query("select description from public.org_custom_snag_descriptions where org_id = $1", [fx.orgA]);
    assert.equal(visible.rows.length, 0, "RLS must hide another organisation's saved descriptions entirely");

    const ownOrgList = await ownerB.query("select description from public.org_custom_snag_descriptions where org_id = $1", [fx.orgB]);
    assert.equal(ownOrgList.rows.length, 0, "Org B's own list is unaffected and starts empty");
  } finally {
    await ownerB.end();
  }
});

test("v81: Security — a non-member can't save a description to an organisation they don't belong to", async () => {
  const stranger = await userClient(DB, STRANGER);
  try {
    await assert.rejects(
      stranger.query("select public.add_org_custom_snag_description($1, $2)", [fx.orgA, "Should never land"])
    );
  } finally {
    await stranger.end();
  }

  const ownerA = await userClient(DB, OWNER_A);
  try {
    const found = await ownerA.query(
      "select 1 from public.org_custom_snag_descriptions where org_id = $1 and description = 'Should never land'",
      [fx.orgA]
    );
    assert.equal(found.rows.length, 0, "the insert policy (is_org_member) must reject this outright, not silently no-op");
  } finally {
    await ownerA.end();
  }
});
