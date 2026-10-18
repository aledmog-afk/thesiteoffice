// Shared helpers for the UAE HV QA demo: GST formatting, SHA-256 hashing,
// photo watermarking, the access-gate check, and the PDF/ZIP builders.
// Deliberately has zero imports from tracker/ — this demo is
// self-contained and must never end up depending on, or accidentally
// pulling in, the production app's Supabase client.
import { isUnlocked } from "./demo-data.js";

// Every timestamp in this demo is shown in Gulf Standard Time
// (UTC+4, no DST) regardless of the viewer's own timezone, since this
// is UAE-specific compliance evidence.
export function formatGST(isoOrDate) {
  const d = typeof isoOrDate === "string" ? new Date(isoOrDate) : isoOrDate;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || "";
  return `${get("day")} ${get("month")} ${get("year")}, ${get("hour")}:${get("minute")} GST (UTC+4)`;
}

// Native Web Crypto SHA-256 — no library needed. Returns lowercase hex.
export async function sha256Hex(input) {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function shortHash(hex) {
  return hex ? `${hex.slice(0, 8)}…${hex.slice(-8)}` : "";
}

// Draws the given image file onto a canvas with an asset tag + GST
// timestamp burned into the bottom-left corner, entirely client-side —
// nothing is uploaded anywhere. Returns { dataUrl, hash } where hash is
// the SHA-256 of the watermarked image bytes (so the hash covers
// exactly what's shown, not the original unwatermarked file).
export async function watermarkPhoto(file, { assetTag, timestampIso }) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });

  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not decode the selected image."));
    el.src = dataUrl;
  });

  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || img.width;
  canvas.height = img.naturalHeight || img.height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  const label1 = `Asset: ${assetTag}`;
  const label2 = formatGST(timestampIso);
  const pad = Math.max(10, Math.round(canvas.width * 0.012));
  const fontSize = Math.max(14, Math.round(canvas.width * 0.022));
  ctx.font = `700 ${fontSize}px sans-serif`;
  const textWidth = Math.max(ctx.measureText(label1).width, ctx.measureText(label2).width);
  const boxHeight = fontSize * 2 + pad * 3;
  const boxWidth = textWidth + pad * 2;
  const boxY = canvas.height - boxHeight - pad;

  ctx.fillStyle = "rgba(15, 17, 23, 0.72)";
  ctx.fillRect(pad, boxY, boxWidth, boxHeight);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label1, pad * 2, boxY + fontSize + pad * 0.5);
  ctx.fillStyle = "#e8a020";
  ctx.fillText(label2, pad * 2, boxY + fontSize * 2 + pad * 1.2);

  const watermarkedDataUrl = canvas.toDataURL("image/jpeg", 0.9);
  const hash = await sha256Hex(watermarkedDataUrl);
  return { dataUrl: watermarkedDataUrl, hash };
}

// Every page except the gate itself calls this on load. If the demo
// hasn't been unlocked in this tab (sessionStorage flag set by
// index.html), send the visitor back to the gate instead of rendering
// any demo content.
export function requireAccess() {
  if (!isUnlocked()) {
    window.location.href = "index.html";
    return false;
  }
  return true;
}

// ─── PDF pack (PMC WIR submittal) ───────────────────────────────────
// Same esm.sh CDN-import pattern tracker/js/app.js already uses for
// jsPDF (buildCommercialEventPdfDocument) — no new dependency.
export async function generateWirPackPdf({ project, wir }) {
  const { jsPDF } = await import("https://esm.sh/jspdf@2.5.2");
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const pageWidth = doc.internal.pageSize.getWidth();
  let y = margin;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text("Work Inspection Request (WIR) Submittal", margin, y);
  y += 22;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(project.name, margin, y);
  y += 14;
  doc.text(`${project.location} — Client: ${project.client} — PMC: ${project.pmc}`, margin, y);
  y += 24;

  doc.setDrawColor(200);
  doc.line(margin, y, pageWidth - margin, y);
  y += 20;

  const field = (label, value) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(label, margin, y);
    doc.setFont("helvetica", "normal");
    doc.text(String(value), margin + 140, y);
    y += 16;
  };

  field("WIR Reference:", wir.id);
  field("Description:", "");
  y -= 4;
  const descLines = doc.splitTextToSize(wir.title, pageWidth - margin * 2 - 140);
  doc.text(descLines, margin + 140, y);
  y += descLines.length * 12 + 6;
  field("Asset Tag:", wir.assetTag);
  field("Status:", statusLabel(wir.status));
  y += 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("QA Checklist", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  for (const item of wir.signOff.checklist) {
    const mark = item.checked ? "[x]" : "[ ]";
    const lines = doc.splitTextToSize(`${mark} ${item.label}`, pageWidth - margin * 2);
    doc.text(lines, margin, y);
    y += lines.length * 12 + 2;
  }
  y += 10;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Photo Evidence", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  if (!wir.signOff.photos.length) {
    doc.text("No photo evidence attached.", margin, y);
    y += 14;
  }
  for (const photo of wir.signOff.photos) {
    if (y > 650) { doc.addPage(); y = margin; }
    try {
      doc.addImage(photo.dataUrl, "JPEG", margin, y, 160, 120);
      doc.text(`${photo.assetTag} — ${formatGST(photo.takenAtIso)}`, margin + 170, y + 14);
      doc.text(`SHA-256: ${shortHash(photo.hash)}`, margin + 170, y + 30);
    } catch {
      doc.text("(photo could not be embedded)", margin, y + 14);
    }
    y += 134;
  }

  y += 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Digital Sign-Off", margin, y);
  y += 16;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  if (wir.signOff.signature?.dataUrl) {
    try { doc.addImage(wir.signOff.signature.dataUrl, "PNG", margin, y, 180, 60); } catch { /* skipped if undecodable */ }
    y += 70;
  }
  doc.text(`Signed by: ${wir.signOff.signature?.signedBy || "—"}`, margin, y);
  y += 14;
  doc.text(`Signed at: ${wir.signOff.signature?.signedAtIso ? formatGST(wir.signOff.signature.signedAtIso) : "—"}`, margin, y);
  y += 14;
  doc.text(`Locked at: ${wir.signOff.lockedAtIso ? formatGST(wir.signOff.lockedAtIso) : "— (not yet locked)"}`, margin, y);

  const footerY = doc.internal.pageSize.getHeight() - 30;
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    `Tamper-evident verification hash (SHA-256): ${wir.signOff.recordHash || "not yet generated — lock the WIR to produce a final hash"}`,
    margin,
    footerY
  );
  doc.text("Generated by The Site Office — UAE HV Infrastructure & QA Demo. Demonstration data only.", margin, footerY + 10);

  return doc;
}

