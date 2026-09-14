// Commercial Module — Phase 1 (Daywork vertical slice). Proves
// daywork-detail.html's real inline script wires the Phase 0 database
// foundation up correctly: creation, line-item pricing display,
// evidence, and the full draft -> submitted -> approved/rejected
// workflow, each gated by the actual capability the page asks the
// database for (getMyCommercialRole()/commercialCapabilities()) — never
// assumed from project ownership.
//
// The mock store below mirrors the REAL rules Phase 0's triggers and
// RLS already enforce (locked content while submitted/approved, no
// self-approval, valid transitions only) — this file is not re-proving
// those rules (tests/security/commercial_*.test.mjs already does that
// against a real Postgres database with real RLS), it proves the PAGE
// respects them: hides the right controls, shows the right messages,
// and never lets a disallowed action appear to succeed.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/daywork-detail.html", import.meta.url).pathname;
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
function extractFunction(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
const helperScope = `
  ${extractFunction("escapeHtml")}
  ${extractFunction("toLocalISODate")}
  ${extractFunction("todayISO")}
  ${extractFunction("formatDate")}
  ${extractFunction("comparePlotNumbers")}
  ${extractFunction("previewLineTotal")}
  ${extractFunction("formatCommercialGBP")}
  ${extractFunction("commercialCapabilities")}
  ${extractFunction("validCommercialStatusTransitions")}
  ${extractConst("COMMERCIAL_STATUS_LABEL")}
  ${extractConst("COMMERCIAL_STATUS_BADGE")}
  ${extractConst("COMMERCIAL_LINE_TYPES")}
  ${extractConst("COMMERCIAL_LINE_TYPE_LABEL")}
  return {
    escapeHtml, formatDate, todayISO, comparePlotNumbers, previewLineTotal, formatCommercialGBP,
    commercialCapabilities, validCommercialStatusTransitions,
    COMMERCIAL_STATUS_LABEL, COMMERCIAL_STATUS_BADGE, COMMERCIAL_LINE_TYPES, COMMERCIAL_LINE_TYPE_LABEL,
  };
`;
const {
  escapeHtml, formatDate, todayISO, comparePlotNumbers, previewLineTotal, formatCommercialGBP,
  commercialCapabilities, validCommercialStatusTransitions,
  COMMERCIAL_STATUS_LABEL, COMMERCIAL_STATUS_BADGE, COMMERCIAL_LINE_TYPES, COMMERCIAL_LINE_TYPE_LABEL,
} = new Function(helperScope)();

const OWNER_A = "u-owner";
const CONTRIBUTOR_A = "u-contributor";
const APPROVER_A = "u-approver";
const MEMBERS = { [OWNER_A]: "owner@example.com", [CONTRIBUTOR_A]: "contributor@example.com", [APPROVER_A]: "approver@example.com" };

const TRANSITIONS = { draft: ["submitted"], submitted: ["approved", "rejected"], rejected: ["draft"], approved: [] };

function makeStore() {
  let nextEventSeq = 1;
  let nextLineSeq = 1;
  let nextDocSeq = 1;
  let nextEvidenceSeq = 1;
  const events = new Map(); // id -> event row (merged with dayworks fields)
  const lineItems = [];
  const evidenceLinks = [];
  const documents = new Map();
  const signatures = [];

  function unlocked(event) {
    return event.status === "draft" || event.status === "rejected";
  }
  function recomputeTotal(eventId) {
    const total = lineItems.filter((li) => li.commercial_event_id === eventId)
      .reduce((sum, li) => sum + (li.line_total === null ? 0 : li.line_total), 0);
    events.get(eventId).total_value = Math.round(total * 100) / 100;
  }

  return {
    events, lineItems, evidenceLinks, documents, signatures,

    async getMyCommercialRole() { return this.__role ?? null; },

    async createDaywork(projectId, { title, plotId = null, dateUndertaken = null }) {
      const id = `e${nextEventSeq++}`;
      const row = {
        id, project_id: projectId, type: "daywork",
        reference: `DW-${String(nextEventSeq - 1).padStart(3, "0")}`,
        title, plot_id: plotId, status: "draft", total_value: 0,
        created_by: this.__userId, created_at: "2026-09-01T00:00:00Z",
        submitted_by: null, submitted_at: null, approved_by: null, approved_at: null,
        rejected_by: null, rejected_at: null, rejection_reason: null,
        date_undertaken: dateUndertaken,
      };
      events.set(id, row);
      return { ...row };
    },
    async getDaywork(eventId) {
      const row = events.get(eventId);
      if (!row) throw new Error("not found");
      return { ...row };
    },
    async updateDaywork(eventId, { title, plotId, dateUndertaken } = {}) {
      const row = events.get(eventId);
      if (!unlocked(row)) throw new Error(row.status === "approved" ? "This commercial event is approved and is immutable. Create a superseding record instead of editing it." : `This commercial event is ${row.status} — its content is locked until it is rejected back to draft.`);
      if (title !== undefined) row.title = title;
      if (plotId !== undefined) row.plot_id = plotId;
      if (dateUndertaken !== undefined) row.date_undertaken = dateUndertaken;
      return { ...row };
    },

    async getCommercialLineItems(eventId) {
      return lineItems.filter((li) => li.commercial_event_id === eventId).map((li) => ({ ...li }));
    },
    async addCommercialLineItem(eventId, { lineType, description, trade = null, quantity = 1, unit = null, rate = null }) {
      const event = events.get(eventId);
      if (!unlocked(event)) throw new Error(`This commercial event is ${event.status} — its content is locked until it is rejected back to draft.`);
      const q = Number(quantity);
      const r = rate === null || rate === "" || rate === undefined ? null : Number(rate);
      const row = {
        id: `li${nextLineSeq++}`, commercial_event_id: eventId, line_type: lineType, description,
        trade, quantity: q, unit, rate: r, line_total: r === null ? null : Math.round(q * r * 100) / 100,
      };
      lineItems.push(row);
      recomputeTotal(eventId);
      return { ...row };
    },
    async deleteCommercialLineItem(lineItemId) {
      const li = lineItems.find((x) => x.id === lineItemId);
      const event = events.get(li.commercial_event_id);
      if (!unlocked(event)) throw new Error(`This commercial event is ${event.status} — its content is locked until it is rejected back to draft.`);
      const idx = lineItems.indexOf(li);
      lineItems.splice(idx, 1);
      recomputeTotal(li.commercial_event_id);
    },

    async getCommercialEvidence(eventId) {
      return evidenceLinks.filter((l) => l.commercial_event_id === eventId).map((l) => ({
        ...l, document: documents.get(l.source_id) || null,
      }));
    },
    async addCommercialEvidencePhoto(eventId, projectId, file, caption = null) {
      const event = events.get(eventId);
      if (!unlocked(event)) throw new Error(`This commercial event is ${event.status} — its content is locked until it is rejected back to draft.`);
      const docId = `d${nextDocSeq++}`;
      const doc = { id: docId, title: caption || "Evidence photo", currentRevision: { file_name: file?.name || "photo.jpg" } };
      documents.set(docId, doc);
      const link = { id: `ev${nextEvidenceSeq++}`, commercial_event_id: eventId, source_table: "documents", source_id: docId, caption };
      evidenceLinks.push(link);
      return { link, document: doc };
    },
    async removeCommercialEvidenceLink(linkId) {
      const link = evidenceLinks.find((l) => l.id === linkId);
      const event = events.get(link.commercial_event_id);
      if (!unlocked(event)) throw new Error(`This commercial event is ${event.status} — its content is locked until it is rejected back to draft.`);
      evidenceLinks.splice(evidenceLinks.indexOf(link), 1);
    },

    async getCommercialSignatures(eventId) {
      return signatures.filter((s) => s.commercial_event_id === eventId);
    },

    async submitCommercialEvent(eventId) {
      const row = events.get(eventId);
      if (!["contributor", "approver"].includes(this.__role)) throw new Error("You do not have permission to submit commercial events on this project");
      if (!TRANSITIONS[row.status].includes("submitted")) throw new Error(`Invalid commercial event status transition: ${row.status} -> submitted`);
      row.status = "submitted"; row.submitted_by = this.__userId; row.submitted_at = "2026-09-02T00:00:00Z";
      signatures.push({ commercial_event_id: eventId, action: "submitted", signed_by_user_id: this.__userId });
      return { ...row };
    },
    async approveCommercialEvent(eventId) {
      const row = events.get(eventId);
      if (this.__role !== "approver") throw new Error("You do not have permission to approve commercial events on this project");
      if (row.created_by === this.__userId) throw new Error("You cannot approve a commercial event you created yourself");
      if (!TRANSITIONS[row.status].includes("approved")) throw new Error(`Invalid commercial event status transition: ${row.status} -> approved`);
      row.status = "approved"; row.approved_by = this.__userId; row.approved_at = "2026-09-03T00:00:00Z";
      signatures.push({ commercial_event_id: eventId, action: "approved", signed_by_user_id: this.__userId });
      return { ...row };
    },
    async rejectCommercialEvent(eventId, reason) {
      const row = events.get(eventId);
      if (this.__role !== "approver") throw new Error("You do not have permission to reject commercial events on this project");
      if (!TRANSITIONS[row.status].includes("rejected")) throw new Error(`Invalid commercial event status transition: ${row.status} -> rejected`);
      row.status = "rejected"; row.rejected_by = this.__userId; row.rejected_at = "2026-09-03T00:00:00Z"; row.rejection_reason = reason || null;
      signatures.push({ commercial_event_id: eventId, action: "rejected", signed_by_user_id: this.__userId });
      return { ...row };
    },
    async reopenCommercialEvent(eventId) {
      const row = events.get(eventId);
      if (!["contributor", "approver"].includes(this.__role)) throw new Error("You do not have permission to edit commercial events on this project");
      if (!TRANSITIONS[row.status].includes("draft")) throw new Error(`Invalid commercial event status transition: ${row.status} -> draft`);
      row.status = "draft";
      return { ...row };
    },

    async getMemberEmailMap() { return MEMBERS; },
    async getDocumentFileUrl() { return "https://example.com/signed-url"; },
  };
}

async function run(store, { role, userId, eventId = null, projectId = "p1" }) {
  store.__role = role;
  store.__userId = userId;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        single: async () => (table === "projects" ? { data: { name: "Test Site" }, error: null } : { data: null, error: null }),
        then: undefined,
      };
      // supabase.from("plots").select(...) is awaited directly (no .single()) in this page
      api.__isThenable = true;
      return new Proxy(api, {
        get(target, prop) {
          if (prop === "then") return (resolve) => resolve({ data: [], error: null });
          return target[prop];
        },
      });
    },
  };
  return runPage(HTML, extractScript(HTML), {
    __url: `https://example.com/daywork-detail.html?${eventId ? `id=${eventId}` : `project=${projectId}`}`,
    supabase,
    requireAuth: async () => ({ id: userId }),
    renderHeader: () => {},
    getParam: (key) => (key === "id" ? eventId : key === "project" ? projectId : null),
    escapeHtml, formatDate, todayISO, comparePlotNumbers, previewLineTotal, formatCommercialGBP,
    commercialCapabilities, validCommercialStatusTransitions,
    COMMERCIAL_STATUS_LABEL, COMMERCIAL_STATUS_BADGE, COMMERCIAL_LINE_TYPES, COMMERCIAL_LINE_TYPE_LABEL,
    showCommercialError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getMyCommercialRole: (...a) => store.getMyCommercialRole(...a),
    createDaywork: (...a) => store.createDaywork(...a),
    getDaywork: (...a) => store.getDaywork(...a),
    updateDaywork: (...a) => store.updateDaywork(...a),
    getCommercialLineItems: (...a) => store.getCommercialLineItems(...a),
    addCommercialLineItem: (...a) => store.addCommercialLineItem(...a),
    deleteCommercialLineItem: (...a) => store.deleteCommercialLineItem(...a),
    getCommercialEvidence: (...a) => store.getCommercialEvidence(...a),
    addCommercialEvidencePhoto: (...a) => store.addCommercialEvidencePhoto(...a),
    removeCommercialEvidenceLink: (...a) => store.removeCommercialEvidenceLink(...a),
    getCommercialSignatures: (...a) => store.getCommercialSignatures(...a),
    submitCommercialEvent: (...a) => store.submitCommercialEvent(...a),
    approveCommercialEvent: (...a) => store.approveCommercialEvent(...a),
    rejectCommercialEvent: (...a) => store.rejectCommercialEvent(...a),
    reopenCommercialEvent: (...a) => store.reopenCommercialEvent(...a),
    getMemberEmailMap: (...a) => store.getMemberEmailMap(...a),
    getDocumentFileUrl: (...a) => store.getDocumentFileUrl(...a),
    alert: () => {}, confirm: () => true,
  });
}

