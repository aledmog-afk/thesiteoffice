// Toolbox Talks — delivery/attendee/signature/completion detail page
// (toolbox-talk-detail.html). Real page script under jsdom; app.js
// functions mocked directly (same convention as toolbox_talks.test.mjs).
//
// Signature capture is exercised via the typed-name fallback path only:
// jsdom has no real canvas 2D context (canvas.getContext("2d") returns
// null without the native `canvas` package), so pointer-drawing cannot
// be simulated here. The typed-name path is a real, independent code
// path (already null-safe against a missing 2D context) and fully
// exercises signToolboxTalkAttendee() the same way a real "cannot draw,
// type name instead" attendee would.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/toolbox-talk-detail.html", import.meta.url).pathname;
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
const { toolboxTalkSignatureProgress } = new Function(`
  ${extractFunction("toolboxTalkSignatureProgress")}
  return { toolboxTalkSignatureProgress };
`)();

const CONTENT_SNAPSHOT = {
  introduction: "Intro text",
  key_message: "Stay safe",
  key_points: ["Point one", "Point two"],
  site_observations: { good_practice: ["Good thing"], warning_signs: ["Bad thing"] },
  discussion_questions: ["What could go wrong?"],
  key_takeaways: ["Wear PPE"],
  pre_task_checks: ["Check ladders"],
};

function makeTalk(overrides = {}) {
  return {
    id: "talk-1",
    reference: "TT-003",
    project_id: "p1",
    template_version_id: "v-1",
    title: "Working at Height",
    status: "in_progress",
    started_at: "2026-01-05T09:00:00Z",
    delivered_by: "u1",
    source_filename: "working-at-height.docx",
    site_notes: null,
    content_snapshot: CONTENT_SNAPSHOT,
    ...overrides,
  };
}

function makeSupabase({ projectName = "Test Site" } = {}) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        single: async () => {
          if (table === "projects") return { data: { name: projectName }, error: null };
          return { data: null, error: null };
        },
      };
      return api;
    },
  };
}

