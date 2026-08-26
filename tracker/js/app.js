import { supabase } from "./supabase-client.js";

// ─── Auth guard ─────────────────────────────────────────────────
// Call at the top of every protected page. Redirects to login if no
// session, and returns the signed-in user.
export async function requireAuth() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    window.location.href = "login.html";
    return null;
  }
  return session.user;
}

export async function signOut() {
  await supabase.auth.signOut();
  window.location.href = "login.html";
}

// ─── Small helpers ──────────────────────────────────────────────
export function getParam(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Sorts plot_number values numerically ("Plot 2" before "Plot 10")
// rather than as plain text, which would otherwise put "Plot 10" before
// "Plot 2". Falls back to a locale-aware string compare for plot names
// with no digits in them, and numeric-vs-non-numeric names sort the
// numeric ones first.
export function comparePlotNumbers(a, b) {
  const numA = (a.match(/\d+/) || [])[0];
  const numB = (b.match(/\d+/) || [])[0];
  if (numA && numB) return Number(numA) - Number(numB) || a.localeCompare(b);
  if (numA) return -1;
  if (numB) return 1;
  return a.localeCompare(b);
}

export function formatDate(d) {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  if (isNaN(date)) return d;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Formats a Date as YYYY-MM-DD using its LOCAL calendar date. Prefer this
// over `date.toISOString().slice(0, 10)`, which converts through UTC first
// and silently shifts the date back a day for anyone in a UTC-ahead
// timezone (e.g. the UK during BST) — every date field in this app means
// a calendar date, never a UTC instant.
export function toLocalISODate(date) {
  const d = new Date(date);
  const offsetMs = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - offsetMs).toISOString().slice(0, 10);
}

export function todayISO() {
  return toLocalISODate(new Date());
}

// First-of-month ISO date for a given Date (defaults to today) — the
// bucket key hs_audits.month and monthly_reports.month both use, so
// "does this calendar month have one yet" is one equality match
// instead of a date-range query.
export function monthStartISO(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

// Given a Date, return the Monday of that week as an ISO date string.
export function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return toLocalISODate(d);
}

export function showError(el, err) {
  const msg = (err && err.message) ? err.message : String(err);
  el.textContent = msg;
  el.style.display = "block";
}

export function clearError(el) {
  el.textContent = "";
  el.style.display = "none";
}

// ─── Photo upload helper ────────────────────────────────────────
// Uploads a File to the public "site-photos" bucket under the given path
// and returns its public URL.
export async function uploadPhoto(file, path) {
  const ext = file.name.split(".").pop();
  const key = `${path}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("site-photos").upload(key, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  const { data } = supabase.storage.from("site-photos").getPublicUrl(key);
  return data.publicUrl;
}

// ─── Image compression ──────────────────────────────────────────
// Shared resize + re-encode step used by compressImage/compressDrawing.
// Non-image files and SVGs pass through unchanged. Falls back to the
// original file if decoding/encoding fails for any reason (e.g. a PDF,
// or a format the browser can't rasterise via Canvas).
async function resizeAndEncode(file, { maxDimension, quality, mimeType, extension }) {
  if (!file.type || !file.type.startsWith("image/") || file.type === "image/svg+xml") return file;

  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;

  let { width, height } = bitmap;
  if (width > maxDimension || height > maxDimension) {
    const scale = maxDimension / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, mimeType, quality));
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + "." + extension;
  return new File([blob], newName, { type: mimeType, lastModified: Date.now() });
}

// Resizes an image file to fit within maxDimension (longest side) and
// re-encodes it as JPEG at the given quality, to keep storage usage down.
export async function compressImage(file, { maxDimension = 1920, quality = 0.78 } = {}) {
  return resizeAndEncode(file, { maxDimension, quality, mimeType: "image/jpeg", extension: "jpg" });
}

// Resizes a drawing/blueprint image to fit within maxDimension and
// re-encodes it as WebP — smaller than JPEG at equivalent quality, and
// still sharp enough for line work/text. PDFs can't be rasterised with
// the Canvas API (no native browser support), so PDF drawings upload
// unchanged; everything else (PNG, JPEG, WebP, ...) gets converted.
export async function compressDrawing(file, { maxDimension = 2560, quality = 0.75 } = {}) {
  return resizeAndEncode(file, { maxDimension, quality, mimeType: "image/webp", extension: "webp" });
}

// Compresses (if it's an image) then uploads to the "site-photos" bucket.
// Used for weekly report / snag / handover photos, where storage volume
// adds up. The logo upload deliberately skips this — see settings.html.
export async function uploadImage(file, path) {
  const compressed = await compressImage(file);
  return uploadPhoto(compressed, path);
}

// Compresses (if it's an image) then uploads to the "drawings/" folder of
// the "site-photos" bucket. Used for site layouts and plot floor plans.
export async function uploadDrawing(file, path) {
  const compressed = await compressDrawing(file);
  return uploadPhoto(compressed, `drawings/${path}`);
}

// ─── Shared header ──────────────────────────────────────────────
// Renders the top nav bar into #site-header. `crumbs` is an array of
// {label, href} — href omitted on the last (current page) crumb.
export function renderHeader(crumbs = []) {
  const el = document.getElementById("site-header");
  if (!el) return;
  const crumbHtml = crumbs
    .map((c, i) =>
      c.href && i < crumbs.length - 1
        ? `<a href="${c.href}">${escapeHtml(c.label)}</a>`
        : `<span>${escapeHtml(c.label)}</span>`
    )
    .join('<span class="crumb-sep">/</span>');

  el.innerHTML = `
    <div class="header-inner">
      <a href="dashboard.html" class="brand">SITE <span>TRACKER</span></a>
      <nav class="crumbs">${crumbHtml}</nav>
      <a href="settings.html" class="btn btn-ghost btn-sm">Settings</a>
      <button id="signOutBtn" class="btn btn-ghost btn-sm">Sign out</button>
    </div>
  `;
  document.getElementById("signOutBtn").addEventListener("click", signOut);
}

// ─── RAG / progress helpers ──────────────────────────────────────
export const RAG_LABEL = { red: "Red", amber: "Amber", green: "Green" };

export function formatGBP(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (Number.isNaN(n)) return null;
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 });
}

// Renders the dual baseline-vs-actual progress bar + slippage line used on
// dashboard site cards and the site detail page.
export function renderProgressBlock(baselinePct, actualPct, ragStatus) {
  const baseline = Number(baselinePct) || 0;
  const actual = Number(actualPct) || 0;
  const slip = actual - baseline;
  let slipHtml;
  if (slip > 0) slipHtml = `<span class="slip-green">+${slip.toFixed(0)}% Ahead of Programme</span>`;
  else if (slip < 0) slipHtml = `<span class="slip-red">${slip.toFixed(0)}% Behind Programme</span>`;
  else slipHtml = `<span class="slip-grey">On Programme</span>`;

  return `
    <div class="progress-block">
      <div class="progress-track">
        <div class="progress-fill-baseline" style="width:${baseline}%;"></div>
        <div class="progress-fill-actual rag-${ragStatus}" style="width:${actual}%;"></div>
      </div>
      <div class="progress-legend">
        <span>Baseline ${baseline.toFixed(0)}% · Actual ${actual.toFixed(0)}%</span>
        ${slipHtml}
      </div>
    </div>
  `;
}

// ─── Org logo ───────────────────────────────────────────────────
// Returns the company logo URL (from org_settings) or null if none is set.
export async function getOrgLogoUrl() {
  const { data } = await supabase.from("org_settings").select("logo_url").eq("id", 1).maybeSingle();
  return data?.logo_url || null;
}

// ─── Automatic progress ───────────────────────────────────────────
// Actual Progress % is a weighted average of every plot's own
// progress_pct, every block's own progress_pct, plus the site's
// external_works_pct (civils/drainage/landscaping that isn't any one
// plot or block). Every input is set directly (by hand, or via
// suggestPlotProgress() below) rather than being locked to an
// automatic calculation — the point is that they're always correctable
// when a milestone gets missed in a weekly report.
//
// A block's own progress_pct is the shared structure/civils tracked
// once for the whole apartment block, not duplicated per flat — but it
// underpins every flat inside it, so it's weighted as though it were
// that many house-equivalent units, not just one. A fully-built frame
// sitting under 30 still-empty flats is genuine, substantial progress
// on the site as a whole, not "barely started" — counting the block's
// shared progress only once would badly understate that. Each flat's
// own fit-out progress still also counts individually and separately,
// same as a house. A brand new block with no flats yet counts as a
// single unit, same as before, so it isn't invisible in the average
// until flats are added.
export async function recalculateActualProgress(projectId) {
  const [{ data: project }, { data: plots }, { data: blocks }] = await Promise.all([
    supabase.from("projects").select("external_works_pct").eq("id", projectId).single(),
    supabase.from("plots").select("progress_pct, block_id").eq("project_id", projectId),
    supabase.from("blocks").select("id, progress_pct").eq("project_id", projectId),
  ]);

  const flatCountByBlock = new Map();
  (plots || []).forEach((p) => {
    if (!p.block_id) return;
    flatCountByBlock.set(p.block_id, (flatCountByBlock.get(p.block_id) || 0) + 1);
  });

  let sum = 0;
  let weight = 0;
  (plots || []).forEach((p) => {
    sum += Number(p.progress_pct) || 0;
    weight += 1;
  });
  (blocks || []).forEach((b) => {
    const blockWeight = flatCountByBlock.get(b.id) || 1;
    sum += (Number(b.progress_pct) || 0) * blockWeight;
    weight += blockWeight;
  });
  sum += Number(project?.external_works_pct) || 0;
  weight += 1;

  const pct = Math.round((sum / weight) * 10) / 10;

  await supabase.from("projects").update({ actual_progress_pct: pct }).eq("id", projectId);
  return pct;
}

// A weekly report's plot tag is freetext ("5", "5,6,7") and a plot's own
// name is also freetext ("Plot 5", or just "5") — normalise both to
// their digits where possible so "Plot 5" and "5" are recognised as the
// same plot, falling back to a case-insensitive exact match for
// non-numeric plot names.
function normalisePlotToken(s) {
  const digits = (s.match(/\d+/) || [])[0];
  return digits || s.trim().toLowerCase();
}

// A site-wide, non-numbered "plot" for civils/drainage/landscaping work
// that isn't any one house or flat. Offered alongside the real plots in
// the weekly report plot picker (see weekly-report-form.html) purely as
// a tag — normalisePlotToken() falls back to a plain lowercase string
// match for it since it has no digits, so it flows through the exact
// same matching suggestPlotProgress() below already does for numbered
// plots, with no extra logic needed. Matches the exact wording of the
// "External / Engineering Works (%)" field on Site Details.
export const EXTERNAL_WORKS_TAG = "External / Engineering Works";

// Suggests a starting point for one plot's progress_pct (or, passing
// EXTERNAL_WORKS_TAG, the site's external_works_pct), computed from
// the build milestones logged against it in weekly reports — purely a
// value for the caller to pre-fill an input with; it never writes
// anything itself, so it can never silently overwrite a manually-typed
// correction.
//
// Dedupes by milestone across the project's ENTIRE weekly report
// history, not just the most recent report, taking the highest percent
// ever recorded for each — so a milestone finished months ago still
// counts even once it's dropped off every current week's list. A
// progress item's plot field can list several plots at once ("5,6,7"),
// so an item counts toward this plot if its plot list includes this
// plot's number. Items with no milestone, or a custom "Other" milestone
// outside BUILD_MILESTONES, aren't weighted — there's no fixed slot for
// them in the scale.
export async function suggestPlotProgress(projectId, plotNumber) {
  const { data: reports } = await supabase.from("weekly_reports").select("progress_items").eq("project_id", projectId);
  const target = normalisePlotToken(plotNumber);

  const best = new Map(); // milestone -> highest percent seen
  (reports || []).forEach((r) => {
    (Array.isArray(r.progress_items) ? r.progress_items : []).forEach((item) => {
      if (typeof item === "string" || !item.milestone || !BUILD_MILESTONES.includes(item.milestone) || !item.plot) return;
      const plotTokens = item.plot.split(",").map((p) => p.trim());
      if (!plotTokens.some((t) => normalisePlotToken(t) === target)) return;
      const percent = typeof item.percent === "number" ? item.percent : 0;
      if (!best.has(item.milestone) || percent > best.get(item.milestone)) best.set(item.milestone, percent);
    });
  });

  if (best.size === 0) return 0;
  const sum = [...best.values()].reduce((s, v) => s + v, 0);
  return Math.round((sum / BUILD_MILESTONES.length) * 10) / 10;
}

// Which BUILD_MILESTONES entries make up each standalone-house quality
// gate. Used only to auto-ADVANCE a gate once every milestone in its
// group is logged at 100% against that plot — never to downgrade one,
// and never to set Approved, which always stays a human decision on the
// plot's own page. Flats and block-level gates use different milestone
// sets not covered here.
const GATE_MILESTONES = {
  substructure_drainage: ["Groundworks", "Foundations (Foots)", "Drainage (Below Ground)", "Slab Pour / Oversite"],
  frame_watertight: ["Timber Frame Erect", "Brick & Block Superstructure", "Scaffold Erect", "Roofing", "Windows & External Doors", "Scaffold Drop", "Render", "Cladding / External Finishes"],
  pre_plaster_first_fix: ["1st Fix – Carpentry", "1st Fix – Electrical", "1st Fix – Plumbing & Heating", "1st Fix – Gas", "Plastering / Drylining"],
  pre_handover_pc: ["2nd Fix – Carpentry", "2nd Fix – Electrical", "2nd Fix – Plumbing & Heating", "Kitchen Fit", "Bathroom Fit", "Painting & Decorating", "Flooring", "Testing & Commissioning", "Snagging", "Handover / Practical Completion"],
};

// Call after saving a weekly report, passing the report's own
// progress_items. Advances a house plot's quality gate to "Under
// Review" once every milestone that makes it up has been logged at
// 100% against that plot (deduped across the project's whole weekly
// report history, same rule as suggestPlotProgress() above) — a gate
// already Under Review, Approved, or marked N/A is left untouched.
// Only checks plots actually tagged in `progressItems`, since that's
// the only data this particular save could have changed. Returns the
// number of gates advanced.
export async function syncGateStatusFromMilestones(projectId, progressItems) {
  const taggedTokens = new Set();
  (progressItems || []).forEach((item) => {
    if (!item.plot || !item.milestone) return;
    item.plot.split(",").forEach((p) => {
      const token = normalisePlotToken(p.trim());
      if (token) taggedTokens.add(token);
    });
  });
  if (!taggedTokens.size) return 0;

  const [{ data: plots }, { data: reports }] = await Promise.all([
    supabase.from("plots").select("id, plot_number").eq("project_id", projectId).is("block_id", null),
    supabase.from("weekly_reports").select("progress_items").eq("project_id", projectId),
  ]);

  const relevantPlots = (plots || []).filter((p) => taggedTokens.has(normalisePlotToken(p.plot_number)));
  if (!relevantPlots.length) return 0;

  const tokenToPlotIds = new Map();
  const completionByPlotId = new Map();
  relevantPlots.forEach((p) => {
    completionByPlotId.set(p.id, new Map());
    const token = normalisePlotToken(p.plot_number);
    if (!tokenToPlotIds.has(token)) tokenToPlotIds.set(token, []);
    tokenToPlotIds.get(token).push(p.id);
  });

  (reports || []).forEach((r) => {
    (Array.isArray(r.progress_items) ? r.progress_items : []).forEach((item) => {
      if (typeof item === "string" || !item.milestone || !BUILD_MILESTONES.includes(item.milestone) || !item.plot) return;
      const percent = typeof item.percent === "number" ? item.percent : 0;
      item.plot.split(",").forEach((p) => {
        const plotIds = tokenToPlotIds.get(normalisePlotToken(p.trim()));
        if (!plotIds) return;
        plotIds.forEach((plotId) => {
          const m = completionByPlotId.get(plotId);
          if (!m.has(item.milestone) || percent > m.get(item.milestone)) m.set(item.milestone, percent);
        });
      });
    });
  });

  const { data: gates } = await supabase
    .from("quality_gates")
    .select("id, plot_id, gate_key, status")
    .in("plot_id", relevantPlots.map((p) => p.id));

  const toAdvance = (gates || [])
    .filter((gate) => {
      const milestones = GATE_MILESTONES[gate.gate_key];
      if (!milestones) return false;
      if (gate.status !== "not_started" && gate.status !== "in_progress") return false;
      const completion = completionByPlotId.get(gate.plot_id);
      if (!completion) return false;
      return milestones.every((m) => (completion.get(m) || 0) >= 100);
    })
    .map((gate) => gate.id);

  if (toAdvance.length) {
    await supabase.from("quality_gates").update({ status: "under_review" }).in("id", toAdvance);
  }
  return toAdvance.length;
}

// Tops a project up to `totalPlots` plots, naming any it creates
// "Plot 1", "Plot 2", … and skipping any of those exact names that
// already exist (case-insensitively) — so re-running this after some
// plots already exist only fills the gaps, it never creates duplicates.
// Each new plot row fires the existing seed_plot_defaults() DB trigger,
// which gives it its own quality gates, handover documents, and snag
// list automatically — nothing extra to wire up here. Purely a plot
// count target, unrelated to Actual Progress (which is the average of
// however many plots actually exist, not this target).
export async function generateMissingPlots(projectId, totalPlots) {
  const { data: existing } = await supabase.from("plots").select("plot_number").eq("project_id", projectId);
  const existingNames = new Set((existing || []).map((p) => p.plot_number.trim().toLowerCase()));

  const { data: { user } } = await supabase.auth.getUser();
  const toCreate = [];
  for (let i = 1; i <= totalPlots; i++) {
    const name = `Plot ${i}`;
    if (!existingNames.has(name.toLowerCase())) {
      toCreate.push({ project_id: projectId, plot_number: name, created_by: user.id });
    }
  }
  if (!toCreate.length) return 0;

  const { error } = await supabase.from("plots").insert(toCreate);
  if (error) throw error;
  return toCreate.length;
}

// Parses a flexible flat/plot number spec into an ordered list of
// individual names, each kept exactly as typed — a bare "23" becomes
// plot_number "23", not forced into "Flat 23" or "Plot 23", since a
// block of flats is often numbered to continue the whole site's own
// plot numbering rather than restart at 1. Supports comma-separated
// lists ("23,25,28A") and numeric ranges ("23-30", inclusive, either
// direction); anything that isn't a pure numeric range is kept as its
// own literal entry.
export function parseFlatNumberSpec(spec) {
  const names = [];
  (spec || "").split(",").map((s) => s.trim()).filter(Boolean).forEach((segment) => {
    const rangeMatch = segment.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const step = start <= end ? 1 : -1;
      for (let i = start; step > 0 ? i <= end : i >= end; i += step) names.push(String(i));
    } else {
      names.push(segment);
    }
  });
  return names;
}

// Creates flats in a block from a number spec (see parseFlatNumberSpec
// above) rather than a plain count, so a block's flats can carry
// whatever plot numbers the site actually uses for them — skips any
// name that already exists on this block (case-insensitively), so
// re-running this after some flats already exist only fills the gaps.
// Each new row gets the project_id (flats are plots under the hood)
// plus this block's id, so seed_plot_defaults() seeds it with the
// reduced flat gate/document set instead of the full house set.
// Returns the created plot rows (not just a count), so a caller adding
// exactly one flat can jump straight to its detail page.
export async function generateFlatsFromSpec(projectId, blockId, spec) {
  const names = parseFlatNumberSpec(spec);
  if (!names.length) return [];

  const { data: existing } = await supabase.from("plots").select("plot_number").eq("block_id", blockId);
  const existingNames = new Set((existing || []).map((p) => p.plot_number.trim().toLowerCase()));

  const { data: { user } } = await supabase.auth.getUser();
  const seen = new Set();
  const toCreate = [];
  names.forEach((name) => {
    const key = name.toLowerCase();
    if (existingNames.has(key) || seen.has(key)) return;
    seen.add(key);
    toCreate.push({ project_id: projectId, block_id: blockId, plot_number: name, created_by: user.id });
  });
  if (!toCreate.length) return [];

  const { data, error } = await supabase.from("plots").insert(toCreate).select();
  if (error) throw error;
  return data || [];
}

// ─── Weather auto-fill (postcodes.io + Open-Meteo) ───────────────
// Leaving a day blank still means "nothing to report" — "Dry" is here
// for when you want that explicitly on record (e.g. confirming a day
// was checked and clear), not because every day needs a condition set.
export const WEATHER_CONDITIONS = ["Dry", "Light Rain", "Heavy Rain", "Snow / Ice"];

// Geocodes a UK postcode via postcodes.io (free, no API key). Returns
// { latitude, longitude } or null if the postcode isn't found or the
// lookup fails for any reason — callers should treat a null result as
// "skip weather auto-fill for this site", never as a hard error.
export async function geocodePostcode(postcode) {
  if (!postcode || !postcode.trim()) return null;
  try {
    const res = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode.trim())}`);
    if (!res.ok) return null;
    const json = await res.json();
    if (!json.result) return null;
    return { latitude: json.result.latitude, longitude: json.result.longitude };
  } catch {
    return null;
  }
}

