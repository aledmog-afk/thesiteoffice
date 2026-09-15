// Commercial Module — Phase 2 (Variations). Proves variation-detail.html's
// real inline script wires the Phase 0/1/2 database foundation up
// correctly: creation, direct-line pricing display, the linked-Daywork
// picker UI (add/remove), markup, evidence, and the full workflow —
// mirroring daywork_workflow.test.mjs's own approach and mock-store
// realism exactly, extended with variation_dayworks linking.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/variation-detail.html", import.meta.url).pathname;
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
  ${extractFunction("previewVariationTotal")}
  ${extractConst("COMMERCIAL_STATUS_LABEL")}
  ${extractConst("COMMERCIAL_STATUS_BADGE")}
  ${extractConst("COMMERCIAL_LINE_TYPES")}
  ${extractConst("COMMERCIAL_LINE_TYPE_LABEL")}
  return {
    escapeHtml, formatDate, todayISO, comparePlotNumbers, previewLineTotal, formatCommercialGBP,
    commercialCapabilities, previewVariationTotal,
    COMMERCIAL_STATUS_LABEL, COMMERCIAL_STATUS_BADGE, COMMERCIAL_LINE_TYPES, COMMERCIAL_LINE_TYPE_LABEL,
  };
`;
const {
  escapeHtml, formatDate, todayISO, comparePlotNumbers, previewLineTotal, formatCommercialGBP,
  commercialCapabilities, previewVariationTotal,
  COMMERCIAL_STATUS_LABEL, COMMERCIAL_STATUS_BADGE, COMMERCIAL_LINE_TYPES, COMMERCIAL_LINE_TYPE_LABEL,
} = new Function(helperScope)();

const CONTRIBUTOR_A = "u-contributor";
const APPROVER_A = "u-approver";
const MEMBERS = { [CONTRIBUTOR_A]: "contributor@example.com", [APPROVER_A]: "approver@example.com" };
const TRANSITIONS = { draft: ["submitted"], submitted: ["approved", "rejected"], rejected: ["draft"], approved: [] };

function makeStore() {
  let nextEventSeq = 1, nextLineSeq = 1, nextDocSeq = 1, nextEvidenceSeq = 1;
  const events = new Map();
  const lineItems = [];
  const links = []; // {variation_id, daywork_id}
  const evidenceLinks = [];
  const documents = new Map();

  function unlocked(event) { return event.status === "draft" || event.status === "rejected"; }
  function recomputeTotal(eventId) {
    const event = events.get(eventId);
    const directSubtotal = lineItems.filter((li) => li.commercial_event_id === eventId)
      .reduce((sum, li) => sum + (li.line_total === null ? 0 : li.line_total), 0);
    if (event.type === "variation") {
      const linkedIds = links.filter((l) => l.variation_id === eventId).map((l) => l.daywork_id);
      const dayworksSubtotal = linkedIds.reduce((sum, id) => sum + (Number(events.get(id)?.total_value) || 0), 0);
      event.total_value = Math.round((directSubtotal + dayworksSubtotal) * (1 + (Number(event.markup_pct) || 0) / 100) * 100) / 100;
    } else {
      event.total_value = Math.round(directSubtotal * 100) / 100;
    }
  }

  return {
    events, lineItems, links, evidenceLinks, documents,

    async getMyCommercialRole() { return this.__role ?? null; },

    async createVariation(projectId, { title, plotId = null, reason = null, instructionReference = null, dateIdentified = null, markupPct = 0 }) {
      const id = `v${nextEventSeq++}`;
      const row = {
        id, project_id: projectId, type: "variation", reference: `VAR-${String(nextEventSeq - 1).padStart(3, "0")}`,
        title, plot_id: plotId, status: "draft", total_value: 0,
        created_by: this.__userId, created_at: "2026-09-01T00:00:00Z",
        submitted_by: null, submitted_at: null, approved_by: null, approved_at: null,
        rejected_by: null, rejected_at: null, rejection_reason: null,
        reason, instruction_reference: instructionReference, date_identified: dateIdentified, markup_pct: markupPct ?? 0,
      };
      events.set(id, row);
      return { ...row };
    },
    async getVariation(eventId) {
      const row = events.get(eventId);
      if (!row) throw new Error("not found");
      return { ...row };
    },
    async updateVariation(eventId, fields = {}) {
      const row = events.get(eventId);
      if (!unlocked(row)) throw new Error(row.status === "approved" ? "This commercial event is approved and is immutable. Create a superseding record instead of editing it." : `This commercial event is ${row.status} — its content is locked until it is rejected back to draft.`);
      if (fields.title !== undefined) row.title = fields.title;
      if (fields.reason !== undefined) row.reason = fields.reason;
      if (fields.dateIdentified !== undefined) row.date_identified = fields.dateIdentified;
      if (fields.plotId !== undefined) row.plot_id = fields.plotId;
      if (fields.instructionReference !== undefined) row.instruction_reference = fields.instructionReference;
      if (fields.markupPct !== undefined) { row.markup_pct = fields.markupPct === "" ? 0 : fields.markupPct; recomputeTotal(eventId); }
      return { ...row };
    },

    async getCommercialLineItems(eventId) { return lineItems.filter((li) => li.commercial_event_id === eventId).map((li) => ({ ...li })); },
    async addCommercialLineItem(eventId, { lineType, description, trade = null, quantity = 1, unit = null, rate = null }) {
      const event = events.get(eventId);
      if (!unlocked(event)) throw new Error(`This commercial event is ${event.status} — its content is locked until it is rejected back to draft.`);
      const q = Number(quantity), r = rate === null || rate === "" || rate === undefined ? null : Number(rate);
      const row = { id: `li${nextLineSeq++}`, commercial_event_id: eventId, line_type: lineType, description, trade, quantity: q, unit, rate: r, line_total: r === null ? null : Math.round(q * r * 100) / 100 };
      lineItems.push(row);
      recomputeTotal(eventId);
      return { ...row };
    },
    async deleteCommercialLineItem(lineItemId) {
      const li = lineItems.find((x) => x.id === lineItemId);
      const event = events.get(li.commercial_event_id);
      if (!unlocked(event)) throw new Error(`This commercial event is ${event.status} — its content is locked until it is rejected back to draft.`);
      lineItems.splice(lineItems.indexOf(li), 1);
      recomputeTotal(li.commercial_event_id);
    },

    async listEligibleDayworksForLinking(projectId, variationEventId) {
      const linkedIds = new Set(links.filter((l) => l.variation_id === variationEventId).map((l) => l.daywork_id));
      return [...events.values()].filter((e) => e.project_id === projectId && e.type === "daywork" && !linkedIds.has(e.id));
    },
    async getLinkedDayworks(variationEventId) {
      return links.filter((l) => l.variation_id === variationEventId).map((l) => ({ id: `vd-${l.variation_id}-${l.daywork_id}`, daywork: events.get(l.daywork_id) ? { ...events.get(l.daywork_id) } : null }));
    },
    async linkDaywork(variationEventId, daywork_id) {
      const v = events.get(variationEventId), d = events.get(daywork_id);
      if (!unlocked(v)) throw new Error(`This commercial event is ${v.status} — its content is locked until it is rejected back to draft.`);
      if (!d || d.project_id !== v.project_id) throw new Error("A Daywork can only be linked to a Variation on the same project");
      if (links.some((l) => l.variation_id === variationEventId && l.daywork_id === daywork_id)) throw new Error("duplicate key value violates unique constraint");
      links.push({ variation_id: variationEventId, daywork_id });
      recomputeTotal(variationEventId);
      return { id: `vd-${variationEventId}-${daywork_id}` };
    },
    async unlinkDaywork(variationEventId, daywork_id) {
      const v = events.get(variationEventId);
      if (!unlocked(v)) throw new Error(`This commercial event is ${v.status} — its content is locked until it is rejected back to draft.`);
      const idx = links.findIndex((l) => l.variation_id === variationEventId && l.daywork_id === daywork_id);
      if (idx >= 0) links.splice(idx, 1);
      recomputeTotal(variationEventId);
    },

    async getCommercialEvidence(eventId) { return evidenceLinks.filter((l) => l.commercial_event_id === eventId).map((l) => ({ ...l, document: documents.get(l.source_id) || null })); },
    async addCommercialEvidencePhoto(eventId, projectId, file, caption = null) {
      const event = events.get(eventId);
      if (!unlocked(event)) throw new Error(`This commercial event is ${event.status} — its content is locked until it is rejected back to draft.`);
      const docId = `d${nextDocSeq++}`;
      documents.set(docId, { id: docId, title: caption || "Evidence photo", currentRevision: { file_name: file?.name || "photo.jpg" } });
      const link = { id: `ev${nextEvidenceSeq++}`, commercial_event_id: eventId, source_table: "documents", source_id: docId, caption };
      evidenceLinks.push(link);
      return { link, document: documents.get(docId) };
    },
    async removeCommercialEvidenceLink(linkId) {
      const link = evidenceLinks.find((l) => l.id === linkId);
      const event = events.get(link.commercial_event_id);
      if (!unlocked(event)) throw new Error(`This commercial event is ${event.status} — its content is locked until it is rejected back to draft.`);
      evidenceLinks.splice(evidenceLinks.indexOf(link), 1);
    },

    async getCommercialSignatures() { return []; },

    async submitCommercialEvent(eventId) {
      const row = events.get(eventId);
      if (!["contributor", "approver"].includes(this.__role)) throw new Error("You do not have permission to submit commercial events on this project");
      if (!TRANSITIONS[row.status].includes("submitted")) throw new Error(`Invalid commercial event status transition: ${row.status} -> submitted`);
      row.status = "submitted"; row.submitted_by = this.__userId; row.submitted_at = "2026-09-02T00:00:00Z";
      return { ...row };
    },
    async approveCommercialEvent(eventId) {
      const row = events.get(eventId);
      if (this.__role !== "approver") throw new Error("You do not have permission to approve commercial events on this project");
      if (row.created_by === this.__userId) throw new Error("You cannot approve a commercial event you created yourself");
      if (!TRANSITIONS[row.status].includes("approved")) throw new Error(`Invalid commercial event status transition: ${row.status} -> approved`);
      row.status = "approved"; row.approved_by = this.__userId; row.approved_at = "2026-09-03T00:00:00Z";
      return { ...row };
    },
    async rejectCommercialEvent(eventId, reason) {
      const row = events.get(eventId);
      if (this.__role !== "approver") throw new Error("You do not have permission to reject commercial events on this project");
      if (!TRANSITIONS[row.status].includes("rejected")) throw new Error(`Invalid commercial event status transition: ${row.status} -> rejected`);
      row.status = "rejected"; row.rejected_by = this.__userId; row.rejected_at = "2026-09-03T00:00:00Z"; row.rejection_reason = reason || null;
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
  store.__role = role; store.__userId = userId;
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: userId } } }) },
    from(table) {
      const api = { select() { return api; }, eq() { return api; }, order() { return api; }, single: async () => (table === "projects" ? { data: { name: "Test Site" }, error: null } : { data: null, error: null }) };
      return new Proxy(api, { get(t, p) { if (p === "then") return (resolve) => resolve({ data: [], error: null }); return t[p]; } });
    },
  };
  return runPage(HTML, extractScript(HTML), {
    __url: `https://example.com/variation-detail.html?${eventId ? `id=${eventId}` : `project=${projectId}`}`,
    supabase,
    requireAuth: async () => ({ id: userId }),
    renderHeader: () => {},
    getParam: (key) => (key === "id" ? eventId : key === "project" ? projectId : null),
    escapeHtml, formatDate, todayISO, comparePlotNumbers, previewLineTotal, previewVariationTotal, formatCommercialGBP,
    commercialCapabilities,
    COMMERCIAL_STATUS_LABEL, COMMERCIAL_STATUS_BADGE, COMMERCIAL_LINE_TYPES, COMMERCIAL_LINE_TYPE_LABEL,
    showCommercialError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    getMyCommercialRole: (...a) => store.getMyCommercialRole(...a),
    createVariation: (...a) => store.createVariation(...a),
    getVariation: (...a) => store.getVariation(...a),
    updateVariation: (...a) => store.updateVariation(...a),
    listEligibleDayworksForLinking: (...a) => store.listEligibleDayworksForLinking(...a),
    getLinkedDayworks: (...a) => store.getLinkedDayworks(...a),
    linkDaywork: (...a) => store.linkDaywork(...a),
    unlinkDaywork: (...a) => store.unlinkDaywork(...a),
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
    generateCommercialEventPdfBlob: (...a) => (store.generateCommercialEventPdfBlob ? store.generateCommercialEventPdfBlob(...a) : Promise.resolve({ blob: new Blob(["pdf"]), filename: "test.pdf" })),
    saveFileToDevice: (...a) => (store.saveFileToDevice ? store.saveFileToDevice(...a) : Promise.resolve({ status: "downloaded" })),
    deviceSaveStatusLabel: (status) => (status === "downloaded" ? "Downloaded" : status),
    alert: () => {}, confirm: () => true,
  });
}

