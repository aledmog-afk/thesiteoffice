// Storage security (Priority 2): the site-photos bucket's write policies
// re-derive the real project/organisation from an object's own path and
// check real membership — never trust a client-supplied id. See
// site_photos_path_parts()/site_photos_authorized() in sql/schema.sql.
//
// What this file CAN and CANNOT prove: tests/lib/mock_setup.sql
// reconstructs storage.objects as a plain table with the real RLS
// policies attached, so every access-control assertion below exercises
// the actual policy logic. It does NOT reconstruct Supabase Storage's
// HTTP API, so the bucket-level file_size_limit/allowed_mime_types
// config (enforced by that API, not by RLS) is checked here by reading
// the bucket row's configuration rather than by attempting a real
// rejected upload — see tests/uploads/client.test.mjs for the
// client-side half of that same control.
//
// Storage READS: since v58 the bucket is private. The anon key could
// previously LIST every object (the old "public read site-photos" policy
// had no role restriction, and Storage's list endpoint is governed by
// exactly that SELECT policy). Reads are now authenticated-only and
// re-derive the owning project (or, for org-logo, the organisation
// whose org_settings row points at the file) from the path — see
// site_photos_read_authorized() in sql/schema.sql.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createTestDatabase, dropTestDatabase, setupSchema, adminClient, userClient, anonClient, isRlsError } from "../lib/db.mjs";

const DB = "tracker_test_storage";

const USER_A = "a1000000-0000-0000-0000-00000000000a";
const USER_B = "b1000000-0000-0000-0000-00000000000b";
const SNAGGER = "e1000000-0000-0000-0000-00000000000e";

let fx;

before(async () => {
  await createTestDatabase(DB);
  await setupSchema(DB);

  const admin = adminClient(DB);
  await admin.connect();
  await admin.query(
    `insert into auth.users (id, email) values ($1,'a@example.com'), ($2,'b@example.com'), ($3,'snagger@example.com')`,
    [USER_A, USER_B, SNAGGER]
  );
  await admin.end();

  const a = await userClient(DB, USER_A);
  const orgA = (await a.query("select public.ensure_organisation() as id")).rows[0].id;
  const projA = (await a.query("insert into public.projects (name, org_id, created_by) values ('A', $1, $2) returning id", [orgA, USER_A])).rows[0].id;
  const snagCode = (await a.query("select public.regenerate_snagging_invite_code($1) as code", [projA])).rows[0].code;
  await a.end();

  const snagger = await userClient(DB, SNAGGER);
  await snagger.query("select public.join_project_by_invite($1)", [snagCode]);
  await snagger.end();

  const b = await userClient(DB, USER_B);
  const orgB = (await b.query("select public.ensure_organisation() as id")).rows[0].id;
  const projB = (await b.query("insert into public.projects (name, org_id, created_by) values ('B', $1, $2) returning id", [orgB, USER_B])).rows[0].id;
  await b.end();

  fx = { orgA, projA, orgB, projB };
});

after(async () => {
  await dropTestDatabase(DB);
});

async function tryInsertObject(client, name) {
  return client.query("insert into storage.objects (bucket_id, name) values ('site-photos', $1)", [name]);
}

test("Bucket config: 50MB size limit and the documented MIME allow-list are set", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query("select file_size_limit, allowed_mime_types from storage.buckets where id = 'site-photos'");
    // pg returns bigint columns as strings to avoid silent precision loss
    // above Number.MAX_SAFE_INTEGER — not relevant at this size, but Number()
    // here keeps the assertion honest either way.
    assert.equal(Number(rows[0].file_size_limit), 52428800, "expected the 50MB limit from sql/schema.sql v27");
    const mimes = rows[0].allowed_mime_types;
    for (const type of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf", "text/csv"]) {
      assert.ok(mimes.includes(type), `expected ${type} to be allowed`);
    }
    assert.ok(!mimes.includes("image/svg+xml"), "image/svg+xml must NOT be allowed (the one real stored-XSS vector this upload surface had)");
    assert.ok(!mimes.includes("text/html"), "text/html must NOT be allowed");
  } finally {
    await admin.end();
  }
});

test("User A can upload into their own project's reports/snags/drawings areas, and the org logo", async () => {
  const a = await userClient(DB, USER_A);
  try {
    const r1 = await tryInsertObject(a, `${fx.projA}/reports/photo1.jpg`);
    assert.equal(r1.rowCount, 1);
    const r2 = await tryInsertObject(a, `${fx.projA}/snags/photo2.jpg`);
    assert.equal(r2.rowCount, 1);
    const r3 = await tryInsertObject(a, `drawings/${fx.projA}/drawings/floorplan.webp`);
    assert.equal(r3.rowCount, 1);
    const r4 = await tryInsertObject(a, "org-logo/logo1.png");
    assert.equal(r4.rowCount, 1, "any org member may upload the shared company logo");
  } finally {
    await a.end();
  }
});