// ─── Creation ───────────────────────────────────────────────────

test("Daywork creation: a Contributor can create — lands in create mode with the form visible", async () => {
  const store = makeStore();
  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, projectId: "p1" });
  await wait(20);
  assert.equal(document.getElementById("createCard").style.display, "block");
  assert.equal(document.getElementById("noAccessCard").style.display, "none");
});

test("Daywork creation: a Viewer cannot create — sees a permission message, not the create form", async () => {
  const store = makeStore();
  const { document } = await run(store, { role: "viewer", userId: "u-viewer", projectId: "p1" });
  await wait(20);
  assert.notEqual(document.getElementById("createCard").style.display, "block");
  assert.ok(document.getElementById("pageErrorBox").textContent.length > 0, "a viewer should see a clear message explaining why they can't create");
});

test("Daywork creation: a user with NO Commercial grant sees the no-access card, not the create form", async () => {
  const store = makeStore();
  const { document } = await run(store, { role: null, userId: "u-nograntowner", projectId: "p1" });
  await wait(20);
  assert.equal(document.getElementById("noAccessCard").style.display, "block");
  assert.notEqual(document.getElementById("createCard").style.display, "block");
});

test("Daywork creation: submitting the form creates the record and lands on its detail page (reference assigned)", async () => {
  const store = makeStore();
  const { document, window } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, projectId: "p1" });
  await wait(20);
  document.getElementById("cTitle").value = "Additional groundworks";
  fireEvent(document.getElementById("createForm"), "submit");
  await wait(30);
  assert.equal(store.events.size, 1);
  const [created] = [...store.events.values()];
  assert.equal(created.title, "Additional groundworks");
  assert.equal(created.status, "draft");
  assert.equal(created.reference, "DW-001");
  // jsdom does not implement real cross-document navigation, so
  // window.location.href after an assignment can't be asserted here
  // (same limitation applies to the app's other post-create redirects,
  // e.g. dashboard.html's own `window.location.href = ...` — none of
  // them are asserted anywhere in this test suite for that reason).
  // The redirect target itself — daywork-detail.html?id=<new id> — is
  // a one-line, directly-readable statement in the page's own submit
  // handler; what's worth proving here is that the record it points at
  // was actually created correctly, which the assertions above cover.
});

