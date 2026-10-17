// v66: the Dayworks & Variations 'approver' role is removed. These tests
// run the REAL commercialCapabilities() and COMMERCIAL_ROLE_LABEL source
// from tracker/js/app.js (extracted, not reimplemented), and check no page
// still tells people to ask for or contact an "Approver".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url).pathname, "utf8");
const APP_JS = read("../../tracker/js/app.js");

function extractFunction(name) {
  const start = APP_JS.indexOf(`export function ${name}(`);
  assert.ok(start >= 0, `${name} not found in app.js`);
  let depth = 0, i = APP_JS.indexOf("{", start);
  for (; i < APP_JS.length; i++) {
    if (APP_JS[i] === "{") depth++;
    else if (APP_JS[i] === "}" && --depth === 0) break;
  }
  const src = APP_JS.slice(start, i + 1).replace(/^export /, "");
  return new Function(`${src}; return ${name};`)();
}

const commercialCapabilities = extractFunction("commercialCapabilities");

test("commercialCapabilities (v66): viewer can only view; contributor can view, edit, submit and approve", () => {
  assert.deepEqual(commercialCapabilities("viewer"), { role: "viewer", canView: true, canEdit: false, canSubmit: false, canApprove: false });
  assert.deepEqual(commercialCapabilities("contributor"), { role: "contributor", canView: true, canEdit: true, canSubmit: true, canApprove: true });
  for (const r of [null, undefined, "", "editor", "owner"]) {
    const c = commercialCapabilities(r);
    assert.equal(c.canView || c.canEdit || c.canSubmit || c.canApprove, false, `${r} must get nothing`);
  }
});

test("commercialCapabilities (v66): an old 'approver' grant (before v66 is applied) is treated exactly as contributor, so nobody loses access in the rollout window", () => {
  assert.deepEqual(commercialCapabilities("approver"), commercialCapabilities("contributor"));
});

test("COMMERCIAL_ROLE_LABEL (v66): only Viewer and Contributor", () => {
  const m = APP_JS.match(/export const COMMERCIAL_ROLE_LABEL = (\{[^}]*\});/);
  assert.ok(m);
  assert.deepEqual(new Function(`return ${m[1]}`)(), { viewer: "Viewer", contributor: "Contributor" });
});

test("Pages (v66): no user-facing text mentions an Approver role any more", () => {
  for (const page of ["project.html", "daywork-detail.html", "variation-detail.html", "commercial-dashboard.html"]) {
    const html = read(`../../tracker/${page}`);
    const visible = html.replace(/\/\/[^\n]*/g, "").replace(/r\.role === "approver"|grant\.role === "approver"/g, "");
    assert.ok(!/\bApprover\b/.test(visible), `${page} still shows "Approver"`);
    assert.ok(!/Variations approver/.test(visible), `${page} still says "contact your … approver"`);
  }
  assert.match(read("../../tracker/daywork-detail.html"), /contact the project owner/);
  assert.match(read("../../tracker/variation-detail.html"), /contact the project owner/);
});
