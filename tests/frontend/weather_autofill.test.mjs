// v102: Weekly report weather auto-fill — fixes two real bugs seen on
// live data (Tudor Inn, 23 Nov 2026 week): (1) the old version used
// Open-Meteo's single DAILY weathercode (the worst moment across the
// whole 24h), so an overnight shower with nothing falling 08:00-17:00
// still marked a working day "Light Rain"; (2) it filled days that
// hadn't happened yet from the forecast. This file runs the REAL
// weekly-report-form.html inline script under jsdom with the REAL
// fetchWeatherConditions() from app.js wired in (extracted the same
// way tests/lib/jsdom-harness.mjs's own DEFAULT_* helpers are, but
// built inside a vm context carrying a per-test MOCK `fetch` — the
// function's own `fetch(...)` call then resolves against that mock,
// never a real network request) — proving the whole pipeline (page
// wiring + real Open-Meteo aggregation + the manual/auto eligibility
// rule) together, not a reimplementation of any of it.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { extractScript, runPage, fireEvent, wait } from "../lib/jsdom-harness.mjs";

const FORM_HTML = new URL("../../tracker/weekly-report-form.html", import.meta.url).pathname;
const APP_JS = fs.readFileSync(new URL("../../tracker/js/app.js", import.meta.url).pathname, "utf8");

function extractConst(name) {
  const m = APP_JS.match(new RegExp(`(?:export )?const ${name} = [\\s\\S]*?;\\n`));
  assert.ok(m, `${name} not found in app.js`);
  return new Function(`${m[0].replace(/^export /, "")} return ${name};`)();
}
const WEEKLY_REPORT_STATUS_LABEL = extractConst("WEEKLY_REPORT_STATUS_LABEL");
const WEEKLY_REPORT_STATUS_BADGE = extractConst("WEEKLY_REPORT_STATUS_BADGE");
const CONTROL_LEVEL_BADGE = extractConst("CONTROL_LEVEL_BADGE");
function isWeeklyReportLocked(report) { return report.status === "approved" || report.status === "issued"; }

// Pulls the real weather-fill block (consts, the condition rule, and
// fetchWeatherConditions() itself — never reimplemented) out of app.js
// and runs it inside its OWN vm context whose only binding is the
// `mockFetch` given here. The returned function still carries that
// context as its closure forever, so calling it later from a
// DIFFERENT vm (the page's own, in runWeatherForm() below) still
// resolves `fetch` against THIS mock, never a real network call.
function loadFetchWeatherConditions(mockFetch) {
  const startHour = APP_JS.match(/export const WEATHER_SITE_START_HOUR = [\s\S]*?;\n/)[0];
  const endHour = APP_JS.match(/export const WEATHER_SITE_END_HOUR = [\s\S]*?\n/)[0];
  const thresholds = APP_JS.match(/const WEATHER_HEAVY_RAIN_MM[\s\S]*?const WEATHER_FROST_MAX_C = 0;\n/)[0];
  const hourLabelFn = APP_JS.match(/function siteHourLabel\([\s\S]*?\n\}\n/)[0];
  const hoursLabelConst = APP_JS.match(/const WEATHER_SITE_HOURS_LABEL = [\s\S]*?;\n/)[0];
  const conditionFn = APP_JS.match(/function conditionFromSiteHours\([\s\S]*?\n\}\n/)[0];
  const londonTodayFn = APP_JS.match(/export function londonTodayISO\([\s\S]*?\n\}\n/)[0];
  const fetchFn = APP_JS.match(/export async function fetchWeatherConditions\([\s\S]*?\n\}\n/)[0];
  assert.ok(startHour && endHour && thresholds && hourLabelFn && hoursLabelConst && conditionFn && londonTodayFn && fetchFn, "weather helpers not found in app.js — has fetchWeatherConditions() moved or been renamed?");
  const code = [startHour, endHour, thresholds, hourLabelFn, hoursLabelConst, conditionFn, londonTodayFn, fetchFn]
    .map((block) => block.replace(/^export /, ""))
    .join("\n")
    + "\nfetchWeatherConditions;\n"; // last expression — vm.runInNewContext returns its value
  return vm.runInNewContext(code, { fetch: mockFetch, Intl, Number, Math, Array, String, Map, Infinity: Infinity });
}

// The real londonTodayISO() alone (no fetch dependency), for the
// dedicated DST-correctness test below.
function loadLondonTodayISOReal() {
  const m = APP_JS.match(/export function londonTodayISO\([\s\S]*?\n\}/);
  assert.ok(m);
  return new Function(`${m[0].replace(/^export /, "")}\nreturn londonTodayISO;`)();
}

