// Pure Actions-helper logic from app.js: due-date state classification
// and the client-side mirror of the server's status-transition table.
// Extracted via the same regex approach as tests/uploads/client.test.mjs
// (app.js can't be imported directly outside a browser — it imports the
// real Supabase client from esm.sh).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}
function extractFunction(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

const scope = `
  ${extractFunction("toLocalISODate")}
  ${extractFunction("todayISO")}
  ${extractConst("ACTION_STATUS_TRANSITIONS")}
  ${extractFunction("validActionStatusTransitions")}
  ${extractFunction("actionDueState")}
  return { actionDueState, validActionStatusTransitions };
`;
const { actionDueState, validActionStatusTransitions } = new Function(scope)();

test("actionDueState: overdue when due_date is before today", () => {
  assert.equal(actionDueState({ status: "open", due_date: "2026-01-01" }, "2026-09-10"), "overdue");
});

test("actionDueState: due today when due_date equals today", () => {
  assert.equal(actionDueState({ status: "in_progress", due_date: "2026-09-10" }, "2026-09-10"), "due_today");
});

test("actionDueState: upcoming when due_date is in the future", () => {
  assert.equal(actionDueState({ status: "blocked", due_date: "2026-12-25" }, "2026-09-10"), "upcoming");
});

test("actionDueState: completed overrides an overdue due_date", () => {
  assert.equal(actionDueState({ status: "completed", due_date: "2020-01-01" }, "2026-09-10"), "completed");
});

test("actionDueState: cancelled overrides an overdue due_date", () => {
  assert.equal(actionDueState({ status: "cancelled", due_date: "2020-01-01" }, "2026-09-10"), "cancelled");
});

test("actionDueState: no due date and still active is 'none'", () => {
  assert.equal(actionDueState({ status: "open", due_date: null }, "2026-09-10"), "none");
});

test("validActionStatusTransitions: mirrors the server's fixed transition table", () => {
  assert.deepEqual(validActionStatusTransitions("open").sort(), ["cancelled", "completed", "in_progress"].sort());
  assert.deepEqual(validActionStatusTransitions("in_progress").sort(), ["blocked", "cancelled", "completed"].sort());
  assert.deepEqual(validActionStatusTransitions("blocked").sort(), ["cancelled", "in_progress"].sort());
  assert.deepEqual(validActionStatusTransitions("completed"), ["open"]);
  assert.deepEqual(validActionStatusTransitions("cancelled"), []);
});