async function makeDaywork(store, projectId, title, rate) {
  const id = `dw${Object.keys(store.events).length}-${Math.random().toString(36).slice(2, 8)}`;
  store.events.set(id, {
    id, project_id: projectId, type: "daywork", reference: `DW-${id}`, title, status: "draft",
    total_value: rate, created_by: "someone", created_at: "2026-09-01T00:00:00Z",
    submitted_by: null, submitted_at: null, approved_by: null, approved_at: null, rejected_by: null, rejected_at: null,
  });
  return id;
}

// ─── Creation ───────────────────────────────────────────────────

test("Variation creation: a Contributor can create — reaches create mode with the form visible", async () => {
  const store = makeStore();
  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, projectId: "p1" });
  await wait(20);
  assert.equal(document.getElementById("createCard").style.display, "block");
});

test("Variation creation: a Viewer cannot create", async () => {
  const store = makeStore();
  const { document } = await run(store, { role: "viewer", userId: "u-viewer", projectId: "p1" });
  await wait(20);
  assert.notEqual(document.getElementById("createCard").style.display, "block");
  assert.ok(document.getElementById("pageErrorBox").textContent.length > 0);
});

test("Variation creation: submitting the form creates the record with an auto-assigned reference", async () => {
  const store = makeStore();
  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, projectId: "p1" });
  await wait(20);
  document.getElementById("cTitle").value = "Revised drainage route";
  document.getElementById("cReason").value = "Ground conditions differ from survey";
  fireEvent(document.getElementById("createForm"), "submit");
  await wait(30);
  assert.equal(store.events.size, 1);
  const [created] = [...store.events.values()];
  assert.equal(created.title, "Revised drainage route");
  assert.equal(created.reference, "VAR-001");
  assert.equal(created.status, "draft");
});

