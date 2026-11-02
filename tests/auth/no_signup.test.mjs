// v84: self-service sign-up is gone (Supabase itself has "Allow new
// users to sign up" turned off — see handover/NOTES.md). A brand-new
// account can now only come from a company invite
// (tracker/invite-password.html, via the invite-party-user Edge
// Function) or from Aled directly in Supabase. This is a sitewide
// regression guard: no page, anywhere in the public site or the app,
// should offer or silently depend on supabase.auth.signUp() again.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const ROOT = new URL("../../", import.meta.url).pathname;
const TRACKER_DIR = path.join(ROOT, "tracker");

function allHtmlFiles() {
  const rootPages = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html")).map((f) => path.join(ROOT, f));
  const trackerPages = fs.readdirSync(TRACKER_DIR).filter((f) => f.endsWith(".html")).map((f) => path.join(TRACKER_DIR, f));
  return [...rootPages, ...trackerPages];
}

test("no page anywhere links to login.html?mode=signup", () => {
  for (const file of allHtmlFiles()) {
    const html = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(html, /mode=signup/i, `${path.basename(file)} still links to sign-up mode`);
  }
});

test("no tracker page's own script calls supabase.auth.signUp", () => {
  for (const file of fs.readdirSync(TRACKER_DIR).filter((f) => f.endsWith(".html"))) {
    const html = fs.readFileSync(path.join(TRACKER_DIR, file), "utf8");
    assert.doesNotMatch(html, /\.signUp\s*\(/, `${file} must never call supabase.auth.signUp`);
  }
});

test("the front page (index.html) has no 'Create one' / sign-up link or toggle", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  assert.doesNotMatch(html, /id="signUpLink"/);
  assert.doesNotMatch(html, />Create one</);
});

test("login.html has no sign-up toggle button or row left in its markup", () => {
  const html = fs.readFileSync(path.join(TRACKER_DIR, "login.html"), "utf8");
  assert.doesNotMatch(html, /id="toggleBtn"/);
  assert.doesNotMatch(html, /id="signupToggleRow"/);
});