function makeContext({ role = "contributor", talk, attendees = [], supabase, pdfBlob, pdfError, saveResult } = {}) {
  const calls = [];
  const ctx = {
    __url: "https://example.com/toolbox-talk-detail.html?id=talk-1",
    supabase: supabase || makeSupabase(),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "talk-1",
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    showError: (el, err) => { el.textContent = (err && err.message) || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    confirm: () => true,
    getMyToolboxTalkRole: async () => role,
    toolboxTalkCapabilities,
    toolboxTalkSignatureProgress,
    getToolboxTalk: async () => talk,
    listToolboxTalkAttendees: async () => attendees,
    getToolboxTalkTemplateVersion: async () => ({ id: "v-1", version_number: 2 }),
    getMemberEmailMap: async () => ({ u1: "deliverer@example.com" }),
    addToolboxTalkAttendee: async (talkId, payload) => { calls.push({ fn: "addToolboxTalkAttendee", talkId, payload }); return { id: "new-attendee-1" }; },
    removeToolboxTalkAttendee: async (attendeeId) => { calls.push({ fn: "removeToolboxTalkAttendee", attendeeId }); },
    signToolboxTalkAttendee: async (attendeeId, payload) => { calls.push({ fn: "signToolboxTalkAttendee", attendeeId, payload }); },
    recordToolboxTalkAttendeeException: async (attendeeId, reason) => { calls.push({ fn: "recordToolboxTalkAttendeeException", attendeeId, reason }); },
    updateToolboxTalkSiteNotes: async (talkId, notes) => { calls.push({ fn: "updateToolboxTalkSiteNotes", talkId, notes }); },
    completeToolboxTalk: async (talkId) => { calls.push({ fn: "completeToolboxTalk", talkId }); },
    cancelToolboxTalk: async (talkId, reason) => { calls.push({ fn: "cancelToolboxTalk", talkId, reason }); },
    generateToolboxTalkPdfBlob: async (talkId) => {
      calls.push({ fn: "generateToolboxTalkPdfBlob", talkId });
      if (pdfError) throw pdfError;
      return { blob: pdfBlob || { type: "application/pdf" }, filename: "TT-003 - Working at Height.pdf" };
    },
    saveFileToDevice: async (blob, filename) => {
      calls.push({ fn: "saveFileToDevice", blob, filename });
      return saveResult || { method: "download", status: "downloaded" };
    },
    deviceSaveStatusLabel: (status) => {
      switch (status) {
        case "saved": return "Saved to Device ✓";
        case "downloaded": return "Download started";
        case "cancelled": return "Not saved to device — you can try again.";
        case "failed": return "Not saved to device — you can try again.";
        default: return "";
      }
    },
    TOOLBOX_TALK_STATUS_LABEL: { in_progress: "In Progress", completed: "Completed", cancelled: "Cancelled" },
    TOOLBOX_TALK_STATUS_BADGE: { in_progress: "badge-amber", completed: "badge-green", cancelled: "badge-grey" },
  };
  ctx.__calls = calls;
  return ctx;
}

async function run(context) {
  return runPage(HTML, extractScript(HTML), context);
}

test("Toolbox Talk detail: renders all content_snapshot sections from the delivered talk", async () => {
  const ctx = makeContext({ talk: makeTalk() });
  const { document } = await run(ctx);
  await wait(20);

  const html = document.getElementById("contentSections").innerHTML;
  assert.ok(html.includes("Intro text"));
  assert.ok(html.includes("Stay safe"));
  assert.ok(html.includes("Point one") && html.includes("Point two"));
  assert.ok(html.includes("Good thing"));
  assert.ok(html.includes("Bad thing"));
  assert.ok(html.includes("What could go wrong?"));
  assert.ok(html.includes("Wear PPE"));
  assert.ok(html.includes("Check ladders"));
});

test("Toolbox Talk detail: attendee list shows Pending/Signed/Exception status badges", async () => {
  const attendees = [
    { id: "a1", name: "Alice", company: "Acme", signed_at: null, exception_reason: null },
    { id: "a2", name: "Bob", company: null, signed_at: "2026-01-05T09:30:00Z", exception_reason: null },
    { id: "a3", name: "Carl", company: null, signed_at: null, exception_reason: "Left site early" },
  ];
  const ctx = makeContext({ talk: makeTalk(), attendees });
  const { document } = await run(ctx);
  await wait(20);

  const html = document.getElementById("attendeeRows").innerHTML;
  assert.ok(html.includes("Alice") && html.includes("Acme"));
  assert.ok(html.includes("Pending"));
  assert.ok(html.includes("Bob") && html.includes("Signed"));
  assert.ok(html.includes("Carl") && html.includes("Exception") && html.includes("Left site early"));
  assert.equal(document.getElementById("progressText").textContent, "2 of 3 attendee(s) resolved");
});

test("Toolbox Talk detail: a contributor can add an attendee", async () => {
  const ctx = makeContext({ talk: makeTalk(), attendees: [] });
  const { document } = await run(ctx);
  await wait(20);

  document.getElementById("newAttendeeName").value = "Dana";
  document.getElementById("newAttendeeCompany").value = "Site Co";
  fireEvent(document.getElementById("addAttendeeBtn"), "click");
  await wait(20);

  const call = ctx.__calls.find((c) => c.fn === "addToolboxTalkAttendee");
  assert.ok(call, "addToolboxTalkAttendee() must have been called");
  assert.equal(call.talkId, "talk-1");
  assert.equal(call.payload.name, "Dana");
  assert.equal(call.payload.company, "Site Co");
});

test("Toolbox Talk detail: signing via the typed-name fallback calls signToolboxTalkAttendee with typedName and no signatureData", async () => {
  const attendees = [{ id: "a1", name: "Alice", company: null, signed_at: null, exception_reason: null }];
  const ctx = makeContext({ talk: makeTalk(), attendees });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.querySelector('button[data-sign="a1"]'), "click");
  await wait(20);
  assert.equal(document.getElementById("signModal").style.display, "flex");

  document.getElementById("typedNameInput").value = "Alice Smith";
  fireEvent(document.getElementById("submitSigBtn"), "click");
  await wait(20);

  const call = ctx.__calls.find((c) => c.fn === "signToolboxTalkAttendee");
  assert.ok(call, "signToolboxTalkAttendee() must have been called");
  assert.equal(call.attendeeId, "a1");
  assert.equal(call.payload.typedName, "Alice Smith");
  assert.equal(call.payload.signatureData, null);
});