// ─── Direct pricing + linked Dayworks + markup ─────────────────

test("Pricing: direct lines, a linked Daywork, and markup all combine into the database-authoritative total shown on the page", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "Combined pricing test", markupPct: 10 });
  await store.addCommercialLineItem(variation.id, { lineType: "labour", description: "Direct work", quantity: 1, rate: 1000 });
  const dwId = await makeDaywork(store, "p1", "Linked daywork", 500);
  await store.linkDaywork(variation.id, dwId);

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: variation.id });
  await wait(30);

  // (1000 + 500) * 1.10 = 1650.00
  assert.equal(document.getElementById("grandTotal").textContent, formatCommercialGBP(1650));
  assert.ok(document.getElementById("linkedDayworkRows").textContent.includes("Linked daywork"));
  assert.equal(document.getElementById("directSubtotal").textContent, formatCommercialGBP(1000));
  assert.equal(document.getElementById("dayworksSubtotal").textContent, formatCommercialGBP(500));
});

test("Linked Dayworks: the Add Daywork picker lists only eligible Dayworks, and linking one updates the total", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "Picker test", markupPct: 0 });
  const eligibleId = await makeDaywork(store, "p1", "Eligible daywork", 200);
  const otherProjectId = await makeDaywork(store, "p2", "Wrong project daywork", 999);

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: variation.id });
  await wait(30);

  fireEvent(document.getElementById("addDayworkBtn"), "click");
  await wait(20);
  assert.equal(document.getElementById("addDayworkModal").style.display, "flex");
  const rowsText = document.getElementById("eligibleDayworkRows").textContent;
  assert.ok(rowsText.includes("Eligible daywork"));
  assert.ok(!rowsText.includes("Wrong project daywork"), "a Daywork from a different project must never be offered in the picker");

  const linkBtn = document.querySelector(`[data-link="${eligibleId}"]`);
  assert.ok(linkBtn, "the eligible daywork must have a Link button");
  fireEvent(linkBtn, "click");
  await wait(30);

  assert.equal(document.getElementById("addDayworkModal").style.display, "none", "linking should close the picker");
  assert.equal(document.getElementById("grandTotal").textContent, formatCommercialGBP(200));
  assert.ok(document.getElementById("linkedDayworkRows").textContent.includes("Eligible daywork"));
});