// Builds a 24-hour Open-Meteo-shaped hourly series for one date.
// `byHour` maps a 0-23 hour to a value for that one field; every hour
// not mentioned defaults to 0 rain/snow, 10°C, 10 km/h gusts — plainly
// uneventful, so a test only has to state what's actually interesting.
function hourlyDay(date, { rain = {}, snow = {}, temp = {}, gust = {} } = {}) {
  const time = [], precipitation = [], snowfall = [], temperature_2m = [], wind_gusts_10m = [];
  for (let h = 0; h < 24; h++) {
    time.push(`${date}T${String(h).padStart(2, "0")}:00`);
    precipitation.push(rain[h] ?? 0);
    snowfall.push(snow[h] ?? 0);
    temperature_2m.push(temp[h] ?? 10);
    wind_gusts_10m.push(gust[h] ?? 10);
  }
  return { time, precipitation, snowfall, temperature_2m, wind_gusts_10m };
}
function mergeHourlyDays(...days) {
  const merged = { time: [], precipitation: [], snowfall: [], temperature_2m: [], wind_gusts_10m: [] };
  days.forEach((d) => Object.keys(merged).forEach((k) => merged[k].push(...d[k])));
  return merged;
}
function fetchMockFor(hourly) {
  return async () => ({ ok: true, json: async () => ({ hourly }) });
}

const SAMPLE_PROJECT = { id: "p1", name: "Test Site", org_id: "org1", main_contractor_name: "ACME", main_contractor_email: "acme@example.com", latitude: 51.649221, longitude: -3.791721 };

function weatherSupabaseMock({ existingReport = null, onUpdate = () => {} } = {}) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from(table) {
      const api = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        limit() { return api; },
        single: async () => {
          if (table === "projects") return { data: SAMPLE_PROJECT, error: null };
          if (table === "weekly_reports" && existingReport) return { data: existingReport, error: null };
          return { data: null, error: null };
        },
        insert(payload) { return { select: () => ({ single: async () => ({ data: { id: "new-report-id", ...payload }, error: null }) }) }; },
        update(payload) {
          if (table === "weekly_reports") onUpdate(payload);
          return { eq: async () => ({ error: null }) };
        },
        then(resolve) { resolve({ data: [], error: null }); },
      };
      return api;
    },
  };
}

// Mirrors weekly_report_workflow.test.mjs's own runForm() context list
// exactly (every binding weekly-report-form.html's real script needs),
// swapping in a real fetchWeatherConditions (built over a per-test
// mock fetch) and a fixed londonTodayISO stub so "today" is
// deterministic.
async function runWeatherForm({ existingReport = null, reportId = null, fetchHourly = null, todayISODate = "2026-11-25", onUpdate = () => {} } = {}) {
  const supabase = weatherSupabaseMock({ existingReport, onUpdate });
  const fetchWeatherConditions = loadFetchWeatherConditions(fetchHourly ? fetchMockFor(fetchHourly) : async () => ({ ok: true, json: async () => ({ hourly: { time: [] } }) }));
  return runPage(FORM_HTML, extractScript(FORM_HTML), {
    __url: `https://example.com/weekly-report-form.html?project=p1${reportId ? `&id=${reportId}` : ""}`,
    supabase,
    requireAuth: async () => ({ id: "u1" }),
    renderHeader: () => {},
    getParam: (name) => (name === "project" ? "p1" : reportId),
    escapeHtml: (s) => String(s ?? ""),
    showError: (el, err) => { el.textContent = err?.message || String(err); el.style.display = "block"; },
    clearError: (el) => { el.textContent = ""; el.style.display = "none"; },
    mondayOf: () => "2026-11-16",
    uploadImage: async () => "https://example.com/photo.jpg",
    todayISO: () => todayISODate,
    toLocalISODate: (d) => {
      const date = new Date(d);
      const offsetMs = date.getTimezoneOffset() * 60000;
      return new Date(date.getTime() - offsetMs).toISOString().slice(0, 10);
    },
    mountItemListEditor: () => ({ getItems: () => [] }),
    mountTableEditor: () => ({ getRows: () => [] }),
    formatGBP: () => null,
    WEATHER_CONDITIONS: ["Dry", "Light Rain", "Heavy Rain", "Snow / Ice"],
    fetchWeatherConditions,
    londonTodayISO: () => todayISODate,
    comparePlotNumbers: (a, b) => String(a).localeCompare(String(b)),
    normalisePlotToken: (s) => String(s).toLowerCase(),
    syncGateStatusFromMilestones: async () => {},
    EXTERNAL_WORKS_TAG: "External / Engineering Works",
    PHOTO_COMPLIANCE_STATUS: [],
    RESOURCE_ADEQUACY: [], RESOURCE_ADEQUACY_BADGE: {},
    RISK_IMPACT_LEVELS: [], RISK_IMPACT_BADGE: {},
    RISK_OWNER_SUGGESTIONS: [],
    STATUTORY_MILESTONE_TYPES: [], STATUTORY_OUTCOMES: [], STATUTORY_OUTCOME_BADGE: {},
    getWeeklyReportPosition: async () => ({ period: { weekStarting: "2026-11-16", weekEnding: "2026-11-20" }, generatedAt: "2026-11-20T12:00:00Z", exceptions: { counts: {}, status: { level: "ok", label: "On track", reason: "" } }, activity: {}, actionsSummary: { overdue: [], dueDuringPeriod: [], blocked: [], highCriticalOpen: [] }, snagsSummary: { overdue: [], highPriorityOpen: [] }, inspectionsSummary: { openFindings: [], criticalFindings: [], highSeverityFindings: [] }, hsSummary: { auditLoggedThisMonth: true, highSeverityOpenCount: 0 } }),
    isWeeklyReportLocked,
    reviseWeeklyReport: async (id) => ({ ...existingReport, status: "draft" }),
    WEEKLY_REPORT_STATUS_LABEL, WEEKLY_REPORT_STATUS_BADGE, CONTROL_LEVEL_BADGE,
    FINDING_SEVERITY_LABEL: { critical: "Critical" },
  });
}