test("Toolbox Talk detail: submitting the sign modal with neither a stroke nor a typed name shows an error and does not call signToolboxTalkAttendee", async () => {
  const attendees = [{ id: "a1", name: "Alice", company: null, signed_at: null, exception_reason: null }];
  const ctx = makeContext({ talk: makeTalk(), attendees });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.querySelector('button[data-sign="a1"]'), "click");
  await wait(20);
  fireEvent(document.getElementById("submitSigBtn"), "click");
  await wait(20);

  assert.ok(!ctx.__calls.some((c) => c.fn === "signToolboxTalkAttendee"));
  assert.ok(document.getElementById("signModalError").textContent.length > 0);
});

test("Toolbox Talk detail: recording a cannot-sign exception calls recordToolboxTalkAttendeeException with the reason", async () => {
  const attendees = [{ id: "a1", name: "Alice", company: null, signed_at: null, exception_reason: null }];
  const ctx = makeContext({ talk: makeTalk(), attendees });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.querySelector('button[data-exception="a1"]'), "click");
  await wait(20);
  assert.equal(document.getElementById("exceptionModal").style.display, "flex");

  document.getElementById("exceptionReasonInput").value = "Left site before the talk finished";
  fireEvent(document.getElementById("submitExceptionBtn"), "click");
  await wait(20);

  const call = ctx.__calls.find((c) => c.fn === "recordToolboxTalkAttendeeException");
  assert.ok(call, "recordToolboxTalkAttendeeException() must have been called");
  assert.equal(call.attendeeId, "a1");
  assert.equal(call.reason, "Left site before the talk finished");
});

test("Toolbox Talk detail: Complete/Cancel and Add Attendee controls are hidden once the talk is no longer in_progress", async () => {
  const attendees = [{ id: "a1", name: "Alice", company: null, signed_at: "2026-01-05T09:30:00Z", exception_reason: null }];
  const ctx = makeContext({ talk: makeTalk({ status: "completed", completed_at: "2026-01-05T10:00:00Z" }), attendees });
  const { document } = await run(ctx);
  await wait(20);

  assert.equal(document.getElementById("talkActionsRow").style.display, "none");
  assert.equal(document.getElementById("addAttendeeRow").style.display, "none");
  assert.equal(document.getElementById("saveSiteNotesBtn").style.display, "none");
  assert.equal(document.getElementById("siteNotesInput").disabled, true);
  // a resolved attendee on a locked talk must show no Sign/Cannot Sign/Remove actions
  assert.ok(!document.querySelector('button[data-sign="a1"]'));
  assert.ok(!document.querySelector('button[data-remove="a1"]'));
});

test("Toolbox Talk detail: a viewer (canEdit=false) sees the talk but no attendee action buttons or talk actions", async () => {
  const attendees = [{ id: "a1", name: "Alice", company: null, signed_at: null, exception_reason: null }];
  const ctx = makeContext({ role: "viewer", talk: makeTalk(), attendees });
  const { document } = await run(ctx);
  await wait(20);

  assert.equal(document.getElementById("body").style.display, "block");
  assert.equal(document.getElementById("talkActionsRow").style.display, "none");
  assert.equal(document.getElementById("addAttendeeRow").style.display, "none");
  assert.ok(!document.querySelector('button[data-sign="a1"]'));
});

test("Toolbox Talk detail: completing the talk calls completeToolboxTalk", async () => {
  const attendees = [{ id: "a1", name: "Alice", company: null, signed_at: "2026-01-05T09:30:00Z", exception_reason: null }];
  const ctx = makeContext({ talk: makeTalk(), attendees });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.getElementById("completeTalkBtn"), "click");
  await wait(20);

  const call = ctx.__calls.find((c) => c.fn === "completeToolboxTalk");
  assert.ok(call, "completeToolboxTalk() must have been called");
  assert.equal(call.talkId, "talk-1");
});