// ─── Pricing display ────────────────────────────────────────────

test("Pricing: line items display the database-calculated total, multiple lines sum correctly, negative and TBC rates both display correctly", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A }), "p1", { title: "Pricing test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 8, rate: 25 }); // 200.00
  await store.addCommercialLineItem(event.id, { lineType: "plant", description: "Excavator", quantity: 2, rate: -10 }); // omission -20.00
  await store.addCommercialLineItem(event.id, { lineType: "material", description: "Concrete", quantity: 5, rate: null }); // TBC

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: event.id });
  await wait(30);

  const rowsText = document.getElementById("lineItemList").textContent;
  assert.ok(rowsText.includes("£25.00") || rowsText.includes("25.00"), "labour rate should be shown");
  assert.ok(rowsText.includes("-£10.00") || rowsText.includes("-10.00"), "the negative (omission) rate should display as negative, not hidden or flipped positive");
  assert.ok(rowsText.includes("TBC"), "a NULL rate must display as TBC, never as £0.00 or blank");
  assert.equal(document.getElementById("grandTotal").textContent, formatCommercialGBP(180), "the grand total must be the database-calculated sum (200.00 - 20.00 = 180.00), not a client re-derivation");
  assert.ok(document.getElementById("tbcWarning").textContent.includes("1 line item"), "a TBC warning should surface without blocking anything");
});

