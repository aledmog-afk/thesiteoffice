// Toolbox Talks — library/list page (toolbox-talks.html). Real page
// script under jsdom; app.js functions mocked directly (same convention
// as onboarding.test.mjs/settings_organisation.test.mjs), with
// toolboxTalkCapabilities() extracted from the real app.js source so its
// actual logic is exercised, not a re-guessed copy — matching
// variation_workflow.test.mjs's own extractFunction() precedent.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/toolbox-talks.html", import.meta.url).pathname;
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractFunction(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
const { toolboxTalkCapabilities } = new Function(`
  ${extractFunction("toolboxTalkCapabilities")}
  return { toolboxTalkCapabilities };
`)();

function makeSupabase({ projectName = "Test Site", orgId = "org-1" } = {}) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        single: async () => {
          if (table === "projects") return { data: { name: projectName, org_id: orgId }, error: null };
          return { data: null, error: null };
        },
      };
      return api;
    },
  };
}

function makeContext({ role = "contributor", canEditLibrary = false, talks = [], templates = [], attendeesByTalk = {}, supabase } = {}) {
  const calls = [];
  const ctx = {
    __url: "https://example.com/toolbox-talks.html",
    supabase: supabase || makeSupabase(),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "p1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getMyToolboxTalkRole: async () => role,
    toolboxTalkCapabilities,
    canEditToolboxTalkTemplateLibrary: async () => canEditLibrary,
    listToolboxTalks: async () => talks,
    listToolboxTalkTemplates: async () => templates,
    listToolboxTalkAttendees: async (talkId) => attendeesByTalk[talkId] || [],
    startToolboxTalk: async (projectId, templateId, versionId) => { calls.push({ fn: "startToolboxTalk", projectId, templateId, versionId }); return { id: "new-talk-1" }; },
    createToolboxTalkTemplate: async (orgId, payload) => { calls.push({ fn: "createToolboxTalkTemplate", orgId, payload }); return { id: "new-template-1" }; },
    addToolboxTalkTemplateVersion: async (templateId, content) => { calls.push({ fn: "addToolboxTalkTemplateVersion", templateId, content }); return { id: "new-version-1" }; },
    getMemberEmailMap: async () => ({ u1: "contributor@example.com" }),
    TOOLBOX_TALK_STATUS_LABEL: { in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled" },
    TOOLBOX_TALK_STATUS_BADGE: { in_progress: "badge-amber", completed: "badge-green", cancelled: "badge-grey" },
    ...(supabase ? {} : {}),
  };
  ctx.__calls = calls;
  return ctx;
}

async function run(context) {
  return runPage(HTML, extractScript(HTML), context);
}

const TEMPLATES = [
  { id: "t-sys-1", org_id: null, title: "Working at Height", description: "10 minute talk", is_active: true, current_version_id: "v-sys-1" },
  { id: "t-org-1", org_id: "org-1", title: "Our Site Induction", description: null, is_active: true, current_version_id: "v-org-1" },
];

test("Toolbox Talks: a viewer sees the list but no Start/New Template buttons", async () => {
  const ctx = makeContext({ role: "viewer", talks: [], templates: TEMPLATES });
  const { document } = await run(ctx);
  await wait(20);
  assert.equal(document.getElementById("body").style.display, "block");
  assert.equal(document.getElementById("startTalkBtn").style.display, "none");
});

test("Toolbox Talks: a contributor sees Start Toolbox Talk, and the summary counts reflect the talk list", async () => {
  const talks = [
    { id: "1", title: "Talk A", status: "completed", started_at: "2026-01-01", delivered_by: "u1" },
    { id: "2", title: "Talk B", status: "in_progress", started_at: "2026-01-02", delivered_by: "u1" },
    { id: "3", title: "Talk C", status: "in_progress", started_at: "2026-01-03", delivered_by: "u1" },
    { id: "4", title: "Talk D", status: "cancelled", started_at: "2026-01-04", delivered_by: "u1" },
  ];
  const ctx = makeContext({ role: "contributor", talks, templates: TEMPLATES });
  const { document } = await run(ctx);
  await wait(20);

  assert.equal(document.getElementById("startTalkBtn").style.display, "inline-flex");
  assert.equal(document.getElementById("completedCount").textContent, "1");
  assert.equal(document.getElementById("inProgressCount").textContent, "2");
  assert.equal(document.getElementById("awaitingCount").textContent, "2");
  assert.equal(document.getElementById("cancelledCount").textContent, "1");
  assert.ok(document.getElementById("talkRows").innerHTML.includes("Talk A"));
});

test("Toolbox Talks: a non-editor never sees the New Template button, even with org templates present", async () => {
  const ctx = makeContext({ role: "contributor", canEditLibrary: false, templates: TEMPLATES });
  const { document } = await run(ctx);
  await wait(20);
  assert.equal(document.getElementById("newTemplateBtn").style.display, "none");
});

test("Toolbox Talks: an editor sees New Template, and their own organisation's template appears in the library management table", async () => {
  const ctx = makeContext({ role: "editor", canEditLibrary: true, templates: TEMPLATES });
  const { document } = await run(ctx);
  await wait(20);
  assert.equal(document.getElementById("newTemplateBtn").style.display, "inline-flex");
  assert.ok(document.getElementById("templateRows").innerHTML.includes("Our Site Induction"), "the org's own template must be listed");
  assert.ok(!document.getElementById("templateRows").innerHTML.includes("Working at Height"), "the system template must NOT appear in 'our organisation's templates'");
});

test("Toolbox Talks: starting a talk from the picker calls startToolboxTalk with the chosen template/version", async () => {
  const ctx = makeContext({ role: "contributor", templates: TEMPLATES });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.getElementById("startTalkBtn"), "click");
  await wait(20);
  assert.equal(document.getElementById("startModal").style.display, "flex");

  const startBtn = document.querySelector('button[data-template-id="t-sys-1"]');
  assert.ok(startBtn, "expected a Start Talk button for the system template");
  fireEvent(startBtn, "click");
  await wait(20);

  const call = ctx.__calls.find((c) => c.fn === "startToolboxTalk");
  assert.ok(call, "startToolboxTalk() must have been called");
  assert.equal(call.templateId, "t-sys-1");
  assert.equal(call.versionId, "v-sys-1");
});

