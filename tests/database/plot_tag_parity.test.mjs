// The weekly report tag parser must behave IDENTICALLY in the browser
// (resolvePlotTags, used for quality-gate sync) and in the database
// (resolve_plot_tags_detail, used to raise plot stages from issued reports
// and in the go-live backfill), including what each one skips. Both run against one shared case table.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient } from "../lib/db.mjs";
import { progressHelpers } from "../lib/progress_helpers.mjs";

const DB = "tracker_test_plot_tag_parity";
const CASES = JSON.parse(fs.readFileSync(new URL("../lib/plot_tag_cases.json", import.meta.url), "utf8"));
const fx = { idToName: new Map() };
let admin;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);
  admin = adminClient(DB);
  await admin.connect();
  const org = (await admin.query("insert into public.organisations (name) values ('Fake Parity Co') returning id")).rows[0].id;
  fx.project = (await admin.query("insert into public.projects (name, org_id) values ('Fake Parity Site', $1) returning id", [org])).rows[0].id;
  const blockIds = {};
  for (const b of CASES.blocks) {
    blockIds[b] = (await admin.query("insert into public.blocks (project_id, block_name) values ($1,$2) returning id", [fx.project, b])).rows[0].id;
  }
  fx.plots = [];
  for (const p of CASES.plots) {
    const id = (await admin.query("insert into public.plots (project_id, block_id, plot_number) values ($1,$2,$3) returning id",
      [fx.project, p.block ? blockIds[p.block] : null, p.plot_number])).rows[0].id;
    fx.idToName.set(id, p.plot_number);
    fx.plots.push({ id, plot_number: p.plot_number });
  }
});
after(async () => { await admin.end(); await dropTestDatabase(DB); });

const sortNames = (ids) => ids.map((id) => fx.idToName.get(id)).sort();

const sortSkips = (list) => list.map((s) => `${s.reason}:${s.token}`).sort();

for (const c of CASES.cases) {
  test(`plot tag ${JSON.stringify(c.tag)} -> ${JSON.stringify(c.expect)} (skipped ${JSON.stringify(c.skipped || [])}) in JS and SQL`, async () => {
    const js = progressHelpers.resolvePlotTagsDetailed(c.tag, fx.plots, CASES.blocks);
    const rows = (await admin.query("select plot_id, token, problem from public.resolve_plot_tags_detail($1, $2)", [fx.project, c.tag])).rows;
    const sqlIds = (await admin.query("select public.resolve_plot_tags($1, $2) id", [fx.project, c.tag])).rows.map((r) => r.id);
    assert.deepEqual(sortNames(js.ids), [...c.expect].sort(), "JS plots");
    assert.deepEqual(sortNames([...new Set(sqlIds)]), [...c.expect].sort(), "SQL plots");
    assert.deepEqual(sortNames(rows.filter((r) => r.plot_id).map((r) => r.plot_id)), [...c.expect].sort(), "SQL detail plots");
    assert.deepEqual(sortSkips(js.skipped), [...(c.skipped || [])].sort(), "JS skipped");
    assert.deepEqual(sortSkips(rows.filter((r) => r.problem).map((r) => ({ token: r.token, reason: r.problem }))), [...(c.skipped || [])].sort(), "SQL skipped");
    assert.deepEqual(progressHelpers.resolvePlotTags(c.tag, fx.plots, CASES.blocks), js.ids);
  });
}
