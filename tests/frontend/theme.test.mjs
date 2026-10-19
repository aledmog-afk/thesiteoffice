// Colour scheme switcher (Settings → Appearance). Three things under
// test, each against the REAL source rather than a reimplementation:
//   1. getTheme()/setTheme()/THEME_OPTIONS (tracker/js/app.js) — the
//      localStorage-backed preference store used once the page is
//      already interactive (the Settings picker itself).
//   2. tracker/js/theme-init.js — the separate, deliberately
//      non-module anti-flash bootstrap loaded first in every page's
//      <head>, which can't share code with app.js (a module's
//      execution is deferred, which is exactly the flash it exists to
//      prevent) — so its own small logic needs its own test.
//   3. The real settings.html page script wiring the picker UI up to
//      those functions.
import fs from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");
const THEME_INIT_JS = fs.readFileSync(new URL("../../tracker/js/theme-init.js", import.meta.url).pathname, "utf8");

function extractConst(name) {
  const m = APP_JS.match(new RegExp(`export const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
function extractFunction(name) {
  const m = APP_JS.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return m[0].replace(/^export /, "");
}

function makeLocalStorage(initial = {}) {
  const store = { ...initial };
  return {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    __store: store,
  };
}

function makeDocumentElement() {
  const attrs = {};
  return {
    setAttribute: (k, v) => { attrs[k] = v; },
    removeAttribute: (k) => { delete attrs[k]; },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    hasAttribute: (k) => k in attrs,
  };
}

// ─── THEME_OPTIONS ───────────────────────────────────────────────────

test("THEME_OPTIONS: exactly the 4 named schemes, each with a value/label/swatch, 'default' first", () => {
  const options = extractConst("THEME_OPTIONS");
  assert.equal(options.length, 4);
  assert.deepEqual(options.map((o) => o.value), ["default", "dark", "ocean", "forest"]);
  for (const o of options) {
    assert.ok(o.label, `${o.value} has a label`);
    assert.match(o.swatch, /^#[0-9a-f]{6}$/i, `${o.value}'s swatch is a real hex colour`);
  }
});

// ─── getTheme()/setTheme() ───────────────────────────────────────────

function makeThemeFns(localStorage, documentElement) {
  const src = `
    ${extractFunction("getTheme")}
    ${extractFunction("setTheme")}
    return { getTheme, setTheme };
  `;
  return new Function("localStorage", "document", src)(localStorage, { documentElement });
}

test("getTheme(): returns 'default' when nothing is stored", () => {
  const { getTheme } = makeThemeFns(makeLocalStorage(), makeDocumentElement());
  assert.equal(getTheme(), "default");
});

test("getTheme(): returns whatever was previously stored", () => {
  const { getTheme } = makeThemeFns(makeLocalStorage({ theme: "ocean" }), makeDocumentElement());
  assert.equal(getTheme(), "ocean");
});

test("getTheme(): a blocked localStorage (throws on access) falls back to 'default' instead of throwing", () => {
  const throwingStorage = { getItem() { throw new Error("blocked"); } };
  const { getTheme } = makeThemeFns(throwingStorage, makeDocumentElement());
  assert.equal(getTheme(), "default");
});

test("setTheme(): a non-default value is persisted AND sets data-theme on <html> immediately", () => {
  const localStorage = makeLocalStorage();
  const documentElement = makeDocumentElement();
  const { setTheme } = makeThemeFns(localStorage, documentElement);
  setTheme("dark");
  assert.equal(localStorage.__store.theme, "dark");
  assert.equal(documentElement.getAttribute("data-theme"), "dark");
});

test("setTheme('default'): persists 'default' but REMOVES the data-theme attribute (falls through to the default :root rules, not a :root[data-theme=\"default\"] block that doesn't exist)", () => {
  const localStorage = makeLocalStorage();
  const documentElement = makeDocumentElement();
  const { setTheme } = makeThemeFns(localStorage, documentElement);
  documentElement.setAttribute("data-theme", "dark"); // simulate switching back from a non-default theme
  setTheme("default");
  assert.equal(localStorage.__store.theme, "default");
  assert.equal(documentElement.hasAttribute("data-theme"), false);
});

test("setTheme(): a blocked localStorage still applies the attribute for this page view, it just doesn't throw or lose the visual change", () => {
  const throwingStorage = { setItem() { throw new Error("blocked"); } };
  const documentElement = makeDocumentElement();
  const { setTheme } = makeThemeFns(throwingStorage, documentElement);
  assert.doesNotThrow(() => setTheme("forest"));
  assert.equal(documentElement.getAttribute("data-theme"), "forest");
});

// ─── theme-init.js (the anti-flash bootstrap) ────────────────────────

