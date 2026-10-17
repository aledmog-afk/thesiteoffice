// Save to Device (Priority 18). Tests canShareFile()/saveFileToDevice()/
// deviceSavePhotoFilename()/deviceSaveStatusLabel() in isolation, exactly
// like uploadPhoto() is tested in client.test.mjs — extracted from the real
// tracker/js/app.js source into their own Function scope, with `navigator`/
// `document`/`URL`/`File`/`setTimeout` injected as fully controllable fakes
// (there is no real DOM/browser here, and jsdom doesn't implement
// navigator.share/canShare at all, so this is the only way to exercise the
// actual branching logic deterministically). This file never touches
// uploadImage()/compressImage()/uploadPhoto() — those are proven unchanged
// by the existing tests in this same directory continuing to pass unmodified.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractFn(name, prefix = "export function") {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = APP_JS.match(new RegExp(`${prefix} ${escaped}\\([^)]*\\) \\{[\\s\\S]*?\\n\\}`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export (async )?function /, "");
}

const canShareFileSrc = "function " + extractFn("canShareFile");
const deviceSavePhotoFilenameSrc = "function " + extractFn("deviceSavePhotoFilename");
const deviceSaveStatusLabelSrc = "function " + extractFn("deviceSaveStatusLabel");
const saveFileToDeviceSrc = "async function " + extractFn("saveFileToDevice", "export async function");

const SCOPE_SRC = `
  ${canShareFileSrc}
  ${deviceSavePhotoFilenameSrc}
  ${deviceSaveStatusLabelSrc}
  ${saveFileToDeviceSrc}
  return { canShareFile, deviceSavePhotoFilename, deviceSaveStatusLabel, saveFileToDevice };
`;

// Builds a fresh set of the four functions, closing over the given fake
// navigator/document/URL/File/setTimeout — real app.js closes over the
// genuine browser globals of the same names; this is the equivalent for a
// Node test environment where none of those exist as real browser APIs.
function makeHelpers({ navigator, document, URL, File, setTimeout }) {
  return new Function("navigator", "document", "URL", "File", "setTimeout", SCOPE_SRC)(navigator, document, URL, File, setTimeout);
}

class FakeFile {
  constructor(parts, name, opts = {}) {
    this.parts = parts;
    this.name = name;
    this.type = opts.type || "";
    this.lastModified = opts.lastModified || 0;
  }
}

function fakeSourceFile({ name = "IMG_0001.jpg", type = "image/jpeg", size = 12345 } = {}) {
  return { name, type, size, lastModified: 1700000000000 };
}

function fakeDocument() {
  const anchors = [];
  return {
    anchors,
    createElement(tag) {
      const el = { tagName: tag, href: "", download: "", clicked: false, appended: false, removed: false, click() { this.clicked = true; }, remove() { this.removed = true; } };
      anchors.push(el);
      return el;
    },
    body: { appendChild(el) { el.appended = true; } },
  };
}

function fakeURL() {
  const created = [];
  const revoked = [];
  return {
    created, revoked,
    createObjectURL(file) { const u = `blob:fake/${created.length}`; created.push({ url: u, file }); return u; },
    revokeObjectURL(u) { revoked.push(u); },
  };
}

const immediateSetTimeout = (fn) => fn();

// ─── canShareFile() ────────────────────────────────────────────────

test("canShareFile(): true when both navigator.share and navigator.canShare exist and canShare() itself returns true for this file", () => {
  const { canShareFile } = makeHelpers({
    navigator: { share: async () => {}, canShare: () => true },
    document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout,
  });
  assert.equal(canShareFile(fakeSourceFile()), true);
});

test("canShareFile(): false when navigator.share does not exist at all (does not assume it)", () => {
  const { canShareFile } = makeHelpers({
    navigator: {}, // no share, no canShare — e.g. desktop Firefox
    document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout,
  });
  assert.equal(canShareFile(fakeSourceFile()), false);
});