// Maps an Open-Meteo WMO weather code to one of WEATHER_CONDITIONS.
// Anything that isn't rain or snow/ice returns "" (no auto-fill) — a
// clear or overcast day just stays blank, since it doesn't affect site
// works.
const WMO_RAIN_LIGHT = new Set([51, 53, 55, 61, 63, 80, 81]);
const WMO_RAIN_HEAVY = new Set([65, 82, 95, 96, 99]);
const WMO_SNOW_ICE = new Set([56, 57, 66, 67, 71, 73, 75, 77, 85, 86]);

export function conditionFromWeatherCode(code) {
  if (WMO_SNOW_ICE.has(code)) return "Snow / Ice";
  if (WMO_RAIN_HEAVY.has(code)) return "Heavy Rain";
  if (WMO_RAIN_LIGHT.has(code)) return "Light Rain";
  return "";
}

// Fetches a daily condition summary for a lat/long + date range from
// Open-Meteo's forecast API (free, no key — it blends recent history and
// forecast in one call, which covers the "this week" / "last week" range
// weekly reports actually need). Returns a Map of date -> condition
// string, or an empty Map on any failure (network, dates out of the
// supported window, etc.) — callers should treat that as "no auto-fill
// available this time", never as a blocking error.
export async function fetchWeatherConditions(latitude, longitude, startDate, endDate) {
  if (latitude == null || longitude == null) return new Map();
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&start_date=${startDate}&end_date=${endDate}&daily=weathercode&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) return new Map();
    const json = await res.json();
    const daily = json.daily;
    if (!daily || !Array.isArray(daily.time)) return new Map();
    const result = new Map();
    daily.time.forEach((date, i) => {
      const condition = conditionFromWeatherCode(daily.weathercode?.[i]);
      if (condition) result.set(date, condition);
    });
    return result;
  } catch {
    return new Map();
  }
}