function weatherRow(document, i) {
  const condition = document.querySelectorAll(".wt-condition")[i];
  const notes = document.querySelectorAll(".wt-notes")[i];
  return { condition: condition.value, notes: notes.value };
}

// The 7-day grid for weekStarting "2026-11-16" (a Monday) is, in
// order: [0] Sat 11-14, [1] Sun 11-15, [2] Mon 11-16, [3] Tue 11-17,
// [4] Wed 11-18, [5] Thu 11-19, [6] Fri 11-20 — see buildDays() in the
// page's own script.
const MON = 2, TUE = 3, WED = 4;

test("weekly-report-form.html weather: rain that only falls overnight (outside 08:00-17:00) is filled as Dry, not Light Rain", async () => {
  const hourly = mergeHourlyDays(
    hourlyDay("2026-11-14", {}), hourlyDay("2026-11-15", {}),
    hourlyDay("2026-11-16", { rain: { 2: 0.8 } }), // 0.8mm at 2am only — long gone by 08:00
    hourlyDay("2026-11-17", {}), hourlyDay("2026-11-18", {}), hourlyDay("2026-11-19", {}), hourlyDay("2026-11-20", {}),
  );
  const { document } = await runWeatherForm({ fetchHourly: hourly });
  await wait(50);
  const row = weatherRow(document, MON);
  assert.equal(row.condition, "Dry", "overnight-only rain outside site hours must never read as a wet day");
  assert.match(row.notes, /^0\.0 mm 8am-5pm/, "the evidence text itself must show 0.0mm for site hours, proving the overnight rain was correctly excluded");
});

test("weekly-report-form.html weather: 0.5mm in site hours is the Light Rain boundary, 4mm is the Heavy Rain boundary", async () => {
  const hourly = mergeHourlyDays(
    hourlyDay("2026-11-14", {}), hourlyDay("2026-11-15", {}),
    hourlyDay("2026-11-16", { rain: { 10: 0.5 } }), // exactly the Light Rain threshold
    hourlyDay("2026-11-17", { rain: { 10: 2, 11: 2 } }), // exactly the Heavy Rain threshold (4mm)
    hourlyDay("2026-11-18", {}), hourlyDay("2026-11-19", {}), hourlyDay("2026-11-20", {}),
  );
  const { document } = await runWeatherForm({ fetchHourly: hourly });
  await wait(50);
  assert.equal(weatherRow(document, MON).condition, "Light Rain", "0.5mm must read as Light Rain, not Dry");
  assert.equal(weatherRow(document, TUE).condition, "Heavy Rain", "4.0mm must read as Heavy Rain, not Light Rain");
});