test("Linked Dayworks: removing a link recomputes the total and the Daywork disappears from the linked list", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "Unlink test", markupPct: 0 });
  const dwId = await makeDaywork(store, "p1", "To be removed", 300);
  await store.linkDaywork(variation.id, dwId);

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: variation.id });
  await wait(30);
  assert.equal(document.getElementById("grandTotal").textContent, formatCommercialGBP(300));

  const removeBtn = document.querySelector(`[data-unlink="${dwId}"]`);
  assert.ok(removeBtn);
  fireEvent(removeBtn, "click");
  await wait(30);

  assert.equal(document.getElementById("grandTotal").textContent, formatCommercialGBP(0));
  assert.ok(!document.getElementById("linkedDayworkRows").textContent.includes("To be removed"));
});

// ─── Workflow ───────────────────────────────────────────────────

test("Workflow: draft can submit with either a direct line or a linked Daywork, becomes read-only once submitted", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "Submit test", markupPct: 0 });
  const dwId = await makeDaywork(store, "p1", "Daywork for submit", 100);
  await store.linkDaywork(variation.id, dwId);

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: variation.id });
  await wait(30);
  const submitBtn = [...document.getElementById("workflowActions").querySelectorAll("button")].find((b) => b.textContent === "Submit for Approval");
  assert.ok(submitBtn);
  fireEvent(submitBtn, "click");
  await wait(30);

  assert.equal(store.events.get(variation.id).status, "submitted");
  assert.equal(document.getElementById("addDayworkBtn").style.display, "none", "linking must be locked once submitted");
  assert.equal(document.getElementById("lineItemAddRow").style.display, "none");
});

