// Shared harness for testing a tracker/*.html page's real inline
// <script type="module"> body under jsdom — never a reimplementation of
// the page's logic. Extracts the exact script text, drops its `import`
// line (the test supplies those bindings directly, e.g. a mock
// `supabase`), and runs it inside a vm context standing in for `window`.
import fs from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

// Extracts a page's module script body, with its `import { ... } from`
// line(s) removed — the caller provides equivalent bindings via `context`.
export function extractScript(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const match = html.match(/<script type="module">([\s\S]*?)<\/script>/);
  if (!match) throw new Error(`No <script type="module"> found in ${htmlPath}`);
  return match[1]
    .split("\n")
    .filter((line) => !/^\s*import\s.*from\s/.test(line))
    .join("\n");
}

export function bodyWithoutScript(htmlPath) {
  return fs.readFileSync(htmlPath, "utf8").replace(/<script type="module">[\s\S]*?<\/script>/, "");
}

// Runs `scriptSrc` (from extractScript) against a fresh JSDOM built from
// `htmlPath`'s markup (minus its own script tag), inside a vm context
// pre-wired with the platform globals a vm.createContext() does NOT
// provide by default (URL, setTimeout/clearTimeout) plus whatever the
// caller passes in `context` (mocked supabase, app.js helpers, etc).
// Waits for the script's own top-level async IIFE to finish, then
// returns { document, window } for the test to interact with further.
export async function runPage(htmlPath, scriptSrc, context = {}) {
  const dom = new JSDOM(bodyWithoutScript(htmlPath), { url: context.__url || "https://example.com/", runScripts: "outside-only" });
  const { window } = dom;
  const document = window.document;

  const fullContext = {
    window,
    document,
    console,
    URL,
    setTimeout,
    clearTimeout,
    crypto: globalThis.crypto,
    // v62 default: report pages behave as for the owner side (commercial
    // notes shown, report objects untouched) unless a test overrides it.
    attachReportCommercialNotes: async () => true,
    // v85 default: no diary entries attached/pullable unless a test
    // overrides it — keeps every pre-existing weekly-report-form.html/
    // weekly-report-view.html test working without having to know
    // about this feature at all.
    getWeeklyReportDiaryEntries: async () => [],
    getUnattachedDiaryEntries: async () => [],
    attachDiaryEntryToReport: async () => ({}),
    updateAttachedDiaryEntry: async () => ({}),
    removeAttachedDiaryEntry: async () => {},
    // v93 defaults: "no active programme" everywhere until a test says
    // otherwise, and the real computeProgrammeComplete() (see above) so
    // calling it against an empty/default activities list behaves
    // exactly as the real page does.
    getActiveProgramme: async () => null,
    listProgrammeActivities: async () => [],
    computeProgrammeComplete: DEFAULT_COMPUTE_PROGRAMME_COMPLETE,
    // v94: dashboard.html's own tile drill-down needs this directly.
    categoriseProgrammeActivity: DEFAULT_CATEGORISE_PROGRAMME_ACTIVITY,
    // v97: weekly-report-form.html/weekly-report-view.html need this
    // directly whenever they render any system position.
    isWeeklyReportEarlyWarningsCalculated: DEFAULT_IS_EARLY_WARNINGS_CALCULATED,
    // v98: weekly-report-form.html needs this directly on every save.
    buildEarlyWarningNotes: DEFAULT_BUILD_EARLY_WARNING_NOTES,
    // v100: weekly-report-form.html/weekly-report-view.html need this
    // directly whenever they render any system position.
    isWeeklyReportProgrammeRevisionsCalculated: DEFAULT_IS_PROGRAMME_REVISIONS_CALCULATED,
    ...context,
  };
  const ctx = vm.createContext(fullContext);
  const wrapped = `(async () => {\n${scriptSrc}\n})().then(() => { window.__done = true; }).catch((e) => { window.__err = e; });`;
  vm.runInContext(wrapped, ctx);

  for (let i = 0; i < 100 && !window.__done && !window.__err; i++) {
    await new Promise((r) => setTimeout(r, 10));
  }
  if (window.__err) throw window.__err;
  await new Promise((r) => setTimeout(r, 20));
  return { document, window };
}

export function fireEvent(el, type, opts = {}) {
  const win = el.ownerDocument.defaultView;
  el.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true, ...opts }));
}

export async function wait(ms) {
  await new Promise((r) => setTimeout(r, ms));
}

// The real safeNextPage() body from tracker/js/app.js (pages that read
// ?next= import it; the harness strips imports, so tests hand it in).
// Returns null if app.js has no such function.
export function loadSafeNextPage() {
  const src = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");
  const m = src.match(/export function safeNextPage\([\s\S]*?\n\}/);
  return m ? new Function(`return ${m[0].replace(/^export /, "")}`)() : null;
}

