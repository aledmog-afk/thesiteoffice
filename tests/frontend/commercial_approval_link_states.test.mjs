// v64 — commercial-approval.html only shows the full record while a
// link is ACTIVE. Runs the page's REAL inline script in the jsdom
// harness against both the new short replies (v64 backend) and the old
// full replies (pre-v64 backend still live), so there's no window where
// a used or dead link renders prices, line items or the client's email.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/commercial-approval.html", import.meta.url).pathname;
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractFunction(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
const { escapeHtml, formatCommercialGBP, formatDate } = new Function(`
  ${extractFunction("escapeHtml")}
  ${extractFunction("formatDate")}
  ${extractFunction("formatCommercialGBP")}
  return { escapeHtml, formatDate, formatCommercialGBP };
`)();

function makeApprovalRequest(overrides = {}) {
  return {
    status: "pending",
    expires_at: "2026-12-31T00:00:00Z",
    recipient_name: "Jane Client",
    recipient_company: "Acme Co",
    recipient_email: "jane@example.invalid",
    signer_name: null,
    approved_at: null,
    rejected_at: null,
    rejection_reason: null,
    event: {
      type: "daywork", reference: "DW-001", title: "Test daywork",
      reason: null, instruction_reference: null, markup_pct: null, date_undertaken: "2026-09-01",
      total_value: 160, status: "submitted",
    },
    project_name: "Test Project",
    org_name: "Test Org",
    line_items: [{ line_type: "labour", description: "Labour", trade: null, quantity: 8, unit: null, rate: 20, line_total: 160 }],
    linked_dayworks: [],
    evidence: [],
    ...overrides,
  };
}

function makeSupabaseMock(request, afterApprove = null) {
  const mock = {
    __approveCalls: [],
    __rejectCalls: [],
    __request: request,
    async rpc(name, args) {
      if (name === "get_commercial_approval_request") return { data: mock.__request, error: null };
      if (name === "approve_commercial_approval_request") {
        mock.__approveCalls.push(args);
        if (afterApprove) mock.__request = afterApprove;
        return { data: { status: "approved" }, error: null };
      }
      if (name === "reject_commercial_approval_request") {
        mock.__rejectCalls.push(args);
        return { data: { status: "rejected" }, error: null };
      }
      throw new Error("unexpected rpc call: " + name);
    },
  };
  return mock;
}

async function run(request, { token = "test-token-123", afterApprove = null } = {}) {
  const supabase = makeSupabaseMock(request, afterApprove);
  const { document, window } = await runPage(HTML, extractScript(HTML), {
    __url: `https://example.com/commercial-approval.html?token=${token}`,
    supabase,
    SUPABASE_URL: "https://example.invalid",
    escapeHtml, formatDate, formatCommercialGBP,
    // Not one of the globals tests/lib/jsdom-harness.mjs's vm context
    // provides by default (only URL/crypto/setTimeout are) — the page
    // itself needs it to read its own ?token= query param.
    URLSearchParams,
  });
  return { document, window, supabase };
}


const SENSITIVE = ["£", "160", "Labour", "jane@example.invalid", "Test daywork", "Test Project", "Acme Co"];

function visibleText(document) {
  // Text of every element that isn't hidden by an ancestor's display:none.
  const out = [];
  const walk = (el) => {
    if (el.style && el.style.display === "none") return;
    for (const n of el.childNodes) {
      if (n.nodeType === 3) out.push(n.textContent);
      else if (n.nodeType === 1 && n.tagName !== "SCRIPT" && n.tagName !== "STYLE") walk(n);
    }
  };
  walk(document.body);
  return out.join(" ").replace(/\s+/g, " ");
}

function assertNoSensitive(document) {
  const vis = visibleText(document);
  for (const bad of SENSITIVE) assert.ok(!vis.includes(bad), `visible page must not show ${JSON.stringify(bad)}: ${vis}`);
  // Not just hidden — the data containers are empty too.
  for (const id of ["lineItemList", "grandTotal", "eventHeading", "eventFacts", "linkedRows", "evidenceList", "recipientEmailLabel"]) {
    assert.equal(document.getElementById(id).textContent.trim(), "", `#${id} must be empty for an inactive link`);
  }
  assert.equal(document.getElementById("activeDetails").style.display, "none");
}

const doneText = (document) => document.getElementById("doneMessage").textContent;

// ─── New (v64) short replies ─────────────────────────────────────────
const SHORT = { active: false, org_name: "Test Org", reference: "DW-012" };

test("v64 short reply, APPROVED: 'You approved DW-012 on <date>. Signed by <name>.' and nothing else", async () => {
  const { document } = await run({ ...SHORT, status: "approved", decided_at: "2026-10-01T09:30:00Z", signer_name: "Jane Client" });
  await wait(50);
  assert.equal(doneText(document), "You approved DW-012 on 1 Oct 2026. Signed by Jane Client.");
  assert.equal(document.getElementById("doneCard").style.display, "block");
  assert.equal(document.getElementById("statusBadge").textContent, "Approved");
  assert.equal(document.getElementById("orgProjectSub").textContent, "Test Org");
  assertNoSensitive(document);
});

test("v64 short reply, REJECTED: 'You rejected DW-012 on <date>. Signed by <name>.'", async () => {
  const { document } = await run({ ...SHORT, status: "rejected", decided_at: "2026-10-02T16:00:00Z", signer_name: "Jane Client" });
  await wait(50);
  assert.equal(doneText(document), "You rejected DW-012 on 2 Oct 2026. Signed by Jane Client.");
  assertNoSensitive(document);
});

for (const status of ["expired", "revoked", "closed"]) {
  test(`v64 short reply, ${status.toUpperCase()}: 'This approval link for DW-012 is no longer active. Contact Test Org for a new one.'`, async () => {
    const { document } = await run({ ...SHORT, status });
    await wait(50);
    assert.equal(doneText(document), "This approval link for DW-012 is no longer active. Contact Test Org for a new one.");
    assertNoSensitive(document);
  });
}

test("v64: a missing/blank reference is simply left out of the sentence", async () => {
  let { document } = await run({ ...SHORT, reference: null, status: "approved", decided_at: "2026-10-01T09:30:00Z", signer_name: "Jane Client" });
  await wait(50);
  assert.equal(doneText(document), "You approved this on 1 Oct 2026. Signed by Jane Client.");
  ({ document } = await run({ ...SHORT, reference: "  ", status: "revoked" }));
  await wait(50);
  assert.equal(doneText(document), "This approval link is no longer active. Contact Test Org for a new one.");
});

test("v64: missing org name / signer / date degrade to plain sentences", async () => {
  let { document } = await run({ active: false, status: "expired", org_name: null, reference: null });
  await wait(50);
  assert.equal(doneText(document), "This approval link is no longer active. Contact the contractor for a new one.");
  ({ document } = await run({ active: false, status: "approved", org_name: "Test Org", reference: "DW-012", decided_at: null, signer_name: null }));
  await wait(50);
  assert.equal(doneText(document), "You approved DW-012.");
});

test("v64: org name, reference and signer are rendered as text, never HTML", async () => {
  const { document } = await run({
    active: false, status: "approved", org_name: "<img src=x onerror=alert(1)>", reference: "<b>DW</b>",
    decided_at: "2026-10-01T09:30:00Z", signer_name: "<script>x</script>",
  });
  await wait(50);
  assert.equal(document.querySelectorAll("#doneMessage *, #orgProjectSub *").length, 0);
  assert.match(doneText(document), /<b>DW<\/b>/);
  assert.equal(document.getElementById("orgProjectSub").textContent, "<img src=x onerror=alert(1)>");
});

// ─── Old (pre-v64) full replies: the page already hides everything ───
const OLD_FULL = {
  approved: { status: "approved", signer_name: "Jane Client", approved_at: "2026-10-01T09:30:00Z" },
  rejected: { status: "rejected", signer_name: "Jane Client", rejected_at: "2026-10-02T16:00:00Z", rejection_reason: "Too expensive" },
  expired: { status: "expired" },
  revoked: { status: "revoked" },
};
const OLD_EXPECTED = {
  approved: "You approved DW-001 on 1 Oct 2026. Signed by Jane Client.",
  rejected: "You rejected DW-001 on 2 Oct 2026. Signed by Jane Client.",
  expired: "This approval link for DW-001 is no longer active. Contact Test Org for a new one.",
  revoked: "This approval link for DW-001 is no longer active. Contact Test Org for a new one.",
};
for (const [status, overrides] of Object.entries(OLD_FULL)) {
  test(`old full reply (pre-v64 backend), ${status.toUpperCase()}: page shows only the short message — no £, line items, email or title`, async () => {
    const { document } = await run(makeApprovalRequest(overrides));
    await wait(50);
    assert.equal(doneText(document), OLD_EXPECTED[status]);
    assertNoSensitive(document);
    assert.ok(!visibleText(document).includes("Too expensive"));
    assert.equal(document.getElementById("orgProjectSub").textContent, "Test Org");
  });
}

// ─── Active links unchanged ──────────────────────────────────────────
for (const [label, req] of [
  ["old reply (no active key)", makeApprovalRequest()],
  ["v64 reply (active:true)", makeApprovalRequest({ active: true, status: "viewed" })],
]) {
  test(`ACTIVE link, ${label}: full record and decision card render as before`, async () => {
    const { document } = await run(req);
    await wait(50);
    assert.equal(document.getElementById("activeDetails").style.display, "block");
    assert.equal(document.getElementById("decisionCard").style.display, "block");
    assert.equal(document.getElementById("doneCard").style.display, "none");
    assert.match(document.getElementById("grandTotal").textContent, /£160\.00/);
    assert.match(document.getElementById("lineItemList").textContent, /Labour/);
    assert.match(document.getElementById("recipientEmailLabel").textContent, /jane@example\.invalid/);
    assert.equal(document.getElementById("orgProjectSub").textContent, "Test Org — Test Project");
  });
}

test("after approving, the page re-renders to the short confirmation and clears the record it was showing", async () => {
  const { document, supabase } = await run(makeApprovalRequest({ active: true, status: "viewed" }), {
    afterApprove: { ...SHORT, reference: "DW-001", status: "approved", decided_at: "2026-10-01T09:30:00Z", signer_name: "Jane Client" },
  });
  await wait(50);
  assert.match(document.getElementById("grandTotal").textContent, /£160\.00/);
  document.getElementById("approveBtn").click();
  await wait(80);
  assert.equal(supabase.__approveCalls.length, 1);
  assert.equal(doneText(document), "You approved DW-001 on 1 Oct 2026. Signed by Jane Client.");
  assertNoSensitive(document);
});