test("canShareFile(): false when navigator.canShare exists but navigator.share does not (defensive — real browsers never do this, but the check must not assume the pairing)", () => {
  const { canShareFile } = makeHelpers({
    navigator: { canShare: () => true },
    document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout,
  });
  assert.equal(canShareFile(fakeSourceFile()), false);
});

test("canShareFile(): false when navigator.canShare() itself rejects this specific file (e.g. an unsupported type)", () => {
  const { canShareFile } = makeHelpers({
    navigator: { share: async () => {}, canShare: () => false },
    document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout,
  });
  assert.equal(canShareFile(fakeSourceFile()), false);
});

// ─── deviceSavePhotoFilename() ─────────────────────────────────────

test("deviceSavePhotoFilename(): a generic 'site-photo-<timestamp>.jpg' name — never the original filename, never anything project-identifying", () => {
  const { deviceSavePhotoFilename } = makeHelpers({ navigator: {}, document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout });
  const name = deviceSavePhotoFilename(fakeSourceFile({ name: "client-confidential-plot-7.jpg", type: "image/jpeg" }));
  assert.match(name, /^site-photo-.+\.jpg$/, "expected a generic site-photo-*.jpg name");
  assert.doesNotMatch(name, /client-confidential/, "must never reuse the original File's own name");
  assert.doesNotMatch(name, /plot-7/);
});

test("deviceSavePhotoFilename(): uses a .png extension for a PNG source, .jpg for everything else", () => {
  const { deviceSavePhotoFilename } = makeHelpers({ navigator: {}, document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout });
  assert.match(deviceSavePhotoFilename(fakeSourceFile({ type: "image/png" })), /\.png$/);
  assert.match(deviceSavePhotoFilename(fakeSourceFile({ type: "image/jpeg" })), /\.jpg$/);
  assert.match(deviceSavePhotoFilename(fakeSourceFile({ type: "image/heic" })), /\.jpg$/);
});

// ─── deviceSaveStatusLabel() ────────────────────────────────────────

test("deviceSaveStatusLabel(): a genuine share completion reads as a confirmed save", () => {
  const { deviceSaveStatusLabel } = makeHelpers({ navigator: {}, document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout });
  assert.equal(deviceSaveStatusLabel("saved"), "Saved to Device ✓");
});

test("deviceSaveStatusLabel(): a plain download is never described as a confirmed gallery save (no completion signal exists for it)", () => {
  const { deviceSaveStatusLabel } = makeHelpers({ navigator: {}, document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout });
  const label = deviceSaveStatusLabel("downloaded");
  assert.notEqual(label, "Saved to Device ✓");
  assert.match(label, /download/i);
});

test("deviceSaveStatusLabel(): cancellation and genuine failure both read as a neutral, non-alarming 'try again' — never as success", () => {
  const { deviceSaveStatusLabel } = makeHelpers({ navigator: {}, document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout });
  assert.match(deviceSaveStatusLabel("cancelled"), /not saved/i);
  assert.match(deviceSaveStatusLabel("failed"), /not saved/i);
});

// ─── saveFileToDevice() — Web Share path ───────────────────────────

test("saveFileToDevice(): when sharing is supported, invokes navigator.share with a File wrapping the ORIGINAL bytes under the given generic filename", async () => {
  let sharedWith = null;
  const { saveFileToDevice } = makeHelpers({
    navigator: { canShare: () => true, share: async (opts) => { sharedWith = opts; } },
    document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout,
  });
  const original = fakeSourceFile({ name: "IMG_9999.jpg", type: "image/jpeg" });
  const result = await saveFileToDevice(original, "site-photo-2026-01-01.jpg");
  assert.deepEqual(result, { method: "share", status: "saved" });
  assert.ok(sharedWith, "navigator.share must have been called");
  assert.equal(sharedWith.files.length, 1);
  const shared = sharedWith.files[0];
  assert.equal(shared.name, "site-photo-2026-01-01.jpg", "the generic filename must be used, not the original");
  assert.equal(shared.parts[0], original, "the shared File must wrap the exact original bytes/reference — never re-encoded");
  assert.equal(shared.type, original.type);
});