test("Toolbox Talks: the template search filters the picker by title", async () => {
  const ctx = makeContext({ role: "contributor", templates: TEMPLATES });
  const { document } = await run(ctx);
  await wait(20);
  fireEvent(document.getElementById("startTalkBtn"), "click");
  await wait(20);

  document.getElementById("templateSearchInput").value = "Induction";
  fireEvent(document.getElementById("templateSearchInput"), "input");
  await wait(20);

  const rows = document.getElementById("templatePickerRows").innerHTML;
  assert.ok(rows.includes("Our Site Induction"));
  assert.ok(!rows.includes("Working at Height"));
});

test("Toolbox Talks: creating a new org template maps the plain-text form fields into the structured content shape", async () => {
  const ctx = makeContext({ role: "editor", canEditLibrary: true, templates: [] });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.getElementById("newTemplateBtn"), "click");
  await wait(20);
  document.getElementById("tfTitle").value = "Custom Talk";
  document.getElementById("tfIntroduction").value = "Intro text";
  document.getElementById("tfKeyPoints").value = "Point one\nPoint two";
  document.getElementById("tfGoodPractice").value = "Do this";
  document.getElementById("tfWarningSigns").value = "Watch for this";
  fireEvent(document.getElementById("saveTemplateBtn"), "click");
  await wait(20);

  const call = ctx.__calls.find((c) => c.fn === "createToolboxTalkTemplate");
  assert.ok(call, "createToolboxTalkTemplate() must have been called");
  assert.equal(call.orgId, "org-1");
  assert.equal(call.payload.title, "Custom Talk");
  assert.equal(call.payload.content.introduction, "Intro text");
  // JSON.stringify rather than assert.deepEqual: the array/object was
  // built inside the vm context (a different realm with its own
  // Array.prototype), which deepStrictEqual correctly treats as unequal
  // even when every element matches — same limitation noted in
  // dashboard_project_creation.test.mjs.
  assert.equal(JSON.stringify(call.payload.content.key_points), JSON.stringify(["Point one", "Point two"]));
  assert.equal(JSON.stringify(call.payload.content.site_observations), JSON.stringify({ good_practice: ["Do this"], warning_signs: ["Watch for this"] }));
});
