// Photo Round-Up — snag-list-view.html's printable snag list appendix.
// At the end of the document, every snag with a photo gets a larger
// image (4 per page, 2x2), captioned with its item number and location,
// while the existing small thumbnail column in the main table is left
// untouched. Follows the same real-inline-script-under-jsdom convention
// as the other snag frontend tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { extractScript, runPage, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/snag-list-view.html", import.meta.url).pathname;

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const SNAG_STATUS_LABEL = extractConst("SNAG_STATUS_LABEL");
const SNAG_STATUS_BADGE = extractConst("SNAG_STATUS_BADGE");

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function makeSnagList() {
  return {
    id: "l1", plot_id: "plotA", title: "General",
    projects: { id: "p1", name: "Test Site", org_id: "org1", main_contractor_email: null, main_contractor_name: null, contract_ref: null },
    plots: { id: "plotA", plot_number: "5" },
  };
}

function makeSupabase(store) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        single: async () => (table === "snag_lists" ? { data: store.snagList, error: null } : { data: null, error: null }),
        then(resolve) {
          if (table === "snag_items") return resolve({ data: store.snags, error: null });
          resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
}

async function run(snags) {
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/snag-list-view.html?id=l1",
    supabase: makeSupabase({ snagList: makeSnagList(), snags }),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "l1",
    escapeHtml,
    formatDate: (d) => d || "",
    todayISO: () => "2026-01-01",
    getOrgLogoUrl: async () => null,
    isSnagOutstanding: (s) => !["closed", "rejected"].includes(s.status),
    SNAG_STATUS_LABEL, SNAG_STATUS_BADGE,
  });
}

function snagWithPhoto(id, item_no, overrides = {}) {
  return {
    id, item_no, location: `Loc ${item_no}`, description: `Desc ${item_no}`, trade: "General",
    status: "open", photo_url: `https://example.com/photo${item_no}.jpg`, raised_date: "2026-01-01",
    delay_flag: false, delay_reason: null, ...overrides,
  };
}

function snagWithoutPhoto(id, item_no, overrides = {}) {
  return {
    id, item_no, location: `Loc ${item_no}`, description: `Desc ${item_no}`, trade: "General",
    status: "open", photo_url: null, raised_date: "2026-01-01",
    delay_flag: false, delay_reason: null, ...overrides,
  };
}

test("no Photo Round-Up section appears when no snag has a photo", async () => {
  const { document } = await run([snagWithoutPhoto("s1", 1)]);
  await wait(30);
  assert.ok(!document.getElementById("doc").innerHTML.includes("Photo Round-Up"));
});

test("the round-up shows every snag with a photo in a larger format, captioned with its item number and location", async () => {
  const { document } = await run([snagWithPhoto("s1", 1), snagWithPhoto("s2", 2), snagWithPhoto("s3", 3)]);
  await wait(30);

  const doc = document.getElementById("doc");
  assert.ok(doc.innerHTML.includes("Photo Round-Up"));

  const groups = doc.querySelectorAll(".photo-roundup-group");
  assert.equal(groups.length, 1, "3 photos fit in a single group");

  const cards = doc.querySelectorAll(".photo-roundup-group .photo-card");
  assert.equal(cards.length, 3);
  const tags = [...cards].map((c) => c.querySelector(".photo-card-tag").textContent);
  assert.deepEqual(tags, ["#1 — Loc 1", "#2 — Loc 2", "#3 — Loc 3"]);
});

test("photos are grouped 4 per page — a 5th photo starts a new group", async () => {
  const snags = [1, 2, 3, 4, 5].map((n) => snagWithPhoto(`s${n}`, n));
  const { document } = await run(snags);
  await wait(30);

  const groups = document.getElementById("doc").querySelectorAll(".photo-roundup-group");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].querySelectorAll(".photo-card").length, 4);
  assert.equal(groups[1].querySelectorAll(".photo-card").length, 1);
});

test("exactly 8 photos fill two full groups of 4, with no trailing empty group", async () => {
  const snags = Array.from({ length: 8 }, (_, i) => snagWithPhoto(`s${i + 1}`, i + 1));
  const { document } = await run(snags);
  await wait(30);

  const groups = document.getElementById("doc").querySelectorAll(".photo-roundup-group");
  assert.equal(groups.length, 2);
  assert.equal(groups[0].querySelectorAll(".photo-card").length, 4);
  assert.equal(groups[1].querySelectorAll(".photo-card").length, 4);
});

test("snags without a photo are skipped in the round-up but still appear in the main table", async () => {
  const snags = [snagWithPhoto("s1", 1), snagWithoutPhoto("s2", 2), snagWithPhoto("s3", 3)];
  const { document } = await run(snags);
  await wait(30);

  const doc = document.getElementById("doc");
  const tableRows = doc.querySelectorAll(".snag-table tbody tr");
  assert.equal(tableRows.length, 3, "the main table still lists every snag, photo or not");

  const cards = doc.querySelectorAll(".photo-roundup-group .photo-card");
  assert.equal(cards.length, 2);
  const tags = [...cards].map((c) => c.querySelector(".photo-card-tag").textContent);
  assert.deepEqual(tags, ["#1 — Loc 1", "#3 — Loc 3"]);
});

test("the round-up includes closed and rejected snags too, not just outstanding ones", async () => {
  const snags = [
    snagWithPhoto("s1", 1, { status: "closed" }),
    snagWithPhoto("s2", 2, { status: "rejected" }),
    snagWithPhoto("s3", 3, { status: "open" }),
  ];
  const { document } = await run(snags);
  await wait(30);

  const cards = document.getElementById("doc").querySelectorAll(".photo-roundup-group .photo-card");
  assert.equal(cards.length, 3);
});

test("the existing small thumbnail in the main table is kept alongside the larger round-up photo", async () => {
  const { document } = await run([snagWithPhoto("s1", 1)]);
  await wait(30);

  const doc = document.getElementById("doc");
  const tableThumb = doc.querySelector(".snag-table tbody img");
  const roundupPhoto = doc.querySelector(".photo-roundup-group .photo-card img");
  assert.ok(tableThumb, "the main table still has its photo thumbnail cell");
  assert.ok(roundupPhoto, "the round-up has a larger copy of the same photo");
  assert.equal(tableThumb.getAttribute("src"), "https://example.com/photo1.jpg");
  assert.equal(roundupPhoto.getAttribute("src"), "https://example.com/photo1.jpg");
});

test("each round-up card shows the snag's status badge and description", async () => {
  const { document } = await run([snagWithPhoto("s1", 1, { status: "pending_review", description: "Cracked tile" })]);
  await wait(30);

  const card = document.querySelector(".photo-roundup-group .photo-card");
  assert.match(card.querySelector(".badge").textContent, /Pending Review|pending_review/i);
  assert.equal(card.querySelector(".photo-card-caption").textContent, "Cracked tile");
});