test("saveFileToDevice(): the user dismissing the native share sheet (AbortError) is reported as 'cancelled', never as a failure or a success", async () => {
  const { saveFileToDevice } = makeHelpers({
    navigator: { canShare: () => true, share: async () => { const e = new Error("cancelled by user"); e.name = "AbortError"; throw e; } },
    document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout,
  });
  const result = await saveFileToDevice(fakeSourceFile(), "site-photo.jpg");
  assert.deepEqual(result, { method: "share", status: "cancelled" });
});

test("saveFileToDevice(): a genuine share error (not a cancellation) is reported as 'failed', not silently swallowed and not reported as success", async () => {
  const err = new Error("something went wrong");
  const { saveFileToDevice } = makeHelpers({
    navigator: { canShare: () => true, share: async () => { throw err; } },
    document: fakeDocument(), URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout,
  });
  const result = await saveFileToDevice(fakeSourceFile(), "site-photo.jpg");
  assert.equal(result.method, "share");
  assert.equal(result.status, "failed");
  assert.equal(result.error, err);
});

// ─── saveFileToDevice() — download fallback path ───────────────────

test("saveFileToDevice(): when file sharing is unavailable, falls back to a user-triggered download — creates and clicks an <a download> with the original file's blob URL", async () => {
  const url = fakeURL();
  const doc = fakeDocument();
  const { saveFileToDevice } = makeHelpers({
    navigator: {}, // no share support at all — e.g. desktop Chrome/Edge
    document: doc, URL: url, File: FakeFile, setTimeout: immediateSetTimeout,
  });
  const original = fakeSourceFile({ name: "IMG_1.jpg", type: "image/jpeg" });
  const result = await saveFileToDevice(original, "site-photo-2026-01-01.jpg");
  assert.deepEqual(result, { method: "download", status: "downloaded" });
  assert.equal(doc.anchors.length, 1);
  const a = doc.anchors[0];
  assert.equal(a.download, "site-photo-2026-01-01.jpg");
  assert.ok(a.clicked, "the download must be triggered by an actual click, not just constructed");
  assert.ok(a.appended && a.removed, "the anchor must be attached to the document to be clickable, then cleaned up");
  assert.equal(url.created.length, 1);
  assert.equal(url.created[0].file.parts[0], original, "the downloaded blob must wrap the exact original bytes — never re-encoded");
});

test("saveFileToDevice(): falls back to download when navigator.canShare() specifically rejects this file, even if navigator.share exists", async () => {
  const doc = fakeDocument();
  const { saveFileToDevice } = makeHelpers({
    navigator: { share: async () => { throw new Error("should never be called"); }, canShare: () => false },
    document: doc, URL: fakeURL(), File: FakeFile, setTimeout: immediateSetTimeout,
  });
  const result = await saveFileToDevice(fakeSourceFile(), "site-photo.jpg");
  assert.equal(result.method, "download");
  assert.equal(doc.anchors.length, 1);
});

test("saveFileToDevice(): a failure in the download fallback itself (e.g. createObjectURL throws) is reported as failed, not thrown uncaught", async () => {
  const { saveFileToDevice } = makeHelpers({
    navigator: {},
    document: fakeDocument(),
    URL: { createObjectURL: () => { throw new Error("no blob support"); }, revokeObjectURL: () => {} },
    File: FakeFile, setTimeout: immediateSetTimeout,
  });
  const result = await saveFileToDevice(fakeSourceFile(), "site-photo.jpg");
  assert.equal(result.method, "download");
  assert.equal(result.status, "failed");
  assert.ok(result.error instanceof Error);
});
