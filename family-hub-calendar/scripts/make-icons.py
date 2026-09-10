#!/usr/bin/env python3
"""Generates the PWA icons.

No image library is available in this project's toolchain and the icon is a few
flat shapes, so it is drawn with pixel maths and encoded as PNG directly. Kept
in the repo so the icons are reproducible rather than mystery binaries.

    python3 scripts/make-icons.py
"""
import struct
import zlib
from pathlib import Path

BG = (15, 23, 42)      # slate-950, matches manifest theme_color
FG = (248, 250, 252)   # slate-50
ACCENT = (56, 189, 248)  # sky-400, the "today" marker

OUT = Path(__file__).resolve().parent.parent / "public" / "icons"


def rounded_rect(x, y, w, h, r):
    """Predicate for a rounded rectangle, in absolute pixel coords.

    A pixel is tested against the ONE corner circle whose quadrant it falls in.
    Testing it against all four (the obvious loop) rejects every corner pixel,
    because a top-left pixel is outside the other three circles — which turns
    the rectangle into a plus sign.
    """
    def inside(px, py):
        if not (x <= px < x + w and y <= py < y + h):
            return False
        if r <= 0:
            return True

        cx = x + r if px < x + r else (x + w - 1 - r if px > x + w - 1 - r else None)
        cy = y + r if py < y + r else (y + h - 1 - r if py > y + h - 1 - r else None)
        if cx is None or cy is None:
            return True  # along an edge, not in a corner

        return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
    return inside


def draw(size, maskable):
    # A maskable icon is full-bleed and keeps its glyph inside the ~80% safe
    # zone, because the launcher crops it to whatever shape the OS wants.
    pad = 0 if maskable else int(size * 0.06)
    corner = 0 if maskable else int(size * 0.22)
    plate = rounded_rect(pad, pad, size - 2 * pad, size - 2 * pad, corner)

    glyph_scale = 0.56 if maskable else 0.66
    gw = int(size * glyph_scale)
    gh = int(gw * 0.88)
    gx = (size - gw) // 2
    gy = (size - gh) // 2 + int(size * 0.02)

    body = rounded_rect(gx, gy, gw, gh, max(2, int(gw * 0.12)))
    header_h = max(3, int(gh * 0.26))
    inner_pad = max(2, int(gw * 0.10))

    # 3x2 grid of day cells under the header
    cell_area_y = gy + header_h + inner_pad
    cell_area_h = gh - header_h - 2 * inner_pad
    cell_area_x = gx + inner_pad
    cell_area_w = gw - 2 * inner_pad
    cols, rows = 3, 2
    gap = max(1, int(cell_area_w * 0.08))
    cw = (cell_area_w - gap * (cols - 1)) // cols
    ch = (cell_area_h - gap * (rows - 1)) // rows

    cells = []
    for r_i in range(rows):
        for c_i in range(cols):
            cx = cell_area_x + c_i * (cw + gap)
            cy = cell_area_y + r_i * (ch + gap)
            cells.append((rounded_rect(cx, cy, cw, ch, max(1, cw // 4)), r_i, c_i))

    rows_out = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            colour = None
            if plate(px, py):
                colour = BG
                if body(px, py):
                    if py < gy + header_h:
                        colour = FG  # solid header bar
                    else:
                        colour = BG
                        for cell, r_i, c_i in cells:
                            if cell(px, py):
                                # One accent cell reads as "today".
                                colour = ACCENT if (r_i == 0 and c_i == 1) else FG
                                break
            if colour is None:
                row += b"\x00\x00\x00\x00"
            else:
                row += bytes(colour) + b"\xff"
        rows_out.append(bytes(row))
    return rows_out


def write_png(path, size, rows):
    raw = b"".join(b"\x00" + r for r in rows)

    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    png = (b"\x89PNG\r\n\x1a\n"
           + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 9))
           + chunk(b"IEND", b""))
    path.write_bytes(png)
    print(f"{path.name}: {len(png)} bytes")


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for size in (192, 512):
        write_png(OUT / f"icon-{size}.png", size, draw(size, maskable=False))
    write_png(OUT / "icon-maskable-512.png", 512, draw(512, maskable=True))
    write_png(OUT / "apple-touch-icon.png", 180, draw(180, maskable=True))