// ─── Workflow ───────────────────────────────────────────────────

test("Workflow: draft can submit — button visible for a Contributor, disappears once submitted, content becomes read-only", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A }), "p1", { title: "Workflow test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: event.id });
  await wait(30);
  let submitBtn = [...document.getElementById("workflowActions").querySelectorAll("button")].find((b) => b.textContent === "Submit for Approval");
  assert.ok(submitBtn, "a draft with a line item should offer Submit for Approval to a Contributor");
  assert.equal(document.getElementById("lineItemAddRow").style.display, "flex", "line items should be addable while draft");

  fireEvent(submitBtn, "click");
  await wait(30);

  assert.equal(store.events.get(event.id).status, "submitted");
  assert.equal(document.getElementById("lineItemAddRow").style.display, "none", "content must become read-only once submitted");
  assert.equal(document.getElementById("editHeaderBtn").style.display, "none");
  const stillHasSubmit = [...document.getElementById("workflowActions").querySelectorAll("button")].some((b) => b.textContent === "Submit for Approval");
  assert.equal(stillHasSubmit, false, "a submitted record should no longer offer Submit");
});

test("Workflow: an eligible Approver (not the creator) can approve a submitted record", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Approve test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(event.id);

  const { document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: event.id });
  await wait(30);
  const approveBtn = [...document.getElementById("workflowActions").querySelectorAll("button")].find((b) => b.textContent === "Approve");
  assert.ok(approveBtn, "an eligible approver should see an Approve button");
  fireEvent(approveBtn, "click");
  await wait(30);
  assert.equal(store.events.get(event.id).status, "approved");
  assert.equal(store.events.get(event.id).approved_by, APPROVER_A);
});

