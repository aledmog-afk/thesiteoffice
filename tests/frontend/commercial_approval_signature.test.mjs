// P18c — External Commercial Approval page, mobile signature-pad
// stability fix. Proves commercial-approval.html's REAL inline script
// wires the touch/pointer/canvas fix up correctly, without
// reimplementing it, using the same extract-and-run jsdom harness
// every other tracker/*.html page's frontend test uses.
//
// IMPORTANT LIMITATION (pre-existing in this codebase, not introduced
// here): jsdom's HTMLCanvasElement.getContext('2d') is not implemented
// without the native `canvas` npm package, which this repo has never
// depended on (see e.g. the "Not implemented: HTMLCanvasElement's
// getContext()" warning every other canvas-touching frontend test in
// this suite already prints). That means sigCtx is null here, and
// every drawing branch in the real code is — by design — gated behind
// `if (!sigCtx) return`, so no actual pixel/stroke rendering can be
// exercised through this harness. What IS both real and verified here:
// the CSS fix, event-handler wiring not throwing (including with a
// null 2D context, which is itself a genuine defensive-coding
// property), and the full typed-name-only approval/rejection paths
// (which never touch the canvas at all).
//
// The interaction- and rendering-level behaviour this bug is actually
// about (does touch-action:none really stop the browser from
// hijacking the gesture; is the resulting stroke continuous; does the
// page stay stationary) was instead verified with real Chromium touch
// emulation via Playwright + CDP against the exact extracted
// <style>/canvas markup/JS from this file, run ad hoc against this
// exact code — see the P18c final report for the full results. That
// script and its scratch harness page were not committed (ad hoc
// verification only); no real physical device was available in this
// environment, so real-device confirmation is still outstanding and
// explicitly called out as such in the report.
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

