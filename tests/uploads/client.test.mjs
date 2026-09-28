// Upload validation, client side (Priority 2). This is UX only, not the
// security boundary — the real enforcement is the "site-photos" bucket's
// file_size_limit/allowed_mime_types config, verified server-side in
// tests/security/storage.test.mjs. This file proves uploadPhoto() gives a
// fast, friendly rejection for the same cases before ever attempting the
// network call.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

// MAX_UPLOAD_BYTES and ALLOWED_UPLOAD_MIME_TYPES are module-level consts
// uploadPhoto() closes over (the latter isn't even exported) — extracted
// together into one shared Function scope so that real closure behaviour
// is preserved, rather than trying to inject them as call parameters.
const maxBytesMatch = APP_JS.match(/export const MAX_UPLOAD_BYTES = [\d_* ]+;/);
assert.ok(maxBytesMatch, "MAX_UPLOAD_BYTES not found in app.js");
const allowedTypesMatch = APP_JS.match(/const ALLOWED_UPLOAD_MIME_TYPES = new Set\(\[[\s\S]*?\]\);/);
assert.ok(allowedTypesMatch, "ALLOWED_UPLOAD_MIME_TYPES not found in app.js");
const uploadPhotoMatch = APP_JS.match(/export async function uploadPhoto\(file, path\)[\s\S]*?\n\}/);
assert.ok(uploadPhotoMatch, "uploadPhoto not found in app.js");
const uploadPhotoBody = uploadPhotoMatch[0]
  .replace(/^export async function uploadPhoto\(file, path\)\s*\{/, "")
  .replace(/\}$/, "");

const scopeSrc = `
  ${maxBytesMatch[0].replace(/^export /, "")}
  ${allowedTypesMatch[0]}
  return {
    MAX_UPLOAD_BYTES,
    uploadPhoto: async function uploadPhoto(file, path, supabase, crypto) {
      ${uploadPhotoBody}
    },
  };
`;
const { MAX_UPLOAD_BYTES, uploadPhoto } = new Function(scopeSrc)();

function fakeFile({ size = 1024, type = "image/jpeg", name = "photo.jpg" } = {}) {
  return { size, type, name };
}

function fakeSupabase() {
  const calls = [];
  return {
    calls,
    storage: {
      from() {
        return {
          upload: async (key, file, opts) => { calls.push({ key, file, opts }); return { error: null }; },
          getPublicUrl: (key) => ({ data: { publicUrl: `https://example.com/${key}` } }),
        };
      },
    },
  };
}

test(`MAX_UPLOAD_BYTES matches the 50MB bucket limit documented in sql/schema.sql`, () => {
  assert.equal(MAX_UPLOAD_BYTES, 50 * 1024 * 1024);
});

test("uploadPhoto(): a normally-sized, allowed file uploads successfully", async () => {
  const supabase = fakeSupabase();
  const url = await uploadPhoto(fakeFile({ size: 2 * 1024 * 1024, type: "image/jpeg" }), "proj1/reports", supabase, crypto);
  assert.equal(supabase.calls.length, 1);
  assert.ok(url.startsWith("https://example.com/proj1/reports/"));
});

for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf", "application/msword", "text/csv"]) {
  test(`uploadPhoto(): allows ${type}`, async () => {
    const supabase = fakeSupabase();
    await uploadPhoto(fakeFile({ type, size: 1024 }), "proj1/specifications", supabase, crypto);
    assert.equal(supabase.calls.length, 1, `${type} should have been allowed through to the upload call`);
  });
}

test("uploadPhoto(): rejects a file over 50MB before attempting to upload", async () => {
  const supabase = fakeSupabase();
  await assert.rejects(
    () => uploadPhoto(fakeFile({ size: 51 * 1024 * 1024 }), "proj1/drawings", supabase, crypto),
    /50 ?MB/i
  );
  assert.equal(supabase.calls.length, 0, "an oversized file must never reach the network call");
});

test("uploadPhoto(): rejects image/svg+xml — the one real stored-XSS vector this upload surface had", async () => {
  const supabase = fakeSupabase();
  await assert.rejects(
    () => uploadPhoto(fakeFile({ type: "image/svg+xml", name: "logo.svg" }), "org-logo", supabase, crypto),
    /svg/i
  );
  assert.equal(supabase.calls.length, 0);
});

test("uploadPhoto(): rejects an arbitrary unsupported MIME type (e.g. an executable)", async () => {
  const supabase = fakeSupabase();
  await assert.rejects(
    () => uploadPhoto(fakeFile({ type: "application/x-msdownload", name: "totally-a-photo.exe" }), "proj1/reports", supabase, crypto),
    /application\/x-msdownload/
  );
  assert.equal(supabase.calls.length, 0);
});

test("uploadPhoto(): a file with no browser-supplied type is let through to the real (server-side) check", async () => {
  // Some browsers omit file.type for less common extensions — client-side
  // validation shouldn't guess or block on an empty type; the bucket's own
  // MIME allow-list is the authoritative check either way.
  const supabase = fakeSupabase();
  await uploadPhoto(fakeFile({ type: "", name: "scan.tif" }), "proj1/reports", supabase, crypto);
  assert.equal(supabase.calls.length, 1);
});
