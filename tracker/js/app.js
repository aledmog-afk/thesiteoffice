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
// Mirrors the "site-photos" bucket's real limits (sql/schema.sql, v27) —
// this is a fast client-side check for a friendly error before spending
// time on an upload that the server would reject anyway; the actual
// enforcement lives in Supabase Storage's bucket config, not here.
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50 MB
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
]);

// Uploads a File to the public "site-photos" bucket under the given path
// and returns its public URL.
export async function uploadPhoto(file, path) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 50 MB.`);
  }
  // An empty file.type (some browsers omit it for less common extensions)
  // is let through client-side rather than guessed at — the bucket's own
  // MIME allow-list is the real, authoritative check either way.
  if (file.type && !ALLOWED_UPLOAD_MIME_TYPES.has(file.type)) {
    throw new Error(`"${file.name}" is a ${file.type} file, which isn't a supported type here.`);
  }
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

// ─── Organisation ───────────────────────────────────────────────
// Returns the signed-in user's organisation id, creating one for them
// the first time it's needed (e.g. right before their first project is
// created) — see ensure_organisation() in sql/schema.sql. Safe to call
// repeatedly; a user who already belongs to an organisation just gets
// its id back.
export async function ensureOrganisation() {
  const { data, error } = await supabase.rpc("ensure_organisation");
  if (error) throw error;
  return data;
}

// Returns the company logo URL for the given organisation (from
// org_settings) or null if none is set.
export async function getOrgLogoUrl(orgId) {
  if (!orgId) return null;
  const { data } = await supabase.from("org_settings").select("logo_url").eq("org_id", orgId).maybeSingle();
  return data?.logo_url || null;
}

// ─── Actions Engine ─────────────────────────────────────────────
// Server-side triggers (sql/schema.sql, v29 — actions_before_write())
// are the real authority for org_id derivation, status-transition
// validity, assignee legitimacy, and created_by/completed_at. These
// helpers exist only so every page uses the same Supabase query shape
// instead of duplicating it — they never substitute for that
// server-side enforcement, and a direct API call bypassing this file
// entirely is still fully covered by the database itself.
export const ACTION_STATUSES = ["open", "in_progress", "blocked", "completed", "cancelled"];
export const ACTION_STATUS_LABEL = { open: "Open", in_progress: "In Progress", blocked: "Blocked", completed: "Completed", cancelled: "Cancelled" };
export const ACTION_STATUS_BADGE = { open: "badge-grey", in_progress: "badge-blue", blocked: "badge-red", completed: "badge-green", cancelled: "badge-grey" };

export const ACTION_PRIORITIES = ["low", "medium", "high", "critical"];
export const ACTION_PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
export const ACTION_PRIORITY_BADGE = { low: "badge-grey", medium: "badge-blue", high: "badge-amber", critical: "badge-red" };

// Mirrors valid_action_status_transition() in sql/schema.sql exactly —
// duplicated here only for immediate UI feedback (e.g. only offering
// valid next statuses in a dropdown). The database is still the real
// authority and independently rejects anything this misses.
const ACTION_STATUS_TRANSITIONS = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["blocked", "completed", "cancelled"],
  blocked: ["in_progress", "cancelled"],
  completed: ["open"],
  cancelled: [],
};
export function validActionStatusTransitions(fromStatus) {
  return ACTION_STATUS_TRANSITIONS[fromStatus] || [];
}

// Due-date state for display. "overdue"/"due_today"/"upcoming" only
// apply while an action is still active work — completed/cancelled are
// their own terminal states regardless of due_date.
export function actionDueState(action, todayStr = todayISO()) {
  if (action.status === "completed") return "completed";
  if (action.status === "cancelled") return "cancelled";
  if (!action.due_date) return "none";
  if (action.due_date < todayStr) return "overdue";
  if (action.due_date === todayStr) return "due_today";
  return "upcoming";
}
export const ACTION_DUE_LABEL = { overdue: "Overdue", due_today: "Due Today", upcoming: "Upcoming", completed: "Completed", cancelled: "Cancelled", none: "" };
export const ACTION_DUE_BADGE = { overdue: "badge-red", due_today: "badge-amber", upcoming: "badge-grey", completed: "badge-green", cancelled: "badge-grey", none: "" };