test("weekly-report-form.html weather: just under each boundary stays in the lower band", async () => {
  const hourly = mergeHourlyDays(
    hourlyDay("2026-11-14", {}), hourlyDay("2026-11-15", {}),
    hourlyDay("2026-11-16", { rain: { 10: 0.4 } }), // just under Light Rain -> Dry
    hourlyDay("2026-11-17", { rain: { 10: 2, 11: 1.9 } }), // just under Heavy Rain -> Light Rain
    hourlyDay("2026-11-18", {}), hourlyDay("2026-11-19", {}), hourlyDay("2026-11-20", {}),
  );
  const { document } = await runWeatherForm({ fetchHourly: hourly });
  await wait(50);
  assert.equal(weatherRow(document, MON).condition, "Dry", "0.4mm must stay Dry");
  assert.equal(weatherRow(document, TUE).condition, "Light Rain", "3.9mm must stay Light Rain");
});

test("weekly-report-form.html weather: a frost day (min temp <= 0°C in site hours) reads Snow / Ice even with zero rain or snowfall", async () => {
  const hourly = mergeHourlyDays(
    hourlyDay("2026-11-14", {}), hourlyDay("2026-11-15", {}),
    hourlyDay("2026-11-16", { temp: { 8: 2, 9: -1, 16: 3 } }),
    hourlyDay("2026-11-17", {}), hourlyDay("2026-11-18", {}), hourlyDay("2026-11-19", {}), hourlyDay("2026-11-20", {}),
  );
  const { document } = await runWeatherForm({ fetchHourly: hourly });
  await wait(50);
  const row = weatherRow(document, MON);
  assert.equal(row.condition, "Snow / Ice");
  assert.match(row.notes, /min -1°C/, "the evidence should show the real sub-zero minimum that triggered it");
});

test("weekly-report-form.html weather: today and future days are left blank, even though the forecast has data for them", async () => {
  // weekStarting "2026-11-16" (as above) but "today" is 2026-11-19
  // (Thursday) — Mon/Tue/Wed have finished, Thu (today) and Fri
  // (tomorrow) have not, even though the mock forecast cheerfully
  // supplies rain data for every single day in the range.
  const hourly = mergeHourlyDays(
    hourlyDay("2026-11-14", { rain: { 10: 5 } }), hourlyDay("2026-11-15", { rain: { 10: 5 } }),
    hourlyDay("2026-11-16", { rain: { 10: 5 } }), hourlyDay("2026-11-17", { rain: { 10: 5 } }), hourlyDay("2026-11-18", { rain: { 10: 5 } }),
    hourlyDay("2026-11-19", { rain: { 10: 5 } }), hourlyDay("2026-11-20", { rain: { 10: 5 } }),
  );
  const { document } = await runWeatherForm({ fetchHourly: hourly, todayISODate: "2026-11-19" });
  await wait(50);
  assert.equal(weatherRow(document, MON).condition, "Heavy Rain", "Monday has already finished — it must be filled");
  assert.equal(weatherRow(document, 5).condition, "", "Thursday IS today — it must stay blank even though the forecast has data for it");
  assert.equal(weatherRow(document, 6).condition, "", "Friday is still in the future — it must stay blank too");
  assert.equal(weatherRow(document, 5).notes, "", "a blank day must get no evidence text either");
});

test("weekly-report-form.html weather: the evidence text written into a blank day's notes matches the real figures exactly", async () => {
  const hourly = mergeHourlyDays(
    hourlyDay("2026-11-14", {}), hourlyDay("2026-11-15", {}),
    hourlyDay("2026-11-16", { rain: { 10: 3.5 }, gust: { 10: 48 }, temp: { 8: 1, 10: 3 } }),
    hourlyDay("2026-11-17", {}), hourlyDay("2026-11-18", {}), hourlyDay("2026-11-19", {}), hourlyDay("2026-11-20", {}),
  );
  const { document } = await runWeatherForm({ fetchHourly: hourly });
  await wait(50);
  assert.equal(weatherRow(document, MON).notes, "3.5 mm 8am-5pm, gusts 48 km/h, min 1°C");
});

// ─── Manual vs auto, and the Refresh button ──────────────────────────

