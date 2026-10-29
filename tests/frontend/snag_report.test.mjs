// v82: snag-report.html — a customisable snag trends report (scope by
// plot/whole site, a date range, trend/trade/room/status/priority
// breakdowns, a ranked plot table and repeated-issue tracking), built
// as a mockup first and approved by Aled before this real version. The
// "Print / Save as PDF" and "Email to Main Contractor" buttons follow
// the exact same convention as snagging-report.html/snag-list-view.html
// (document.title as filename, mailto: with a "see attached" body).
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const HTML = new URL("../../tracker/snag-report.html", import.meta.url).pathname;

const SNAG_STATUS_LABEL = { open: "Open", pending_review: "Pending Review", closed: "Closed", rejected: "Rejected" };

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function makeProject(overrides = {}) {
  return {
    id: "p1", name: "Heol Crwys", org_id: "org1", main_contractor_email: "contractor@example.com",
    main_contractor_name: "ABC Builders", contract_ref: "HC-2026", ...overrides,
  };
}

function daysAgoISO(n) {
  const d = new Date("2026-10-29"); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function snag(id, overrides = {}) {
  return {
    id, item_no: 1, location: "Kitchen", description: "Paint touch-up required", trade: "Painter & Decorator",
    priority: "medium", status: "open", raised_date: daysAgoISO(10), closed_date: null, due_date: null,
    plot_id: null, snag_lists: { plot_id: "plotA" }, ...overrides,
  };
}

function makeSupabase(store) {
  return {
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        single: async () => (table === "projects" ? { data: store.project, error: null } : { data: null, error: null }),
        then(resolve) {
          if (table === "plots") return resolve({ data: store.plots, error: null });
          if (table === "snag_items") return resolve({ data: store.snags, error: null });
          resolve({ data: [], error: null });
        },
      };
      return api;
    },
  };
}

async function run(store) {
  return runPage(HTML, extractScript(HTML), {
    __url: "https://example.com/snag-report.html?project=p1",
    supabase: makeSupabase(store),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: () => "p1",
    escapeHtml,
    formatDate: (d) => d || "",
    todayISO: () => "2026-10-29",
    getOrgLogoUrl: async () => null,
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }),
    SNAG_STATUS_LABEL,
  });
}

test("loads the project, plots and snags, and renders summary totals for the default (whole site, 90 days) scope", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }, { id: "plotB", plot_number: "6" }],
    snags: [
      snag("s1", { status: "open", snag_lists: { plot_id: "plotA" } }),
      snag("s2", { status: "closed", closed_date: daysAgoISO(2), snag_lists: { plot_id: "plotB" } }),
    ],
  };
  const { document } = await run(store);
  await wait(30);

  const facts = [...document.querySelectorAll(".doc-facts dd")].map((el) => el.textContent);
  assert.equal(facts[0], "2", "Total Snags");
  assert.equal(facts[1], "1", "Currently Open");
});

test("scope chips: picking a specific plot excludes snags from other plots", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }, { id: "plotB", plot_number: "6" }],
    snags: [
      snag("s1", { snag_lists: { plot_id: "plotA" } }),
      snag("s2", { snag_lists: { plot_id: "plotB" } }),
    ],
  };
  const { document } = await run(store);
  await wait(30);

  const chips = [...document.querySelectorAll("#plotChips .chip")];
  const plot5Chip = chips.find((c) => c.textContent === "5");
  assert.ok(plot5Chip, "a chip for plot 5 must exist");
  plot5Chip.click();
  await wait(20);

  assert.equal(document.querySelectorAll(".doc-facts dd")[0].textContent, "1", "only plot 5's own snag should count");
});

test("a snag with no plot at all (true site-wide) is included in Whole Site but excluded once a specific plot is selected", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }],
    snags: [
      snag("s1", { snag_lists: { plot_id: "plotA" } }),
      snag("s2", { plot_id: null, snag_lists: { plot_id: null } }),
    ],
  };
  const { document } = await run(store);
  await wait(30);

  assert.equal(document.querySelectorAll(".doc-facts dd")[0].textContent, "2", "Whole Site counts the site-wide snag too");

  document.querySelector('#plotChips .chip[aria-pressed]').nextSibling; // no-op, just ensures chips rendered
  const plot5Chip = [...document.querySelectorAll("#plotChips .chip")].find((c) => c.textContent === "5");
  plot5Chip.click();
  await wait(20);
  assert.equal(document.querySelectorAll(".doc-facts dd")[0].textContent, "1", "a site-wide snag with no plot tag isn't attributable to Plot 5");
});

test("date range: switching to 30 days excludes a snag raised 60 days ago", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }],
    snags: [
      snag("s1", { raised_date: daysAgoISO(10) }),
      snag("s2", { raised_date: daysAgoISO(60) }),
    ],
  };
  const { document } = await run(store);
  await wait(30);
  assert.equal(document.querySelectorAll(".doc-facts dd")[0].textContent, "2");

  const btn30 = [...document.querySelectorAll("#rangeSeg .seg-btn")].find((b) => b.dataset.range === "30");
  btn30.click();
  await wait(20);
  assert.equal(document.querySelectorAll(".doc-facts dd")[0].textContent, "1", "the 60-day-old snag falls outside a 30-day range");
});

