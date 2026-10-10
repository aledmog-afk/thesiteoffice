// v58 — the "site-photos" bucket is private. These tests exercise the
// REAL client-side code from tracker/js/app.js (extracted verbatim, the
// same convention as the other app.js helper tests) that turns stored
// photo references into short-lived signed URLs:
//   - sitePhotoPath(): both stored shapes (new bare path, legacy full
//     public URL) normalise to an object path; everything else is null;
//   - getSitePhotoUrls(): ONE batched createSignedUrls() call, cached,
//     with failures not retried in a tight loop;
//   - hydrateSitePhotos()/startSitePhotoHydration(): every <img src> /
//     <a href> holding a reference — including ones rendered later via
//     innerHTML or set via .src — is rewritten to the signed URL;
//   - getDocumentFileUrl()/downloadDocumentFile(): legacy site-photos
//     Documents revisions are signed/downloaded through the private
//     bucket rather than fetched from the dead public URL.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { JSDOM } from "jsdom";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function section(startMarker, endMarker) {
  const start = APP_JS.indexOf(startMarker);
  assert.ok(start !== -1, `${startMarker} not found in app.js`);
  const end = APP_JS.indexOf(endMarker, start);
  assert.ok(end !== -1, `${endMarker} not found in app.js`);
  return APP_JS.slice(start, end);
}

const SITE_PHOTOS_SRC = section("// ─── Private site-photos", "// ─── Image compression");
const DOC_URL_SRC = section("export async function getDocumentFileUrl(revision)", "// ─── Bulk export");

// Fresh module-level state (cache, observer flag) per call, exactly as a
// fresh page load would have.
function load(supabase, document = undefined) {
  const src = `${SITE_PHOTOS_SRC}\n${DOC_URL_SRC}`.replace(/^export /gm, "");
  return new Function("supabase", "document", `${src}
    return { sitePhotoPath, getSitePhotoUrls, getSitePhotoUrl, hydrateSitePhotos, startSitePhotoHydration,
             getDocumentFileUrl, downloadDocumentFile, SITE_PHOTO_URL_TTL_SECONDS };`)(supabase, document);
}

const PID = "3f2a6c1e-8b4d-4e2a-9c1f-0a1b2c3d4e5f";
const LEGACY = `https://nkrgzmxwvydoridmiskl.supabase.co/storage/v1/object/public/site-photos/${PID}/snags/old.jpg`;

function fakeSupabase({ deny = new Set(), fail = false } = {}) {
  const calls = [];
  const downloads = [];
  return {
    calls,
    downloads,
    storage: {
      from(bucket) {
        return {
          async createSignedUrls(paths, ttl) {
            calls.push({ bucket, paths: [...paths], ttl });
            if (fail) return { data: null, error: new Error("boom") };
            return {
              data: paths.map((p) => deny.has(p)
                ? { path: p, signedUrl: null, error: "Object not found" }
                : { path: p, signedUrl: `https://signed.example/${bucket}/${p}?token=t`, error: null }),
              error: null,
            };
          },
          async download(path) {
            downloads.push({ bucket, path });
            return { data: { size: 3, path }, error: null };
          },
          async createSignedUrl() { throw new Error("controlled-documents path not exercised here"); },
        };
      },
    },
  };
}

test("sitePhotoPath(): new bare paths, drawings/ paths, org-logo paths and LEGACY public URLs all normalise to the object path", () => {
  const { sitePhotoPath } = load(fakeSupabase());
  assert.equal(sitePhotoPath(`${PID}/reports/a.jpg`), `${PID}/reports/a.jpg`);
  assert.equal(sitePhotoPath(`drawings/${PID}/site-layout/b.webp`), `drawings/${PID}/site-layout/b.webp`);
  assert.equal(sitePhotoPath("org-logo/9b1f3a3e-0000-4000-8000-000000000000.png"), "org-logo/9b1f3a3e-0000-4000-8000-000000000000.png");
  assert.equal(sitePhotoPath(LEGACY), `${PID}/snags/old.jpg`);
  assert.equal(sitePhotoPath(`${LEGACY}?download=1`), `${PID}/snags/old.jpg`);
});

