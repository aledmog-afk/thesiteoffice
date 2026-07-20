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

export function formatDate(d) {
  if (!d) return "";
  const date = new Date(d + "T00:00:00");
  if (isNaN(date)) return d;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Given a Date, return the Monday of that week as an ISO date string.
export function mondayOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
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

// ─── Itemised list editor ────────────────────────────────────────
// Mounts an add/edit/delete list UI into `container`. Each item is
// { plot, text } — plot is an optional tag (e.g. "Plot 4"), shown
// alongside the item text. Plain-string items (from before plot
// numbers existed) are normalised into { plot: "", text }.
// Calls onChange(items) whenever the list changes. Returns { getItems }.
export function mountItemListEditor(container, initialItems, onChange) {
  function normalise(item) {
    return typeof item === "string" ? { plot: "", text: item } : { plot: item.plot || "", text: item.text || "" };
  }
  let items = (initialItems || []).map(normalise);
  let editingIndex = null;

  function render() {
    container.innerHTML = `
      <ul class="item-list">
        ${items.map((item, i) => editingIndex === i ? `
          <li class="item-row editing">
            <input type="text" class="item-edit-plot" placeholder="Plot (optional)" value="${escapeHtml(item.plot)}">
            <input type="text" class="item-edit-input" placeholder="Item" value="${escapeHtml(item.text)}">
            <button type="button" class="btn btn-sm btn-amber" data-save="${i}">Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-cancel="${i}">Cancel</button>
          </li>
        ` : `
          <li class="item-row">
            ${item.plot ? `<span class="plot-tag">${escapeHtml(item.plot)}</span>` : ""}
            <span>${escapeHtml(item.text)}</span>
            <button type="button" class="btn btn-sm btn-outline" data-edit="${i}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-delete="${i}">Delete</button>
          </li>
        `).join("")}
      </ul>
      <div class="item-add-row">
        <input type="text" id="itemListNewPlot" class="item-plot-input" placeholder="Plot (optional)">
        <input type="text" id="itemListNewInput" placeholder="Add an item…">
        <button type="button" class="btn btn-outline btn-sm" id="itemListAddBtn">+ Add</button>
      </div>
    `;

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
        const plotVal = container.querySelector(".item-edit-plot").value.trim();
        const textVal = container.querySelector(".item-edit-input").value.trim();
        if (textVal) items[i] = { plot: plotVal, text: textVal };
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
    function addItem() {
      const textVal = addInput.value.trim();
      if (!textVal) return;
      items.push({ plot: plotInput.value.trim(), text: textVal });
      onChange(items);
      render();
      container.querySelector("#itemListNewInput").focus();
    }
    addBtn.addEventListener("click", addItem);
    [plotInput, addInput].forEach((el) => el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addItem(); }
    }));
  }

  render();
  return { getItems: () => items };
}