test("overdue count only includes open snags past their due date", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }],
    snags: [
      snag("s1", { status: "open", due_date: daysAgoISO(5) }),       // overdue
      snag("s2", { status: "open", due_date: daysAgoISO(-5) }),      // due in the future, not overdue
      snag("s3", { status: "closed", due_date: daysAgoISO(5), closed_date: daysAgoISO(1) }), // closed, not overdue even though past due
    ],
  };
  const { document } = await run(store);
  await wait(30);
  const overdue = document.querySelectorAll(".doc-facts dd")[2].textContent;
  assert.equal(overdue, "1");
});

test("average days to close is computed only from snags that are actually closed", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }],
    snags: [
      snag("s1", { status: "closed", raised_date: daysAgoISO(10), closed_date: daysAgoISO(4) }), // 6 days
      snag("s2", { status: "closed", raised_date: daysAgoISO(20), closed_date: daysAgoISO(16) }), // 4 days
      snag("s3", { status: "open" }), // ignored — not closed
    ],
  };
  const { document } = await run(store);
  await wait(30);
  const avg = document.querySelectorAll(".doc-facts dd")[3].textContent;
  assert.equal(avg, "5.0");
});

test("the By Plot table only appears once more than one plot is actually represented in scope", async () => {
  const single = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }],
    snags: [snag("s1", { snag_lists: { plot_id: "plotA" } })],
  };
  const { document: doc1 } = await run(single);
  await wait(30);
  assert.ok(![...doc1.querySelectorAll("h3")].some((h) => h.textContent === "By Plot"), "a single-plot scope shouldn't show a plot comparison table");

  const multi = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }, { id: "plotB", plot_number: "6" }],
    snags: [snag("s1", { snag_lists: { plot_id: "plotA" } }), snag("s2", { snag_lists: { plot_id: "plotB" } })],
  };
  const { document: doc2 } = await run(multi);
  await wait(30);
  assert.ok([...doc2.querySelectorAll("h3")].some((h) => h.textContent === "By Plot"));
});

test("a plot with open-snag count well above the site average is flagged", async () => {
  const snags = [];
  for (let i = 0; i < 2; i++) snags.push(snag(`a${i}`, { status: "open", snag_lists: { plot_id: "plotA" } }));
  for (let i = 0; i < 8; i++) snags.push(snag(`b${i}`, { status: "open", snag_lists: { plot_id: "plotB" } }));
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }, { id: "plotB", plot_number: "6" }],
    snags,
  };
  const { document } = await run(store);
  await wait(30);
  const rows = [...document.querySelectorAll(".snag-table tbody tr")];
  const plot6Row = rows.find((r) => r.textContent.includes("6"));
  assert.ok(plot6Row.querySelector(".row-flag"), "Plot 6, well above average, should be flagged");
  const plot5Row = rows.find((r) => r.textContent.includes("5") && !r.textContent.includes("6"));
  assert.ok(!plot5Row.querySelector(".row-flag"));
});

test("Most Common Issues only lists descriptions that actually repeat, sorted by frequency", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }],
    snags: [
      snag("s1", { description: "Grout missing" }),
      snag("s2", { description: "Grout missing" }),
      snag("s3", { description: "Grout missing" }),
      snag("s4", { description: "Door sticks" }),
      snag("s5", { description: "Door sticks" }),
      snag("s6", { description: "One-off unique issue" }),
    ],
  };
  const { document } = await run(store);
  await wait(30);
  const rows = [...document.querySelectorAll(".issue-row")];
  assert.equal(rows.length, 2, "only the two repeated descriptions, not the one-off");
  assert.match(rows[0].querySelector(".issue-text").textContent, /Grout missing/);
  assert.match(rows[0].querySelector(".issue-count").textContent, /3 times/);
});

test("document.title (the Save as PDF filename) and the mailto link reflect the current scope", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }],
    snags: [snag("s1")],
  };
  const { document } = await run(store);
  await wait(30);

  assert.match(document.title, /^Snag Report - Heol Crwys - Whole Site — Last 90 Days/);
  const href = document.getElementById("emailLink").getAttribute("href");
  assert.match(href, /^mailto:contractor@example\.com\?/);
  assert.match(decodeURIComponent(href), /Heol Crwys/);
});

test("a malicious description or location renders as inert text, never as HTML", async () => {
  const store = {
    project: makeProject(),
    plots: [{ id: "plotA", plot_number: "5" }],
    snags: [
      snag("s1", { description: '<img src=x onerror=alert(1)>Grout missing', location: '<script>alert(2)</script>Kitchen' }),
      snag("s2", { description: '<img src=x onerror=alert(1)>Grout missing' }),
    ],
  };
  const { document } = await run(store);
  await wait(30);
  const html = document.getElementById("doc").innerHTML;
  assert.ok(!html.includes("<img src=x"), "a malicious description must never reach the page as raw HTML");
  assert.ok(!html.includes("<script>alert(2)"), "a malicious location must never reach the page as raw HTML");
});