test("sitePhotoPath(): never mistakes ordinary links, data: URLs, signed URLs or other buckets for a site photo", () => {
  const { sitePhotoPath } = load(fakeSupabase());
  for (const v of [
    "plot-detail.html?id=123", "dashboard.html", "#", "mailto:a@b.c", "data:image/png;base64,AAAA",
    "https://x.supabase.co/storage/v1/object/sign/site-photos/a/b.jpg?token=t",
    "https://x.supabase.co/storage/v1/object/public/other/a/b.jpg",
    "/absolute/path.jpg", "not-a-uuid/reports/a.jpg", "", null, undefined, 42,
  ]) {
    assert.equal(sitePhotoPath(v), null, `expected null for ${JSON.stringify(v)}`);
  }
});

test("getSitePhotoUrls(): signs every distinct path in ONE batched call against the site-photos bucket, mapping each original reference", async () => {
  const sb = fakeSupabase();
  const { getSitePhotoUrls, SITE_PHOTO_URL_TTL_SECONDS } = load(sb);
  const refs = [`${PID}/reports/a.jpg`, LEGACY, `${PID}/reports/a.jpg`, "data:image/png;base64,AA"];
  const map = await getSitePhotoUrls(refs);
  assert.equal(sb.calls.length, 1);
  assert.equal(sb.calls[0].bucket, "site-photos");
  assert.deepEqual(sb.calls[0].paths.sort(), [`${PID}/reports/a.jpg`, `${PID}/snags/old.jpg`].sort());
  assert.equal(sb.calls[0].ttl, SITE_PHOTO_URL_TTL_SECONDS);
  assert.equal(map.get(`${PID}/reports/a.jpg`), `https://signed.example/site-photos/${PID}/reports/a.jpg?token=t`);
  assert.equal(map.get(LEGACY), `https://signed.example/site-photos/${PID}/snags/old.jpg?token=t`);
  assert.ok(!map.has("data:image/png;base64,AA"));
});

test("getSitePhotoUrls(): cached signed URLs are reused, and a denied path isn't re-requested on every DOM change", async () => {
  const sb = fakeSupabase({ deny: new Set([`${PID}/hs-audits/x.jpg`]) });
  const { getSitePhotoUrls } = load(sb);
  const first = await getSitePhotoUrls([`${PID}/reports/a.jpg`, `${PID}/hs-audits/x.jpg`]);
  assert.ok(first.has(`${PID}/reports/a.jpg`));
  assert.ok(!first.has(`${PID}/hs-audits/x.jpg`), "a path the user can't read is simply left unresolved");
  await getSitePhotoUrls([`${PID}/reports/a.jpg`, `${PID}/hs-audits/x.jpg`]);
  assert.equal(sb.calls.length, 1, "second call must be served from cache / the denied list");
});

test("getSitePhotoUrls(): a signing error never throws into the page", async () => {
  const { getSitePhotoUrls, getSitePhotoUrl } = load(fakeSupabase({ fail: true }));
  const map = await getSitePhotoUrls([`${PID}/reports/a.jpg`]);
  assert.equal(map.size, 0);
  assert.equal(await getSitePhotoUrl(`${PID}/reports/b.jpg`), null);
});

test("getSitePhotoUrl(): passes non-site-photo values (data: URLs) through unchanged", async () => {
  const sb = fakeSupabase();
  const { getSitePhotoUrl } = load(sb);
  assert.equal(await getSitePhotoUrl("data:image/png;base64,AA"), "data:image/png;base64,AA");
  assert.equal(sb.calls.length, 0);
});