test("Workflow: an eligible Approver (not the creator) can approve a submitted Variation", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "Approve test", markupPct: 0 });
  await store.addCommercialLineItem(variation.id, { lineType: "labour", description: "x", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(variation.id);

  const { document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: variation.id });
  await wait(30);
  const approveBtn = [...document.getElementById("workflowActions").querySelectorAll("button")].find((b) => b.textContent === "Sign & Approve");
  assert.ok(approveBtn);
  fireEvent(approveBtn, "click");
  await wait(10);
  assert.equal(document.getElementById("signApproveModal").style.display, "flex", "approving must open the sign-off modal, not approve immediately");
  document.getElementById("typedNameInput").value = "Jane Approver";
  fireEvent(document.getElementById("submitSigBtn"), "click");
  await wait(30);
  assert.equal(store.events.get(variation.id).status, "approved");
});

test("Workflow: an approved Variation shows no edit/link/evidence controls at all", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "Locked test", markupPct: 0 });
  await store.addCommercialLineItem(variation.id, { lineType: "labour", description: "x", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(variation.id);
  store.__userId = APPROVER_A; store.__role = "approver";
  await store.approveCommercialEvent(variation.id);

  const { document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: variation.id });
  await wait(30);
  assert.equal(document.getElementById("editHeaderBtn").style.display, "none");
  assert.equal(document.getElementById("lineItemAddRow").style.display, "none");
  assert.equal(document.getElementById("addDayworkBtn").style.display, "none");
  assert.equal(document.getElementById("addEvidenceRow").style.display, "none");
  assert.equal(document.getElementById("saveMarkupBtn").style.display, "none");
  assert.equal(document.getElementById("workflowActions").children.length, 0);
});

