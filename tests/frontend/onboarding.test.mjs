// Onboarding (Phase 0: Organisation Onboarding & Membership Requests) —
// the real onboarding.html page script under jsdom, same harness pattern
// as every other page test in this repo (see tests/lib/jsdom-harness.mjs).
// Mocks the app.js functions directly (createOrganisation,
// searchOrganisations, requestOrganisationMembership) rather than a
// lower-level supabase client, matching variation_workflow.test.mjs's
// own convention for pages that call app.js wrappers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/onboarding.html", import.meta.url).pathname;

const ORG_TYPES = [
  { value: "main_contractor", label: "Main Contractor" },
  { value: "subcontractor", label: "Subcontractor" },
  { value: "other", label: "Other" },
];

function makeContext(overrides = {}) {
  const calls = [];
  const ctx = {
    __url: "https://example.com/onboarding.html",
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    escapeHtml: (s) => String(s ?? ""),
    ORGANISATION_TYPES: ORG_TYPES,
    createOrganisation: async (name, type) => { calls.push({ fn: "createOrganisation", name, type }); return "org-new"; },
    searchOrganisations: async (q) => {
      calls.push({ fn: "searchOrganisations", q });
      return q === "Acme" ? [{ id: "org-1", name: "Acme Construction", type: "main_contractor" }] : [];
    },
    requestOrganisationMembership: async (orgId) => { calls.push({ fn: "requestOrganisationMembership", orgId }); return "req-1"; },
    ...overrides,
  };
  ctx.__calls = calls;
  return ctx;
}

async function run(context) {
  return runPage(HTML, extractScript(HTML), context);
}

test("Onboarding: the chooser shows both options plus a Skip link to the dashboard", async () => {
  const { document } = await run(makeContext());
  assert.ok(document.getElementById("showCreateBtn"));
  assert.ok(document.getElementById("showJoinBtn"));
  assert.equal(document.getElementById("skipLink").getAttribute("href"), "dashboard.html");
});

test("Onboarding: creating my own organisation calls createOrganisation() with the entered name and type", async () => {
  const ctx = makeContext();
  const { document } = await run(ctx);

  fireEvent(document.getElementById("showCreateBtn"), "click");
  document.getElementById("orgName").value = "ABC Plumbing Ltd";
  document.getElementById("orgType").value = "subcontractor";
  fireEvent(document.getElementById("createSubmitBtn"), "click");
  await wait(30);

  const call = ctx.__calls.find((c) => c.fn === "createOrganisation");
  assert.ok(call, "createOrganisation() must have been called");
  assert.equal(call.name, "ABC Plumbing Ltd");
  assert.equal(call.type, "subcontractor");
});

test("Onboarding: creating an organisation with an empty name is refused client-side, without calling createOrganisation()", async () => {
  const ctx = makeContext();
  const { document } = await run(ctx);

  fireEvent(document.getElementById("showCreateBtn"), "click");
  document.getElementById("orgName").value = "   ";
  fireEvent(document.getElementById("createSubmitBtn"), "click");
  await wait(30);

  assert.equal(ctx.__calls.filter((c) => c.fn === "createOrganisation").length, 0);
  assert.ok(document.getElementById("errorBox").textContent.length > 0, "an error must be shown");
});

test("Onboarding: creation errors from the server (e.g. duplicate/validation) are shown, not swallowed", async () => {
  const ctx = makeContext({
    createOrganisation: async () => { throw new Error("Organisation name is required"); },
  });
  const { document } = await run(ctx);

  fireEvent(document.getElementById("showCreateBtn"), "click");
  document.getElementById("orgName").value = "Some Name";
  fireEvent(document.getElementById("createSubmitBtn"), "click");
  await wait(30);

  assert.ok(document.getElementById("errorBox").textContent.includes("Organisation name is required"));
});

test("Onboarding: searching for an organisation shows matching results with name and type", async () => {
  const ctx = makeContext();
  const { document } = await run(ctx);

  fireEvent(document.getElementById("showJoinBtn"), "click");
  document.getElementById("orgSearch").value = "Acme";
  fireEvent(document.getElementById("searchBtn"), "click");
  await wait(30);

  const results = document.getElementById("searchResults").textContent;
  assert.ok(results.includes("Acme Construction"), "the matching organisation's name must be shown");
  assert.ok(document.querySelector("button[data-org-id='org-1']"), "a 'Request to Join' button must exist for the result");
});

test("Onboarding: a query shorter than 2 characters does not call searchOrganisations", async () => {
  const ctx = makeContext();
  const { document } = await run(ctx);

  fireEvent(document.getElementById("showJoinBtn"), "click");
  document.getElementById("orgSearch").value = "a";
  fireEvent(document.getElementById("searchBtn"), "click");
  await wait(30);

  assert.equal(ctx.__calls.filter((c) => c.fn === "searchOrganisations").length, 0);
});

test("Onboarding: requesting to join calls requestOrganisationMembership() and shows the pending confirmation message, never navigating away", async () => {
  const ctx = makeContext();
  const { document } = await run(ctx);

  fireEvent(document.getElementById("showJoinBtn"), "click");
  document.getElementById("orgSearch").value = "Acme";
  fireEvent(document.getElementById("searchBtn"), "click");
  await wait(30);

  fireEvent(document.querySelector("button[data-org-id='org-1']"), "click");
  await wait(30);

  const call = ctx.__calls.find((c) => c.fn === "requestOrganisationMembership");
  assert.ok(call, "requestOrganisationMembership() must have been called");
  assert.equal(call.orgId, "org-1");

  assert.equal(document.getElementById("pendingView").style.display, "block", "the pending confirmation view must be shown");
  const message = document.getElementById("pendingMessage").textContent;
  assert.ok(message.includes("Acme Construction"), "the confirmation must name the organisation requested");
  assert.ok(/sent to the organisation administrator/i.test(message), "the required wording must be shown, not a generic success message");
  assert.ok(/you'll get access once they approve/i.test(message), "must make clear that access is NOT granted yet");
});

test("Onboarding: a failed join request shows the error and stays on the search view, not the pending confirmation", async () => {
  const ctx = makeContext({
    requestOrganisationMembership: async () => { throw new Error("You are already a member of this organisation"); },
  });
  const { document } = await run(ctx);

  fireEvent(document.getElementById("showJoinBtn"), "click");
  document.getElementById("orgSearch").value = "Acme";
  fireEvent(document.getElementById("searchBtn"), "click");
  await wait(30);
  fireEvent(document.querySelector("button[data-org-id='org-1']"), "click");
  await wait(30);

  assert.equal(document.getElementById("pendingView").style.display, "none", "must not show the pending confirmation on failure");
  assert.ok(document.getElementById("errorBox").textContent.includes("already a member"));
});
