// Touch/pointer-safe signature canvas, adapted from the same pattern
// already proven in tracker/commercial-approval.html (P18c mobile
// stability fix: touch-action:none, pointer capture, dpr-aware backing
// store). Kept as its own small module here so wir-detail.html can
// attach and read it without duplicating the drawing logic inline.
export function initSignaturePad(canvas, { clearButton } = {}) {
  const ctx = canvas.getContext("2d");
  let drawing = false;
  let hasStroke = false;
  let activePointerId = null;
  let cssWidth = 0;
  const CSS_HEIGHT = 180;

  function resizeIfNeeded() {
    const rectWidth = Math.round(canvas.getBoundingClientRect().width);
    if (!rectWidth || rectWidth === cssWidth) return;
    cssWidth = rectWidth;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rectWidth * dpr);
    canvas.height = Math.round(CSS_HEIGHT * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    hasStroke = false;
  }
  window.addEventListener("resize", resizeIfNeeded);
  resizeIfNeeded();

  function point(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function start(e) {
    if (drawing) return;
    drawing = true;
    activePointerId = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const p = point(e);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
    ctx.fillStyle = "#0f1117";
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    hasStroke = true;
    e.preventDefault();
  }
  function move(e) {
    if (!drawing || e.pointerId !== activePointerId) return;
    const p = point(e);
    ctx.lineTo(p.x, p.y);
    ctx.strokeStyle = "#0f1117";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    e.preventDefault();
  }
  function end(e) {
    if (e && e.pointerId !== activePointerId) return;
    if (activePointerId !== null) {
      try { canvas.releasePointerCapture(activePointerId); } catch { /* already released */ }
    }
    drawing = false;
    activePointerId = null;
  }
  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  canvas.addEventListener("lostpointercapture", end);

  function clear() {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    hasStroke = false;
  }
  if (clearButton) clearButton.addEventListener("click", clear);

  return {
    hasStroke: () => hasStroke,
    toDataURL: () => canvas.toDataURL("image/png"),
    clear,
  };
}
