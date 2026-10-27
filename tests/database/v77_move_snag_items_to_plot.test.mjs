// v77: move_snag_items_to_plot(uuid[], uuid) — a plot's snag list is
// 1:1 (snag_lists_plot_id_uidx), auto-created the moment the plot
// itself is, so there is no "re-point this list at another plot"
// operation; a client who added snags under the wrong plot needs them
// transplanted into the correct plot's own (already-existing) list.
// security invoker, deliberately — see the function's own comment in
// sql/schema.sql for why it defers to snag_items' real write policy
// rather than re-implementing it.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient } from "../lib/db.mjs";

const DB = "tracker_test_v77_move_snags";

const OWNER_A = "a1000000-0000-0000-0000-000000000001";
const STRANGER = "c1000000-0000-0000-0000-000000000001";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'ownera@example.com'), ($2,'stranger@example.com')`,
    [OWNER_A, STRANGER]
  );
  await admin.end();

  const ownerA = await userClient(DB, OWNER_A);
  const orgA = (await ownerA.query("select public.create_organisation('Test Org', 'main_contractor') as id")).rows[0].id;
  const projA = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;
  const projB = (await ownerA.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgA, OWNER_A])).rows[0].id;

  const plot1 = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 1') returning id", [projA])).rows[0].id;
  const plot2 = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1,'Plot 2') returning id", [projA])).rows[0].id;
  const plotB = (await ownerA.query("insert into public.plots (project_id, plot_number) values ($1,'Plot B1') returning id", [projB])).rows[0].id;
  const list1 = (await ownerA.query("select id from public.snag_lists where plot_id = $1", [plot1])).rows[0].id;
  const list2 = (await ownerA.query("select id from public.snag_lists where plot_id = $1", [plot2])).rows[0].id;
  const listB = (await ownerA.query("select id from public.snag_lists where plot_id = $1", [plotB])).rows[0].id;
  await ownerA.end();

  fx = { orgA, projA, projB, plot1, plot2, plotB, list1, list2, listB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function createSnag(client, { projectId, listId, location }) {
  const { rows } = await client.query(
    "insert into public.snag_items (project_id, snag_list_id, location, description) values ($1,$2,$3,'Wrong plot') returning id, item_no",
    [projectId, listId, location]
  );
  return rows[0];
}

test("v77: moves selected items into the target plot's own list, clearing plot_id and renumbering past the target's existing items", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    // Plot 2 already has two items of its own (#1, #2) before the move.
    await createSnag(ownerA, { projectId: fx.projA, listId: fx.list2, location: "Existing A" });
    await createSnag(ownerA, { projectId: fx.projA, listId: fx.list2, location: "Existing B" });

    const wrong1 = await createSnag(ownerA, { projectId: fx.projA, listId: fx.list1, location: "Meant for Plot 2 - first" });
    const wrong2 = await createSnag(ownerA, { projectId: fx.projA, listId: fx.list1, location: "Meant for Plot 2 - second" });
    assert.equal(wrong1.item_no, 1, "sanity: Plot 1's own numbering starts fresh at 1");

    const moved = (await ownerA.query("select public.move_snag_items_to_plot($1, $2) as n", [[wrong1.id, wrong2.id], fx.plot2])).rows[0].n;
    assert.equal(moved, 2);

    const { rows } = await ownerA.query(
      "select id, snag_list_id, plot_id, item_no, location from public.snag_items where id = any($1) order by item_no",
      [[wrong1.id, wrong2.id]]
    );
    assert.equal(rows[0].snag_list_id, fx.list2);
    assert.equal(rows[1].snag_list_id, fx.list2);
    assert.equal(rows[0].plot_id, null, "plot_id is cleared — implied by the target list itself, same as any other item in a plot-specific list");
    assert.equal(rows[1].plot_id, null);
    assert.deepEqual([rows[0].item_no, rows[1].item_no], [3, 4], "continues after Plot 2's own existing #1/#2, in the order given");

    const stillInPlot1 = (await ownerA.query("select count(*)::int n from public.snag_items where snag_list_id = $1", [fx.list1])).rows[0].n;
    assert.equal(stillInPlot1, 0, "nothing is left behind in the wrong plot's list");
  } finally {
    await ownerA.end();
  }
});

test("v77: an item already in the target list is left untouched — not recounted, not renumbered", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const already = await createSnag(ownerA, { projectId: fx.projA, listId: fx.list2, location: "Already here" });
    const moved = (await ownerA.query("select public.move_snag_items_to_plot($1, $2) as n", [[already.id], fx.plot2])).rows[0].n;
    assert.equal(moved, 0);
    const after = (await ownerA.query("select item_no from public.snag_items where id = $1", [already.id])).rows[0];
    assert.equal(after.item_no, already.item_no);
  } finally {
    await ownerA.end();
  }
});

test("v77: an item from a different project in the same array is silently skipped, not moved and not erroring", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const foreign = await createSnag(ownerA, { projectId: fx.projB, listId: fx.listB, location: "Belongs to Project B" });
    const moved = (await ownerA.query("select public.move_snag_items_to_plot($1, $2) as n", [[foreign.id], fx.plot2])).rows[0].n;
    assert.equal(moved, 0);
    const after = (await ownerA.query("select snag_list_id from public.snag_items where id = $1", [foreign.id])).rows[0];
    assert.equal(after.snag_list_id, fx.listB, "a different project's item must never move just because its id was in the array");
  } finally {
    await ownerA.end();
  }
});

test("v77: a target plot id with no snag list raises, rather than silently doing nothing or crashing obscurely", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    const item = await createSnag(ownerA, { projectId: fx.projA, listId: fx.list1, location: "Any" });
    await assert.rejects(
      ownerA.query("select public.move_snag_items_to_plot($1, $2)", [[item.id], "00000000-0000-0000-0000-000000000000"]),
      /no snag list/i
    );
  } finally {
    await ownerA.end();
  }
});

test("v77: empty or null input is a harmless no-op", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  try {
    assert.equal((await ownerA.query("select public.move_snag_items_to_plot($1, $2) as n", [[], fx.plot2])).rows[0].n, 0);
    assert.equal((await ownerA.query("select public.move_snag_items_to_plot($1, $2) as n", [null, fx.plot2])).rows[0].n, 0);
  } finally {
    await ownerA.end();
  }
});

test("v77: Security — a non-member of the project can't move anything, even knowing real ids (security invoker defers to snag_items' real RLS)", async () => {
  const ownerA = await userClient(DB, OWNER_A);
  const item = await createSnag(ownerA, { projectId: fx.projA, listId: fx.list1, location: "Stranger must not move this" });
  await ownerA.end();

  const stranger = await userClient(DB, STRANGER);
  try {
    let moved = 0;
    try {
      moved = (await stranger.query("select public.move_snag_items_to_plot($1, $2) as n", [[item.id], fx.plot2])).rows[0].n;
    } catch {
      // Raising (e.g. because RLS also hides the target plot's own list
      // from a non-member) is an acceptable way to refuse — what matters
      // is that nothing actually moved, checked below either way.
    }
    assert.equal(moved, 0);
  } finally {
    await stranger.end();
  }

  const ownerCheck = await userClient(DB, OWNER_A);
  try {
    const after = (await ownerCheck.query("select snag_list_id from public.snag_items where id = $1", [item.id])).rows[0];
    assert.equal(after.snag_list_id, fx.list1, "a non-member must never actually move a snag, whatever the call itself returned or threw");
  } finally {
    await ownerCheck.end();
  }
});
