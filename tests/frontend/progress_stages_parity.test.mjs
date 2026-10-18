// The 33-stage list exists twice on purpose: PROGRESS_STAGES in app.js
// (dropdown and grid render without a request) and public.progress_stages
// in sql/schema.sql (the report save trigger resolves stage names in SQL).
// They must match exactly: keys, names (en dashes included), order and
// house / flat N/A defaults.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { progressHelpers } from "../lib/progress_helpers.mjs";

const SCHEMA = fs.readFileSync(new URL("../../sql/schema.sql", import.meta.url), "utf8");

function sqlStages() {
  const start = SCHEMA.indexOf("insert into public.progress_stages (stage_key, name, sort_order, house_default_applicable, flat_default_applicable) values");
  assert.ok(start > 0);
  const body = SCHEMA.slice(start, SCHEMA.indexOf("on conflict (stage_key) do nothing;", start));
  return [...body.matchAll(/\('(st_[a-z0-9_]+)',\s*'([^']+)',\s*(\d+),\s*(true|false),\s*(true|false)\)/g)]
    .map((m) => ({ key: m[1], name: m[2], sort: Number(m[3]), house: m[4] === "true", flat: m[5] === "true" }));
}

test("PROGRESS_STAGES (app.js) and progress_stages (schema.sql) are identical, in the same order", () => {
  const sql = sqlStages();
  assert.equal(sql.length, 33);
  assert.deepEqual(sql.map((s) => s.sort), Array.from({ length: 33 }, (_, i) => i + 1));
  assert.deepEqual(progressHelpers.PROGRESS_STAGES, sql.map(({ key, name, house, flat }) => ({ key, name, house, flat })));
  assert.deepEqual(progressHelpers.BUILD_MILESTONES, sql.map((s) => s.name));
});

test("every old weekly-report stage name is still in the list verbatim (old reports keep resolving)", () => {
  const OLD_30 = ["Site Set-Up / Enabling Works", "Groundworks", "Foundations (Foots)", "Drainage (Below Ground)", "Slab Pour / Oversite",
    "Timber Frame Erect", "Brick & Block Superstructure", "Scaffold Erect", "Roofing", "Windows & External Doors", "Scaffold Drop", "Render",
    "Cladding / External Finishes", "1st Fix – Carpentry", "1st Fix – Electrical", "1st Fix – Plumbing & Heating", "1st Fix – Gas",
    "Plastering / Drylining", "2nd Fix – Carpentry", "2nd Fix – Electrical", "2nd Fix – Plumbing & Heating", "Kitchen Fit", "Bathroom Fit",
    "Painting & Decorating", "Flooring", "Solar Panels (PV)", "External Works / Landscaping", "Testing & Commissioning", "Snagging",
    "Handover / Practical Completion"];
  const names = progressHelpers.BUILD_MILESTONES;
  OLD_30.forEach((n) => assert.ok(names.includes(n), n));
  // ...in the same relative order, with Carpentry Finals, Mastic and Clean added.
  assert.deepEqual(names.filter((n) => OLD_30.includes(n)), OLD_30);
  assert.deepEqual(names.filter((n) => !OLD_30.includes(n)), ["Carpentry Finals", "Mastic", "Clean"]);
});

test("Site Set-Up and External Works / Landscaping are N/A on every plot (no double counting with the external works figure)", () => {
  const s = Object.fromEntries(progressHelpers.PROGRESS_STAGES.map((x) => [x.key, x]));
  for (const k of ["st_site_setup", "st_external_works"]) { assert.equal(s[k].house, false); assert.equal(s[k].flat, false); }
  assert.equal(progressHelpers.PROGRESS_STAGES.filter((x) => x.house).length, 31);
  assert.equal(progressHelpers.PROGRESS_STAGES.filter((x) => x.flat).length, 17);
  assert.equal(s.st_windows_doors.flat, false, "Windows: N/A by default for flats (switchable per flat)");
  assert.equal(s.st_1fix_gas.flat, false, "Gas: N/A by default for flats (switchable per flat)");
});