test("User A CANNOT upload into Organisation B's project, by any path shape", async () => {
  const a = await userClient(DB, USER_A);
  try {
    await assert.rejects(() => tryInsertObject(a, `${fx.projB}/reports/hacked.jpg`), (e) => isRlsError(e));
    await assert.rejects(() => tryInsertObject(a, `drawings/${fx.projB}/drawings/hacked.webp`), (e) => isRlsError(e));
  } finally {
    await a.end();
  }
});

test("A fabricated, non-existent project UUID in the path is rejected, not silently treated as public", async () => {
  const a = await userClient(DB, USER_A);
  try {
    await assert.rejects(
      () => tryInsertObject(a, "11111111-1111-1111-1111-111111111111/reports/hacked.jpg"),
      (e) => isRlsError(e)
    );
  } finally {
    await a.end();
  }
});

test("User A cannot DELETE Organisation B's files", async () => {
  const b = await userClient(DB, USER_B);
  await tryInsertObject(b, `${fx.projB}/reports/legit.jpg`);
  await b.end();

  const a = await userClient(DB, USER_A);
  try {
    const del = await a.query("delete from storage.objects where bucket_id = 'site-photos' and name = $1", [`${fx.projB}/reports/legit.jpg`]);
    assert.equal(del.rowCount, 0, "cross-org delete must affect 0 rows, not error silently succeed");
  } finally {
    await a.end();
  }

  const admin = adminClient(DB);
  await admin.connect();
  const still = await admin.query("select 1 from storage.objects where bucket_id='site-photos' and name = $1", [`${fx.projB}/reports/legit.jpg`]);
  assert.equal(still.rowCount, 1, "Org B's file must have survived the attempted cross-org delete");
  await admin.end();
});

test("Snagging-only member CAN upload snag photos but CANNOT upload to editor-only areas", async () => {
  const snagger = await userClient(DB, SNAGGER);
  try {
    const ok = await tryInsertObject(snagger, `${fx.projA}/snags/snag-photo.jpg`);
    assert.equal(ok.rowCount, 1, "snagging member should be able to upload a snag photo");

    await assert.rejects(() => tryInsertObject(snagger, `${fx.projA}/reports/not-allowed.jpg`), (e) => isRlsError(e));
    await assert.rejects(() => tryInsertObject(snagger, `drawings/${fx.projA}/drawings/not-allowed.webp`), (e) => isRlsError(e));
    await assert.rejects(() => tryInsertObject(snagger, `${fx.projB}/snags/hacked.jpg`), (e) => isRlsError(e), "snagging role never crosses organisations");
  } finally {
    await snagger.end();
  }
});

// ─── v58: private reads ─────────────────────────────────────────────

const LEGACY_PREFIX = "https://nkrgzmxwvydoridmiskl.supabase.co/storage/v1/object/public/site-photos/";

async function adminInsertObjects(names) {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    for (const name of names) {
      await admin.query(
        "insert into storage.objects (bucket_id, name) select 'site-photos', $1 where not exists (select 1 from storage.objects where bucket_id='site-photos' and name=$1)",
        [name]
      );
    }
  } finally {
    await admin.end();
  }
}

async function visibleNames(client, names) {
  const { rows } = await client.query(
    "select name from storage.objects where bucket_id = 'site-photos' and name = any($1::text[]) order by name",
    [names]
  );
  return rows.map((r) => r.name);
}

test("v58: the site-photos bucket is no longer public", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const { rows } = await admin.query("select public from storage.buckets where id = 'site-photos'");
    assert.equal(rows[0].public, false);
    const pol = await admin.query("select policyname, roles::text[] as roles from pg_policies where schemaname='storage' and tablename='objects' and cmd='SELECT' and qual like '%site-photos%'");
    assert.deepEqual(pol.rows.map((r) => r.policyname), ["project members read site-photos"], "the old public read policy must be gone");
    assert.deepEqual(pol.rows[0].roles, ["authenticated"]);
  } finally {
    await admin.end();
  }
});

test("v58: the anon role can no longer list or read ANY site-photos object (the confirmed live leak)", async () => {
  await adminInsertObjects([`${fx.projA}/reports/anon-check.jpg`, `${fx.projA}/hs-audits/anon-check.jpg`, "org-logo/anon-check.png"]);
  const anon = await anonClient(DB);
  try {
    const { rowCount } = await anon.query("select 1 from storage.objects where bucket_id = 'site-photos'");
    assert.equal(rowCount, 0);
  } finally {
    await anon.end();
  }
  const noSub = await userClient(DB, null);
  try {
    const { rowCount } = await noSub.query("select 1 from storage.objects where bucket_id = 'site-photos'");
    assert.equal(rowCount, 0, "an authenticated role with no identity sees nothing either");
  } finally {
    await noSub.end();
  }
});

test("v58: a project member can read every area of their own project (including drawings/ paths)", async () => {
  const names = [
    `${fx.projA}/reports/r.jpg`, `${fx.projA}/snags/s.jpg`, `${fx.projA}/handover/h.jpg`,
    `${fx.projA}/hs-audits/a.jpg`, `${fx.projA}/inspections/i.jpg`, `drawings/${fx.projA}/drawings/d.webp`,
  ];
  await adminInsertObjects(names);
  const a = await userClient(DB, USER_A);
  try {
    assert.deepEqual(await visibleNames(a, names), [...names].sort());
  } finally {
    await a.end();
  }
});