test("Permissions: an Approver cannot approve their OWN Variation submission", async () => {
  const store = makeStore();
  store.__userId = APPROVER_A; store.__role = "approver";
  const variation = await store.createVariation("p1", { title: "Self-approval test", markupPct: 0 });
  await store.addCommercialLineItem(variation.id, { lineType: "labour", description: "x", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(variation.id);

  const { document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: variation.id });
  await wait(30);
  const buttons = [...document.getElementById("workflowActions").querySelectorAll("button")].map((b) => b.textContent);
  assert.ok(!buttons.includes("Approve"));
});

// ─── Evidence ───────────────────────────────────────────────────

test("Evidence: can be added while draft, locked once submitted", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "Evidence test", markupPct: 0 });

  const { document, window } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: variation.id });
  await wait(30);
  const input = document.getElementById("evidenceFileInput");
  const file = new window.File(["bytes"], "photo.jpg", { type: "image/jpeg" });
  Object.defineProperty(input, "files", { value: [file], writable: false });
  fireEvent(input, "change");
  await wait(30);
  assert.equal(store.evidenceLinks.length, 1);
  assert.equal(store.evidenceLinks[0].source_table, "documents");
});

test("Evidence: the file input accepts PDFs as well as images — proof of an instruction is usually an emailed PDF, not a photo", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "Evidence type test", markupPct: 0 });
  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: variation.id });
  await wait(30);
  assert.equal(document.getElementById("evidenceFileInput").getAttribute("accept"), "application/pdf,image/*");
});

// ─── PDF export ──────────────────────────────────────────────────

test("PDF export: Generate PDF is hidden on a draft, shown once submitted or approved", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "PDF visibility test", markupPct: 0 });

  let { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: variation.id });
  await wait(30);
  assert.notEqual(document.getElementById("generatePdfBtn").style.display, "inline-flex", "a draft must not offer a PDF export");

  await store.addCommercialLineItem(variation.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(variation.id);
  ({ document } = await run(store, { role: "approver", userId: APPROVER_A, eventId: variation.id }));
  await wait(30);
  assert.equal(document.getElementById("generatePdfBtn").style.display, "inline-flex", "a submitted record may be sent to the client for approval");
});

test("PDF export: clicking Generate PDF calls generateCommercialEventPdfBlob() with type 'variation' for this record", async () => {
  const store = makeStore();
  store.__userId = CONTRIBUTOR_A; store.__role = "contributor";
  const variation = await store.createVariation("p1", { title: "PDF click test", markupPct: 0 });
  await store.addCommercialLineItem(variation.id, { lineType: "labour", description: "Labour", quantity: 1, rate: 10 });
  await store.submitCommercialEvent(variation.id);

  const calls = [];
  store.generateCommercialEventPdfBlob = async (eventId, type) => { calls.push({ eventId, type }); return { blob: new Blob(["pdf"]), filename: "VAR-001.pdf" }; };
  store.saveFileToDevice = async (blob, filename) => { calls.push({ savedFilename: filename }); return { status: "downloaded" }; };

  const { document } = await run(store, { role: "contributor", userId: CONTRIBUTOR_A, eventId: variation.id });
  await wait(30);
  fireEvent(document.getElementById("generatePdfBtn"), "click");
  await wait(30);

  assert.equal(calls[0].eventId, variation.id);
  assert.equal(calls[0].type, "variation");
  assert.equal(calls[1].savedFilename, "VAR-001.pdf");
  assert.equal(document.getElementById("pdfStatusText").textContent, "Downloaded");
});