// Standard UK residential new-build stages, groundworks through handover,
// offered as the milestone dropdown on weekly report progress/next-week
// items. Not exhaustive for every build type (e.g. covers both timber
// frame and brick & block) — "Other" lets you type anything not listed.
export const BUILD_MILESTONES = [
  "Site Set-Up / Enabling Works",
  "Groundworks",
  "Foundations (Foots)",
  "Drainage (Below Ground)",
  "Slab Pour / Oversite",
  "Timber Frame Erect",
  "Brick & Block Superstructure",
  "Scaffold Erect",
  "Roofing",
  "Windows & External Doors",
  "Scaffold Drop",
  "Render",
  "Cladding / External Finishes",
  "1st Fix – Carpentry",
  "1st Fix – Electrical",
  "1st Fix – Plumbing & Heating",
  "1st Fix – Gas",
  "Plastering / Drylining",
  "2nd Fix – Carpentry",
  "2nd Fix – Electrical",
  "2nd Fix – Plumbing & Heating",
  "Kitchen Fit",
  "Bathroom Fit",
  "Painting & Decorating",
  "Flooring",
  "Solar Panels (PV)",
  "External Works / Landscaping",
  "Testing & Commissioning",
  "Snagging",
  "Handover / Practical Completion",
];
const MILESTONE_CUSTOM_VALUE = "__custom__";