test("v58: a snagging-only member can read their project's photos (snags reuse report/finding photos) but never another org's", async () => {
  const own = [`${fx.projA}/snags/s2.jpg`, `${fx.projA}/reports/r2.jpg`];
  const other = [`${fx.projB}/snags/b-s.jpg`, `${fx.projB}/reports/b-r.jpg`];
  await adminInsertObjects([...own, ...other]);
  const snagger = await userClient(DB, SNAGGER);
  try {
    assert.deepEqual(await visibleNames(snagger, [...own, ...other]), [...own].sort());
  } finally {
    await snagger.end();
  }
});

test("v58: cross-organisation reads (and LISTING) are denied — a user only ever sees their own projects' objects", async () => {
  const bNames = [`${fx.projB}/reports/secret.jpg`, `drawings/${fx.projB}/site-layout/secret.webp`, `${fx.projB}/hs-audits/secret.jpg`];
  await adminInsertObjects(bNames);
  const a = await userClient(DB, USER_A);
  try {
    assert.deepEqual(await visibleNames(a, bNames), []);
    const { rows } = await a.query("select name from storage.objects where bucket_id = 'site-photos'");
    for (const { name } of rows) {
      assert.ok(!name.includes(fx.projB), `User A must not be able to list Org B's object ${name}`);
    }
  } finally {
    await a.end();
  }
});

test("v58: malformed / non-project paths are never readable", async () => {
  const names = ["11111111-1111-1111-1111-111111111111/reports/x.jpg", "random/thing.jpg", "drawings/not-a-uuid/x.webp"];
  await adminInsertObjects(names);
  const a = await userClient(DB, USER_A);
  try {
    assert.deepEqual(await visibleNames(a, names), []);
  } finally {
    await a.end();
  }
});

test("v58: an org logo is readable by its own org's members (legacy full-URL logo_url AND new bare-path logo_url), never by another org", async () => {
  await adminInsertObjects(["org-logo/logo-a.png", "org-logo/logo-b.png", "org-logo/orphan.png"]);
  const admin = adminClient(DB);
  await admin.connect();
  try {
    await admin.query("insert into public.org_settings (org_id, logo_url) values ($1, $2) on conflict (org_id) do update set logo_url = excluded.logo_url", [fx.orgA, `${LEGACY_PREFIX}org-logo/logo-a.png`]);
    await admin.query("insert into public.org_settings (org_id, logo_url) values ($1, $2) on conflict (org_id) do update set logo_url = excluded.logo_url", [fx.orgB, "org-logo/logo-b.png"]);
  } finally {
    await admin.end();
  }
  const all = ["org-logo/logo-a.png", "org-logo/logo-b.png", "org-logo/orphan.png"];

  const a = await userClient(DB, USER_A);
  try { assert.deepEqual(await visibleNames(a, all), ["org-logo/logo-a.png"]); } finally { await a.end(); }

  const b = await userClient(DB, USER_B);
  try { assert.deepEqual(await visibleNames(b, all), ["org-logo/logo-b.png"]); } finally { await b.end(); }

  // The snagging-only member of Org A's project sees Org A's logo on a
  // printed snag list, regardless of whether they're an org member.
  const snagger = await userClient(DB, SNAGGER);
  try { assert.deepEqual(await visibleNames(snagger, all), ["org-logo/logo-a.png"]); } finally { await snagger.end(); }
});

test("v58: site_photos_read_authorized is not callable by anon", async () => {
  const anon = await anonClient(DB);
  try {
    await assert.rejects(() => anon.query("select public.site_photos_read_authorized('x/y.jpg')"), /permission denied/i);
  } finally {
    await anon.end();
  }
});

test("v58: site_photos_ref_to_path() converts every stored reference shape to a bare object path", async () => {
  const admin = adminClient(DB);
  await admin.connect();
  try {
    const cases = [
      [`${LEGACY_PREFIX}abc/reports/x.jpg`, "abc/reports/x.jpg"],
      [`${LEGACY_PREFIX}drawings/abc/drawings/x.webp?v=1`, "drawings/abc/drawings/x.webp"],
      ["https://x.supabase.co/storage/v1/object/sign/site-photos/abc/snags/y.jpg?token=t", "abc/snags/y.jpg"],
      ["abc/snags/y.jpg", "abc/snags/y.jpg"],
      ["org-logo/l.png", "org-logo/l.png"],
      ["https://x.supabase.co/storage/v1/object/public/other-bucket/abc.jpg", null],
      ["data:image/png;base64,AAAA", null],
      ["", null],
      [null, null],
    ];
    for (const [input, expected] of cases) {
      const { rows } = await admin.query("select public.site_photos_ref_to_path($1) as p", [input]);
      assert.equal(rows[0].p, expected, `site_photos_ref_to_path(${JSON.stringify(input)})`);
    }
  } finally {
    await admin.end();
  }
});