test("Toolbox Talk detail: cancelling the talk requires a reason and calls cancelToolboxTalk with it", async () => {
  const ctx = makeContext({ talk: makeTalk(), attendees: [] });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.getElementById("cancelTalkBtn"), "click");
  await wait(20);
  assert.equal(document.getElementById("cancelModal").style.display, "flex");

  fireEvent(document.getElementById("confirmCancelBtn"), "click");
  await wait(20);
  assert.ok(!ctx.__calls.some((c) => c.fn === "cancelToolboxTalk"), "must not cancel without a reason");
  assert.ok(document.getElementById("cancelModalError").textContent.length > 0);

  document.getElementById("cancelReasonInput").value = "Weather turned unsafe";
  fireEvent(document.getElementById("confirmCancelBtn"), "click");
  await wait(20);

  const call = ctx.__calls.find((c) => c.fn === "cancelToolboxTalk");
  assert.ok(call, "cancelToolboxTalk() must have been called");
  assert.equal(call.talkId, "talk-1");
  assert.equal(call.reason, "Weather turned unsafe");
});

// ─── PDF export ──────────────────────────────────────────────────────

test("Toolbox Talk detail: Generate PDF is hidden for an in-progress talk and shown for a completed one", async () => {
  const inProgress = makeContext({ talk: makeTalk({ status: "in_progress" }), attendees: [] });
  const { document: doc1 } = await run(inProgress);
  await wait(20);
  assert.equal(doc1.getElementById("generatePdfBtn").style.display, "none");

  const completed = makeContext({ talk: makeTalk({ status: "completed", completed_at: "2026-01-05T09:30:00Z" }), attendees: [{ id: "a1", name: "Alice", signed_at: "2026-01-05T09:20:00Z" }] });
  const { document: doc2 } = await run(completed);
  await wait(20);
  assert.equal(doc2.getElementById("generatePdfBtn").style.display, "inline-flex");
});

test("Toolbox Talk detail: Generate PDF is hidden for a cancelled talk", async () => {
  const ctx = makeContext({ talk: makeTalk({ status: "cancelled", cancellation_reason: "Rained off" }), attendees: [] });
  const { document } = await run(ctx);
  await wait(20);
  assert.equal(document.getElementById("generatePdfBtn").style.display, "none");
});

test("Toolbox Talk detail: clicking Generate PDF calls generateToolboxTalkPdfBlob then saveFileToDevice with the returned blob/filename, and shows the resulting status", async () => {
  const ctx = makeContext({
    talk: makeTalk({ status: "completed", completed_at: "2026-01-05T09:30:00Z" }),
    attendees: [{ id: "a1", name: "Alice", signed_at: "2026-01-05T09:20:00Z" }],
    saveResult: { method: "share", status: "saved" },
  });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.getElementById("generatePdfBtn"), "click");
  await wait(20);

  const genCall = ctx.__calls.find((c) => c.fn === "generateToolboxTalkPdfBlob");
  assert.ok(genCall, "generateToolboxTalkPdfBlob() must have been called");
  assert.equal(genCall.talkId, "talk-1");

  const saveCall = ctx.__calls.find((c) => c.fn === "saveFileToDevice");
  assert.ok(saveCall, "saveFileToDevice() must have been called with the generated blob/filename");
  assert.equal(saveCall.filename, "TT-003 - Working at Height.pdf");

  assert.equal(document.getElementById("pdfStatusText").textContent, "Saved to Device ✓");
});

test("Toolbox Talk detail: a PDF generation failure shows the error and never calls saveFileToDevice", async () => {
  const ctx = makeContext({
    talk: makeTalk({ status: "completed", completed_at: "2026-01-05T09:30:00Z" }),
    attendees: [{ id: "a1", name: "Alice", signed_at: "2026-01-05T09:20:00Z" }],
    pdfError: new Error("Only a completed Toolbox Talk can be exported as a PDF."),
  });
  const { document } = await run(ctx);
  await wait(20);

  fireEvent(document.getElementById("generatePdfBtn"), "click");
  await wait(20);

  assert.ok(!ctx.__calls.some((c) => c.fn === "saveFileToDevice"), "must not attempt to save/share when generation failed");
  assert.ok(document.getElementById("pageErrorBox").textContent.includes("Only a completed Toolbox Talk"));
});

test("Toolbox Talk detail: the talk's reference and template version both appear in the page subtitle", async () => {
  const ctx = makeContext({ talk: makeTalk({ reference: "TT-009" }), attendees: [] });
  const { document } = await run(ctx);
  await wait(20);
  const sub = document.getElementById("talkSub").textContent;
  assert.ok(sub.includes("TT-009"));
  assert.ok(sub.includes("Version 2"));
});