// ─── H&S Audits ─────────────────────────────────────────────────
// A condensed checklist covering the areas a UK residential site H&S
// audit typically checks — trimmed from a fuller ~80-item third-party
// SHE inspection template down to the items most sites actually need
// to see on a monthly walk-round. Each internal audit gets one
// hs_audit_items row per entry here (section + item_name copied in as
// plain text at creation time, not a foreign key back to this list,
// so editing this constant later never rewrites the wording of an
// already-completed audit).
export const HS_CHECKLIST = [
  { section: "Statutory Documentation", item: "Health & Safety Policy" },
  { section: "Statutory Documentation", item: "Construction Phase Plan" },
  { section: "Statutory Documentation", item: "Site Induction Records" },
  { section: "Statutory Documentation", item: "Risk Assessments" },
  { section: "Statutory Documentation", item: "Method Statements" },
  { section: "Statutory Documentation", item: "F10 Notification" },
  { section: "Statutory Documentation", item: "Insurances" },
  { section: "Statutory Documentation", item: "Plant Inspection Records" },
  { section: "Statutory Documentation", item: "Scaffold Inspection Records" },
  { section: "Statutory Documentation", item: "LOLER / Lifting Equipment Inspections" },
  { section: "General Requirements", item: "Welfare Facilities" },
  { section: "General Requirements", item: "PPE" },
  { section: "General Requirements", item: "Operative Competencies / CSCS" },
  { section: "General Requirements", item: "First Aid Provisions" },
  { section: "General Requirements", item: "Fire Fighting Provisions" },
  { section: "General Requirements", item: "Emergency Procedures" },
  { section: "General Requirements", item: "Site Security" },
  { section: "General Requirements", item: "Walkways / Access Routes" },
  { section: "General Requirements", item: "Traffic Management" },
  { section: "General Requirements", item: "Site Signage" },
  { section: "Site Based Hazards", item: "Working at Height" },
  { section: "Site Based Hazards", item: "Scaffolding" },
  { section: "Site Based Hazards", item: "Ladders" },
  { section: "Site Based Hazards", item: "Excavations" },
  { section: "Site Based Hazards", item: "Plant Operation" },
  { section: "Site Based Hazards", item: "Use of Hand Tools" },
  { section: "Site Based Hazards", item: "Materials Handling" },
  { section: "Site Based Hazards", item: "Storage of Materials" },
  { section: "Site Based Hazards", item: "Housekeeping" },
  { section: "Site Based Hazards", item: "Noise" },
  { section: "Site Based Hazards", item: "Hazardous Substances (COSHH)" },
  { section: "Site Based Hazards", item: "Structural Safety" },
  { section: "Environmental", item: "Emissions to Air" },
  { section: "Environmental", item: "Spill Kits" },
  { section: "Environmental", item: "Waste Storage" },
  { section: "Environmental", item: "Hazardous Waste" },
  { section: "Environmental", item: "Water Courses" },
  { section: "Environmental", item: "Protected Species / Ecology" },
];

