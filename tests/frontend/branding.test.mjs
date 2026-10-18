// Branding regression (The Site Office rename) — guards against the old
// "Site Tracker" name creeping back into any tracker/*.html <title> or the
// shared brand lockup in renderHeader(), since nothing else in the suite
// would catch a one-off revert of either.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const TRACKER_DIR = new URL("../../tracker/", import.meta.url).pathname;

test("no tracker page title contains the old brand name", () => {
  const files = fs.readdirSync(TRACKER_DIR).filter((f) => f.endsWith(".html"));
  assert.ok(files.length > 0, "expected to find tracker/*.html pages");
  for (const file of files) {
    const html = fs.readFileSync(path.join(TRACKER_DIR, file), "utf8");
    const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
    assert.ok(titleMatch, `${file} has no <title> tag`);
    assert.ok(
      !/site tracker/i.test(titleMatch[1]),
      `${file}'s <title> still says "Site Tracker": ${titleMatch[1]}`
    );
  }
});

test("the shared header brand lockup is The Site Office, not Site Tracker", () => {
  const appJs = fs.readFileSync(path.join(TRACKER_DIR, "js", "app.js"), "utf8");
  const brandMatch = appJs.match(/class="brand">([\s\S]*?)<\/a>/);
  assert.ok(brandMatch, "renderHeader() brand lockup not found in app.js");
  assert.ok(!/site tracker/i.test(brandMatch[1]), "brand lockup still says Site Tracker");
  assert.match(brandMatch[1], /THE SITE/, "brand lockup should read THE SITE OFFICE");
});