test("hydrateSitePhotos(): rewrites <img src> and <a href> holding either reference shape, leaves everything else alone", async () => {
  const dom = new JSDOM(`<body>
    <img id="new" src="${PID}/reports/a.jpg">
    <a id="legacy" href="${LEGACY}" target="_blank"><img id="legacyImg" src="${LEGACY}"></a>
    <a id="page" href="plot-detail.html?id=1">x</a>
    <img id="data" src="data:image/png;base64,AA">
  </body>`);
  const doc = dom.window.document;
  const sb = fakeSupabase();
  const { hydrateSitePhotos } = load(sb, doc);
  await hydrateSitePhotos(doc);
  assert.equal(sb.calls.length, 1, "one batched signing call for the whole page");
  assert.equal(doc.getElementById("new").getAttribute("src"), `https://signed.example/site-photos/${PID}/reports/a.jpg?token=t`);
  assert.equal(doc.getElementById("new").getAttribute("data-site-photo-ref"), `${PID}/reports/a.jpg`);
  assert.equal(doc.getElementById("legacy").getAttribute("href"), `https://signed.example/site-photos/${PID}/snags/old.jpg?token=t`);
  assert.equal(doc.getElementById("legacyImg").getAttribute("src"), `https://signed.example/site-photos/${PID}/snags/old.jpg?token=t`);
  assert.equal(doc.getElementById("page").getAttribute("href"), "plot-detail.html?id=1");
  assert.equal(doc.getElementById("data").getAttribute("src"), "data:image/png;base64,AA");
});

test("startSitePhotoHydration(): photos rendered LATER (innerHTML, or .src assignment like drawing-view/settings) are signed automatically", async () => {
  const dom = new JSDOM(`<body><div id="list"></div><img id="preview"></body>`);
  const doc = dom.window.document;
  const sb = fakeSupabase();
  const { startSitePhotoHydration } = load(sb, doc);
  startSitePhotoHydration(doc, sb);

  doc.getElementById("list").innerHTML = `<img class="t" src="${PID}/snags/1.jpg"><img class="t" src="${PID}/snags/2.jpg">`;
  doc.getElementById("preview").src = "org-logo/9b1f3a3e-0000-4000-8000-000000000000.png";
  for (let i = 0; i < 20 && doc.querySelectorAll("[data-site-photo-ref]").length < 3; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const imgs = [...doc.querySelectorAll(".t")].map((i) => i.getAttribute("src"));
  assert.deepEqual(imgs, [
    `https://signed.example/site-photos/${PID}/snags/1.jpg?token=t`,
    `https://signed.example/site-photos/${PID}/snags/2.jpg?token=t`,
  ]);
  assert.equal(doc.getElementById("preview").getAttribute("src"), "https://signed.example/site-photos/org-logo/9b1f3a3e-0000-4000-8000-000000000000.png?token=t");
  assert.ok(sb.calls.length <= 2, `mutations should be batched, got ${sb.calls.length} signing calls`);
});

test("getDocumentFileUrl(): a legacy site-photos revision is signed (old public URL no longer works), not returned as-is", async () => {
  const sb = fakeSupabase();
  const { getDocumentFileUrl } = load(sb);
  const url = await getDocumentFileUrl({ storage_bucket: "site-photos", file_url: `https://x.supabase.co/storage/v1/object/public/site-photos/drawings/${PID}/drawings/p.pdf`, file_name: "p.pdf" });
  assert.equal(url, `https://signed.example/site-photos/drawings/${PID}/drawings/p.pdf?token=t`);
});

test("getDocumentFileUrl(): a legacy revision the user can't read fails loudly instead of returning a dead URL", async () => {
  const path = `drawings/${PID}/drawings/p.pdf`;
  const { getDocumentFileUrl } = load(fakeSupabase({ deny: new Set([path]) }));
  await assert.rejects(() => getDocumentFileUrl({ storage_bucket: "site-photos", file_url: path, file_name: "p.pdf" }), /Could not open/);
});

test("downloadDocumentFile(): a legacy site-photos revision downloads through the authenticated Storage client by PATH", async () => {
  const sb = fakeSupabase();
  const { downloadDocumentFile } = load(sb);
  await downloadDocumentFile({ storage_bucket: "site-photos", file_url: `https://x.supabase.co/storage/v1/object/public/site-photos/${PID}/specifications/s.pdf`, file_name: "s.pdf" });
  assert.deepEqual(sb.downloads, [{ bucket: "site-photos", path: `${PID}/specifications/s.pdf` }]);
});

test("requireAuth() starts photo hydration for every protected page, and uploadPhoto() no longer builds public URLs", () => {
  const requireAuth = APP_JS.match(/export async function requireAuth\(\)[\s\S]*?\n\}/)[0];
  assert.match(requireAuth, /startSitePhotoHydration\(\)/);
  assert.ok(!/getPublicUrl\(/.test(APP_JS), "nothing in app.js may build a public site-photos URL any more");
});