export const HS_STATUS_LABEL = { compliant: "Compliant", non_compliant: "Non-Compliant", na: "N/A", good_practice: "Good Practice" };
export const HS_STATUS_BADGE = { compliant: "badge-green", non_compliant: "badge-red", na: "badge-grey", good_practice: "badge-blue" };

// The traffic-light rating for a Non-Compliant item — how serious that
// particular issue is, separate from (and only meaningful alongside)
// its Compliant/Non-Compliant/N/A/Good Practice status above.
export const HS_SEVERITY_LABEL = { low: "Low", medium: "Medium", high: "High" };
export const HS_SEVERITY_BADGE = { low: "badge-green", medium: "badge-amber", high: "badge-red" };

// Score % excludes N/A items from both sides of the fraction, same rule
// as the quality-gates approved ratio — marking something N/A can only
// help a site's score, never hold it back. flaggedCount is just the
// Non-Compliant count, shown alongside the score rather than folded
// into it.
export function hsAuditScore(items) {
  const applicable = (items || []).filter((i) => i.status !== "na");
  const passing = applicable.filter((i) => i.status === "compliant" || i.status === "good_practice").length;
  const flaggedCount = applicable.filter((i) => i.status === "non_compliant").length;
  const scorePct = applicable.length ? Math.round((passing / applicable.length) * 1000) / 10 : null;
  return { scorePct, flaggedCount, applicableCount: applicable.length };
}

