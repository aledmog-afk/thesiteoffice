// Handover Part B (v72) — tracker/plot-handover-share.html, the
// read-only buyer/solicitor link. Runs the page's REAL inline script
// under jsdom (never a reimplementation), mirroring the convention
// commercial_approval_link_states.test.mjs already established for
// commercial-approval.html. This page is read-only by design — unlike
// the Commercial approval link, there is no approve/reject action to
// test, only correct rendering per status and the one-RPC read path.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/plot-handover-share.html", import.meta.url).pathname;
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractFunction(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m) throw new Error(`${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
const { escapeHtml, formatDateTime } = new Function(`
  ${extractFunction("escapeHtml")}
  ${extractFunction("formatDateTime")}
  return { escapeHtml, formatDateTime };
`)();

function makePack(overrides = {}) {
  return {
    status: "viewed",
    plot_number: "Plot 5",
    project_name: "Test Site",
    confirmed_at: "2026-03-01T10:00:00Z",
    signed_by_name: "Jane Site Manager",
    signature_data: null,
    content_hash: "abc123def456",
    gates_snapshot: [{ gate_key: "g1", title: "Substructure & Drainage", status: "approved" }],
    documents_snapshot: [{ doc_key: "d1", title: "EPC", status: "approved_final" }],
    snags_snapshot: [{ description: "Chip in tile", location: "Kitchen", priority: "low", status: "open" }],
    meter_readings: [{ utility: "electricity", reading: "00123.4", unit: "kWh" }],
    key_log: [{ item: "Front door keys", quantity: 2, held_by: "Site office" }],
    recipient_name: "Jane Solicitor",
    ...overrides,
  };
}

function makeSupabaseMock(pack) {
  return {
    async rpc(name, args) {
      assert.equal(name, "get_plot_handover_share");
      assert.equal(args.p_token, "tok-123");
      return { data: pack, error: null };
    },
  };
}

async function runSharePage({ pack = makePack(), url = "https://example.com/plot-handover-share.html?token=tok-123", supabase } = {}) {
  return runPage(HTML, extractScript(HTML), {
    __url: url,
    URLSearchParams,
    supabase: supabase || makeSupabaseMock(pack),
    escapeHtml, formatDateTime,
    buildPlotHandoverPdfDocument: () => ({ output: () => new Blob() }),
    plotHandoverPdfFilename: () => "handover.pdf",
    saveFileToDevice: async () => ({ status: "downloaded" }),
    deviceSaveStatusLabel: () => "Downloaded",
  });
}

test("plot-handover-share.html: an active (viewed) pack renders gates, documents, snags, meters, key log and the signer", async () => {
  const { document } = await runSharePage();
  await wait(40);
  assert.equal(document.getElementById("loadingNotice").style.display, "none");
  assert.match(document.getElementById("plotHeading").textContent, /Plot 5/);
  assert.match(document.getElementById("projectSub").textContent, /Test Site/);
  assert.match(document.getElementById("gatesRows").innerHTML, /Substructure &amp; Drainage/);
  assert.match(document.getElementById("docsRows").innerHTML, /EPC/);
  assert.match(document.getElementById("snagsList").innerHTML, /Chip in tile/);
  assert.equal(document.getElementById("snagsEmpty").style.display, "none");
  assert.match(document.getElementById("metersRows").innerHTML, /electricity/);
  assert.match(document.getElementById("keysRows").innerHTML, /Front door keys/);
  assert.match(document.getElementById("signedByLine").textContent, /Jane Site Manager/);
  assert.match(document.getElementById("contentHashLine").textContent, /abc123def456/);
  assert.ok(document.getElementById("downloadPdfBtn"));
});

test("plot-handover-share.html: a pack with no open snags shows the empty-state note, not an empty list", async () => {
  const { document } = await runSharePage({ pack: makePack({ snags_snapshot: [{ description: "Old issue", status: "closed", priority: "low" }] }) });
  await wait(40);
  assert.equal(document.getElementById("snagsEmpty").style.display, "block");
  assert.equal(document.getElementById("snagsList").innerHTML, "");
});

test("plot-handover-share.html: an expired link shows the inactive message, never the record content", async () => {
  const { document } = await runSharePage({ pack: { status: "expired" } });
  await wait(40);
  assert.equal(document.getElementById("activeDetails").style.display, "none");
  assert.match(document.getElementById("doneMessage").textContent, /expired/i);
  assert.doesNotMatch(document.getElementById("content").innerHTML, /Plot 5/);
});

test("plot-handover-share.html: a revoked link shows its own distinct inactive message", async () => {
  const { document } = await runSharePage({ pack: { status: "revoked" } });
  await wait(40);
  assert.match(document.getElementById("doneMessage").textContent, /revoked/i);
});

test("plot-handover-share.html: a missing token shows a fatal error and never calls the RPC", async () => {
  let called = false;
  const supabase = { async rpc() { called = true; return { data: null, error: null }; } };
  const { document } = await runSharePage({ url: "https://example.com/plot-handover-share.html", supabase });
  await wait(40);
  assert.equal(called, false, "the RPC must never be called without a token");
  assert.match(document.getElementById("pageErrorBox").textContent, /missing its handover token/i);
});

test("plot-handover-share.html: an invalid-token RPC error surfaces as a fatal error, not a blank or crashed page", async () => {
  const supabase = { async rpc() { return { data: null, error: { message: "Invalid handover link" } }; } };
  const { document } = await runSharePage({ supabase });
  await wait(40);
  assert.match(document.getElementById("pageErrorBox").textContent, /Invalid handover link/);
});