test("Workflow: a submitted record can be rejected, with a reason, and returned to draft for amendment", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Reject test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(event.id);

  let { document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: event.id });
  await wait(30);
  const rejectBtn = [...document.getElementById("workflowActions").querySelectorAll("button")].find((b) => b.textContent === "Reject");
  assert.ok(rejectBtn);
  fireEvent(rejectBtn, "click");
  await wait(10);
  assert.equal(document.getElementById("rejectModal").style.display, "flex", "rejecting should open the reason modal, not reject immediately");
  document.getElementById("rejectReason").value = "Pricing looks wrong on line 1";
  fireEvent(document.getElementById("confirmRejectBtn"), "click");
  await wait(30);
  assert.equal(store.events.get(event.id).status, "rejected");
  assert.equal(store.events.get(event.id).rejection_reason, "Pricing looks wrong on line 1");

  // Contributor returns it to draft
  ({ document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: event.id }));
  await wait(30);
  const returnBtn = [...document.getElementById("workflowActions").querySelectorAll("button")].find((b) => b.textContent === "Return to Draft");
  assert.ok(returnBtn, "a rejected record should offer Return to Draft to a Contributor");
  fireEvent(returnBtn, "click");
  await wait(30);
  assert.equal(store.events.get(event.id).status, "draft");
  assert.equal(document.getElementById("lineItemAddRow").style.display, "flex", "content must be editable again once back in draft");
});

test("Workflow: an approved record shows no edit/delete controls at all — completely read-only", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Locked test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(event.id);
  store.__userId = APPROVER_A; store.__role = "approver";
  await store.approveCommercialEvent(event.id);

  const { document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: event.id });
  await wait(30);
  assert.equal(document.getElementById("editHeaderBtn").style.display, "none");
  assert.equal(document.getElementById("lineItemAddRow").style.display, "none");
  assert.equal(document.getElementById("addEvidenceRow").style.display, "none");
  const deleteLineBtns = document.querySelectorAll("[data-delete-line]");
  assert.equal(deleteLineBtns.length, 0, "an approved record's line items must show no delete control");
  assert.equal(document.getElementById("workflowActions").children.length, 0, "an approved record offers no workflow actions at all");
  assert.ok(document.getElementById("workflowDetails").textContent.includes("permanently locked"));
});

test("Workflow: an invalid transition (approving a draft directly) is rejected and surfaced as an error, never silently succeeding", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Invalid transition test" });
  // Directly attempt the store-level illegal transition the page itself
  // would never offer a button for — proving the underlying call used by
  // the page (not just the button's visibility) rejects it correctly.
  await assert.rejects(
    store.approveCommercialEvent.call(Object.assign(store, { __userId: APPROVER_A, __role: "approver" }), event.id),
    /Invalid commercial event status transition: draft -> approved/
  );
  assert.equal(store.events.get(event.id).status, "draft", "the status must be unchanged after a rejected transition attempt");
});

// ─── Permissions ────────────────────────────────────────────────