function statusLabel(status) {
  return (
    { approved: "Approved / Signed Off", pending_signoff: "Pending SAP / Client QA Sign-off", in_progress: "In Progress" }[status] ||
    status
  );
}

// ─── Decennial liability archive (.ZIP) ─────────────────────────────
// Same esm.sh CDN-import pattern tracker/js/app.js already uses for
// JSZip (exportDocumentsZip) — no new dependency.
export async function exportDecennialArchiveZip(state) {
  const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
  const zip = new JSZip();
  const root = zip.folder(sanitizeFilename(state.project.name));

  const manifest = {
    project: state.project,
    generatedAt: new Date().toISOString(),
    generatedAtGST: formatGST(new Date()),
    note: "UAE 10-year Decennial Liability Archive — demonstration export, synthetic data only.",
    wirs: state.wirs.map((w) => ({ id: w.id, title: w.title, assetTag: w.assetTag, status: w.status, lockedAtIso: w.signOff.lockedAtIso, recordHash: w.signOff.recordHash })),
    ncrs: state.ncrs.map((n) => ({ id: n.id, title: n.title, assetTag: n.assetTag, status: n.status })),
    variations: state.variations.map((v) => ({ id: v.id, title: v.title, status: v.status })),
  };
  root.file("manifest.json", JSON.stringify(manifest, null, 2));

  const wirFolder = root.folder("WIRs");
  for (const wir of state.wirs) {
    const wf = wirFolder.folder(wir.id);
    wf.file(
      "summary.txt",
      [
        `WIR Reference: ${wir.id}`,
        `Description: ${wir.title}`,
        `Asset Tag: ${wir.assetTag}`,
        `Status: ${statusLabel(wir.status)}`,
        `Locked at: ${wir.signOff.lockedAtIso ? formatGST(wir.signOff.lockedAtIso) : "— not yet locked"}`,
        `Verification hash (SHA-256): ${wir.signOff.recordHash || "—"}`,
        "",
        "QA Checklist:",
        ...wir.signOff.checklist.map((c) => `  [${c.checked ? "x" : " "}] ${c.label}`),
      ].join("\n")
    );
    wir.signOff.photos.forEach((photo, i) => {
      const base64 = photo.dataUrl.split(",")[1];
      if (base64) wf.file(`photo-${i + 1}-${photo.assetTag}.jpg`, base64, { base64: true });
    });
    if (wir.signOff.signature?.dataUrl) {
      const base64 = wir.signOff.signature.dataUrl.split(",")[1];
      if (base64) wf.file("signature.png", base64, { base64: true });
    }
  }

  const ncrFolder = root.folder("NCRs");
  for (const ncr of state.ncrs) {
    ncrFolder.file(
      `${ncr.id}.txt`,
      [
        `NCR Reference: ${ncr.id}`,
        `Title: ${ncr.title}`,
        `Asset Tag: ${ncr.assetTag}`,
        `Status: ${ncr.status}`,
        `Raised by: ${ncr.raisedBy}`,
        `Raised at: ${formatGST(ncr.raisedAtIso)}`,
        "",
        ncr.description,
      ].join("\n")
    );
  }

  const varFolder = root.folder("Variations-and-Site-Instructions");
  for (const v of state.variations) {
    varFolder.file(
      `${v.id}.txt`,
      [`Reference: ${v.id}`, `Title: ${v.title}`, `Status: ${v.status}`, "", "Voice note transcript:", v.transcript, "", `Claim: ${v.claim}`].join("\n")
    );
  }

  const blob = await zip.generateAsync({ type: "blob" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${sanitizeFilename(state.project.name)}-decennial-archive.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function sanitizeFilename(name) {
  return name.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}