// ─── Itemised list editor ────────────────────────────────────────
// Mounts an add/edit/delete list UI into `container`. Each item is
// { id, plot, text } — plot is an optional tag (e.g. "Plot 4"), shown
// alongside the item text. `id` is stable across saves (and across
// reports, when an item is carried forward — see weekly-report-form.html)
// so items can be matched by identity rather than text. Plain-string
// items (from before plot numbers existed) are normalised into
// { id, plot: "", text }.
// Pass { withPercent: true } to add a 0-100 "% complete" field to every
// item (used for progress items; next-week items don't have one).
// Pass { withMilestone: true } to add a build-stage dropdown (from
// BUILD_MILESTONES, plus a free-text "Other" option) to every item.
// Pass { plotOptions: [...] } (a project's plot numbers) to turn the plot
// field from freetext into a multi-select — still stored as the same
// comma-joined string ("Plot 5, Plot 6") the rest of the app already
// expects (suggestPlotProgress() etc. already split on commas), so this
// is a pure UI change with no data-shape migration. Falls back to the
// plain text input when omitted/empty.
// Calls onChange(items) whenever the list changes. Returns { getItems }.
export function mountItemListEditor(container, initialItems, onChange, { withPercent = false, withMilestone = false, plotOptions = [] } = {}) {
  function normalise(item) {
    if (typeof item === "string") {
      return { id: crypto.randomUUID(), plot: "", text: item, ...(withPercent ? { percent: 0 } : {}), ...(withMilestone ? { milestone: "" } : {}) };
    }
    return {
      id: item.id || crypto.randomUUID(),
      plot: item.plot || "",
      text: item.text || "",
      ...(withPercent ? { percent: typeof item.percent === "number" ? item.percent : 0 } : {}),
      ...(withMilestone ? { milestone: item.milestone || "" } : {}),
    };
  }
  let items = (initialItems || []).map(normalise);
  let editingIndex = null;

  function percentBadge(percent) {
    if (!withPercent) return "";
    const cls = percent >= 100 ? "badge-green" : percent > 0 ? "badge-amber" : "badge-grey";
    return `<span class="badge ${cls}" style="flex:0 0 auto;">${percent}%</span>`;
  }

  // Renders a milestone <select> + a companion free-text input that only
  // shows when "Other" is picked. `attrs` distinguishes the always-present
  // add-row instance (ids) from the single edit-row instance (classes).
  function milestoneFieldHtml(attrs, currentValue) {
    if (!withMilestone) return "";
    const isCustom = currentValue && !BUILD_MILESTONES.includes(currentValue);
    return `
      <select ${attrs.select} style="flex:0 0 190px;">
        <option value="">Milestone (optional)</option>
        ${BUILD_MILESTONES.map((m) => `<option value="${escapeHtml(m)}" ${currentValue === m ? "selected" : ""}>${escapeHtml(m)}</option>`).join("")}
        <option value="${MILESTONE_CUSTOM_VALUE}" ${isCustom ? "selected" : ""}>Other (type your own)…</option>
      </select>
      <input type="text" ${attrs.custom} placeholder="Custom milestone" value="${isCustom ? escapeHtml(currentValue) : ""}" style="flex:0 0 160px; display:${isCustom ? "inline-block" : "none"};">
    `;
  }

  function readMilestone(selectEl, customEl) {
    if (!selectEl) return "";
    return selectEl.value === MILESTONE_CUSTOM_VALUE ? customEl.value.trim() : selectEl.value;
  }

  // Multi-select plot picker, falling back to a plain text input when no
  // plotOptions were supplied. Any plot name already on the item that
  // isn't in plotOptions (e.g. typed freetext from before this existed,
  // or a plot since renamed/deleted) is kept as a selected option too,
  // so editing an old item never silently drops it.
  function plotFieldHtml(attrs, currentValue) {
    if (!plotOptions.length) {
      return `<input type="text" ${attrs.plot} placeholder="Plot (optional)" value="${escapeHtml(currentValue)}">`;
    }
    const currentNames = currentValue.split(",").map((s) => s.trim()).filter(Boolean);
    const allOptions = [...new Set([...plotOptions, ...currentNames])];
    return `
      <select ${attrs.plot} multiple size="4" style="flex:0 0 150px;">
        ${allOptions.map((name) => `<option value="${escapeHtml(name)}" ${currentNames.includes(name) ? "selected" : ""}>${escapeHtml(name)}</option>`).join("")}
      </select>
    `;
  }

  function readPlot(el) {
    if (!plotOptions.length) return el.value.trim();
    return Array.from(el.selectedOptions).map((o) => o.value).join(", ");
  }

  function render() {
    container.innerHTML = `
      <ul class="item-list">
        ${items.map((item, i) => editingIndex === i ? `
          <li class="item-row editing">
            ${plotFieldHtml({ plot: 'class="item-edit-plot"' }, item.plot)}
            ${milestoneFieldHtml({ select: 'class="item-edit-milestone"', custom: 'class="item-edit-milestone-custom"' }, item.milestone || "")}
            <input type="text" class="item-edit-input" placeholder="Item (optional if milestone set)" value="${escapeHtml(item.text)}">
            ${withPercent ? `<input type="number" class="item-edit-percent" min="0" max="100" step="5" placeholder="%" value="${item.percent}" style="flex:0 0 80px;">` : ""}
            <button type="button" class="btn btn-sm btn-amber" data-save="${i}">Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-cancel="${i}">Cancel</button>
          </li>
        ` : `
          <li class="item-row">
            ${item.plot ? `<span class="plot-tag">${escapeHtml(item.plot)}</span>` : ""}
            ${item.milestone ? `<span class="milestone-tag">${escapeHtml(item.milestone)}</span>` : ""}
            <span>${escapeHtml(item.text)}</span>
            ${percentBadge(item.percent)}
            <button type="button" class="btn btn-sm btn-outline" data-edit="${i}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-delete="${i}">Delete</button>
          </li>
        `).join("")}
      </ul>
      <div class="item-add-row">
        ${plotFieldHtml({ plot: 'id="itemListNewPlot" class="item-plot-input"' }, "")}
        ${milestoneFieldHtml({ select: 'id="itemListNewMilestone"', custom: 'id="itemListNewMilestoneCustom"' }, "")}
        <input type="text" id="itemListNewInput" placeholder="Add an item… (optional if milestone set)">
        ${withPercent ? `<input type="number" id="itemListNewPercent" min="0" max="100" step="5" placeholder="%" style="flex:0 0 80px;">` : ""}
        <button type="button" class="btn btn-outline btn-sm" id="itemListAddBtn">+ Add</button>
      </div>
    `;

    // Reveal the free-text input only when "Other" is selected in its
    // adjacent milestone dropdown.
    if (withMilestone) {
      [container.querySelector("#itemListNewMilestone"), container.querySelector(".item-edit-milestone")]
        .filter(Boolean)
        .forEach((sel) => {
          sel.addEventListener("change", () => {
            const customInput = sel.nextElementSibling;
            if (sel.value === MILESTONE_CUSTOM_VALUE) {
              customInput.style.display = "inline-block";
              customInput.focus();
            } else {
              customInput.style.display = "none";
              customInput.value = "";
            }
          });
        });
    }

    container.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => { editingIndex = Number(btn.dataset.edit); render(); })
    );
    container.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", () => {
        items.splice(Number(btn.dataset.delete), 1);
        onChange(items);
        render();
      })
    );
    container.querySelectorAll("[data-save]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.save);
        const plotVal = readPlot(container.querySelector(".item-edit-plot"));
        const textVal = container.querySelector(".item-edit-input").value.trim();
        const milestoneVal = withMilestone ? readMilestone(container.querySelector(".item-edit-milestone"), container.querySelector(".item-edit-milestone-custom")) : "";
        if (textVal || milestoneVal) {
          items[i] = { ...items[i], plot: plotVal, text: textVal };
          if (withMilestone) items[i].milestone = milestoneVal;
          if (withPercent) {
            const percentVal = container.querySelector(".item-edit-percent").value;
            items[i].percent = percentVal === "" ? 0 : Math.max(0, Math.min(100, Number(percentVal)));
          }
        }
        editingIndex = null;
        onChange(items);
        render();
      })
    );
    container.querySelectorAll("[data-cancel]").forEach((btn) =>
      btn.addEventListener("click", () => { editingIndex = null; render(); })
    );

    const addBtn = container.querySelector("#itemListAddBtn");
    const plotInput = container.querySelector("#itemListNewPlot");
    const addInput = container.querySelector("#itemListNewInput");
    const percentInput = container.querySelector("#itemListNewPercent");
    function addItem() {
      const textVal = addInput.value.trim();
      const milestoneVal = withMilestone ? readMilestone(container.querySelector("#itemListNewMilestone"), container.querySelector("#itemListNewMilestoneCustom")) : "";
      if (!textVal && !milestoneVal) return;
      const newItem = { id: crypto.randomUUID(), plot: readPlot(plotInput), text: textVal };
      if (withMilestone) newItem.milestone = milestoneVal;
      if (withPercent) {
        const percentVal = percentInput.value;
        newItem.percent = percentVal === "" ? 0 : Math.max(0, Math.min(100, Number(percentVal)));
      }
      items.push(newItem);
      onChange(items);
      render();
      container.querySelector("#itemListNewInput").focus();
    }
    addBtn.addEventListener("click", addItem);
    const enterTriggers = [plotInput, addInput, percentInput, container.querySelector("#itemListNewMilestoneCustom")].filter(Boolean);
    enterTriggers.forEach((el) => el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addItem(); }
    }));
  }

  render();
  return { getItems: () => items };
}