test("Permissions: a Viewer sees the record but no mutation controls anywhere on the page", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Viewer test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });

  const { document } = await run(store, { role: "viewer", userId: "u-viewer", eventId: event.id });
  await wait(30);
  assert.equal(document.getElementById("editHeaderBtn").style.display, "none");
  assert.equal(document.getElementById("lineItemAddRow").style.display, "none");
  assert.equal(document.getElementById("addEvidenceRow").style.display, "none");
  assert.equal(document.getElementById("workflowActions").children.length, 0, "a viewer should see zero workflow action buttons");
  assert.ok(document.getElementById("lineItemList").textContent.includes("Labour"), "a viewer must still be able to SEE the pricing");
});

test("Permissions: a Contributor cannot approve — an Approve button never appears for them even on a submitted record they didn't create", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: APPROVER_A, __role: "approver" }), "p1", { title: "Contributor-cannot-approve test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(event.id);

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: event.id });
  await wait(30);
  const buttons = [...document.getElementById("workflowActions").querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(!buttons.includes("Approve"));
  assert.ok(!buttons.includes("Reject"));
});

test("Permissions: an Approver cannot approve their OWN submission — the page shows an explanatory message instead of Approve/Reject buttons", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: APPROVER_A, __role: "approver" }), "p1", { title: "Self-approval test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(event.id);

  const { document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: event.id });
  await wait(30);
  const buttons = [...document.getElementById("workflowActions").querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(!buttons.includes("Approve"), "an approver must never see Approve on their own submission");
  assert.ok(document.getElementById("workflowDetails").textContent.includes("cannot approve") || document.getElementById("workflowActions").textContent.includes("cannot approve"), "the page should explain why, not just silently hide the button");
});

test("Permissions: a project owner with NO Commercial grant gets the no-access card on a Daywork's detail page too", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Owner no grant test" });

  const { document } = await run(store, { role: null, userId: "u-ownernogrant", eventId: event.id });
  await wait(30);
  assert.equal(document.getElementById("noAccessCard").style.display, "block");
  assert.notEqual(document.getElementById("detailBody").style.display, "block");
});

// ─── Evidence ───────────────────────────────────────────────────

test("Evidence: a permitted Contributor can add evidence to a draft record", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Evidence test" });

  const { document, window } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: event.id });
  await wait(30);
  assert.equal(document.getElementById("addEvidenceRow").style.display, "flex");

  const input = document.getElementById("evidenceFileInput");
  const file = new window.File(["fake-bytes"], "site-photo.jpg", { type: "image/jpeg" });
  Object.defineProperty(input, "files", { value: [file], writable: false });
  fireEvent(input, "change");
  await wait(30);

  assert.equal(store.evidenceLinks.length, 1);
  assert.equal(store.evidenceLinks[0].source_table, "documents", "evidence must be backed by the Documents module, not a new upload mechanism");
  assert.equal(document.getElementById("evidenceEmpty").style.display, "none");
});

test("Evidence: cannot be added or removed once the record is submitted", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Evidence lock test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.addCommercialEvidencePhoto(event.id, "p1", { name: "before.jpg" });
  await store.submitCommercialEvent(event.id);

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: event.id });
  await wait(30);
  assert.equal(document.getElementById("addEvidenceRow").style.display, "none", "the Add Photo control must be hidden once submitted");
  const removeLinks = document.querySelectorAll("[data-remove-evidence]");
  assert.equal(removeLinks.length, 0, "no Remove link should be offered for evidence on a submitted record");

  await assert.rejects(store.addCommercialEvidencePhoto(event.id, "p1", { name: "sneaky.jpg" }), /locked/);
});

test("Evidence: cannot be added or removed once the record is approved", async () => {
  const store = makeStore();
  const event = await store.createDaywork.call(Object.assign(store, { __userId: CONTRIBUTOR_A, __role: "contributor" }), "p1", { title: "Evidence approved lock test" });
  await store.addCommercialLineItem(event.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.addCommercialEvidencePhoto(event.id, "p1", { name: "before.jpg" });
  await store.submitCommercialEvent(event.id);
  store.__userId = APPROVER_A; store.__role = "approver";
  await store.approveCommercialEvent(event.id);

  const { document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: event.id });
  await wait(30);
  assert.equal(document.getElementById("addEvidenceRow").style.display, "none");
  assert.equal(document.querySelectorAll("[data-remove-evidence]").length, 0);
  await assert.rejects(store.removeCommercialEvidenceLink(store.evidenceLinks[0].id), /locked/);
});
