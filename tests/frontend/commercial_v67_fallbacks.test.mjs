// v67: the app.js helpers the pages use for "Viewers see totals only /
// owners get full access" must work both BEFORE v67 is applied (the new
// database functions don't exist yet → fall back to the old reads) and
// AFTER (use the new functions). Runs the REAL source from tracker/js/app.js
// (extracted, not reimplemented) against a fake supabase client.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function src(name) {
  const m = APP_JS.match(new RegExp(`export (async )?function ${name}\\(`));
  assert.ok(m, `${name} not found`);
  const start = m.index;
  let depth = 0, i = APP_JS.indexOf("{", APP_JS.indexOf(")", start));
  for (; i < APP_JS.length; i++) { if (APP_JS[i] === "{") depth++; else if (APP_JS[i] === "}" && --depth === 0) break; }
  return APP_JS.slice(start, i + 1).replace(/^export /, "");
}
const NAMES = ["isMissingRpcError", "getMyCommercialRole", "getCommercialOwnerAccessUserIds", "getCommercialEventView", "getCommercialTbcEventIds", "listCommercialVariationFacts", "getCommercialWarnings"];
function load(supabase) {
  return new Function("supabase", `${NAMES.map(src).join("\n")}; return { ${NAMES.join(", ")} };`)(supabase);
}
const MISSING = { code: "PGRST202", message: "Could not find the function public.x in the schema cache" };

// A fake supabase: rpcs[name] = {data,error}; tables[name] = rows.
function fake({ rpcs = {}, tables = {} }) {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push(["rpc", name, args]); return rpcs[name] || { data: null, error: MISSING }; },
    from: (t) => ({ select: () => ({ eq: async () => { calls.push(["from", t]); return tables[t] instanceof Error ? { data: null, error: tables[t] } : { data: tables[t] || [], error: null }; } }) }),
  };
}

test("getMyCommercialRole: after v67 uses commercial_access_role (owner → 'contributor'); before v67 falls back to project_module_role", async () => {
  let sb = fake({ rpcs: { commercial_access_role: { data: "contributor", error: null } } });
  assert.equal(await load(sb).getMyCommercialRole("p"), "contributor");
  assert.ok(!sb.calls.some((c) => c[1] === "project_module_role"));
  sb = fake({ rpcs: { project_module_role: { data: "viewer", error: null } } });
  assert.equal(await load(sb).getMyCommercialRole("p"), "viewer");
  sb = fake({ rpcs: { project_module_role: { data: null, error: null } } });
  assert.equal(await load(sb).getMyCommercialRole("p"), null);
  sb = fake({ rpcs: { commercial_access_role: { data: null, error: { code: "42501", message: "permission denied" } } } });
  await assert.rejects(load(sb).getMyCommercialRole("p"), (e) => /permission denied/.test(e.message), "a real error is not swallowed");
});

test("getCommercialOwnerAccessUserIds: asks the database (is_owner_side_user) for each owner-role member only, and fails closed", async () => {
  const calls = [];
  const sb = { rpc: async (name, args) => {
    calls.push([name, args]);
    if (args.p_user_id === "in-org") return { data: true, error: null };
    if (args.p_user_id === "boom") return { data: null, error: { code: "500", message: "network" } };
    return { data: false, error: null };
  } };
  const members = [{ user_id: "in-org", role: "owner" }, { user_id: "not-in-org", role: "owner" }, { user_id: "boom", role: "owner" }, { user_id: "collab", role: "collaborator" }];
  const ids = await load(sb).getCommercialOwnerAccessUserIds("p", members);
  assert.deepEqual([...ids], ["in-org"]);
  assert.deepEqual(calls.map((c) => c[0]), ["is_owner_side_user", "is_owner_side_user", "is_owner_side_user"], "only owner-role members are checked");
  assert.deepEqual(calls[0][1], { p_project_id: "p", p_user_id: "in-org" });
});

test("getCommercialEventView: returns the redacted record after v67, null before (so the page falls back)", async () => {
  const view = { id: "e1", total_value: 10, lines: [] };
  assert.deepEqual(await load(fake({ rpcs: { get_commercial_event_view: { data: view, error: null } } })).getCommercialEventView("e1"), view);
  assert.equal(await load(fake({})).getCommercialEventView("e1"), null);
  await assert.rejects(load(fake({ rpcs: { get_commercial_event_view: { data: null, error: { code: "P0001", message: "Commercial record not found" } } } })).getCommercialEventView("e1"), (e) => /not found/.test(e.message));
});

test("getCommercialTbcEventIds / getCommercialWarnings: after v67 use the id-only function (no line items read); before v67 read line items", async () => {
  let sb = fake({ rpcs: { commercial_tbc_event_ids: { data: ["e1", "e2"], error: null } }, tables: { commercial_evidence_links: [{ commercial_event_id: "e2" }] } });
  const w = await load(sb).getCommercialWarnings("p");
  assert.deepEqual([...w.tbcEventIds], ["e1", "e2"]);
  assert.deepEqual([...w.eventsWithEvidence], ["e2"]);
  assert.ok(!sb.calls.some((c) => c[1] === "commercial_line_items"), "a v67 Viewer never touches line items");
  sb = fake({ tables: { commercial_line_items: [{ commercial_event_id: "e1", rate: null }, { commercial_event_id: "e1", rate: null }, { commercial_event_id: "e3", rate: 5 }] } });
  assert.deepEqual(await load(sb).getCommercialTbcEventIds("p"), ["e1"]);
});

test("listCommercialVariationFacts: after v67 uses the function; before v67 reads the variations table", async () => {
  const facts = [{ commercial_event_id: "v1", date_identified: "2026-10-02", date_instructed: null, instruction_reference: "CI-1" }];
  let sb = fake({ rpcs: { list_commercial_variation_facts: { data: facts, error: null } } });
  assert.deepEqual(await load(sb).listCommercialVariationFacts("p"), facts);
  assert.ok(!sb.calls.some((c) => c[1] === "variations"));
  sb = fake({ tables: { variations: [{ commercial_event_id: "v1", date_identified: "2026-10-02" }] } });
  assert.deepEqual(await load(sb).listCommercialVariationFacts("p"), [{ commercial_event_id: "v1", date_identified: "2026-10-02" }]);
});