// The real computeProgrammeComplete() (v93) from tracker/js/app.js,
// extracted the same way loadSafeNextPage() is above, plus its two
// private dependencies (programmeActivityDurationWeight/
// diffCalendarDays) — never a reimplementation that could drift from
// the real one. Used as runPage()'s default binding below so every
// pre-existing test of a page that now imports computeProgrammeComplete
// (dashboard.html, project.html, programme.html) keeps working without
// having to know about this feature at all, the same reasoning the
// v85 diary defaults above already established.
function loadComputeProgrammeComplete() {
  const src = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");
  const diffFn = src.match(/function diffCalendarDays\([\s\S]*?\n\}/);
  const weightFn = src.match(/function programmeActivityDurationWeight\([\s\S]*?\n\}/);
  const mainFn = src.match(/export function computeProgrammeComplete\([\s\S]*?\n\}/);
  if (!diffFn || !weightFn || !mainFn) return () => null;
  return new Function(`
    ${diffFn[0]}
    ${weightFn[0]}
    ${mainFn[0].replace(/^export /, "")}
    return computeProgrammeComplete;
  `)();
}
const DEFAULT_COMPUTE_PROGRAMME_COMPLETE = loadComputeProgrammeComplete();

// The real categoriseProgrammeActivity() (v94 dashboard tile drill-down
// needs it directly, not just via countProgrammeSignals()) — extracted
// the same way, plus its const/private dependencies. todayISO() here is
// the real implementation too (toLocalISODate(new Date())), not a fixed
// test date, since this is a general-purpose default for whichever
// "today" the test actually runs on — a test that needs a fixed date
// for determinism passes its own categoriseProgrammeActivity binding,
// the same override pattern every other default here already supports.
function loadCategoriseProgrammeActivity() {
  const src = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");
  const toLocalISODateFn = src.match(/export function toLocalISODate\([\s\S]*?\n\}/);
  const todayISOFn = src.match(/export function todayISO\([\s\S]*?\n\}/);
  const dueSoonConst = src.match(/export const DUE_SOON_DAYS = [\s\S]*?;\n/);
  const materialDelayConst = src.match(/export const PROGRAMME_MATERIAL_DELAY_DAYS = [\s\S]*?;\n/);
  const diffFn = src.match(/function diffCalendarDays\([\s\S]*?\n\}/);
  const mainFn = src.match(/export function categoriseProgrammeActivity\([\s\S]*?\n\}/);
  if (!toLocalISODateFn || !todayISOFn || !dueSoonConst || !materialDelayConst || !diffFn || !mainFn) return () => ({});
  return new Function(`
    ${toLocalISODateFn[0].replace(/^export /, "")}
    ${todayISOFn[0].replace(/^export /, "")}
    ${dueSoonConst[0].replace(/^export /, "")}
    ${materialDelayConst[0].replace(/^export /, "")}
    ${diffFn[0]}
    ${mainFn[0].replace(/^export /, "")}
    return categoriseProgrammeActivity;
  `)();
}
const DEFAULT_CATEGORISE_PROGRAMME_ACTIVITY = loadCategoriseProgrammeActivity();

// The real isWeeklyReportEarlyWarningsCalculated() (v97) — weekly-report-
// form.html/weekly-report-view.html both call it unconditionally while
// rendering ANY system position, so every pre-existing test of either
// page needs this default (trivially small, but still extracted, never
// reimplemented, same rule as every other default here).
function loadIsWeeklyReportEarlyWarningsCalculated() {
  const src = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");
  const mainFn = src.match(/export function isWeeklyReportEarlyWarningsCalculated\([\s\S]*?\n\}/);
  if (!mainFn) return () => false;
  return new Function(`
    ${mainFn[0].replace(/^export /, "")}
    return isWeeklyReportEarlyWarningsCalculated;
  `)();
}
const DEFAULT_IS_EARLY_WARNINGS_CALCULATED = loadIsWeeklyReportEarlyWarningsCalculated();

// The real buildEarlyWarningNotes() (v98) — weekly-report-form.html
// calls it unconditionally on every save, so every pre-existing test
// of that page needs this default too, same reasoning as every other
// default here.
function loadBuildEarlyWarningNotes() {
  const src = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");
  const mainFn = src.match(/export function buildEarlyWarningNotes\([\s\S]*?\n\}/);
  if (!mainFn) return () => ({});
  return new Function(`
    ${mainFn[0].replace(/^export /, "")}
    return buildEarlyWarningNotes;
  `)();
}
const DEFAULT_BUILD_EARLY_WARNING_NOTES = loadBuildEarlyWarningNotes();

// The real isWeeklyReportProgrammeRevisionsCalculated() (v100) —
// weekly-report-form.html/weekly-report-view.html both call it
// unconditionally while rendering ANY system position, exactly like
// isWeeklyReportEarlyWarningsCalculated() above, so every pre-existing
// test of either page needs this default too.
function loadIsWeeklyReportProgrammeRevisionsCalculated() {
  const src = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url), "utf8");
  const mainFn = src.match(/export function isWeeklyReportProgrammeRevisionsCalculated\([\s\S]*?\n\}/);
  if (!mainFn) return () => false;
  return new Function(`
    ${mainFn[0].replace(/^export /, "")}
    return isWeeklyReportProgrammeRevisionsCalculated;
  `)();
}
const DEFAULT_IS_PROGRAMME_REVISIONS_CALCULATED = loadIsWeeklyReportProgrammeRevisionsCalculated();