function makeSupabaseMock(request) {
  const mock = {
    __approveCalls: [],
    __rejectCalls: [],
    __request: request,
    async rpc(name, args) {
      if (name === "get_commercial_approval_request") return { data: mock.__request, error: null };
      if (name === "approve_commercial_approval_request") {
        mock.__approveCalls.push(args);
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

async function run(request, token = "test-token-123") {
  const supabase = makeSupabaseMock(request);
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

// ─── Structural / CSS ────────────────────────────────────────────────

test("Structure: #sigCanvas has no hardcoded width/height attributes (responsive sizing is entirely CSS/JS driven)", async () => {
  const html = fs.readFileSync(HTML, "utf8");
  const canvasTag = html.match(/<canvas id="sigCanvas"[^>]*>/)[0];
  assert.doesNotMatch(canvasTag, /width=/, "a hardcoded width attribute would override the responsive CSS sizing");
  assert.doesNotMatch(canvasTag, /height=/, "a hardcoded height attribute would override the responsive CSS sizing");
});

test("Structure: #sigCanvas has touch-action: none declared in the page's own CSS, scoped to the canvas only", async () => {
  const html = fs.readFileSync(HTML, "utf8");
  const styleBlock = html.match(/<style>[\s\S]*?<\/style>/)[0];
  const canvasRuleMatch = styleBlock.match(/#sigCanvas\s*\{[^}]*\}/);
  assert.ok(canvasRuleMatch, "expected a #sigCanvas rule in the page's <style> block");
  assert.match(canvasRuleMatch[0], /touch-action:\s*none/, "touch-action: none must be declared on #sigCanvas — this is the actual mechanism that stops the browser treating a finger-drag as a page-pan gesture");
  // Scoping check: touch-action: none must not appear on any broader
  // selector (body/.page/.card/*) — only the drawing surface itself.
  const bodyWideRule = styleBlock.match(/(?:^|\})\s*(body|html|\.page|\.card|\*)\s*\{[^}]*touch-action\s*:\s*none/);
  assert.equal(bodyWideRule, null, "touch-action: none must not be applied to any ancestor/broad selector — only #sigCanvas itself");
});

test("Structure: the computed touch-action style actually resolves to 'none' on the live DOM element", async () => {
  const { document, window } = await run(makeApprovalRequest());
  await wait(50);
  const canvas = document.getElementById("sigCanvas");
  assert.equal(window.getComputedStyle(canvas).touchAction, "none");
});

// ─── Approve/reject validation and typed-name-only path ──────────────
// (canvas-independent — these exercise the real code paths a typed-
// name-only signer, or an interrupted/empty attempt, actually takes.)

test("Approve: rejects an empty name client-side, never calls the RPC", async () => {
  const { document, supabase } = await run(makeApprovalRequest());
  await wait(50);
  document.getElementById("signerName").value = "   ";
  document.getElementById("approveBtn").dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  await wait(50);
  assert.equal(supabase.__approveCalls.length, 0);
  assert.match(document.getElementById("decisionError").textContent, /name is required/i);
});

test("Approve: a typed-name-only approval (no drawing) calls the RPC with p_signature_data: null and the typed name", async () => {
  const { document, supabase } = await run(makeApprovalRequest());
  await wait(50);
  document.getElementById("signerName").value = "Jane Client";
  document.getElementById("signerCompany").value = "Acme Co";
  document.getElementById("approveBtn").dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  await wait(100);
  assert.equal(supabase.__approveCalls.length, 1);
  const call = supabase.__approveCalls[0];
  assert.equal(call.p_token, "test-token-123");
  assert.equal(call.p_signer_name, "Jane Client");
  assert.equal(call.p_signer_company, "Acme Co");
  assert.equal(call.p_signature_data, null, "with no working canvas context (or no drawing at all), signature_data must be sent as null, not a broken/empty string");
});

test("Reject: requires a name before revealing the reason card", async () => {
  const { document } = await run(makeApprovalRequest());
  await wait(50);
  document.getElementById("signerName").value = "";
  document.getElementById("rejectBtn").dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  await wait(50);
  assert.equal(document.getElementById("rejectReasonCard").style.display, "none");
  assert.match(document.getElementById("decisionError").textContent, /name is required/i);
});

test("Reject: requires a non-blank reason, then calls the RPC with the correct args", async () => {
  const { document, supabase } = await run(makeApprovalRequest());
  await wait(50);
  document.getElementById("signerName").value = "Jane Client";
  document.getElementById("rejectBtn").dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  await wait(50);
  assert.equal(document.getElementById("rejectReasonCard").style.display, "block");

  document.getElementById("rejectReason").value = "   ";
  document.getElementById("confirmRejectBtn").dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  await wait(50);
  assert.equal(supabase.__rejectCalls.length, 0);
  assert.match(document.getElementById("rejectError").textContent, /reason is required/i);

  document.getElementById("rejectReason").value = "Pricing looks too high";
  document.getElementById("confirmRejectBtn").dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  await wait(100);
  assert.equal(supabase.__rejectCalls.length, 1);
  assert.equal(supabase.__rejectCalls[0].p_signer_name, "Jane Client");
  assert.equal(supabase.__rejectCalls[0].p_rejection_reason, "Pricing looks too high");
});

// ─── Pointer/resize event wiring safety ───────────────────────────────
// jsdom has no working 2D context, so every drawing branch below is a
// no-op via the code's own `if (!sigCtx) return` guard — what these
// tests confirm is that dispatching the full pointer/resize event
// sequence never throws and never corrupts drawing state, which is a
// real defensive-coding property (not merely a test-environment
// workaround) since a null-context canvas is also what a browser
// without 2D canvas support would produce.

test("Pointer events: a full pointerdown/pointermove/pointerup/pointercancel sequence on #sigCanvas never throws, even with no working 2D context", async () => {
  const { document, window } = await run(makeApprovalRequest());
  await wait(50);
  const canvas = document.getElementById("sigCanvas");
  const fire = (type, extra = {}) => canvas.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: 10, clientY: 10, ...extra }));
  assert.doesNotThrow(() => {
    fire("pointerdown");
    fire("pointermove", { clientX: 20, clientY: 15 });
    fire("pointerup");
    fire("pointerdown");
    fire("pointercancel");
    fire("lostpointercapture");
  });
});

test("Resize: dispatching a window resize event never throws, even before/without a working 2D context", async () => {
  const { window } = await run(makeApprovalRequest());
  await wait(50);
  assert.doesNotThrow(() => {
    window.dispatchEvent(new window.Event("resize"));
  });
});

test("Clear button: clicking it never throws even with no working 2D context", async () => {
  const { document } = await run(makeApprovalRequest());
  await wait(50);
  assert.doesNotThrow(() => {
    document.getElementById("clearSigBtn").dispatchEvent(new document.defaultView.Event("click", { bubbles: true }));
  });
});

// ─── Regression: page still renders the record correctly ─────────────

test("Regression: the record's authoritative total, line items, and recipient email render correctly (unaffected by the signature-pad fix)", async () => {
  const { document } = await run(makeApprovalRequest());
  await wait(50);
  assert.match(document.getElementById("grandTotal").textContent, /£160\.00/);
  assert.match(document.getElementById("recipientEmailLabel").textContent, /jane@example\.invalid/);
  assert.equal(document.getElementById("signerName").value, "Jane Client");
});