test("weekly-report-form.html weather: a day with manually-entered content (no source tag) is never touched, even by Refresh", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", status: "draft", week_starting: "2026-11-16", week_ending: "2026-11-20",
    weather_days: [
      { date: "2026-11-16", condition: "Dry", lost_hours: 0, notes: "Checked on site, all clear" }, // no `source` at all — legacy/manual
    ],
  };
  const freshHourly = mergeHourlyDays(
    hourlyDay("2026-11-14", {}), hourlyDay("2026-11-15", {}),
    hourlyDay("2026-11-16", { rain: { 10: 10 } }), // would be Heavy Rain if it were ever applied
    hourlyDay("2026-11-17", {}), hourlyDay("2026-11-18", {}), hourlyDay("2026-11-19", {}), hourlyDay("2026-11-20", {}),
  );
  const { document } = await runWeatherForm({ existingReport, reportId: "r1", fetchHourly: freshHourly });
  await wait(50);
  // Sanity: the initial load's own auto-fill pass already must not
  // have touched it.
  assert.equal(weatherRow(document, MON).condition, "Dry");
  assert.equal(weatherRow(document, MON).notes, "Checked on site, all clear");

  fireEvent(document.getElementById("refreshWeatherBtn"), "click");
  await wait(50);
  const row = weatherRow(document, MON);
  assert.equal(row.condition, "Dry", "Refresh must never overwrite a manually-entered day");
  assert.equal(row.notes, "Checked on site, all clear", "Refresh must never overwrite its manually-entered notes either");
});

test("weekly-report-form.html weather: Refresh re-runs the lookup and updates a day the auto-fill itself set (source: 'auto')", async () => {
  const existingReport = {
    id: "r1", project_id: "p1", status: "draft", week_starting: "2026-11-16", week_ending: "2026-11-20",
    weather_days: [
      { date: "2026-11-16", condition: "Light Rain", lost_hours: 0, notes: "stale evidence from an earlier run", source: "auto" },
    ],
  };
  const freshHourly = mergeHourlyDays(
    hourlyDay("2026-11-14", {}), hourlyDay("2026-11-15", {}),
    hourlyDay("2026-11-16", { rain: { 10: 2, 11: 2 } }), // now Heavy Rain (4mm) on a fresh lookup
    hourlyDay("2026-11-17", {}), hourlyDay("2026-11-18", {}), hourlyDay("2026-11-19", {}), hourlyDay("2026-11-20", {}),
  );
  const { document } = await runWeatherForm({ existingReport, reportId: "r1", fetchHourly: freshHourly });
  await wait(50);

  fireEvent(document.getElementById("refreshWeatherBtn"), "click");
  await wait(50);
  const row = weatherRow(document, MON);
  assert.equal(row.condition, "Heavy Rain", "Refresh must overwrite a day it itself auto-filled before, with the freshly looked-up condition");
  assert.doesNotMatch(row.notes, /stale evidence/, "the stale evidence text must be replaced too");
});

test("weekly-report-form.html weather: editing a day by hand immediately protects it from any later auto-fill/Refresh", async () => {
  const hourly = mergeHourlyDays(
    hourlyDay("2026-11-14", {}), hourlyDay("2026-11-15", {}),
    hourlyDay("2026-11-16", {}), hourlyDay("2026-11-17", {}), hourlyDay("2026-11-18", {}), hourlyDay("2026-11-19", {}), hourlyDay("2026-11-20", {}),
  );
  const { document, window } = await runWeatherForm({ fetchHourly: hourly });
  await wait(50);
  assert.equal(weatherRow(document, MON).condition, "Dry", "sanity: auto-filled Dry on load");

  const select = document.querySelectorAll(".wt-condition")[MON];
  select.value = "Heavy Rain";
  fireEvent(select, "change");

  // A SECOND lookup (as Refresh would trigger) must leave the now-
  // manual day alone, even though it would otherwise have been filled
  // with "Dry" again.
  fireEvent(document.getElementById("refreshWeatherBtn"), "click");
  await wait(50);
  assert.equal(weatherRow(document, MON).condition, "Heavy Rain", "the user's own choice must survive a Refresh");
});

// ─── londonTodayISO() itself ──────────────────────────────────────────

test("londonTodayISO(): uses Europe/London's own calendar date, not a raw UTC slice (proven across the BST boundary)", async () => {
  const londonTodayISO = loadLondonTodayISOReal();
  // 23:30 UTC in mid-July is 00:30 BST the NEXT day in London — a raw
  // `.toISOString().slice(0,10)` would wrongly return the UTC date.
  assert.equal(londonTodayISO(new Date("2026-07-15T23:30:00Z")), "2026-07-16");
  // In winter (GMT, no offset) the two agree.
  assert.equal(londonTodayISO(new Date("2026-01-15T23:30:00Z")), "2026-01-15");
});
