// Dashboard load + project creation (Priority 1: every new project must
// resolve/create the caller's organisation via ensure_organisation()
// before inserting — this proves the real dashboard.html page does that,
// not just that the RPC exists).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/dashboard.html", import.meta.url).pathname;

function makeSupabase({ ensureOrgId = "org-1", projects = [] } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    rpc(name) {
      calls.push({ op: "rpc", name });
      if (name === "ensure_organisation") return Promise.resolve({ data: ensureOrgId, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        single: async () => ({ data: { id: "new-project-id" }, error: null }),
        insert(payload) {
          calls.push({ table, op: "insert", payload });
          return { select: () => ({ single: async () => ({ data: { id: "new-project-id", ...payload }, error: null }) }) };
        },
        then(resolve) {
          if (table === "projects") resolve({ data: projects, error: null });
          else resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
}

async function run(supabase) {
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/dashboard.html",
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    RAG_LABEL: { red: "Red", amber: "Amber", green: "Green" },
    renderProgressBlock: () => "",
    ensureOrganisation: async () => {
      const { data, error } = await supabase.rpc("ensure_organisation");
      if (error) throw error;
      return data;
    },
  });
}

test("dashboard.html: an empty account shows the empty state, not an error", async () => {
  const { document } = await run(makeSupabase({ projects: [] }));
  await wait(20);
  assert.equal(document.getElementById("emptyState").style.display, "block");
});

test("dashboard.html: existing projects render as tiles", async () => {
  const project = { id: "p1", name: "Elm Grove", main_contractor_name: "Acme Ltd", rag_status: "green", status: "active", baseline_progress_pct: 10, actual_progress_pct: 12 };
  const { document } = await run(makeSupabase({ projects: [project] }));
  await wait(20);
  assert.equal(document.getElementById("emptyState").style.display, "none");
  assert.ok(document.getElementById("grid").innerHTML.includes("Elm Grove"));
});

test("dashboard.html: creating a project resolves the caller's organisation and includes org_id in the insert", async () => {
  const supabase = makeSupabase({ ensureOrgId: "org-abc-123" });
  const { document } = await run(supabase);

  fireEvent(document.getElementById("newProjectBtn"), "click");
  document.getElementById("name").value = "New Site";
  fireEvent(document.getElementById("projectForm"), "submit");
  await wait(30);

  const rpcCalls = supabase.calls.filter((c) => c.op === "rpc" && c.name === "ensure_organisation");
  assert.equal(rpcCalls.length, 1, "expected ensure_organisation to be called exactly once");

  const inserts = supabase.calls.filter((c) => c.table === "projects" && c.op === "insert");
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].payload.org_id, "org-abc-123", "the resolved organisation id must be included in the insert");
  assert.equal(inserts[0].payload.name, "New Site");
});

test("dashboard.html: if resolving the organisation fails, no project insert is attempted", async () => {
  const supabase = makeSupabase({});
  supabase.rpc = (name) => (name === "ensure_organisation" ? Promise.resolve({ data: null, error: { message: "boom" } }) : Promise.resolve({ data: null, error: null }));
  const { document } = await run(supabase);

  fireEvent(document.getElementById("newProjectBtn"), "click");
  document.getElementById("name").value = "New Site";
  fireEvent(document.getElementById("projectForm"), "submit");
  await wait(30);

  const inserts = supabase.calls.filter((c) => c.table === "projects" && c.op === "insert");
  assert.equal(inserts.length, 0, "must not attempt to insert a project if the organisation couldn't be resolved");
  assert.ok(document.getElementById("errorBox").textContent.includes("boom"));
});