export async function listActions(projectId) {
  const { data, error } = await supabase.from("actions").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getAction(actionId) {
  const { data, error } = await supabase.from("actions").select("*").eq("id", actionId).single();
  if (error) throw error;
  return data;
}

export async function createAction(projectId, { title, description = null, priority = "medium", assignedTo = null, dueDate = null }) {
  const { data, error } = await supabase.from("actions").insert({
    project_id: projectId,
    title,
    description,
    priority,
    assigned_to: assignedTo,
    due_date: dueDate,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateAction(actionId, fields) {
  const { data, error } = await supabase.from("actions").update(fields).eq("id", actionId).select().single();
  if (error) throw error;
  return data;
}

export async function changeActionStatus(actionId, status) {
  return updateAction(actionId, { status });
}

export async function assignAction(actionId, userId) {
  return updateAction(actionId, { assigned_to: userId });
}

export async function completeAction(actionId) {
  return updateAction(actionId, { status: "completed" });
}

export async function cancelAction(actionId) {
  return updateAction(actionId, { status: "cancelled" });
}

export async function deleteAction(actionId) {
  const { error } = await supabase.from("actions").delete().eq("id", actionId);
  if (error) throw error;
}

// ─── Inspections ────────────────────────────────────────────────
// Inspection -> Finding -> Evidence -> Action -> Owner -> Due Date ->
// Completion -> Audit Trail. A separate, general-purpose, ad-hoc
// inspection workflow — deliberately independent of hs_audits/
// hs_audit_items (a specific, fixed-checklist MONTHLY H&S compliance
// mechanism that already feeds monthly_reports; a genuinely different
// concept, left untouched). Findings that need follow-up link to the
// EXISTING actions table (Priority 5) via inspection_findings.action_id
// — there is no second task system. Server-side triggers (sql/schema.sql,
// v31) are the real authority for org_id/project_id derivation,
// created_by/created_at immutability, and cross-project linkage
// validation; these helpers exist only so every page shares one query
// shape.
export const INSPECTION_TYPES = ["quality", "health_safety", "progress", "handover", "general"];
export const INSPECTION_TYPE_LABEL = { quality: "Quality", health_safety: "Health & Safety", progress: "Progress", handover: "Handover", general: "General" };

export const INSPECTION_STATUSES = ["draft", "completed", "cancelled"];
export const INSPECTION_STATUS_LABEL = { draft: "Draft", completed: "Completed", cancelled: "Cancelled" };
export const INSPECTION_STATUS_BADGE = { draft: "badge-grey", completed: "badge-green", cancelled: "badge-red" };

export const FINDING_SEVERITIES = ["low", "medium", "high", "critical"];
export const FINDING_SEVERITY_LABEL = { low: "Low", medium: "Medium", high: "High", critical: "Critical" };
export const FINDING_SEVERITY_BADGE = { low: "badge-grey", medium: "badge-blue", high: "badge-amber", critical: "badge-red" };

export const FINDING_STATUSES = ["open", "action_required", "resolved", "accepted", "cancelled"];
export const FINDING_STATUS_LABEL = { open: "Open", action_required: "Action Required", resolved: "Resolved", accepted: "Accepted", cancelled: "Cancelled" };
export const FINDING_STATUS_BADGE = { open: "badge-red", action_required: "badge-amber", resolved: "badge-green", accepted: "badge-blue", cancelled: "badge-grey" };

// A finding still counts as outstanding work until it's explicitly
// resolved, accepted, or cancelled — used both for UI and for the
// dashboard-integration counts below.
export function isFindingOutstanding(finding) {
  return !["resolved", "accepted", "cancelled"].includes(finding.status);
}

export async function getInspections(projectId) {
  const { data, error } = await supabase.from("inspections").select("*").eq("project_id", projectId).order("inspection_date", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function getInspection(inspectionId) {
  const { data, error } = await supabase.from("inspections").select("*, projects(name)").eq("id", inspectionId).single();
  if (error) throw error;
  return data;
}

export async function createInspection(projectId, { title, inspectionType = "general", inspectionDate = todayISO(), conductedBy = null, description = null }) {
  const { data, error } = await supabase.from("inspections").insert({
    project_id: projectId,
    title,
    inspection_type: inspectionType,
    inspection_date: inspectionDate,
    conducted_by: conductedBy,
    description,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateInspection(inspectionId, fields) {
  const { data, error } = await supabase.from("inspections").update(fields).eq("id", inspectionId).select().single();
  if (error) throw error;
  return data;
}

export async function completeInspection(inspectionId) {
  return updateInspection(inspectionId, { status: "completed" });
}

export async function cancelInspection(inspectionId) {
  return updateInspection(inspectionId, { status: "cancelled" });
}

export async function deleteInspection(inspectionId) {
  const { error } = await supabase.from("inspections").delete().eq("id", inspectionId);
  if (error) throw error;
}

export async function getFindings(inspectionId) {
  const { data, error } = await supabase.from("inspection_findings").select("*").eq("inspection_id", inspectionId).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function createFinding(inspectionId, projectId, { title, description = null, severity = "medium" }) {
  const { data, error } = await supabase.from("inspection_findings").insert({
    inspection_id: inspectionId,
    project_id: projectId,
    title,
    description,
    severity,
  }).select().single();
  if (error) throw error;
  return data;
}

export async function updateFinding(findingId, fields) {
  const { data, error } = await supabase.from("inspection_findings").update(fields).eq("id", findingId).select().single();
  if (error) throw error;
  return data;
}

// Explicit, human-driven only — never called automatically because an
// Action was completed. See createActionFromFinding() below for the
// one deliberate, explicit status side-effect this module makes.
export async function resolveFinding(findingId) {
  return updateFinding(findingId, { status: "resolved" });
}

export async function deleteFinding(findingId) {
  const { error } = await supabase.from("inspection_findings").delete().eq("id", findingId);
  if (error) throw error;
}

// Creates a brand-new Action in the existing Actions Engine and links
// it back to this finding — the ONLY way a finding ever gets an
// action_id; nothing here happens automatically for every finding, only
// when a user explicitly clicks "Create Action". Also moves the finding
// to 'action_required' — a direct, deliberate consequence of that same
// explicit click, not a background workflow — so resolving it later is
// still always a separate, explicit step (resolveFinding() above).
export async function createActionFromFinding(finding, { title, description = null, assignedTo = null, priority = "medium", dueDate = null }) {
  const action = await createAction(finding.project_id, { title, description, priority, assignedTo, dueDate });
  const updated = await updateFinding(finding.id, { action_id: action.id, status: "action_required" });
  return { action, finding: updated };
}

export async function getFindingPhotos(findingId) {
  const { data, error } = await supabase.from("inspection_finding_photos").select("*").eq("finding_id", findingId).order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function addFindingPhoto(findingId, projectId, file) {
  const url = await uploadImage(file, `${projectId}/inspections`);
  const { data, error } = await supabase.from("inspection_finding_photos").insert({ finding_id: findingId, project_id: projectId, photo_url: url }).select().single();
  if (error) throw error;
  return data;
}

export async function deleteFindingPhoto(photoId) {
  const { error } = await supabase.from("inspection_finding_photos").delete().eq("id", photoId);
  if (error) throw error;
}

// ─── Snags / Defects (Priority 8) ──────────────────────────────
// snag_items has existed since the very first schema (a defect record:
// location, description, trade, photo, open/closed/rejected status) and
// stays exactly that — this only adds the missing accountability layer
// (assigned_to, due_date, verified_at/verified_by) and two optional
// links to the other control-loop records: inspection_finding_id (the
// snag's origin, if it came from a Finding) and action_id (its
// consequence, if follow-up work was raised). Server-side triggers
// (sql/schema.sql, v32) are the real authority for assignee/action/
// finding legitimacy and verification permission; these helpers exist
// only so every page shares one query shape. RLS on snag_items itself
// is UNCHANGED — still member-level, snagging-only members included,
// exactly as it always has been.
export const SNAG_PRIORITIES = ["low", "medium", "high"];
export const SNAG_PRIORITY_LABEL = { low: "Low", medium: "Medium", high: "High" };
export const SNAG_PRIORITY_BADGE = { low: "badge-grey", medium: "badge-blue", high: "badge-amber" };

export const SNAG_STATUSES = ["open", "closed", "rejected"];
export const SNAG_STATUS_LABEL = { open: "Open", closed: "Closed", rejected: "Rejected" };
export const SNAG_STATUS_BADGE = { open: "badge-red", closed: "badge-green", rejected: "badge-grey" };

export function isSnagOutstanding(snag) {
  return !["closed", "rejected"].includes(snag.status);
}

export async function listSnags(projectId) {
  const { data, error } = await supabase.from("snag_items").select("*").eq("project_id", projectId).order("item_no", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function getSnag(snagId) {
  const { data, error } = await supabase.from("snag_items").select("*, projects(name)").eq("id", snagId).single();
  if (error) throw error;
  return data;
}

export async function updateSnag(snagId, fields) {
  const { data, error } = await supabase.from("snag_items").update(fields).eq("id", snagId).select().single();
  if (error) throw error;
  return data;
}

export async function assignSnag(snagId, userId) {
  return updateSnag(snagId, { assigned_to: userId });
}

// "Resolve" in the sense this module uses it — moves status to
// 'closed'. Kept as its own function name (matching the app-wide
// convention of a named verb per lifecycle step) even though it's a
// thin wrapper, so pages never hand-write the status string.
export async function resolveSnag(snagId) {
  return updateSnag(snagId, { status: "closed" });
}

// Editor-only server-side (enforced by the trigger, not just here) —
// independent confirmation that a closed snag is genuinely fixed.
export async function verifySnag(snagId) {
  return updateSnag(snagId, { verified_at: new Date().toISOString() });
}

export async function unverifySnag(snagId) {
  return updateSnag(snagId, { verified_at: null });
}

// Creates a brand-new Action and links it back to this snag — the ONLY
// way a snag ever gets an action_id; nothing here happens automatically
// for every snag, only when a user explicitly clicks "Create Action".
// Unlike createActionFromFinding(), a snag's own status is left
// untouched (it stays whatever it already was) — snag_items has no
// "action_required" status to move it to, and it must stay open/
// tracked until the defect is actually fixed regardless of whether an
// Action now exists for it.
export async function createActionFromSnag(snag, { title, description = null, assignedTo = null, priority = "medium", dueDate = null }) {
  const action = await createAction(snag.project_id, { title, description, priority, assignedTo, dueDate });
  const updated = await updateSnag(snag.id, { action_id: action.id });
  return { action, snag: updated };
}

// Every snag-viewing page (snag-list-edit.html, snagging.html) filters
// strictly by snag_list_id, so a snag can't just be inserted without one
// or it's invisible in the UI. Findings aren't tied to a plot, so this
// gets-or-creates one general, project-wide list to hold them — the same
// "general list" convention weekly-report-form.html already established
// for its own auto-raised snags (resolveSnagListId(), general list titled
// "Weekly Report Issues"), reused here rather than invented fresh.
const FINDING_SNAG_LIST_TITLE = "Inspection Findings";

async function resolveFindingSnagListId(projectId) {
  const { data: existing, error: findError } = await supabase
    .from("snag_lists")
    .select("id")
    .eq("project_id", projectId)
    .is("plot_id", null)
    .ilike("title", FINDING_SNAG_LIST_TITLE)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing.id;

  const { data: { user } } = await supabase.auth.getUser();
  const { data: created, error: createError } = await supabase
    .from("snag_lists")
    .insert({ project_id: projectId, plot_id: null, title: FINDING_SNAG_LIST_TITLE, created_by: user.id })
    .select()
    .single();
  if (createError) throw createError;
  return created.id;
}

// Creates a brand-new snag from an inspection finding and links it back
// (inspection_finding_id) — the origin references its consequence's
// origin, not the reverse. Also moves the FINDING to 'action_required',
// the same status a finding gets when an Action is created from it —
// reusing that existing vocabulary rather than inventing a new one,
// since a linked snag is exactly the same kind of "this now has
// tracked follow-up" signal.
export async function createSnagFromFinding(finding, { location, description = null, trade = null, priority = "medium" }) {
  const { data: { user } } = await supabase.auth.getUser();
  const snagListId = await resolveFindingSnagListId(finding.project_id);
  const { data: snag, error } = await supabase.from("snag_items").insert({
    project_id: finding.project_id,
    snag_list_id: snagListId,
    location,
    description: description ?? finding.description ?? finding.title,
    trade,
    priority,
    inspection_finding_id: finding.id,
    raised_date: todayISO(),
    created_by: user.id,
  }).select().single();
  if (error) throw error;
  const updatedFinding = await updateFinding(finding.id, { status: "action_required" });
  return { snag, finding: updatedFinding };
}

// ─── Project Control Dashboard ─────────────────────────────────
// "What requires my attention right now?" — built entirely on top of
// Actions (the one genuinely date-driven, unambiguous urgency signal
// this schema has) plus hs_audit_items' real severity column for
// unresolved high-severity H&S issues. Every query below is
// UNFILTERED by project_id and relies entirely on each table's own RLS
// (is_project_editor()) to return only rows the caller can already
// see — the same "broad select, RLS does the real scoping" pattern
// dashboard.html already used for snag_items before this priority
// existed. This is not a security shortcut: RLS is the actual boundary
// either way, and a database view/RPC would enforce nothing more.
export const DUE_SOON_DAYS = 7;

// Independent, non-exclusive category flags for one action — an action
// can be both overdue AND high/critical priority at once. Only active
// (not completed/cancelled) actions ever carry a true flag.
export function categoriseAction(action, todayStr = todayISO()) {
  const cats = { overdue: false, dueToday: false, dueSoon: false, blocked: false, highCritical: false };
  if (["completed", "cancelled"].includes(action.status)) return cats;
  if (action.status === "blocked") cats.blocked = true;
  if (action.priority === "high" || action.priority === "critical") cats.highCritical = true;
  if (action.due_date) {
    if (action.due_date < todayStr) cats.overdue = true;
    else if (action.due_date === todayStr) cats.dueToday = true;
    else {
      const due = new Date(action.due_date + "T00:00:00");
      const today = new Date(todayStr + "T00:00:00");
      const days = Math.round((due - today) / 86400000);
      if (days > 0 && days <= DUE_SOON_DAYS) cats.dueSoon = true;
    }
  }
  return cats;
}

// Rolls a raw actions array into the counts computeControlStatus() and
// the summary cards need. completed/cancelled are excluded from every
// count here (openActions and all category counts alike) — they are
// resolved work, not exceptions.
export function aggregateActionCounts(actions, todayStr = todayISO()) {
  const counts = { openActions: 0, overdue: 0, overdueCritical: 0, dueToday: 0, dueSoon: 0, blocked: 0, highCritical: 0 };
  for (const a of actions) {
    if (!["completed", "cancelled"].includes(a.status)) counts.openActions++;
    const cats = categoriseAction(a, todayStr);
    if (cats.overdue) { counts.overdue++; if (cats.highCritical) counts.overdueCritical++; }
    if (cats.dueToday) counts.dueToday++;
    if (cats.dueSoon) counts.dueSoon++;
    if (cats.blocked) counts.blocked++;
    if (cats.highCritical) counts.highCritical++;
  }
  return counts;
}

export function countHighSeverityHsIssues(hsItems) {
  return (hsItems || []).filter((h) => h.status === "non_compliant" && h.severity === "high").length;
}

// Inspection-finding signals for the dashboard (Priority 7) — only
// rules the actual data model can support cleanly: a critical finding
// is urgent on its own; a high-severity finding only becomes urgent
// once it has a linked Action whose own due_date says so (findings
// themselves have no due date). actionsById must contain every action
// visible to the caller (already fetched for the Actions counts above)
// so this adds no extra query.
export function countFindingSignals(findings, actionsById, todayStr = todayISO()) {
  let criticalOpenFindings = 0;
  let highSeverityOverdueLinkedFindings = 0;
  let highSeverityDueSoonLinkedFindings = 0;
  for (const f of findings || []) {
    if (!isFindingOutstanding(f)) continue;
    if (f.severity === "critical") criticalOpenFindings++;
    if (f.severity === "high" && f.action_id) {
      const linkedAction = actionsById.get(f.action_id);
      if (linkedAction) {
        const cats = categoriseAction(linkedAction, todayStr);
        if (cats.overdue) highSeverityOverdueLinkedFindings++;
        else if (cats.dueSoon) highSeverityDueSoonLinkedFindings++;
      }
    }
  }
  return { criticalOpenFindings, highSeverityOverdueLinkedFindings, highSeverityDueSoonLinkedFindings };
}

// Snag signals (Priority 8) — mirrors categoriseAction()/
// aggregateActionCounts() exactly, on the snag's own due_date, since
// snag_items now carries one just like actions do. A rejected/closed
// snag is resolved work, not an exception, same exclusion rule
// isSnagOutstanding() already uses everywhere else. Priority alone
// (with no due date) only ever reaches Watch, mirroring how an
// action's own high/critical priority works — never Attention on
// priority alone, and never a fabricated numeric score.
export function categoriseSnag(snag, todayStr = todayISO()) {
  const cats = { overdue: false, dueToday: false, dueSoon: false, highPriority: false };
  if (!isSnagOutstanding(snag)) return cats;
  if (snag.priority === "high") cats.highPriority = true;
  if (snag.due_date) {
    if (snag.due_date < todayStr) cats.overdue = true;
    else if (snag.due_date === todayStr) cats.dueToday = true;
    else {
      const due = new Date(snag.due_date + "T00:00:00");
      const today = new Date(todayStr + "T00:00:00");
      const days = Math.round((due - today) / 86400000);
      if (days > 0 && days <= DUE_SOON_DAYS) cats.dueSoon = true;
    }
  }
  return cats;
}

export function countSnagSignals(snags, todayStr = todayISO()) {
  const counts = { overdueSnags: 0, dueTodaySnags: 0, dueSoonSnags: 0, highPrioritySnags: 0 };
  for (const s of snags || []) {
    const cats = categoriseSnag(s, todayStr);
    if (cats.overdue) counts.overdueSnags++;
    if (cats.dueToday) counts.dueTodaySnags++;
    if (cats.dueSoon) counts.dueSoonSnags++;
    if (cats.highPriority) counts.highPrioritySnags++;
  }
  return counts;
}

// ─── Programme Variance (Priority 11, Phase 4) ───────────────────
// Plan -> Forecast -> Actual -> Variance -> Exception -> Action. Pure,
// deterministic, injectable-today functions mirroring
// categoriseAction()/countSnagSignals() exactly, so programme
// exceptions plug into the EXISTING Project Control Dashboard rather
// than becoming a second one. No Gantt, no dependency/critical-path
// engine, no AI, and no numeric "programme health" score — only what
// the real planned/forecast/actual dates already say.

// A forecast slipping by a handful of days is routine, actively-
// managed noise, not something a manager needs alerting on; a slip
// beyond this many calendar days is treated as material (Attention)
// rather than routine (Watch). A DELIBERATELY separate constant from
// DUE_SOON_DAYS (Actions' own "coming up soon" window) — both happen
// to land near a working week, but forecast slippage and action-due
// proximity are different concepts, free to diverge independently
// later. A milestone gets no such allowance at all (see
// categoriseProgrammeActivity below) — any forecast slip on a
// milestone is treated as material on its own, since a milestone is
// typically an externally-significant date (practical completion, a
// statutory test) where "a few days late" is not routine the way it
// can be for an ordinary task.
export const PROGRAMME_MATERIAL_DELAY_DAYS = 5;

// Whole calendar days between two ISO (YYYY-MM-DD) dates, laterStr -
// earlierStr (positive when laterStr is actually later). Both
// operands are parsed as a LOCAL midnight the same way
// categoriseAction()/categoriseSnag() already parse due_date, so the
// two Date constructions' own timezone offsets cancel out in the
// subtraction — this is calendar-date arithmetic, not a wall-clock/
// UTC computation, and deliberately reuses that exact established
// idiom rather than introducing a second one. A boolean "is this
// later/earlier" comparison never needs this at all — two ISO date
// strings already compare correctly with plain </>, since
// YYYY-MM-DD sorts lexicographically the same as chronologically.
function diffCalendarDays(laterStr, earlierStr) {
  const later = new Date(laterStr + "T00:00:00");
  const earlier = new Date(earlierStr + "T00:00:00");
  return Math.round((later - earlier) / 86400000);
}

// Classifies ONE programme activity's variance against `todayStr`
// (injectable for deterministic testing — never a scattered `new
// Date()`). Independent, non-exclusive boolean flags (the same shape
// categoriseAction() already established) plus a single best-fit
// `label` for a one-word UI badge (Overdue/Late/Ahead/On Plan/
// Completed Late/Completed Early/Completed On Plan/Cancelled/No Plan
// Date). A cancelled activity carries no variance judgement at all —
// it was deliberately stopped, not a programme failure. A completed
// activity's variance is permanently historical (actual vs planned)
// and never touches the "still open" fields (overdue/forecastLate) —
// a completed activity can never be "overdue" no matter how late it
// finished.
export function categoriseProgrammeActivity(activity, todayStr = todayISO()) {
  const cats = {
    overdue: false, forecastLate: false, materialForecastDelay: false,
    completedLate: false, completedEarly: false, completedOnPlan: false,
    upcoming: false, forecastVarianceDays: null, actualVarianceDays: null,
    label: "on_plan",
  };

  if (activity.status === "cancelled") { cats.label = "cancelled"; return cats; }

  if (activity.status === "complete") {
    if (activity.planned_finish && activity.actual_finish) {
      cats.actualVarianceDays = diffCalendarDays(activity.actual_finish, activity.planned_finish);
      if (cats.actualVarianceDays > 0) { cats.completedLate = true; cats.label = "completed_late"; }
      else if (cats.actualVarianceDays < 0) { cats.completedEarly = true; cats.label = "completed_early"; }
      else { cats.completedOnPlan = true; cats.label = "completed_on_plan"; }
    } else {
      cats.label = "completed";
    }
    return cats;
  }

  // not_started / in_progress from here on — the only statuses a
  // "still open" variance judgement (overdue/forecast-late/upcoming)
  // can meaningfully apply to.
  if (!activity.planned_finish) {
    cats.label = "no_plan_date";
  } else {
    if (activity.planned_finish < todayStr) { cats.overdue = true; cats.label = "overdue"; }

    if (activity.forecast_finish) {
      cats.forecastVarianceDays = diffCalendarDays(activity.forecast_finish, activity.planned_finish);
      if (activity.forecast_finish > activity.planned_finish) {
        cats.forecastLate = true;
        const threshold = activity.is_milestone ? 0 : PROGRAMME_MATERIAL_DELAY_DAYS;
        if (cats.forecastVarianceDays > threshold) cats.materialForecastDelay = true;
        if (!cats.overdue) cats.label = "late";
      } else if (!cats.overdue) {
        cats.label = activity.forecast_finish < activity.planned_finish ? "ahead" : "on_plan";
      }
    }
  }

  // "Upcoming" is informational only (brief: must not flood the
  // dashboard) — computed here and exposed via countProgrammeSignals()
  // for the Programme page, but computeControlStatus() deliberately
  // never reads it.
  const startRef = activity.forecast_start || activity.planned_start;
  if (startRef) {
    const daysUntilStart = diffCalendarDays(startRef, todayStr);
    if (daysUntilStart >= 0 && daysUntilStart <= DUE_SOON_DAYS) cats.upcoming = true;
  }

  return cats;
}

export const PROGRAMME_VARIANCE_LABEL = {
  overdue: "Overdue", late: "Late", ahead: "Ahead", on_plan: "On Plan",
  completed_late: "Completed Late", completed_early: "Completed Early", completed_on_plan: "Completed On Plan",
  completed: "Completed", cancelled: "Cancelled", no_plan_date: "No Plan Date",
};
export const PROGRAMME_VARIANCE_BADGE = {
  overdue: "badge-red", late: "badge-amber", ahead: "badge-green", on_plan: "badge-grey",
  completed_late: "badge-amber", completed_early: "badge-green", completed_on_plan: "badge-green",
  completed: "badge-green", cancelled: "badge-grey", no_plan_date: "badge-grey",
};

// Rolls a raw programme_activities array (one project's activities, or
// every visible project's activities for the portfolio view) into the
// counts computeControlStatus() and the Programme page both need.
// Mirrors countSnagSignals()'s own shape and "count, don't score"
// philosophy exactly — completedLateProgrammeActivities and
// upcomingProgrammeActivities are deliberately NOT fed into
// computeControlStatus() (see its own comment): a historical late
// completion is not a CURRENT exception, and upcoming work is not an
// exception at all, just useful context for the Programme page.
export function countProgrammeSignals(rows, todayStr = todayISO()) {
  const counts = {
    overdueProgrammeActivities: 0,
    overdueProgrammeMilestones: 0,
    forecastLateProgrammeActivities: 0,
    materialForecastLateProgrammeActivities: 0,
    forecastLateProgrammeMilestones: 0,
    completedLateProgrammeActivities: 0,
    upcomingProgrammeActivities: 0,
  };
  for (const a of rows || []) {
    const cats = categoriseProgrammeActivity(a, todayStr);
    if (cats.overdue) {
      if (a.is_milestone) counts.overdueProgrammeMilestones++;
      else counts.overdueProgrammeActivities++;
    } else if (cats.forecastLate) {
      if (a.is_milestone) counts.forecastLateProgrammeMilestones++;
      else {
        counts.forecastLateProgrammeActivities++;
        if (cats.materialForecastDelay) counts.materialForecastLateProgrammeActivities++;
      }
    }
    if (cats.completedLate) counts.completedLateProgrammeActivities++;
    if (cats.upcoming) counts.upcomingProgrammeActivities++;
  }
  return counts;
}

// A transparent, explainable control status — never a numeric score.
// ATTENTION: overdue actions, blocked actions, overdue snags, or
// unresolved high-severity H&S issues exist — all unambiguous
// exceptions.
// WATCH: nothing above, but something's coming up (due today/soon) or
// there's open high/critical-priority work.
// ON TRACK: no open exception of any kind. `restricted` is a distinct
// 4th level (see getPortfolioControlSummary) for a snagging-only
// member — it is never "on track", since that would misrepresent data
// they simply aren't entitled to see, not data that's actually healthy.
export function computeControlStatus(counts) {
  const attentionReasons = [];
  if (counts.overdue > 0) attentionReasons.push(`${counts.overdue} overdue action${counts.overdue === 1 ? "" : "s"}${counts.overdueCritical ? ` (${counts.overdueCritical} critical)` : ""}`);
  if (counts.blocked > 0) attentionReasons.push(`${counts.blocked} blocked`);
  if (counts.highSeverityHs > 0) attentionReasons.push(`${counts.highSeverityHs} unresolved high-severity H&S issue${counts.highSeverityHs === 1 ? "" : "s"}`);
  if (counts.criticalOpenFindings > 0) attentionReasons.push(`${counts.criticalOpenFindings} critical open inspection finding${counts.criticalOpenFindings === 1 ? "" : "s"}`);
  if (counts.highSeverityOverdueLinkedFindings > 0) attentionReasons.push(`${counts.highSeverityOverdueLinkedFindings} high-severity finding${counts.highSeverityOverdueLinkedFindings === 1 ? "" : "s"} with an overdue Action`);
  if (counts.overdueSnags > 0) attentionReasons.push(`${counts.overdueSnags} overdue snag${counts.overdueSnags === 1 ? "" : "s"}`);
  if (counts.overdueProgrammeActivities > 0) attentionReasons.push(`${counts.overdueProgrammeActivities} programme activit${counts.overdueProgrammeActivities === 1 ? "y is" : "ies are"} overdue`);
  if (counts.overdueProgrammeMilestones > 0) attentionReasons.push(`${counts.overdueProgrammeMilestones} programme milestone${counts.overdueProgrammeMilestones === 1 ? "" : "s"} overdue`);
  if (counts.materialForecastLateProgrammeActivities > 0) attentionReasons.push(`${counts.materialForecastLateProgrammeActivities} programme activit${counts.materialForecastLateProgrammeActivities === 1 ? "y" : "ies"} forecast materially late`);
  if (counts.forecastLateProgrammeMilestones > 0) attentionReasons.push(`${counts.forecastLateProgrammeMilestones} programme milestone${counts.forecastLateProgrammeMilestones === 1 ? "" : "s"} forecast late`);
  if (attentionReasons.length) {
    return { level: "attention", label: "Attention", reason: `Attention — ${attentionReasons.join(", ")}.` };
  }

  const watchReasons = [];
  if (counts.dueToday > 0) watchReasons.push(`${counts.dueToday} due today`);
  if (counts.dueSoon > 0) watchReasons.push(`${counts.dueSoon} due within ${DUE_SOON_DAYS} days`);
  if (counts.highCritical > 0) watchReasons.push(`${counts.highCritical} high/critical priority open`);
  if (counts.highSeverityDueSoonLinkedFindings > 0) watchReasons.push(`${counts.highSeverityDueSoonLinkedFindings} high-severity finding${counts.highSeverityDueSoonLinkedFindings === 1 ? "" : "s"} with an Action due soon`);
  if (counts.dueTodaySnags > 0) watchReasons.push(`${counts.dueTodaySnags} snag${counts.dueTodaySnags === 1 ? "" : "s"} due today`);
  if (counts.dueSoonSnags > 0) watchReasons.push(`${counts.dueSoonSnags} snag${counts.dueSoonSnags === 1 ? "" : "s"} due within ${DUE_SOON_DAYS} days`);
  if (counts.highPrioritySnags > 0) watchReasons.push(`${counts.highPrioritySnags} high-priority snag${counts.highPrioritySnags === 1 ? "" : "s"} open`);
  // Only the ROUTINE (non-material) share of forecast-late activities
  // reaches Watch — the material share was already folded into
  // Attention above, and must never be counted twice.
  const minorForecastLateProgrammeActivities = (counts.forecastLateProgrammeActivities || 0) - (counts.materialForecastLateProgrammeActivities || 0);
  if (minorForecastLateProgrammeActivities > 0) watchReasons.push(`${minorForecastLateProgrammeActivities} programme activit${minorForecastLateProgrammeActivities === 1 ? "y" : "ies"} forecast late`);
  if (watchReasons.length) {
    return { level: "watch", label: "Watch", reason: `Watch — ${watchReasons.join(", ")}.` };
  }

  return counts.openActions > 0
    ? { level: "on_track", label: "On Track", reason: `On track — ${counts.openActions} open action${counts.openActions === 1 ? "" : "s"}, no exceptions.` }
    : { level: "on_track", label: "On Track", reason: "On track — no open actions." };
}

export const CONTROL_LEVEL_BADGE = { attention: "badge-red", watch: "badge-amber", on_track: "badge-green", restricted: "badge-grey" };
export const CONTROL_LEVEL_ORDER = { attention: 0, watch: 1, on_track: 2, restricted: 3 };

// Every project the caller can at least see (RLS: is_project_member),
// plus its role, so a snagging-only project can be labelled honestly
// instead of showing a fabricated "0 exceptions" status for data that
// role was never entitled to see in the first place. Uses ONE bulk
// get_my_project_roles() call rather than one get_my_role() call per
// project — avoids an N+1 pattern that would otherwise scale with the
// number of projects on every dashboard load.
async function getProjectsWithRole() {
  const [{ data: projects, error }, { data: roleRows, error: roleErr }] = await Promise.all([
    supabase.from("projects").select("id, name, status, rag_status").order("name"),
    supabase.rpc("get_my_project_roles"),
  ]);
  if (error) throw error;
  if (roleErr) throw roleErr;
  const roleByProject = {};
  (roleRows || []).forEach((r) => { roleByProject[r.project_id] = r.role; });
  return (projects || []).map((p) => ({ ...p, myRole: roleByProject[p.id] || null }));
}

// One fixed, small number of broad queries (never one per project) —
// actions and hs_audit_items are each fetched ONCE, unfiltered, and
// grouped client-side by project_id. This scales with total row count,
// not project count, and is the same shape dashboard.html already used
// for snag_items/weekly_reports before Actions existed.
export async function getPortfolioControlSummary() {
  const [projects, { data: actions, error: actErr }, { data: hsItems, error: hsErr }, { data: findings, error: findErr }, { data: snags, error: snagErr }, { data: progActivities, error: progErr }] = await Promise.all([
    getProjectsWithRole(),
    supabase.from("actions").select("id, project_id, status, priority, due_date"),
    supabase.from("hs_audit_items").select("project_id, status, severity"),
    supabase.from("inspection_findings").select("id, project_id, severity, status, action_id"),
    supabase.from("snag_items").select("project_id, status, priority, due_date"),
    supabase.from("programme_activities").select("project_id, is_milestone, status, planned_start, planned_finish, forecast_start, forecast_finish, actual_finish, programmes(status)"),
  ]);
  if (actErr) throw actErr;
  if (hsErr) throw hsErr;
  if (findErr) throw findErr;
  if (snagErr) throw snagErr;
  if (progErr) throw progErr;

  const todayStr = todayISO();
  const actionsByProject = new Map();
  const actionsById = new Map();
  for (const a of actions || []) {
    if (!actionsByProject.has(a.project_id)) actionsByProject.set(a.project_id, []);
    actionsByProject.get(a.project_id).push(a);
    actionsById.set(a.id, a);
  }
  const hsByProject = new Map();
  for (const h of hsItems || []) {
    if (!hsByProject.has(h.project_id)) hsByProject.set(h.project_id, []);
    hsByProject.get(h.project_id).push(h);
  }
  const findingsByProject = new Map();
  for (const f of findings || []) {
    if (!findingsByProject.has(f.project_id)) findingsByProject.set(f.project_id, []);
    findingsByProject.get(f.project_id).push(f);
  }
  const snagsByProject = new Map();
  for (const s of snags || []) {
    if (!snagsByProject.has(s.project_id)) snagsByProject.set(s.project_id, []);
    snagsByProject.get(s.project_id).push(s);
  }
  // Only the project's ACTIVE programme's activities count toward
  // control status — a draft programme is still being set up (not yet
  // being tracked against) and an archived one is retired history;
  // neither should generate a current exception. Filtered client-side
  // rather than a second, narrower query, matching this function's own
  // "one broad select per table" shape.
  const progActivitiesByProject = new Map();
  for (const a of progActivities || []) {
    if (a.programmes?.status !== "active") continue;
    if (!progActivitiesByProject.has(a.project_id)) progActivitiesByProject.set(a.project_id, []);
    progActivitiesByProject.get(a.project_id).push(a);
  }

  const rows = projects.map((project) => {
    if (project.myRole !== "owner" && project.myRole !== "collaborator") {
      return { project, counts: null, status: { level: "restricted", label: "Snagging Only", reason: "Snagging-only access — control data isn't visible at this role." } };
    }
    const counts = aggregateActionCounts(actionsByProject.get(project.id) || [], todayStr);
    counts.highSeverityHs = countHighSeverityHsIssues(hsByProject.get(project.id) || []);
    Object.assign(counts, countFindingSignals(findingsByProject.get(project.id) || [], actionsById, todayStr));
    Object.assign(counts, countSnagSignals(snagsByProject.get(project.id) || [], todayStr));
    Object.assign(counts, countProgrammeSignals(progActivitiesByProject.get(project.id) || [], todayStr));
    return { project, counts, status: computeControlStatus(counts) };
  });

  rows.sort((a, b) =>
    CONTROL_LEVEL_ORDER[a.status.level] - CONTROL_LEVEL_ORDER[b.status.level]
    || (b.counts?.overdue || 0) - (a.counts?.overdue || 0)
    || a.project.name.localeCompare(b.project.name)
  );

  const totals = rows.reduce((acc, r) => {
    if (!r.counts) return acc;
    acc.openActions += r.counts.openActions;
    acc.overdue += r.counts.overdue;
    acc.dueToday += r.counts.dueToday;
    acc.blocked += r.counts.blocked;
    acc.highCritical += r.counts.highCritical;
    acc.overdueProgrammeActivities += r.counts.overdueProgrammeActivities;
    acc.overdueProgrammeMilestones += r.counts.overdueProgrammeMilestones;
    acc.materialForecastLateProgrammeActivities += r.counts.materialForecastLateProgrammeActivities;
    acc.forecastLateProgrammeMilestones += r.counts.forecastLateProgrammeMilestones;
    return acc;
  }, { openActions: 0, overdue: 0, dueToday: 0, blocked: 0, highCritical: 0, overdueProgrammeActivities: 0, overdueProgrammeMilestones: 0, materialForecastLateProgrammeActivities: 0, forecastLateProgrammeMilestones: 0 });

  return { rows, totals, projectsRequiringAttention: rows.filter((r) => r.status.level === "attention").length };
}

export async function getProjectControlSummary(projectId) {
  const [actions, { data: hsItems, error: hsErr }, { data: findings, error: findErr }, { data: snags, error: snagErr }, { data: progActivities, error: progErr }] = await Promise.all([
    listActions(projectId),
    supabase.from("hs_audit_items").select("status, severity").eq("project_id", projectId),
    supabase.from("inspection_findings").select("id, severity, status, action_id").eq("project_id", projectId),
    supabase.from("snag_items").select("status, priority, due_date").eq("project_id", projectId),
    supabase.from("programme_activities").select("is_milestone, status, planned_start, planned_finish, forecast_start, forecast_finish, actual_finish, programmes(status)").eq("project_id", projectId),
  ]);
  if (hsErr) throw hsErr;
  if (findErr) throw findErr;
  if (snagErr) throw snagErr;
  if (progErr) throw progErr;
  const todayStr = todayISO();
  const counts = aggregateActionCounts(actions, todayStr);
  counts.highSeverityHs = countHighSeverityHsIssues(hsItems || []);
  const actionsById = new Map(actions.map((a) => [a.id, a]));
  Object.assign(counts, countFindingSignals(findings || [], actionsById, todayStr));
  Object.assign(counts, countSnagSignals(snags || [], todayStr));
  const activeProgActivities = (progActivities || []).filter((a) => a.programmes?.status === "active");
  Object.assign(counts, countProgrammeSignals(activeProgActivities, todayStr));
  return { actions, counts, status: computeControlStatus(counts) };
}

// Existing counts that support the picture without driving the control
// status itself — their statuses don't carry the same clear "overdue"
// semantics an Action's due_date does (e.g. "pending_client_review" is
// a normal in-flight state, not automatically an exception).
export async function getProjectSupportingSignals(projectId) {
  const [{ data: snags }, { data: gates }, { data: commercial }] = await Promise.all([
    supabase.from("snag_items").select("status").eq("project_id", projectId),
    supabase.from("quality_gates").select("status").eq("project_id", projectId),
    supabase.from("commercial_items").select("status").eq("project_id", projectId),
  ]);
  return {
    openSnags: (snags || []).filter((s) => s.status === "open").length,
    outstandingGates: (gates || []).filter((g) => !["approved", "not_applicable"].includes(g.status)).length,
    pendingCommercial: (commercial || []).filter((c) => c.status === "pending_client_review").length,
  };
}

// Actions actually worth surfacing in an "attention" list — overdue,
// due today, due soon, blocked, or high/critical priority, among still-
// active work. Portfolio-wide when no projectId is given (still RLS-
// scoped, same as everything else here); embeds the project name via
// the real actions.project_id -> projects FK relationship PostgREST
// already exposes elsewhere in this app (e.g. weekly-report-view.html).
export async function getAttentionActions({ projectId } = {}) {
  let query = supabase.from("actions").select("id, project_id, title, status, priority, assigned_to, due_date, projects(name)");
  if (projectId) query = query.eq("project_id", projectId);
  const { data, error } = await query;
  if (error) throw error;
  const todayStr = todayISO();
  const rank = (x) => (x.categories.overdue ? 0 : x.categories.dueToday ? 1 : x.categories.blocked ? 2 : x.categories.dueSoon ? 3 : 4);
  return (data || [])
    .map((a) => ({ ...a, categories: categoriseAction(a, todayStr) }))
    .filter((a) => a.categories.overdue || a.categories.dueToday || a.categories.dueSoon || a.categories.blocked || a.categories.highCritical)
    .sort((a, b) => rank(a) - rank(b) || (a.due_date || "9999-99-99").localeCompare(b.due_date || "9999-99-99"));
}

// Batches one get_project_members() call per DISTINCT project (never
// per action/row) to resolve assigned_to user ids to display emails —
// already an editor-gated RPC (see sql/schema.sql), so this adds no
// new exposure.
export async function getMemberEmailMap(projectIds) {
  const unique = [...new Set(projectIds)];
  const results = await Promise.all(unique.map((id) => supabase.rpc("get_project_members", { p_project_id: id })));
  const map = {};
  results.forEach(({ data }) => (data || []).forEach((m) => { map[m.user_id] = m.email; }));
  return map;
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

// Stamps a plot as fully handed over the moment ALL its quality gates
// are Approved (or N/A — same exclusion rule the gate-approval ratios
// use elsewhere) and ALL its handover documents are Approved/Final.
// Called after any gate/document change on plot-detail.html. Only ever
// sets handed_over_at once — it's a completion date, not a live status,
// so it's never cleared if a gate is later reverted — and a plot with
// no gates or no documents at all can never be "handed over" by this
// check, since there's nothing to judge completeness from. Returns
// true if this call is what just completed the plot (false otherwise,
// including "already complete"), purely for callers that want to react
// to it — nothing currently does.
export async function checkAndMarkPlotHandedOver(plotId) {
  const [{ data: gates }, { data: docs }, { data: plot }] = await Promise.all([
    supabase.from("quality_gates").select("status").eq("plot_id", plotId),
    supabase.from("handover_documents").select("status").eq("plot_id", plotId),
    supabase.from("plots").select("handed_over_at").eq("id", plotId).single(),
  ]);
  if (!gates?.length || !docs?.length || plot?.handed_over_at) return false;
  const gatesReady = gates.every((g) => g.status === "approved" || g.status === "not_applicable");
  const docsReady = docs.every((d) => d.status === "approved_final");
  if (!gatesReady || !docsReady) return false;
  await supabase.from("plots").update({ handed_over_at: new Date().toISOString() }).eq("id", plotId);
  return true;
}

// ─── Plot Control / Handover Readiness (Priority 12, Phase 1) ─────
//
// "What is the current control position of this plot, and what known
// items are preventing or threatening handover?" — answered by
// CONNECTING data that already exists and is already plot-linked
// (Quality Gates, Handover Documents, Programme Activities via
// plot_id, Snags via their plot's own snag list) rather than adding a
// new module or a new plot lifecycle. Deliberately does NOT add
// actions.plot_id / inspection_findings.plot_id this phase — see
// tracker/README.md for why, and the Phase 1 report for the decision.
//
// IMPORTANT (confirmed against real production data before writing
// this): snag_items.plot_id is populated ONLY for the rare project-
// wide ("general") snag list where a user optionally tags one item to
// a plot. The normal, everyday case — a snag raised against a plot's
// own auto-seeded snag list — leaves snag_items.plot_id null and
// relies entirely on snag_lists.plot_id instead (of 70 real snag items
// in production, only 4 carried plot_id directly; 60 relied on their
// list's plot_id). Every plot-scoped snag query below accounts for
// BOTH paths — querying snag_items.plot_id alone would silently miss
// the large majority of real plot snags.

// A plot's own snag list (unique per plot, auto-seeded — see
// seed_plot_defaults() in sql/schema.sql), plus any snag items
// directly tagged to this plot from a general/site-wide list, merged
// and deduped by id.
async function getPlotSnags(plotId) {
  const { data: list, error: listErr } = await supabase.from("snag_lists").select("id").eq("plot_id", plotId).maybeSingle();
  if (listErr) throw listErr;
  const [byList, byDirectTag] = await Promise.all([
    list ? supabase.from("snag_items").select("*").eq("snag_list_id", list.id) : Promise.resolve({ data: [] }),
    supabase.from("snag_items").select("*").eq("plot_id", plotId),
  ]);
  if (byList.error) throw byList.error;
  if (byDirectTag.error) throw byDirectTag.error;
  const byId = new Map();
  for (const s of [...(byList.data || []), ...(byDirectTag.data || [])]) byId.set(s.id, s);
  return [...byId.values()];
}

// Quality Gates: "ready" mirrors checkAndMarkPlotHandedOver()'s own,
// already-established definition exactly (approved OR not_applicable)
// — not a new rule. A plot with zero gate rows recorded is neither
// ready nor outstanding; it's simply excluded from the gate
// consideration (see computePlotHandoverReadiness's zero-guard below),
// the same non-alarming posture checkAndMarkPlotHandedOver() already
// takes for a plot with nothing recorded yet. There is no "required vs
// not required" flag in this data model beyond not_applicable itself
// — every gate/document row that exists for a plot is implicitly
// required, exactly as the existing handover check already assumes.
export function summarisePlotGates(gates) {
  const total = gates.length;
  const approved = gates.filter((g) => g.status === "approved" || g.status === "not_applicable").length;
  return { total, approved, outstanding: total - approved };
}

// Handover Documents: "ready" mirrors checkAndMarkPlotHandedOver()'s
// own definition exactly (approved_final). No not_applicable-equivalent
// exists for documents in this data model — every row is implicitly
// required, same as gates.
export function summarisePlotDocuments(docs) {
  const total = docs.length;
  const approved = docs.filter((d) => d.status === "approved_final").length;
  return { total, approved, outstanding: total - approved };
}

// The pure, deterministic readiness calculation — no network calls, no
// Date.now(), an explicit injectable asOfDate exactly like
// categoriseProgrammeActivity()/categoriseSnag() already use. Reuses
// countProgrammeSignals()/categoriseSnag() directly rather than
// reimplementing any date/variance logic — this is NOT a second
// definition of programme or snag health.
//
// "Critical snag" (the brief's own suggested hard-blocker wording)
// cannot be implemented literally: SNAG_PRIORITIES has no tier above
// "high" (unlike FINDING_SEVERITIES' low/medium/high/critical) — there
// is no headroom in this data model for a "critical" tier distinct
// from "high". The nearest defensible, non-invented equivalent —
// combining two fields this codebase already uses together elsewhere
// for exactly this kind of split (see countFindingSignals()'s own
// highSeverityOverdueLinkedFindings vs highSeverityDueSoonLinkedFindings)
// — is an OPEN, HIGH-priority snag that is ALSO overdue. A high-priority
// snag that isn't yet overdue, or an overdue snag that isn't
// high-priority, is a warning, never a blocker on its own.
//
// A historical completed-late programme activity is deliberately never
// a blocker or warning here (see the report) — completedLate/upcoming
// counts are exposed for information only, mirroring Phase 4's own
// computeControlStatus(), which never reads them either.
//
// editorDataVisible must reflect the CALLER's real role (owner/
// collaborator vs snagging-only) — Quality Gates, Handover Documents
// and Programme are editor-only RLS, so a snagging-only caller's
// "gates"/"handoverDocuments"/"programmeActivities" arrays will always
// arrive empty regardless of the real data, and must never be silently
// read as "all clear". Snags remain member-level and are always
// evaluated regardless of role.
export function computePlotHandoverReadiness(plot, {
  gates = [], handoverDocuments = [], snags = [], programmeActivities = [], editorDataVisible = true,
} = {}, asOfDate = todayISO()) {
  const qualityGates = summarisePlotGates(gates);
  const handoverDocumentsSummary = summarisePlotDocuments(handoverDocuments);
  const programmeCounts = countProgrammeSignals(programmeActivities, asOfDate);

  const blockers = [];
  const warnings = [];

  let openSnags = 0, blockingSnags = 0, warningSnags = 0;
  for (const s of snags) {
    if (!isSnagOutstanding(s)) continue;
    openSnags++;
    const cats = categoriseSnag(s, asOfDate);
    if (cats.overdue && cats.highPriority) blockingSnags++;
    else if (cats.overdue || cats.highPriority) warningSnags++;
  }
  if (blockingSnags > 0) {
    blockers.push({ code: "snags_blocking", label: `${blockingSnags} open high-priority snag${blockingSnags === 1 ? "" : "s"} overdue` });
  }
  if (warningSnags > 0) {
    warnings.push({ code: "snags_warning", label: `${warningSnags} open snag${warningSnags === 1 ? "" : "s"} either overdue or high-priority` });
  }

  if (editorDataVisible) {
    if (qualityGates.total > 0 && qualityGates.outstanding > 0) {
      blockers.push({ code: "gates_outstanding", label: `${qualityGates.outstanding} of ${qualityGates.total} Quality Gate${qualityGates.total === 1 ? "" : "s"} not yet approved` });
    }
    if (handoverDocumentsSummary.total > 0 && handoverDocumentsSummary.outstanding > 0) {
      blockers.push({ code: "documents_outstanding", label: `${handoverDocumentsSummary.outstanding} of ${handoverDocumentsSummary.total} Handover Document${handoverDocumentsSummary.total === 1 ? "" : "s"} not yet approved / final` });
    }
    if (programmeCounts.overdueProgrammeActivities > 0) {
      warnings.push({ code: "programme_overdue_activity", label: `${programmeCounts.overdueProgrammeActivities} programme activit${programmeCounts.overdueProgrammeActivities === 1 ? "y is" : "ies are"} overdue` });
    }
    if (programmeCounts.overdueProgrammeMilestones > 0) {
      warnings.push({ code: "programme_overdue_milestone", label: `${programmeCounts.overdueProgrammeMilestones} programme milestone${programmeCounts.overdueProgrammeMilestones === 1 ? "" : "s"} overdue` });
    }
    if (programmeCounts.materialForecastLateProgrammeActivities > 0) {
      warnings.push({ code: "programme_forecast_late_activity", label: `${programmeCounts.materialForecastLateProgrammeActivities} programme activit${programmeCounts.materialForecastLateProgrammeActivities === 1 ? "y" : "ies"} forecast materially late` });
    }
    if (programmeCounts.forecastLateProgrammeMilestones > 0) {
      warnings.push({ code: "programme_forecast_late_milestone", label: `${programmeCounts.forecastLateProgrammeMilestones} programme milestone${programmeCounts.forecastLateProgrammeMilestones === 1 ? "" : "s"} forecast late` });
    }
    // "Approaching handover with unresolved items" (brief) — only
    // meaningful once something is ALREADY outstanding; a plot with
    // nothing outstanding approaching its finish date is simply on
    // schedule, not at risk. Deliberately evaluated last, after every
    // other blocker/warning above has been gathered.
    if (programmeCounts.upcomingProgrammeActivities > 0 && (blockers.length > 0 || warnings.length > 0)) {
      warnings.push({ code: "approaching_with_unresolved", label: `A programme activity is due within ${DUE_SOON_DAYS} days with unresolved items still outstanding` });
    }
  }

  let status;
  if (plot.handed_over_at) status = "handed_over";
  else if (!editorDataVisible) status = "restricted";
  else if (blockers.length > 0) status = "not_ready";
  else if (warnings.length > 0) status = "at_risk";
  else status = "ready";

  return {
    status, asOfDate, editorDataVisible, handedOverAt: plot.handed_over_at || null,
    programme: { hasActivities: programmeActivities.length > 0, total: programmeActivities.length, ...programmeCounts },
    snags: { total: snags.length, open: openSnags, blocking: blockingSnags, warning: warningSnags },
    qualityGates, handoverDocuments: handoverDocumentsSummary,
    blockers, warnings,
  };
}

export const PLOT_READINESS_LABEL = {
  handed_over: "Handed Over", restricted: "Restricted", not_ready: "Not Ready", at_risk: "At Risk", ready: "Ready",
};
export const PLOT_READINESS_BADGE = {
  handed_over: "badge-green", restricted: "badge-grey", not_ready: "badge-red", at_risk: "badge-amber", ready: "badge-green",
};
export const PLOT_READINESS_ORDER = { not_ready: 0, at_risk: 1, restricted: 2, ready: 3, handed_over: 4 };

// Single-plot fetch for plot-detail.html — one broad query per
// underlying table, scoped to this one plot, plus the caller's own
// role (needed so Quality Gates/Handover Documents/Programme, all
// editor-only RLS, are never silently read as "all clear" for a
// snagging-only viewer — see computePlotHandoverReadiness's own
// comment on editorDataVisible).
export async function getPlotHandoverReadiness(plotId) {
  const { data: plot, error: plotErr } = await supabase.from("plots").select("*").eq("id", plotId).single();
  if (plotErr) throw plotErr;

  const [{ data: role }, { data: gates, error: gatesErr }, { data: docs, error: docsErr }, snags, { data: progActivities, error: progErr }] = await Promise.all([
    supabase.rpc("get_my_role", { p_project_id: plot.project_id }),
    supabase.from("quality_gates").select("*").eq("plot_id", plotId),
    supabase.from("handover_documents").select("*").eq("plot_id", plotId),
    getPlotSnags(plotId),
    supabase.from("programme_activities").select("*, programmes(status)").eq("plot_id", plotId),
  ]);
  if (gatesErr) throw gatesErr;
  if (docsErr) throw docsErr;
  if (progErr) throw progErr;

  const editorDataVisible = role === "owner" || role === "collaborator";
  const activeProgActivities = (progActivities || []).filter((a) => a.programmes?.status === "active");
  const readiness = computePlotHandoverReadiness(plot, {
    gates: gates || [], handoverDocuments: docs || [], snags, programmeActivities: activeProgActivities, editorDataVisible,
  }, todayISO());
  return { plot, readiness };
}

// Portfolio (one project's) fetch for plot-handovers.html — a FIXED,
// small number of broad, project_id-scoped queries (never one per
// plot), grouped client-side, the exact same shape
// getPortfolioControlSummary()/getProjectControlSummary() already use.
// One get_my_role() call for the whole project (this page is already
// scoped to one project), never one per plot.
export async function getProjectPlotReadiness(projectId) {
  const [{ data: role }, { data: plots, error: plotsErr }, { data: gates, error: gatesErr }, { data: docs, error: docsErr }, { data: lists, error: listsErr }, { data: snagRows, error: snagErr }, { data: progActivities, error: progErr }] = await Promise.all([
    supabase.rpc("get_my_role", { p_project_id: projectId }),
    supabase.from("plots").select("*").eq("project_id", projectId),
    supabase.from("quality_gates").select("plot_id, status").eq("project_id", projectId).not("plot_id", "is", null),
    supabase.from("handover_documents").select("plot_id, status").eq("project_id", projectId).not("plot_id", "is", null),
    supabase.from("snag_lists").select("id, plot_id").eq("project_id", projectId),
    supabase.from("snag_items").select("plot_id, snag_list_id, status, priority, due_date").eq("project_id", projectId),
    supabase.from("programme_activities").select("plot_id, is_milestone, status, planned_start, planned_finish, forecast_start, forecast_finish, actual_finish, programmes(status)").eq("project_id", projectId).not("plot_id", "is", null),
  ]);
  if (plotsErr) throw plotsErr;
  if (gatesErr) throw gatesErr;
  if (docsErr) throw docsErr;
  if (listsErr) throw listsErr;
  if (snagErr) throw snagErr;
  if (progErr) throw progErr;

  const editorDataVisible = role === "owner" || role === "collaborator";
  const todayStr = todayISO();

  const groupByPlot = (rows) => {
    const map = new Map();
    for (const r of rows || []) {
      if (!r.plot_id) continue;
      if (!map.has(r.plot_id)) map.set(r.plot_id, []);
      map.get(r.plot_id).push(r);
    }
    return map;
  };
  const gatesByPlot = groupByPlot(gates);
  const docsByPlot = groupByPlot(docs);

  const listPlotById = new Map((lists || []).map((l) => [l.id, l.plot_id]));
  const snagsByPlot = new Map();
  for (const s of snagRows || []) {
    const effectivePlotId = s.plot_id || listPlotById.get(s.snag_list_id) || null;
    if (!effectivePlotId) continue;
    if (!snagsByPlot.has(effectivePlotId)) snagsByPlot.set(effectivePlotId, []);
    snagsByPlot.get(effectivePlotId).push(s);
  }

  const progByPlot = new Map();
  for (const a of progActivities || []) {
    if (a.programmes?.status !== "active") continue;
    if (!progByPlot.has(a.plot_id)) progByPlot.set(a.plot_id, []);
    progByPlot.get(a.plot_id).push(a);
  }

  return (plots || []).map((plot) => ({
    plot,
    readiness: computePlotHandoverReadiness(plot, {
      gates: gatesByPlot.get(plot.id) || [],
      handoverDocuments: docsByPlot.get(plot.id) || [],
      snags: snagsByPlot.get(plot.id) || [],
      programmeActivities: progByPlot.get(plot.id) || [],
      editorDataVisible,
    }, todayStr),
  }));
}

// A weekly report's plot tag is freetext ("5", "5,6,7") and a plot's own
// name is also freetext ("Plot 5", or just "5") — normalise both to
// their digits where possible so "Plot 5" and "5" are recognised as the
// same plot, falling back to a case-insensitive exact match for
// non-numeric plot names.
export function normalisePlotToken(s) {
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
// Pass { withVerification: true } to add a Clerk of Works "Quality
// Verification & Notes" field to every item (e.g. "Pre-plaster check
// signed off") — used for progress items only, so a report reads as a
// verified works audit rather than just a contractor-reported %.
// Calls onChange(items) whenever the list changes. Returns { getItems }.
export function mountItemListEditor(container, initialItems, onChange, { withPercent = false, withMilestone = false, withVerification = false, plotOptions = [] } = {}) {
  function normalise(item) {
    if (typeof item === "string") {
      return { id: crypto.randomUUID(), plot: "", text: item, ...(withPercent ? { percent: 0 } : {}), ...(withMilestone ? { milestone: "" } : {}), ...(withVerification ? { verification_notes: "" } : {}) };
    }
    return {
      id: item.id || crypto.randomUUID(),
      plot: item.plot || "",
      text: item.text || "",
      ...(withPercent ? { percent: typeof item.percent === "number" ? item.percent : 0 } : {}),
      ...(withMilestone ? { milestone: item.milestone || "" } : {}),
      ...(withVerification ? { verification_notes: item.verification_notes || "" } : {}),
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
            ${withVerification ? `<input type="text" class="item-edit-verification" placeholder="CoW quality verification &amp; notes" value="${escapeHtml(item.verification_notes)}" style="flex:1 1 100%;">` : ""}
            <button type="button" class="btn btn-sm btn-amber" data-save="${i}">Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-cancel="${i}">Cancel</button>
          </li>
        ` : `
          <li class="item-row" style="${withVerification ? "flex-wrap:wrap;" : ""}">
            ${item.plot ? `<span class="plot-tag">${escapeHtml(item.plot)}</span>` : ""}
            ${item.milestone ? `<span class="milestone-tag">${escapeHtml(item.milestone)}</span>` : ""}
            <span>${escapeHtml(item.text)}</span>
            ${percentBadge(item.percent)}
            <button type="button" class="btn btn-sm btn-outline" data-edit="${i}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-delete="${i}">Delete</button>
            ${withVerification && item.verification_notes ? `<span class="hint" style="flex:1 1 100%;">CoW: ${escapeHtml(item.verification_notes)}</span>` : ""}
          </li>
        `).join("")}
      </ul>
      <div class="item-add-row" style="${withVerification ? "flex-wrap:wrap;" : ""}">
        ${plotFieldHtml({ plot: 'id="itemListNewPlot" class="item-plot-input"' }, "")}
        ${milestoneFieldHtml({ select: 'id="itemListNewMilestone"', custom: 'id="itemListNewMilestoneCustom"' }, "")}
        <input type="text" id="itemListNewInput" placeholder="Add an item… (optional if milestone set)">
        ${withPercent ? `<input type="number" id="itemListNewPercent" min="0" max="100" step="5" placeholder="%" style="flex:0 0 80px;">` : ""}
        ${withVerification ? `<input type="text" id="itemListNewVerification" placeholder="CoW quality verification &amp; notes (optional)" style="flex:1 1 100%;">` : ""}
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
          if (withVerification) {
            items[i].verification_notes = container.querySelector(".item-edit-verification").value.trim();
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
    const verificationInput = container.querySelector("#itemListNewVerification");
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
      if (withVerification) newItem.verification_notes = verificationInput.value.trim();
      items.push(newItem);
      onChange(items);
      render();
      container.querySelector("#itemListNewInput").focus();
    }
    addBtn.addEventListener("click", addItem);
    const enterTriggers = [plotInput, addInput, percentInput, verificationInput, container.querySelector("#itemListNewMilestoneCustom")].filter(Boolean);
    enterTriggers.forEach((el) => el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addItem(); }
    }));
  }

  render();
  return { getItems: () => items };
}

// ─── Weekly report: Clerk of Works compliance record fields ──────
// Compliance status tagged onto each site photo, alongside a Plot/Area
// and Inspection Category/Element caption — see PHOTO_COMPLIANCE_BADGE
// and the photo gallery in weekly-report-form.html/weekly-report-view.html.
export const PHOTO_COMPLIANCE_STATUS = ["Approved / Compliant", "Action Required", "Info Only"];
export const PHOTO_COMPLIANCE_BADGE = { "Approved / Compliant": "badge-green", "Action Required": "badge-red", "Info Only": "badge-blue" };

// Resource adequacy rating on the Labour & Site Resource Tracker.
export const RESOURCE_ADEQUACY = ["Adequate", "Low / Risk to Programme"];
export const RESOURCE_ADEQUACY_BADGE = { "Adequate": "badge-green", "Low / Risk to Programme": "badge-red" };

// Impact level on the Risk & Delays Tracker — a traffic light like
// HS_SEVERITY above, but kept as its own constant since it's a
// separate feature (weekly report risks, not H&S audit findings) that
// shouldn't have to change if one or the other's wording ever diverges.
export const RISK_IMPACT_LEVELS = ["Low", "Medium", "High"];
export const RISK_IMPACT_BADGE = { Low: "badge-green", Medium: "badge-amber", High: "badge-red" };

// Suggested (not exhaustive — the owner field stays freetext) action
// owners on the Risk & Delays Tracker.
export const RISK_OWNER_SUGGESTIONS = ["Main Contractor", "Employer's Agent", "Utility Provider", "Client", "Design Team"];

// Statutory Witnessing / Building Control / Warranty inspection types
// and outcomes for the Statutory & Testing Milestones log.
export const STATUTORY_MILESTONE_TYPES = ["Air Permeability Test", "Sound Test", "Drainage Pressure Test", "Building Control Inspection", "NHBC / Premier Warranty Inspection", "Other"];
export const STATUTORY_OUTCOMES = ["Pass", "Fail", "Pending", "Signed Off"];
export const STATUTORY_OUTCOME_BADGE = { Pass: "badge-green", Fail: "badge-red", Pending: "badge-amber", "Signed Off": "badge-blue" };

// Generic add/edit/delete table-shaped editor, sharing the same
// interaction pattern as mountCommercialEditor but driven by a
// `columns` definition so it can serve several differently-shaped
// tables without re-writing the same render/edit/delete plumbing each
// time — currently the weekly report's Labour & Site Resource Tracker,
// Risk & Delays Tracker, and Statutory & Testing Milestones log.
//
// Each column: { key, label, type: 'text'|'number'|'select'|'date',
// options (for select), placeholder, datalist (id of a <datalist> the
// page itself renders, for freetext suggestions), badgeMap (for
// select columns — value -> badge CSS class, used in the compact
// row view), flex (CSS flex-basis for the input, default varies by
// type) }.
// Calls onChange(rows) whenever the table changes. Returns { getRows }.
export function mountTableEditor(container, initialRows, onChange, { columns }) {
  function normalise(row) {
    const out = { id: row.id || crypto.randomUUID() };
    columns.forEach((col) => { out[col.key] = row[col.key] ?? (col.type === "number" ? null : ""); });
    return out;
  }
  let rows = (initialRows || []).map(normalise);
  let editingId = null;

  function fieldHtml(col, value, cls) {
    const val = value ?? "";
    const flex = col.flex || (col.type === "select" ? "0 0 170px" : col.type === "date" ? "0 0 150px" : col.type === "number" ? "0 0 100px" : "1 1 160px");
    const listAttr = col.datalist ? ` list="${col.datalist}"` : "";
    if (col.type === "select") {
      // A leading blank option so "nothing chosen" is representable —
      // without it a <select> defaults to its first real option, which
      // would make an empty add-row silently pick up e.g. "Adequate" or
      // "Low" and defeat the "ignore an all-blank add" guard below.
      return `<select class="${cls}" data-key="${col.key}" style="flex:${flex};">
        <option value="" ${val === "" ? "selected" : ""}>${escapeHtml(col.placeholder || "—")}</option>
        ${col.options.map((o) => `<option value="${escapeHtml(o)}" ${val === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
      </select>`;
    }
    if (col.type === "date") {
      return `<input type="date" class="${cls}" data-key="${col.key}" value="${escapeHtml(val)}" style="flex:${flex};">`;
    }
    if (col.type === "number") {
      return `<input type="number" class="${cls}" data-key="${col.key}" value="${val === "" ? "" : val}" placeholder="${escapeHtml(col.placeholder || "")}" style="flex:${flex};">`;
    }
    return `<input type="text" class="${cls}" data-key="${col.key}"${listAttr} value="${escapeHtml(val)}" placeholder="${escapeHtml(col.placeholder || "")}" style="flex:${flex};">`;
  }

  function readFields(scopeEl) {
    const out = {};
    columns.forEach((col) => {
      const el = scopeEl.querySelector(`[data-key="${col.key}"]`);
      const raw = el.value;
      out[col.key] = col.type === "number" ? (raw === "" ? null : Number(raw)) : raw.trim();
    });
    return out;
  }

  function hasAnyValue(fields) {
    return columns.some((col) => fields[col.key] || fields[col.key] === 0);
  }

  function summaryHtml(row) {
    return columns.map((col) => {
      const v = row[col.key];
      if (!v && v !== 0) return "";
      if (col.type === "select" && col.badgeMap) {
        return `<span class="badge ${col.badgeMap[v] || "badge-grey"}" style="flex:0 0 auto;">${escapeHtml(v)}</span>`;
      }
      return `<span>${escapeHtml(col.type === "date" ? formatDate(v) : String(v))}</span>`;
    }).join("");
  }

  function render() {
    container.innerHTML = `
      <ul class="item-list">
        ${rows.map((row) => editingId === row.id ? `
          <li class="item-row editing te-row" style="flex-wrap:wrap;" data-id="${row.id}">
            ${columns.map((col) => fieldHtml(col, row[col.key], "te-field")).join("")}
            <button type="button" class="btn btn-sm btn-amber" data-save="${row.id}">Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-cancel="${row.id}">Cancel</button>
          </li>
        ` : `
          <li class="item-row" style="flex-wrap:wrap;">
            ${summaryHtml(row)}
            <button type="button" class="btn btn-sm btn-outline" data-edit="${row.id}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-delete="${row.id}">Delete</button>
          </li>
        `).join("")}
      </ul>
      <div class="item-add-row te-add-row" style="flex-wrap:wrap;">
        ${columns.map((col) => fieldHtml(col, "", "te-field")).join("")}
        <button type="button" class="btn btn-outline btn-sm" id="teAddBtn">+ Add</button>
      </div>
    `;

    container.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => { editingId = btn.dataset.edit; render(); })
    );
    container.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", () => {
        rows = rows.filter((r) => r.id !== btn.dataset.delete);
        onChange(rows);
        render();
      })
    );
    container.querySelectorAll("[data-cancel]").forEach((btn) =>
      btn.addEventListener("click", () => { editingId = null; render(); })
    );
    container.querySelectorAll("[data-save]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const li = btn.closest(".te-row");
        const fields = readFields(li);
        rows = rows.map((r) => r.id === btn.dataset.save ? { id: r.id, ...fields } : r);
        editingId = null;
        onChange(rows);
        render();
      })
    );

    const addRow = container.querySelector(".te-add-row");
    container.querySelector("#teAddBtn").addEventListener("click", () => {
      const fields = readFields(addRow);
      if (!hasAnyValue(fields)) return;
      rows.push({ id: crypto.randomUUID(), ...fields });
      onChange(rows);
      render();
    });
  }

  render();
  return { getRows: () => rows };
}

// ─── Weekly Reporting: system-generated position (Priority 9) ────
// A weekly report already had a rich HUMAN side — progress, weather,
// labour, risks, commercial items, photos, all pre-existing, all
// exactly what they always were. This section adds the SYSTEM side:
// what Actions/Snags/Inspections/H&S actually say "as of" the report's
// own reporting period, structured the same transparent way
// getProjectControlSummary() (Priority 6) already established — counts
// plus a plain-English Attention/Watch/On Track reason, never a
// numeric score. The one deliberate difference from the Dashboard:
// every calculation here is anchored on the report's own week_ending,
// never the real "today" — a report about a past week must always show
// the same position however long after that week it's actually opened,
// and must be exactly reproducible in a test against fixed dates, never
// the live clock. Server-side triggers (sql/schema.sql, v33 —
// weekly_reports_before_write()) are the real authority for the
// status lifecycle and for locking content once approved/issued; these
// functions exist only so every page shares one query shape and one
// definition of "during this period," same as every prior priority.

// Extracts the calendar-date component of a Postgres timestamptz value
// (e.g. "2026-09-08T14:30:00+00:00" -> "2026-09-08") by slicing the ISO
// string directly — never via `new Date(ts).toLocaleDateString()` or
// toLocalISODate(new Date(ts)), both of which depend on the browser's
// own local timezone offset. Period-membership checks need one fixed,
// deterministic definition regardless of who's viewing the report or
// what timezone a test happens to run in.
export function dateOfTimestamp(ts) {
  return ts ? String(ts).slice(0, 10) : null;
}

// The one, single definition of "happened during this reporting
// period" every function below uses — a plain `date` string (or the
// date component of a timestamp, via dateOfTimestamp() above) falling
// within [weekStarting, weekEnding] inclusive.
export function inPeriod(dateStr, weekStarting, weekEnding) {
  return !!dateStr && dateStr >= weekStarting && dateStr <= weekEnding;
}

// Mirrors categoriseAction()'s own exclusion list — completed/cancelled
// actions are resolved work, not outstanding, regardless of due_date.
function isActionOutstanding(action) {
  return !["completed", "cancelled"].includes(action.status);
}

// ─── Actions ─────────────────────────────────────────────────────
export function summariseActionsForReport(actions, period) {
  const { weekStarting, weekEnding } = period;
  const overdue = actions.filter((a) => categoriseAction(a, weekEnding).overdue);
  const dueDuringPeriod = actions.filter((a) => isActionOutstanding(a) && inPeriod(a.due_date, weekStarting, weekEnding));
  const blocked = actions.filter((a) => a.status === "blocked");
  const highCriticalOpen = actions.filter((a) => isActionOutstanding(a) && ["high", "critical"].includes(a.priority));
  const createdDuringPeriod = actions.filter((a) => inPeriod(dateOfTimestamp(a.created_at), weekStarting, weekEnding));
  const completedDuringPeriod = actions.filter((a) => a.completed_at && inPeriod(dateOfTimestamp(a.completed_at), weekStarting, weekEnding));
  return { overdue, dueDuringPeriod, blocked, highCriticalOpen, createdDuringPeriod, completedDuringPeriod };
}

export async function getWeeklyReportActions(projectId, period) {
  const { data, error } = await supabase.from("actions").select("id, title, status, priority, assigned_to, due_date, created_at, completed_at").eq("project_id", projectId);
  if (error) throw error;
  return summariseActionsForReport(data || [], period);
}

// ─── Snags / Defects ────────────────────────────────────────────
export function summariseSnagsForReport(snags, period) {
  const { weekStarting, weekEnding } = period;
  const overdue = snags.filter((s) => categoriseSnag(s, weekEnding).overdue);
  const highPriorityOpen = snags.filter((s) => isSnagOutstanding(s) && s.priority === "high");
  const raisedDuringPeriod = snags.filter((s) => inPeriod(s.raised_date, weekStarting, weekEnding));
  const closedDuringPeriod = snags.filter((s) => inPeriod(s.closed_date, weekStarting, weekEnding));
  const verifiedDuringPeriod = snags.filter((s) => s.verified_at && inPeriod(dateOfTimestamp(s.verified_at), weekStarting, weekEnding));
  return { overdue, highPriorityOpen, raisedDuringPeriod, closedDuringPeriod, verifiedDuringPeriod };
}

export async function getWeeklyReportSnags(projectId, period) {
  const { data, error } = await supabase.from("snag_items").select("id, item_no, location, description, priority, status, raised_date, closed_date, verified_at, snag_list_id").eq("project_id", projectId);
  if (error) throw error;
  return summariseSnagsForReport(data || [], period);
}

// ─── Inspections / Findings ─────────────────────────────────────
// "Inspections completed during period" uses inspection_date (a real,
// deliberately-set field — when the inspection actually happened) not
// created_at/updated_at, which would only say when the database row was
// last touched. "Findings resolved during period" uses resolved_at
// (v33 — set/cleared on transition into/out of 'resolved', mirroring
// actions.completed_at exactly) rather than updated_at, which any
// unrelated edit (a note, a severity change) would also touch.
export function summariseInspectionsForReport(findings, inspections, period) {
  const { weekStarting, weekEnding } = period;
  const openFindings = findings.filter(isFindingOutstanding);
  const criticalFindings = openFindings.filter((f) => f.severity === "critical");
  const highSeverityFindings = openFindings.filter((f) => f.severity === "high");
  const resolvedDuringPeriod = findings.filter((f) => f.resolved_at && inPeriod(dateOfTimestamp(f.resolved_at), weekStarting, weekEnding));
  const completedDuringPeriod = inspections.filter((i) => i.status === "completed" && inPeriod(i.inspection_date, weekStarting, weekEnding));
  return { openFindings, criticalFindings, highSeverityFindings, resolvedDuringPeriod, completedDuringPeriod };
}

export async function getWeeklyReportInspections(projectId, period) {
  const [{ data: findings, error: findErr }, { data: inspections, error: inspErr }] = await Promise.all([
    supabase.from("inspection_findings").select("id, title, severity, status, action_id, inspection_id, resolved_at").eq("project_id", projectId),
    supabase.from("inspections").select("id, title, status, inspection_date").eq("project_id", projectId),
  ]);
  if (findErr) throw findErr;
  if (inspErr) throw inspErr;
  return summariseInspectionsForReport(findings || [], inspections || [], period);
}

// ─── H&S ──────────────────────────────────────────────────────────
// Only the two signals hs_audits/hs_audit_items can actually support
// reliably: whether the calendar month this reporting period falls in
// has an audit logged yet (the same month-bucket check project.html's
// own "⚠️ No H&S audit logged this month" flag already uses), and the
// existing unresolved-high-severity count the Dashboard already
// computes. hs_audits/hs_audit_items themselves are untouched.
export function summariseHsForReport(hsAudits, hsItems, period) {
  const monthOfPeriod = monthStartISO(new Date(period.weekEnding + "T00:00:00"));
  const auditLoggedThisMonth = (hsAudits || []).some((a) => a.month === monthOfPeriod);
  const highSeverityOpenCount = countHighSeverityHsIssues(hsItems);
  return { auditLoggedThisMonth, highSeverityOpenCount };
}

export async function getWeeklyReportHs(projectId, period) {
  const [{ data: hsAudits, error: auditErr }, { data: hsItems, error: itemsErr }] = await Promise.all([
    supabase.from("hs_audits").select("month").eq("project_id", projectId),
    supabase.from("hs_audit_items").select("status, severity").eq("project_id", projectId),
  ]);
  if (auditErr) throw auditErr;
  if (itemsErr) throw itemsErr;
  return summariseHsForReport(hsAudits || [], hsItems || [], period);
}

// ─── Exceptions (Red / Amber / Green) ───────────────────────────
// Reuses the EXACT SAME counting/status functions the Project Control
// Dashboard (Priority 6-8) already established — aggregateActionCounts(),
// countHighSeverityHsIssues(), countFindingSignals(), countSnagSignals(),
// computeControlStatus() — with one deliberate difference: every one of
// them is called with the report's own week_ending as the reference
// date, never todayISO(). Same transparent Attention/Watch/On Track
// levels, same "never a numeric score, never a manufactured green" rule
// — just anchored to the reporting period instead of the live clock.
export function computeReportExceptions({ actions, snags, findings, hsItems }, period) {
  const referenceDate = period.weekEnding;
  const counts = aggregateActionCounts(actions, referenceDate);
  counts.highSeverityHs = countHighSeverityHsIssues(hsItems);
  const actionsById = new Map(actions.map((a) => [a.id, a]));
  Object.assign(counts, countFindingSignals(findings, actionsById, referenceDate));
  Object.assign(counts, countSnagSignals(snags, referenceDate));
  return { counts, status: computeControlStatus(counts) };
}

// ─── Programme Control Signal (Priority 11, Phase 5) ──────────────
// Reuses countProgrammeSignals() (Phase 4) exactly — no second
// definition of programme health. Deliberately anchored to
// `asOfDate` (the report's own week_ending), never todayISO(), the
// same rule computeReportExceptions() above already established for
// Actions/Snags/Findings/H&S: a historical report must show what the
// programme position genuinely was as of that week, not today's live
// figures silently substituted in. Kept as its OWN plain counts
// object — deliberately NOT folded into computeReportExceptions()'s
// counts/computeControlStatus() call, since the brief asks for a
// clearly separate "Programme Control Signal" block, not a blended
// Attention/Watch judgement; the underlying categorisation logic is
// still the identical Phase 4 function, only the presentation differs.
export function computeWeeklyProgrammeSignal(programme, activities, asOfDate) {
  if (!programme) {
    return {
      hasActiveProgramme: false, programmeName: null, asOfDate, totalActivities: 0,
      overdueProgrammeActivities: 0, forecastLateProgrammeActivities: 0, materialForecastLateProgrammeActivities: 0,
      overdueProgrammeMilestones: 0, forecastLateProgrammeMilestones: 0,
      completedLateProgrammeActivities: 0, upcomingProgrammeActivities: 0,
    };
  }
  const counts = countProgrammeSignals(activities, asOfDate);
  return { hasActiveProgramme: true, programmeName: programme.name, asOfDate, totalActivities: activities.length, ...counts };
}

// Network wrapper mirroring getWeeklyReportExceptions()'s own shape —
// fetches the project's active programme and (if one exists) its
// activities, then hands off to the pure function above. Only ever
// used where the caller needs the programme signal in isolation (e.g.
// a focused test); getWeeklyReportPosition() below folds this into
// its own single Promise.all round rather than calling this wrapper,
// to avoid fetching the active programme twice on a real page load.
export async function getWeeklyReportProgrammeSignal(projectId, asOfDate) {
  const programme = await getActiveProgramme(projectId);
  const activities = programme ? await listProgrammeActivities(programme.id) : [];
  return computeWeeklyProgrammeSignal(programme, activities, asOfDate);
}

export async function getWeeklyReportExceptions(projectId, period) {
  const [{ data: actions, error: actErr }, { data: snags, error: snagErr }, { data: findings, error: findErr }, { data: hsItems, error: hsErr }] = await Promise.all([
    supabase.from("actions").select("id, status, priority, due_date").eq("project_id", projectId),
    supabase.from("snag_items").select("status, priority, due_date").eq("project_id", projectId),
    supabase.from("inspection_findings").select("id, severity, status, action_id").eq("project_id", projectId),
    supabase.from("hs_audit_items").select("status, severity").eq("project_id", projectId),
  ]);
  if (actErr) throw actErr;
  if (snagErr) throw snagErr;
  if (findErr) throw findErr;
  if (hsErr) throw hsErr;
  return computeReportExceptions({ actions: actions || [], snags: snags || [], findings: findings || [], hsItems: hsItems || [] }, period);
}

// ─── Activity ("What changed this week?") ───────────────────────
// Deliberately built only from real existing timestamps (created_at/
// completed_at/raised_date/closed_date/verified_at/resolved_at/
// inspection_date) — never a raw audit_log dump. "Currently blocked" /
// "currently overdue" / "currently high-priority" are STATES, not
// events, and belong in Exceptions above, not here — this section only
// ever answers "what happened," never "what's still wrong."
export function computeReportActivity({ actions, snags, findings, inspections }, period) {
  const a = summariseActionsForReport(actions, period);
  const s = summariseSnagsForReport(snags, period);
  const i = summariseInspectionsForReport(findings, inspections, period);
  return {
    actionsCreated: a.createdDuringPeriod,
    actionsCompleted: a.completedDuringPeriod,
    snagsRaised: s.raisedDuringPeriod,
    snagsClosed: s.closedDuringPeriod,
    snagsVerified: s.verifiedDuringPeriod,
    findingsResolved: i.resolvedDuringPeriod,
    inspectionsCompleted: i.completedDuringPeriod,
  };
}

export async function getWeeklyReportActivity(projectId, period) {
  const [{ data: actions, error: actErr }, { data: snags, error: snagErr }, { data: findings, error: findErr }, { data: inspections, error: inspErr }] = await Promise.all([
    supabase.from("actions").select("id, title, status, priority, created_at, completed_at").eq("project_id", projectId),
    supabase.from("snag_items").select("id, item_no, location, raised_date, closed_date, verified_at, snag_list_id").eq("project_id", projectId),
    supabase.from("inspection_findings").select("id, title, severity, status, resolved_at").eq("project_id", projectId),
    supabase.from("inspections").select("id, title, status, inspection_date").eq("project_id", projectId),
  ]);
  if (actErr) throw actErr;
  if (snagErr) throw snagErr;
  if (findErr) throw findErr;
  if (inspErr) throw inspErr;
  return computeReportActivity({ actions: actions || [], snags: snags || [], findings: findings || [], inspections: inspections || [] }, period);
}

// ─── The orchestrator ────────────────────────────────────────────
// The ONE function that actually hits the network for the position as
// a whole — six broad, project-scoped selects (actions, snag_items,
// inspection_findings, inspections, hs_audits, hs_audit_items), each
// issued exactly ONCE via Promise.all, never one per row and never one
// per section re-fetching the same table (getWeeklyReportExceptions()/
// getWeeklyReportActivity()/etc above each do their own single fetch
// too, so they stay independently useful and independently testable,
// but this orchestrator deliberately calls the pure compute functions
// directly instead of those wrappers, to avoid fetching the same six
// tables twice on every real page load). Returns a plain object — not
// yet saved anywhere; the caller (weekly-report-form.html) decides
// when to actually persist it into system_position, and only while the
// report is still draft/reviewed (the v33 trigger enforces this).
export async function getWeeklyReportPosition(projectId, period) {
  const [
    { data: actions, error: actErr },
    { data: snags, error: snagErr },
    { data: findings, error: findErr },
    { data: inspections, error: inspErr },
    { data: hsAudits, error: hsAuditErr },
    { data: hsItems, error: hsItemErr },
    activeProgramme,
  ] = await Promise.all([
    supabase.from("actions").select("id, title, status, priority, assigned_to, due_date, created_at, completed_at").eq("project_id", projectId),
    supabase.from("snag_items").select("id, item_no, location, description, priority, status, raised_date, closed_date, verified_at, snag_list_id").eq("project_id", projectId),
    supabase.from("inspection_findings").select("id, title, severity, status, action_id, inspection_id, resolved_at").eq("project_id", projectId),
    supabase.from("inspections").select("id, title, status, inspection_date").eq("project_id", projectId),
    supabase.from("hs_audits").select("month").eq("project_id", projectId),
    supabase.from("hs_audit_items").select("status, severity").eq("project_id", projectId),
    getActiveProgramme(projectId),
  ]);
  if (actErr) throw actErr;
  if (snagErr) throw snagErr;
  if (findErr) throw findErr;
  if (inspErr) throw inspErr;
  if (hsAuditErr) throw hsAuditErr;
  if (hsItemErr) throw hsItemErr;

  const data = { actions: actions || [], snags: snags || [], findings: findings || [], inspections: inspections || [], hsAudits: hsAudits || [], hsItems: hsItems || [] };
  // A second, DEPENDENT fetch (needs the active programme's id first) —
  // only issued when a project actually has one, so a project with no
  // programme yet costs nothing extra beyond the lookup above.
  const programmeActivities = activeProgramme ? await listProgrammeActivities(activeProgramme.id) : [];

  return {
    period,
    generatedAt: new Date().toISOString(),
    exceptions: computeReportExceptions(data, period),
    activity: computeReportActivity(data, period),
    actionsSummary: summariseActionsForReport(data.actions, period),
    snagsSummary: summariseSnagsForReport(data.snags, period),
    inspectionsSummary: summariseInspectionsForReport(data.findings, data.inspections, period),
    hsSummary: summariseHsForReport(data.hsAudits, data.hsItems, period),
    programmeSummary: computeWeeklyProgrammeSignal(activeProgramme, programmeActivities, period.weekEnding),
  };
}

// ─── Report lifecycle (Draft -> Reviewed -> Approved -> Issued) ──
// Server-side triggers (sql/schema.sql, v33) are the real authority —
// these are thin wrappers, plus a client-side mirror of the valid-
// transition table for immediate UI feedback only, same convention as
// validActionStatusTransitions().
export const WEEKLY_REPORT_STATUSES = ["draft", "reviewed", "approved", "issued"];
export const WEEKLY_REPORT_STATUS_LABEL = { draft: "Draft", reviewed: "Reviewed", approved: "Approved", issued: "Issued" };
export const WEEKLY_REPORT_STATUS_BADGE = { draft: "badge-grey", reviewed: "badge-blue", approved: "badge-amber", issued: "badge-green" };

const WEEKLY_REPORT_STATUS_TRANSITIONS = {
  draft: ["reviewed"],
  reviewed: ["approved", "draft"],
  approved: ["issued", "draft"],
  issued: ["draft"],
};
export function validWeeklyReportStatusTransitions(fromStatus) {
  return WEEKLY_REPORT_STATUS_TRANSITIONS[fromStatus] || [];
}

// True once a report is approved/issued — its content (including
// system_position) is locked server-side; only Revise (back to draft)
// can reopen it for further editing.
export function isWeeklyReportLocked(report) {
  return report.status === "approved" || report.status === "issued";
}

async function updateWeeklyReportStatus(reportId, newStatus) {
  const { data, error } = await supabase.from("weekly_reports").update({ status: newStatus }).eq("id", reportId).select().single();
  if (error) throw error;
  return data;
}
export async function reviewWeeklyReport(reportId) { return updateWeeklyReportStatus(reportId, "reviewed"); }
export async function approveWeeklyReport(reportId) { return updateWeeklyReportStatus(reportId, "approved"); }
export async function issueWeeklyReport(reportId) { return updateWeeklyReportStatus(reportId, "issued"); }
export async function reviseWeeklyReport(reportId) { return updateWeeklyReportStatus(reportId, "draft"); }

// ─── Documents (Priority 10) ─────────────────────────────────────
// Organisation -> Project -> Document -> Revision -> File. Server-side
// triggers (sql/schema.sql, v34 — documents_before_write(),
// document_revisions_before_insert/after_insert()) are the real
// authority for org_id/project_id derivation, revision-number
// integrity, and current-revision promotion; these helpers exist only
// so every page shares one query shape, the same convention every
// prior priority's own data-access section already established.
//
// Deliberately separate from every existing file field in this schema
// — see tracker/README.md for the full "why a new table, why NOT
// migrating Handover/evidence into it" design note. drawings/
// specifications are NOT replaced — they keep working exactly as they
// always have (pinpoint snagging depends on drawings.id); this is an
// additive, parallel system, backfilled once from their existing rows.
export const DOCUMENT_TYPES = ["drawing", "specification", "other"];
export const DOCUMENT_TYPE_LABEL = { drawing: "Drawing", specification: "Specification", other: "Other", programme: "Programme" };

export const DOCUMENT_STATUSES = ["draft", "current", "superseded", "archived"];
export const DOCUMENT_STATUS_LABEL = { draft: "Draft", current: "Current", superseded: "Superseded", archived: "Archived" };
export const DOCUMENT_STATUS_BADGE = { draft: "badge-grey", current: "badge-green", superseded: "badge-amber", archived: "badge-grey" };

const CONTROLLED_DOCUMENT_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain", "text/csv",
]);

// Uploads a controlled document's file to the private
// "controlled-documents" bucket, unmodified — deliberately NO
// compression (unlike uploadImage/uploadDrawing), since a controlled
// document must stay byte-faithful to what was actually issued, the
// same reasoning the organisation logo upload already established.
// Returns the raw object PATH, never a public URL — this bucket has no
// public read policy at all; resolve a path via getDocumentFileUrl()
// or downloadDocumentFile() below whenever it's actually needed.
export async function uploadControlledDocument(file, path) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is 50 MB.`);
  }
  if (file.type && !CONTROLLED_DOCUMENT_MIME_TYPES.has(file.type)) {
    throw new Error(`"${file.name}" is a ${file.type} file, which isn't a supported type here.`);
  }
  const ext = file.name.split(".").pop();
  const key = `${path}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from("controlled-documents").upload(key, file, {
    cacheControl: "3600",
    upsert: false,
  });
  if (error) throw error;
  return key;
}

// Every document for a project, plus its current revision's own
// metadata — two broad, project-scoped queries (never one per
// document, and never one per revision), joined client-side by id.
// Matches the established "small fixed number of broad selects"
// convention Actions/Snags/Inspections all already use.
export async function listDocuments(projectId, { documentType, status } = {}) {
  let query = supabase.from("documents").select("*").eq("project_id", projectId);
  if (documentType) query = query.eq("document_type", documentType);
  if (status) query = query.eq("status", status);
  const { data: docs, error } = await query.order("created_at", { ascending: false });
  if (error) throw error;

  const revisionIds = (docs || []).map((d) => d.current_revision_id).filter(Boolean);
  const revisionsById = {};
  if (revisionIds.length) {
    const { data: revisions, error: revError } = await supabase.from("document_revisions").select("*").in("id", revisionIds);
    if (revError) throw revError;
    (revisions || []).forEach((r) => { revisionsById[r.id] = r; });
  }
  return (docs || []).map((d) => ({ ...d, currentRevision: d.current_revision_id ? revisionsById[d.current_revision_id] : null }));
}

export async function getDocument(documentId) {
  const { data: doc, error } = await supabase.from("documents").select("*, projects(name)").eq("id", documentId).single();
  if (error) throw error;
  const { data: revisions, error: revError } = await supabase.from("document_revisions").select("*").eq("document_id", documentId).order("revision_number", { ascending: false });
  if (revError) throw revError;
  const currentRevision = revisions.find((r) => r.id === doc.current_revision_id) || null;
  return { ...doc, revisions: revisions || [], currentRevision };
}

// Creates a document AND its first revision as one logical action —
// there is no "document with zero revisions" state in the normal
// flow, matching the brief's own "Create document -> Document +
// Revision 1 + Current Revision = Revision 1" workflow exactly.
export async function createDocument(projectId, { documentType, title, docNumber = null }, file) {
  const { data: doc, error } = await supabase.from("documents").insert({
    project_id: projectId,
    document_type: documentType,
    title,
    doc_number: docNumber,
  }).select().single();
  if (error) throw error;
  const path = await uploadControlledDocument(file, `${projectId}/${doc.id}`);
  const { error: revError } = await supabase.from("document_revisions").insert({
    document_id: doc.id,
    storage_bucket: "controlled-documents",
    file_url: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || null,
  });
  if (revError) throw revError;
  return getDocument(doc.id);
}

// Uploads a new revision for an existing document — the ONLY way its
// content ever changes; there is no "replace the current file" action
// anywhere in this app. The server-side trigger does everything else:
// computes the next revision_number, supersedes the previous current
// revision, and repoints documents.current_revision_id at this one.
export async function addDocumentRevision(documentId, projectId, file) {
  const path = await uploadControlledDocument(file, `${projectId}/${documentId}`);
  const { error } = await supabase.from("document_revisions").insert({
    document_id: documentId,
    storage_bucket: "controlled-documents",
    file_url: path,
    file_name: file.name,
    file_size: file.size,
    mime_type: file.type || null,
  });
  if (error) throw error;
  return getDocument(documentId);
}

export async function updateDocumentMetadata(documentId, fields) {
  const { data, error } = await supabase.from("documents").update(fields).eq("id", documentId).select().single();
  if (error) throw error;
  return data;
}

// The only way a document is ever retired — never a DELETE (see the
// RLS comment in sql/schema.sql: documents/document_revisions have no
// delete policy at all, a deliberate choice to avoid ever creating a
// storage-orphan problem or losing audit history for a controlled
// document).
export async function archiveDocument(documentId) {
  return updateDocumentMetadata(documentId, { status: "archived" });
}

// Resolves a revision's file to something actually openable. Legacy
// migrated rows (storage_bucket = 'site-photos') already hold a full,
// directly-usable public URL, exactly as drawings.drawing_url always
// was — returned as-is. Everything else lives in the private
// 'controlled-documents' bucket and is resolved to a short-lived
// signed URL on demand, never persisted (a stored signed URL would
// just expire) — this IS the real access-control boundary for
// controlled documents, not the URL's obscurity.
export async function getDocumentFileUrl(revision) {
  if (revision.storage_bucket === "site-photos") return revision.file_url;
  const { data, error } = await supabase.storage.from("controlled-documents").createSignedUrl(revision.file_url, 300);
  if (error) throw error;
  return data.signedUrl;
}

// Fetches a revision's actual file content as a Blob — used by bulk
// export, which needs real bytes to zip, not a URL to open in a tab.
// Goes through the same authenticated client + storage RLS as every
// other read in this app; there is no service-role path anywhere here
// — an export can only ever contain a file the signed-in user could
// already open individually.
export async function downloadDocumentFile(revision) {
  if (revision.storage_bucket === "site-photos") {
    const res = await fetch(revision.file_url);
    if (!res.ok) throw new Error(`Could not download "${revision.file_name}" (${res.status})`);
    return res.blob();
  }
  const { data, error } = await supabase.storage.from("controlled-documents").download(revision.file_url);
  if (error) throw error;
  return data;
}

// ─── Bulk export (Microsoft 365 / SharePoint-friendly ZIP) ──────────
// A client-side export, not a server integration — see
// tracker/README.md for why (no Graph/SharePoint API, no service-role
// credential anywhere in this app). Every file this reads comes from
// downloadDocumentFile() above, so export can never surface a document
// the signed-in user's own RLS-scoped queries didn't already return.

// A client-side ZIP must hold every exported file in browser memory at
// once (there is no server to stream through) — this cap keeps that
// bounded and, crucially, FAILS LOUDLY with a clear message rather
// than silently truncating the export when a selection is too large.
export const EXPORT_MAX_TOTAL_BYTES = 150 * 1024 * 1024; // 150MB

export const EXPORT_FOLDER_BY_TYPE = { drawing: "01 Drawings", specification: "02 Specifications", other: "03 Other Documents" };

// Strips characters Windows/SharePoint can't have in a filename or
// folder name, collapses whitespace, and caps length — never trusts a
// document title, doc_number, or original filename as already safe.
export function sanitizeExportFilename(name) {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/, ""); // Windows disallows a trailing dot or space
  const safe = cleaned || "Untitled";
  return safe.length > 150 ? safe.slice(0, 150).trim() : safe;
}

// "[Doc Number] - [Title] - Rev [N].[ext]", or "[Title] - Rev [N].[ext]"
// with no doc number — never destroys information, just computes a
// clean, human-meaningful export name; the true original filename
// stays visible in the app itself (document_revisions.file_name) and
// in the export manifest.
export function exportFilenameFor(doc, revision) {
  const ext = (revision.file_name.split(".").pop() || "").toLowerCase();
  const base = doc.doc_number ? `${doc.doc_number} - ${doc.title}` : doc.title;
  const safe = sanitizeExportFilename(`${base} - Rev ${revision.revision_number}`);
  return ext && ext !== safe.toLowerCase() ? `${safe}.${ext}` : safe;
}

// Deterministically de-duplicates filenames destined for the SAME
// folder — never silently overwrites two different files in the ZIP.
// Appends " (2)", " (3)", ... to the second and later occurrence of an
// exact name, in stable input order.
export function dedupeExportFilenames(filenames) {
  const seen = new Map();
  return filenames.map((name) => {
    const count = (seen.get(name) || 0) + 1;
    seen.set(name, count);
    if (count === 1) return name;
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : "";
    return `${base} (${count})${ext}`;
  });
}

export function buildExportManifestCsv(rows) {
  const header = ["Project", "Document Title", "Document Type", "Document Number", "Revision", "Status", "Original Filename", "Export Filename", "Exported Date"];
  const escapeCsv = (v) => {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.map(escapeCsv).join(",")];
  rows.forEach((r) => lines.push([r.project, r.title, r.type, r.docNumber || "", r.revision, r.status, r.originalFilename, r.exportFilename, r.exportedDate].map(escapeCsv).join(",")));
  return lines.join("\r\n");
}

// Pure planning step — computes every (folder path, filename) entry
// for the export with NO network calls, so filename de-duplication
// happens BEFORE any file is actually fetched. folderPath is an array
// of segment names; joined with "/" it's also this entry's manifest
// grouping key. Exported separately from exportDocumentsZip() so the
// planning logic (folder structure, naming, dedup, manifest rows) can
// be unit-tested without a real ZIP library or network access.
export function planDocumentExport(documents, { includeHistory = false } = {}) {
  const groups = new Map(); // folderPath.join("/") -> [{doc, revision, isCurrent}]
  function addToGroup(folderPath, entry) {
    const key = folderPath.join("/");
    if (!groups.has(key)) groups.set(key, { folderPath, entries: [] });
    groups.get(key).entries.push(entry);
  }

  for (const doc of documents) {
    const typeFolder = EXPORT_FOLDER_BY_TYPE[doc.document_type] || EXPORT_FOLDER_BY_TYPE.other;
    if (!includeHistory) {
      if (!doc.currentRevision) continue;
      addToGroup([typeFolder], { doc, revision: doc.currentRevision, isCurrent: true });
    } else {
      const revisions = (doc.revisions || []).slice().sort((a, b) => b.revision_number - a.revision_number);
      if (!revisions.length) continue;
      const docFolderName = sanitizeExportFilename(doc.doc_number ? `${doc.doc_number} - ${doc.title}` : doc.title);
      for (const rev of revisions) {
        const isCurrent = rev.id === doc.current_revision_id;
        addToGroup([typeFolder, docFolderName, isCurrent ? "Current" : "Revision History"], { doc, revision: rev, isCurrent });
      }
    }
  }

  const plan = [];
  for (const { folderPath, entries } of groups.values()) {
    const filenames = dedupeExportFilenames(entries.map((e) => exportFilenameFor(e.doc, e.revision)));
    entries.forEach((entry, i) => plan.push({ ...entry, folderPath, filename: filenames[i] }));
  }
  return plan;
}

// Builds and downloads a ZIP for the given documents — current
// revision only by default, or every revision (Current/ +
// "Revision History"/ subfolders per document) when includeHistory is
// true. JSZip is loaded on demand from esm.sh only when this runs,
// the same CDN-import approach this app already uses for SheetJS
// (tracker/plot-handovers.html's Export Trackers).
export async function exportDocumentsZip(projectName, documents, { includeHistory = false } = {}) {
  const plan = planDocumentExport(documents, { includeHistory });
  const totalBytes = plan.reduce((sum, e) => sum + (e.revision.file_size || 0), 0);
  if (totalBytes > EXPORT_MAX_TOTAL_BYTES) {
    throw new Error(`This export is approximately ${(totalBytes / 1024 / 1024).toFixed(0)} MB, over the ${EXPORT_MAX_TOTAL_BYTES / 1024 / 1024} MB export limit. Narrow your selection or filters and try again.`);
  }
  if (!plan.length) {
    throw new Error("None of the selected documents have a file to export.");
  }

  const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
  const zip = new JSZip();
  const projectFolder = zip.folder(sanitizeExportFilename(projectName));
  const exportedDate = todayISO();
  const manifestRows = [];

  for (const entry of plan) {
    const blob = await downloadDocumentFile(entry.revision);
    let folder = projectFolder;
    entry.folderPath.forEach((seg) => { folder = folder.folder(seg); });
    folder.file(entry.filename, blob);
    manifestRows.push({
      project: projectName,
      title: entry.doc.title,
      type: DOCUMENT_TYPE_LABEL[entry.doc.document_type] || entry.doc.document_type,
      docNumber: entry.doc.doc_number,
      revision: entry.revision.revision_number,
      status: entry.isCurrent ? entry.doc.status : "superseded",
      originalFilename: entry.revision.file_name,
      exportFilename: entry.filename,
      exportedDate,
    });
  }

  projectFolder.file("Export Manifest.csv", buildExportManifestCsv(manifestRows));

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeExportFilename(projectName)} - Documents Export.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


// ─── Programme Control (Priority 11, Phase 2) ────────────────────
// Project -> Programme -> Programme Activity. Server-side triggers
// (sql/schema.sql, v35 — programmes_before_write(),
// programme_activities_before_write()) are the real authority for
// org_id/project_id derivation, plot/assignee validation, and the
// percent_complete/actual_finish status coupling; these helpers exist
// only so every page shares one query shape, the same convention every
// prior priority's own data-access section already established.
//
// Hybrid architecture: this is NOT a scheduling engine. An external
// programme (MS Project / Asta / Excel) remains the actual planning
// tool — see tracker/README.md for the full design rationale. This
// phase deliberately has no dependency graph, no Gantt, no
// versioning/re-baselining, and no dashboard/weekly-report
// integration yet (those are explicit future phases).
export const PROGRAMME_STATUSES = ["draft", "active", "archived"];
export const PROGRAMME_STATUS_LABEL = { draft: "Draft", active: "Active", archived: "Archived" };
export const PROGRAMME_STATUS_BADGE = { draft: "badge-grey", active: "badge-green", archived: "badge-grey" };

export const ACTIVITY_STATUSES = ["not_started", "in_progress", "complete", "cancelled"];
export const ACTIVITY_STATUS_LABEL = { not_started: "Not Started", in_progress: "In Progress", complete: "Complete", cancelled: "Cancelled" };
export const ACTIVITY_STATUS_BADGE = { not_started: "badge-grey", in_progress: "badge-blue", complete: "badge-green", cancelled: "badge-grey" };

export async function listProgrammes(projectId) {
  const { data, error } = await supabase.from("programmes").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
  if (error) throw error;
  return data || [];
}

// The one row most pages actually want — a project's current active
// programme, or null if it doesn't have one yet (still in draft, or
// never set up). Never assumes there's exactly one; if more than one
// somehow existed it would be a data anomaly the unique partial index
// already prevents at the database level.
export async function getActiveProgramme(projectId) {
  const { data, error } = await supabase.from("programmes").select("*").eq("project_id", projectId).eq("status", "active").maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function createProgramme(projectId, { name } = {}) {
  const { data, error } = await supabase.from("programmes").insert({ project_id: projectId, name: name || "Programme" }).select().single();
  if (error) throw error;
  return data;
}

export async function updateProgrammeStatus(programmeId, status) {
  const { data, error } = await supabase.from("programmes").update({ status }).eq("id", programmeId).select().single();
  if (error) throw error;
  return data;
}
export async function activateProgramme(programmeId) { return updateProgrammeStatus(programmeId, "active"); }
export async function archiveProgramme(programmeId) { return updateProgrammeStatus(programmeId, "archived"); }

export async function updateProgramme(programmeId, fields) {
  const { data, error } = await supabase.from("programmes").update(fields).eq("id", programmeId).select().single();
  if (error) throw error;
  return data;
}

export async function listProgrammeActivities(programmeId, { status } = {}) {
  let query = supabase.from("programme_activities").select("*, plots(plot_number)").eq("programme_id", programmeId);
  if (status) query = query.eq("status", status);
  const { data, error } = await query.order("forecast_finish", { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data || [];
}

export async function createProgrammeActivity(programmeId, fields) {
  const { data, error } = await supabase.from("programme_activities").insert({ programme_id: programmeId, ...fields }).select("*, plots(plot_number)").single();
  if (error) throw error;
  return data;
}

export async function updateProgrammeActivity(activityId, fields) {
  const { data, error } = await supabase.from("programme_activities").update(fields).eq("id", activityId).select("*, plots(plot_number)").single();
  if (error) throw error;
  return data;
}

export async function deleteProgrammeActivity(activityId) {
  const { error } = await supabase.from("programme_activities").delete().eq("id", activityId);
  if (error) throw error;
}

// "Create Action" from a programme exception (Priority 11, Phase 4) —
// an explicit, user-initiated call, never automatic. Automatically
// creating an Action for every overdue/forecast-late activity would
// generate exactly the noise the brief warns against; a person
// decides an exception is worth tracking as accountable work, the
// same judgement createActionFromFinding()/createActionFromSnag()
// already require. Mirrors them exactly: creates the action, then
// links the ORIGIN (the programme activity) back to its CONSEQUENCE
// (the action) via action_id — never the reverse, keeping the Actions
// Engine uncoupled from Programme Control.
export async function createActionFromProgrammeActivity(activity, { title, description = null, assignedTo = null, priority = "medium", dueDate = null }) {
  const action = await createAction(activity.project_id, { title, description, priority, assignedTo, dueDate });
  const updated = await updateProgrammeActivity(activity.id, { action_id: action.id });
  return { action, activity: updated };
}

// Pure — builds a human-readable description pre-fill from an
// activity's real planned/forecast/variance data (never a database
// call, never invents a cause). Programme Control can only ever say
// WHAT is late, never WHY — see tracker/README.md's "do not confuse
// programme delay with cause" note; a person fills in the actual
// reason/action required when they create the Action. `cats` is the
// same categoriseProgrammeActivity() result the caller already has
// from rendering the row.
export function buildProgrammeActionContext(activity, cats) {
  const lines = [`Programme activity: ${activity.title}`];
  if (activity.plots?.plot_number) lines.push(`Plot: ${activity.plots.plot_number}`);
  if (activity.planned_finish) lines.push(`Planned finish: ${activity.planned_finish}`);
  if (activity.forecast_finish) lines.push(`Forecast finish: ${activity.forecast_finish}`);
  if (cats.forecastVarianceDays !== null && cats.forecastVarianceDays !== undefined) {
    lines.push(`Forecast variance: ${cats.forecastVarianceDays > 0 ? "+" : ""}${cats.forecastVarianceDays} day${Math.abs(cats.forecastVarianceDays) === 1 ? "" : "s"}`);
  }
  if (cats.overdue) lines.push("Status: overdue against planned finish");
  else if (cats.forecastLate) lines.push("Status: forecast late against planned finish");
  return lines.join("\n");
}

// ─── XLSX import architecture (contract only — no reader/UI yet) ────
// This phase deliberately stops short of a working importer (brief
// section 12: "First establish... the import data contract... do not
// build the complete import UI yet"). What follows is the CONTRACT a
// future importer will implement against — the shape of a valid row,
// how it's validated, and how it's matched against existing activities
// for create-vs-update — all pure, synchronous, and fully testable
// without ever touching XLSX.read() or the network. Reading a real
// workbook (via the xlsx@0.18.5 already used for Export Trackers) and
// the column-mapping/preview UI are Phase 3 work.

// The columns a future importer will recognise. "external_id" is
// deliberately the FIRST-CLASS identity field — see
// matchImportRowToActivity() below for why title alone is never a
// safe key. Column names here are the CONTRACT's own vocabulary, not
// tied to any one spreadsheet's literal header text — column mapping
// (letting a user say "my 'Task Name' column means title") is UI work
// for the actual importer, not this phase.
export const PROGRAMME_IMPORT_COLUMNS = ["external_id", "title", "plot_number", "is_milestone", "planned_start", "planned_finish"];

// Accepts a small set of unambiguous shapes a spreadsheet cell might
// actually contain: an ISO date string, an Excel serial date number
// (SheetJS can hand these back as raw numbers depending on cell
// formatting), or a JS Date (SheetJS's own `cellDates: true` option
// would produce this). Anything else is treated as invalid rather than
// guessed at — a wrong silent guess is worse than a row the user has
// to fix by hand.
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30); // day 0 in Excel's (incorrect but universal) date system

// Validates a real calendar date (rejects e.g. "2026-02-30", which
// plain `new Date()` would silently roll forward into March) and
// formats it as YYYY-MM-DD, entirely via UTC fields — never local
// ones. y/m/d are calendar numbers, not zero-indexed.
function formatCalendarDateUTC(y, m, d) {
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Accepts the shapes a real construction-programme spreadsheet cell
// can actually contain: a genuine Excel date cell (arrives as a JS
// Date when the workbook was read with cellDates:true — see
// readWorkbookFile() below), an Excel serial date NUMBER (a cell
// that's a date but wasn't formatted as one, so SheetJS hands back
// the raw serial instead), an ISO date string (optionally with a time
// component, which is truncated — never shifted through a timezone
// conversion), or a UK-style DD/MM/YYYY or DD-MM-YYYY string
// (optionally with a time suffix too). Anything else is treated as
// invalid rather than guessed at — a wrong silent guess is worse than
// a row the user has to fix by hand.
//
// Timezone correctness (the one thing this function has to get
// exactly right): Excel date serials — and therefore the Date objects
// SheetJS builds from them — have no timezone concept at all; SheetJS
// encodes the intended calendar date using UTC fields regardless of
// where the code runs. Reading such a Date back with LOCAL getters
// (as this app's own toLocalISODate() deliberately does for
// wall-clock Dates elsewhere) would silently shift the date by a day
// for anyone running in a timezone behind UTC — so a Date that came
// from a spreadsheet cell is ALWAYS read back via UTC fields here,
// deliberately not toLocalISODate().
export function parseImportDate(value) {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return { ok: false };
    const formatted = formatCalendarDateUTC(value.getUTCFullYear(), value.getUTCMonth() + 1, value.getUTCDate());
    return formatted ? { ok: true, value: formatted } : { ok: false };
  }
  if (typeof value === "number" && isFinite(value)) {
    // Floor, not round — a serial's fractional part is a time-of-day
    // within that calendar day (e.g. 46096.75 = 6pm on day 46096);
    // rounding could bump a late-afternoon time into the next day.
    const ms = EXCEL_EPOCH_MS + Math.floor(value) * 86400000;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return { ok: false };
    return { ok: true, value: d.toISOString().slice(0, 10) };
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return { ok: true, value: null };
    const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/);
    if (iso) {
      const formatted = formatCalendarDateUTC(Number(iso[1]), Number(iso[2]), Number(iso[3]));
      return formatted ? { ok: true, value: formatted } : { ok: false };
    }
    const uk = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[T ].*)?$/);
    if (uk) {
      const formatted = formatCalendarDateUTC(Number(uk[3]), Number(uk[2]), Number(uk[1]));
      return formatted ? { ok: true, value: formatted } : { ok: false };
    }
    return { ok: false };
  }
  return { ok: false };
}

// Validates ONE parsed spreadsheet row against the import contract.
// Returns { valid: true, activity: {...} } with a clean, ready-to-
// insert/update field set, or { valid: false, errors: [...] } with
// every problem found (not just the first) — so a preview UI can show
// a row's full set of issues in one pass rather than a fix-one-see-
// the-next loop. Never touches the network or an existing activity
// list; matching against what already exists is
// matchImportRowToActivity()'s job, kept separate on purpose (the
// same "pure planning, separate from I/O" split planDocumentExport()
// already established for bulk export).
export function validateImportRow(row) {
  const errors = [];
  const title = typeof row.title === "string" ? row.title.trim() : "";
  if (!title) errors.push("Title is required.");

  const plannedStart = parseImportDate(row.planned_start);
  if (!plannedStart.ok) errors.push(`Invalid planned_start: "${row.planned_start}".`);
  const plannedFinish = parseImportDate(row.planned_finish);
  if (!plannedFinish.ok) errors.push(`Invalid planned_finish: "${row.planned_finish}".`);
  if (plannedStart.ok && plannedFinish.ok && plannedStart.value && plannedFinish.value && plannedFinish.value < plannedStart.value) {
    errors.push("planned_finish cannot be before planned_start.");
  }

  let percentComplete;
  if (row.percent_complete !== undefined && row.percent_complete !== null && row.percent_complete !== "") {
    const n = Number(row.percent_complete);
    if (!isFinite(n) || n < 0 || n > 100) {
      errors.push(`Invalid percent_complete: "${row.percent_complete}" (must be 0-100).`);
    } else {
      percentComplete = n;
    }
  }

  const externalId = typeof row.external_id === "string" ? row.external_id.trim() : (row.external_id ? String(row.external_id).trim() : "");

  if (errors.length) return { valid: false, errors };

  return {
    valid: true,
    activity: {
      externalId: externalId || null,
      title,
      plotNumber: row.plot_number ? String(row.plot_number).trim() : null,
      isMilestone: row.is_milestone === true || row.is_milestone === "true" || row.is_milestone === "TRUE" || row.is_milestone === 1,
      plannedStart: plannedStart.value,
      plannedFinish: plannedFinish.value,
      percentComplete,
    },
  };
}

// Stable-identity strategy for "is this the same activity I imported
// last week?" (brief section 12's central question):
//   1. external_id, when the source programme provides one (MS
//      Project/Asta/Primavera exports typically carry a stable
//      Activity ID/UID column) — matched within the SAME programme
//      only (document_id-scoped, mirroring how document_revisions'
//      own numbering is scoped to one document, never global).
//   2. Falling back to (plot_number, title) when no external_id is
//      present — the same "match by natural key, case/whitespace-
//      normalised" idiom already used for the Documents backfill
//      (project_id+document_type+title) and the general-snag-list
//      get-or-create in weekly-report-form.html. Title alone is
//      deliberately NOT enough on its own (the brief's own warning) —
//      two different plots very plausibly share an identical activity
//     title ("1st Fix - Electrical"), so plot is required alongside it.
//   3. No match by either method -> this is a new activity (create).
// Never mutates anything — returns the matching existing activity (or
// null), for the caller to decide create vs. update.
export function matchImportRowToActivity(parsedRow, existingActivities) {
  if (parsedRow.externalId) {
    const byExternalId = existingActivities.find((a) => a.external_id === parsedRow.externalId);
    if (byExternalId) return byExternalId;
    return null;
  }
  const normalisedTitle = parsedRow.title.trim().toLowerCase();
  return existingActivities.find((a) =>
    (a.external_id === null || a.external_id === undefined) &&
    (a.title || "").trim().toLowerCase() === normalisedTitle &&
    (a.plotNumber || a.plot_number || null) === (parsedRow.plotNumber || null)
  ) || null;
}

// Fields an import is allowed to touch vs. fields this application
// owns once an activity exists (brief section 13 — "do not allow a
// subsequent import to silently overwrite application-controlled
// forecast or actual fields"). Imported fields describe what the
// EXTERNAL programme says should happen; everything else (forecast,
// actual, status, percent_complete, assigned_to) is this app's own
// control-layer data and must never be clobbered by a re-import.
export const PROGRAMME_IMPORT_OWNED_FIELDS = ["title", "planned_start", "planned_finish", "is_milestone", "external_id", "plot_id"];
export const PROGRAMME_APP_OWNED_FIELDS = ["forecast_start", "forecast_finish", "actual_start", "actual_finish", "status", "percent_complete", "assigned_to"];

// Builds the plan for one import batch: which validated rows become a
// new activity, which match an existing one (an UPDATE touching only
// PROGRAMME_IMPORT_OWNED_FIELDS — never forecast/actual/status), and
// which rows failed validation — all computed with zero network
// access, exactly like planDocumentExport()'s own "plan first, act
// later" split. `plotIdByNumber` resolves a row's plot_number to a
// real plot_id (or null if unmatched/unset) — supplied by the caller,
// since only it can query the project's real plots.
export function planProgrammeImport(rows, existingActivities, plotIdByNumber = {}) {
  const results = rows.map((row, index) => ({ index, row, ...validateImportRow(row) }));

  const seenExternalIds = new Map();
  for (const r of results) {
    if (!r.valid || !r.activity.externalId) continue;
    if (seenExternalIds.has(r.activity.externalId)) {
      const firstIndex = seenExternalIds.get(r.activity.externalId);
      r.valid = false;
      r.errors = [`Duplicate external_id "${r.activity.externalId}" — already used by row ${firstIndex + 1} in this import.`];
      delete r.activity;
    } else {
      seenExternalIds.set(r.activity.externalId, r.index);
    }
  }

  const toCreate = [];
  const toUpdate = [];
  const invalid = [];
  for (const r of results) {
    if (!r.valid) { invalid.push({ index: r.index, errors: r.errors }); continue; }
    const existing = matchImportRowToActivity(r.activity, existingActivities);
    const plotId = r.activity.plotNumber ? (plotIdByNumber[r.activity.plotNumber] || null) : null;
    const fields = {
      title: r.activity.title,
      planned_start: r.activity.plannedStart,
      planned_finish: r.activity.plannedFinish,
      is_milestone: r.activity.isMilestone,
      external_id: r.activity.externalId,
      plot_id: plotId,
    };
    if (existing) {
      toUpdate.push({ index: r.index, activityId: existing.id, fields });
    } else {
      toCreate.push({ index: r.index, fields });
    }
  }

  return { toCreate, toUpdate, invalid };
}

// ─── XLSX Programme Import — workflow (Phase 3) ──────────────────
// A CONTROLLED construction-programme ingestion workflow, not a
// generic spreadsheet importer — see tracker/README.md for the full
// design. Reads the workbook entirely client-side (never sent to any
// external service), reusing the exact xlsx@0.18.5 already loaded
// on-demand for Export Trackers (plot-handovers.html) — no second
// spreadsheet library introduced. The actual write is
// importProgrammeActivities() below, a thin wrapper around the
// confirmed-import transaction (sql/schema.sql v36,
// import_programme_activities()) — that RPC is the real authority;
// everything else here exists to build an accurate PREVIEW of what it
// will do, and to get a real workbook into the plain row-object shape
// validateImportRow()/matchImportRowToActivity() (Phase 2) already
// understand.

// 10MB is generous for a programme workbook; this is a client-side UX
// safeguard for the parsing step (avoid hanging the browser on a huge
// file), not a security boundary — the file is never stored anywhere
// unless the user separately opts to retain it as a controlled
// document (see the optional retention note near the bottom), which
// THEN goes through uploadControlledDocument()'s own real size/MIME
// enforcement.
export const IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;

// Pre-network validation of the selected file itself — UX only,
// matching uploadPhoto()'s own "fast, friendly rejection" precedent;
// nothing downstream trusts this alone. readWorkbookFile() below is
// the real check (a file can have a ".xlsx" name and still not
// actually be a workbook).
export function validateImportFile(file) {
  if (!file) return { ok: false, error: "No file selected." };
  if (!/\.xlsx$/i.test(file.name || "")) return { ok: false, error: `"${file.name}" is not an .xlsx file.` };
  if (file.size === 0) return { ok: false, error: `"${file.name}" is empty.` };
  if (file.size > IMPORT_MAX_FILE_BYTES) return { ok: false, error: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB — the limit is ${IMPORT_MAX_FILE_BYTES / 1024 / 1024} MB.` };
  return { ok: true };
}

// Reads a workbook entirely client-side and returns every worksheet's
// data as a plain array-of-arrays (row 0 = header row) — no XLSX
// object survives past this call, so everything downstream is plain,
// testable data. cellDates:true means a real Excel date cell arrives
// as a JS Date rather than a raw serial number, letting
// parseImportDate() handle both shapes uniformly. Throws a clear,
// specific error for a corrupted/non-workbook file or one with no
// worksheets at all — never returns a half-broken result.
export async function readWorkbookFile(file) {
  const XLSX = await import("https://esm.sh/xlsx@0.18.5");
  const buffer = await file.arrayBuffer();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  } catch {
    throw new Error(`"${file.name}" could not be read as an Excel workbook — it may be corrupted, password-protected, or not a real .xlsx file.`);
  }
  const sheetNames = workbook.SheetNames || [];
  if (!sheetNames.length) {
    throw new Error(`"${file.name}" has no worksheets.`);
  }
  const sheets = {};
  for (const name of sheetNames) {
    sheets[name] = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, raw: true, defval: null });
  }
  return { sheetNames, sheets };
}

// Splits a worksheet's raw array-of-arrays into its header row and
// data rows, dropping fully-blank trailing rows (routine in real
// spreadsheets) and normalising every row to the header's own width
// so a downstream lookup by column index is always safe, even for a
// row with trailing blank cells Excel simply omitted.
export function splitSheetHeaderAndRows(sheetAOA) {
  if (!sheetAOA || !sheetAOA.length) return { headers: [], rows: [] };
  const headers = (sheetAOA[0] || []).map((h) => (h === null || h === undefined ? "" : String(h).trim()));
  const rows = sheetAOA.slice(1)
    .filter((row) => (row || []).some((cell) => cell !== null && cell !== undefined && cell !== ""))
    .map((row) => headers.map((_, i) => (row[i] === undefined ? null : row[i])));
  return { headers, rows };
}

// Best-guess column mapping from a worksheet's real header text to
// this app's logical fields — a convenience the user must be able to
// override (brief §5: "Do not build AI-assisted column mapping"; this
// is plain keyword matching, nothing more). Checked in a deliberate
// field order (external_id before title, etc.) so a more specific
// header ("Activity ID") is claimed before a looser one ("Activity")
// can be miscategorised; a header already claimed by one field is
// never offered to another.
const COLUMN_MAPPING_HINTS = {
  external_id: ["activity id", "task id", "id", "ref", "reference", "uid", "unique id"],
  title: ["title", "activity name", "task name", "activity", "task", "description", "name"],
  plot_number: ["plot number", "plot no", "plot", "unit"],
  planned_start: ["planned start", "start date", "start"],
  planned_finish: ["planned finish", "finish date", "completion date", "end date", "finish", "completion", "end"],
  is_milestone: ["milestone"],
};
const COLUMN_MAPPING_FIELD_ORDER = ["external_id", "title", "plot_number", "planned_start", "planned_finish", "is_milestone"];

export function suggestColumnMapping(headers) {
  const mapping = {};
  const used = new Set();
  const normalised = (headers || []).map((h) => (h || "").toString().trim().toLowerCase());

  for (const field of COLUMN_MAPPING_FIELD_ORDER) {
    const hints = COLUMN_MAPPING_HINTS[field];
    let bestIndex = null;
    for (let i = 0; i < normalised.length; i++) {
      if (used.has(i)) continue;
      if (hints.includes(normalised[i])) { bestIndex = i; break; }
    }
    if (bestIndex === null) {
      for (let i = 0; i < normalised.length; i++) {
        if (used.has(i)) continue;
        if (hints.some((h) => normalised[i].includes(h))) { bestIndex = i; break; }
      }
    }
    if (bestIndex !== null) { mapping[field] = bestIndex; used.add(bestIndex); }
  }
  return mapping;
}

// Reshapes raw (header-indexed) worksheet rows into the plain,
// field-named objects validateImportRow() already understands, using
// the user-confirmed column mapping (a header index per logical
// field, or absent for an unmapped optional field). Purely a reshape
// — no validation happens here.
export function mapRowsToImportRows(rows, mapping) {
  return (rows || []).map((row, i) => ({
    client_row_index: i,
    external_id: mapping.external_id != null ? row[mapping.external_id] : null,
    title: mapping.title != null ? row[mapping.title] : null,
    plot_number: mapping.plot_number != null ? row[mapping.plot_number] : null,
    is_milestone: mapping.is_milestone != null ? row[mapping.is_milestone] : null,
    planned_start: mapping.planned_start != null ? row[mapping.planned_start] : null,
    planned_finish: mapping.planned_finish != null ? row[mapping.planned_finish] : null,
  }));
}

// Builds the full reconciliation PREVIEW — a client-side MIRROR of
// import_programme_activities()'s own matching logic (sql/schema.sql
// v36), for immediate feedback only, the same "client-side mirror,
// server stays the real authority" convention
// validActionStatusTransitions() already established for actions. The
// RPC re-validates everything shown here against the real database
// state at confirmation time (which may have changed since this
// preview was built — e.g. someone else imported in the meantime) and
// is the only actual source of truth for what gets written.
//
// Deliberately separate from Phase 2's planProgrammeImport() (left
// completely untouched, still exactly what its own tests exercise) —
// this adds three things that function doesn't do: ambiguous-
// fallback-match detection (never silently picks one), an
// updated-vs-unchanged split (comparing against the real existing
// row, not just "matched -> update"), and "missing from import"
// (existing activities this batch never touched at all — never
// deleted or archived, only flagged).
export function buildImportReconciliation(rows, existingActivities, plotIdByNumber = {}) {
  const results = rows.map((row, index) => ({ index, row, ...validateImportRow(row) }));

  const externalIdCounts = new Map();
  results.forEach((r) => {
    if (r.valid && r.activity.externalId) {
      externalIdCounts.set(r.activity.externalId, (externalIdCounts.get(r.activity.externalId) || 0) + 1);
    }
  });

  const toCreate = [];
  const toUpdate = [];
  const unchanged = [];
  const invalid = [];
  const matchedActivityIds = new Set();

  for (const r of results) {
    if (!r.valid) { invalid.push({ index: r.index, errors: r.errors }); continue; }

    if (r.activity.externalId && externalIdCounts.get(r.activity.externalId) > 1) {
      invalid.push({ index: r.index, errors: [`Duplicate external_id "${r.activity.externalId}" appears more than once in this import.`] });
      continue;
    }

    // A plot_number was supplied but couldn't be confidently resolved
    // to a real plot in this project — never guess (brief §9): the
    // activity is still created/updated, just left unattached, with
    // the ambiguity surfaced via plotUnmatched for the preview to show.
    const plotUnmatched = Boolean(r.activity.plotNumber) && !plotIdByNumber[r.activity.plotNumber];
    const plotId = r.activity.plotNumber ? (plotIdByNumber[r.activity.plotNumber] || null) : null;

    let existing = null;
    if (r.activity.externalId) {
      existing = existingActivities.find((a) => a.external_id === r.activity.externalId) || null;
    } else {
      const candidates = existingActivities.filter((a) =>
        (a.external_id === null || a.external_id === undefined) &&
        (a.title || "").trim().toLowerCase() === r.activity.title.trim().toLowerCase() &&
        (a.plot_id || null) === (plotId || null)
      );
      if (candidates.length > 1) {
        invalid.push({ index: r.index, errors: ["Ambiguous match — more than one existing activity matches this title/plot with no external_id. Add an external_id to disambiguate, or resolve the duplicates manually first."] });
        continue;
      }
      existing = candidates[0] || null;
    }

    const fields = {
      title: r.activity.title,
      planned_start: r.activity.plannedStart,
      planned_finish: r.activity.plannedFinish,
      is_milestone: r.activity.isMilestone,
      external_id: r.activity.externalId,
      plot_id: plotId,
    };

    if (!existing) {
      toCreate.push({ index: r.index, fields, plotUnmatched });
      continue;
    }

    matchedActivityIds.add(existing.id);
    const changed = PROGRAMME_IMPORT_OWNED_FIELDS.some((key) => (existing[key] ?? null) !== (fields[key] ?? null));
    if (changed) {
      toUpdate.push({ index: r.index, activityId: existing.id, existing, fields, plotUnmatched });
    } else {
      unchanged.push({ index: r.index, activityId: existing.id });
    }
  }

  const missing = existingActivities.filter((a) => !matchedActivityIds.has(a.id));

  return { toCreate, toUpdate, unchanged, missing, invalid };
}

// The confirmed-import transaction (sql/schema.sql v36,
// import_programme_activities()) — the ONLY code path that actually
// writes an import's rows. Re-validates authorization, duplicate/
// ambiguous matches, and field ownership entirely server-side; this
// wrapper is a thin pass-through, not a second source of truth. Runs
// as one atomic operation (a single plpgsql function body/
// transaction) — a genuinely unexpected failure rolls back everything
// this call attempted; an anticipated per-row problem (duplicate
// external_id, ambiguous match, cross-project plot) is reported back
// in the result's `rejected` array instead, and does not block the
// other rows in the same batch from committing.
export async function importProgrammeActivities(programmeId, rows) {
  const { data, error } = await supabase.rpc("import_programme_activities", { p_programme_id: programmeId, p_rows: rows });
  if (error) throw error;
  return data;
}