function runThemeInit(localStorage, documentElement) {
  new Function("localStorage", "document", THEME_INIT_JS)(localStorage, { documentElement });
}

test("theme-init.js: no stored preference — data-theme is never set (default scheme applies via plain :root)", () => {
  const documentElement = makeDocumentElement();
  runThemeInit(makeLocalStorage(), documentElement);
  assert.equal(documentElement.hasAttribute("data-theme"), false);
});

test("theme-init.js: a stored 'default' also leaves data-theme unset", () => {
  const documentElement = makeDocumentElement();
  runThemeInit(makeLocalStorage({ theme: "default" }), documentElement);
  assert.equal(documentElement.hasAttribute("data-theme"), false);
});

test("theme-init.js: a stored non-default scheme sets data-theme BEFORE anything else runs — this is the whole anti-flash point", () => {
  const documentElement = makeDocumentElement();
  runThemeInit(makeLocalStorage({ theme: "dark" }), documentElement);
  assert.equal(documentElement.getAttribute("data-theme"), "dark");
});

test("theme-init.js: a blocked/throwing localStorage never crashes the page — falls back to the default scheme", () => {
  const documentElement = makeDocumentElement();
  const throwingStorage = { getItem() { throw new Error("private browsing"); } };
  assert.doesNotThrow(() => runThemeInit(throwingStorage, documentElement));
  assert.equal(documentElement.hasAttribute("data-theme"), false);
});

// ─── settings.html: the Appearance picker UI ─────────────────────────

const SETTINGS_HTML = new URL("../../tracker/settings.html", import.meta.url).pathname;

function makeSupabase() {
  return {
    from() {
      const api = {
        select() { return api; }, eq() { return api; },
        single: async () => ({ data: { name: "Acme Ltd" }, error: null }),
        maybeSingle: async () => ({ data: null, error: null }),
      };
      return api;
    },
  };
}

async function runSettings({ activeTheme = "default", reactive = false } = {}) {
  const setThemeCalls = [];
  let current = activeTheme;
  const result = await runPage(SETTINGS_HTML, extractScript(SETTINGS_HTML), {
    __url: "https://example.com/settings.html",
    supabase: makeSupabase(),
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    showError: () => {}, clearError: () => {},
    escapeHtml: (s) => String(s ?? ""),
    formatDate: (d) => d || "",
    uploadPhoto: async () => "",
    getPrimaryOrganisation: async () => "org1",
    getOrganisationMembers: async () => [],
    getOrganisationMembershipRequests: async () => [],
    approveOrganisationMembership: async () => {},
    rejectOrganisationMembership: async () => {},
    THEME_OPTIONS: [
      { value: "default", label: "Site Office", swatch: "#e8a020" },
      { value: "dark", label: "Dark", swatch: "#1c1f27" },
      { value: "ocean", label: "Ocean", swatch: "#1a4fa0" },
      { value: "forest", label: "Forest", swatch: "#1e6b3c" },
    ],
    getTheme: () => current,
    setTheme: (v) => { setThemeCalls.push(v); if (reactive) current = v; },
  });
  return { ...result, setThemeCalls };
}

test("settings.html: renders one swatch per THEME_OPTIONS entry, with the active one marked", async () => {
  const { document } = await runSettings({ activeTheme: "ocean" });
  await wait(30);
  const swatches = document.querySelectorAll(".theme-swatch");
  assert.equal(swatches.length, 4);
  const active = document.querySelector(".theme-swatch.active");
  assert.ok(active, "exactly one swatch is marked active");
  assert.equal(active.dataset.themeValue, "ocean");
});

test("settings.html: clicking a different swatch calls setTheme() with that swatch's value", async () => {
  const { document, setThemeCalls } = await runSettings({ activeTheme: "default" });
  await wait(30);
  const darkSwatch = [...document.querySelectorAll(".theme-swatch")].find((el) => el.dataset.themeValue === "dark");
  fireEvent(darkSwatch, "click");
  await wait(20);
  assert.deepEqual(setThemeCalls, ["dark"]);
});

test("settings.html: after clicking a swatch, the grid re-renders so the NEW swatch (and only that one) shows as active", async () => {
  const { document } = await runSettings({ activeTheme: "default", reactive: true });
  await wait(30);
  const forestSwatch = [...document.querySelectorAll(".theme-swatch")].find((el) => el.dataset.themeValue === "forest");
  fireEvent(forestSwatch, "click");
  await wait(20);
  const activeSwatches = document.querySelectorAll(".theme-swatch.active");
  assert.equal(activeSwatches.length, 1, "exactly one swatch is active after the click");
  assert.equal(activeSwatches[0].dataset.themeValue, "forest");
});
