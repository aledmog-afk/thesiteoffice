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
// Resizes an image file to fit within maxDimension (longest side) and
// re-encodes it as JPEG at the given quality, to keep storage usage down.
// Non-image files (e.g. PDFs) and SVGs pass through unchanged. Falls back
// to the original file if decoding/encoding fails for any reason.
export async function compressImage(file, { maxDimension = 1920, quality = 0.78 } = {}) {
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

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
  if (!blob) return file;

  const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return new File([blob], newName, { type: "image/jpeg", lastModified: Date.now() });
}

// Compresses (if it's an image) then uploads to the "site-photos" bucket.
// Used for weekly report / snag / handover photos, where storage volume
// adds up. The logo upload deliberately skips this — see settings.html.
export async function uploadImage(file, path) {
  const compressed = await compressImage(file);
  return uploadPhoto(compressed, path);
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
// Mounts an add/edit/delete list UI (plain text items) into `container`.
// Calls onChange(items) whenever the list changes. Returns { getItems }.
export function mountItemListEditor(container, initialItems, onChange) {
  let items = [...(initialItems || [])];
  let editingIndex = null;

  function render() {
    container.innerHTML = `
      <ul class="item-list">
        ${items.map((text, i) => editingIndex === i ? `
          <li class="item-row editing">
            <input type="text" class="item-edit-input" value="${escapeHtml(text)}">
            <button type="button" class="btn btn-sm btn-amber" data-save="${i}">Save</button>
            <button type="button" class="btn btn-sm btn-outline" data-cancel="${i}">Cancel</button>
          </li>
        ` : `
          <li class="item-row">
            <span>${escapeHtml(text)}</span>
            <button type="button" class="btn btn-sm btn-outline" data-edit="${i}">Edit</button>
            <button type="button" class="btn btn-sm btn-danger" data-delete="${i}">Delete</button>
          </li>
        `).join("")}
      </ul>
      <div class="item-add-row">
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
        const val = container.querySelector(".item-edit-input").value.trim();
        if (val) items[i] = val;
        editingIndex = null;
        onChange(items);
        render();
      })
    );
    container.querySelectorAll("[data-cancel]").forEach((btn) =>
      btn.addEventListener("click", () => { editingIndex = null; render(); })
    );

    const addBtn = container.querySelector("#itemListAddBtn");
    const addInput = container.querySelector("#itemListNewInput");
    function addItem() {
      const val = addInput.value.trim();
      if (!val) return;
      items.push(val);
      onChange(items);
      render();
      container.querySelector("#itemListNewInput").focus();
    }
    addBtn.addEventListener("click", addItem);
    addInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); addItem(); }
    });
  }

  render();
  return { getItems: () => items };
}
