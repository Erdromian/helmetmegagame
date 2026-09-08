#!/usr/bin/env python3
"""Cut the river out of the map plate as an alpha mask.

The plate (docs/assets/map-prototype.png) is flat Playscii art -- six colours,
no anti-aliasing -- and exactly one of them is an accent: #57a9bc, the water.
That blue was picked in the drawing program, so it followed no theme and sat
wrong against the app's palette in every one of them.

Rather than ship a tinted copy of the plate per theme, this writes a
white-on-transparent mask of just those pixels. /map paints it with
var(--map-river) through an SVG <mask>, so the water takes its colour from the
active theme like every other surface in the app -- and a theme added later
gets a river for free.

Exact match, no tolerance, because the source has no anti-aliased edges: the
mask lands pixel-for-pixel on the water and covers it completely.

    python3 docs/assets/make-map-river.py

Needs ffmpeg on PATH (there is no PIL on this machine) and writes
web/public/assets/map-river.png.
"""

import pathlib
import struct
import subprocess
import sys
import tempfile
import zlib

RIVER = (0x57, 0xA9, 0xBC)

ROOT = pathlib.Path(__file__).resolve().parents[2]
SRC = ROOT / "docs" / "assets" / "map-prototype.png"
OUT = ROOT / "web" / "public" / "assets" / "map-river.png"


def size_of(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    w, h = out.split("x")
    return int(w), int(h)


def write_png(path, width, height, rgba):
    """A minimal RGBA PNG writer -- stdlib only."""
    raw = bytearray()
    stride = width * 4
    for y in range(height):
        raw.append(0)  # filter: none
        raw += rgba[y * stride:(y + 1) * stride]

    def chunk(tag, data):
        body = tag + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))

    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(bytes(raw), 9))
    png += chunk(b"IEND", b"")
    path.write_bytes(png)


def main():
    if not SRC.exists():
        sys.exit(f"no plate at {SRC}")
    width, height = size_of(SRC)

    with tempfile.NamedTemporaryFile(suffix=".raw") as tmp:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", str(SRC),
             "-pix_fmt", "rgb24", "-f", "rawvideo", tmp.name],
            check=True,
        )
        src = pathlib.Path(tmp.name).read_bytes()

    if len(src) != width * height * 3:
        sys.exit(f"decoded {len(src)} bytes, expected {width * height * 3}")

    out = bytearray(width * height * 4)
    hits = 0
    for i in range(0, len(src), 3):
        if src[i] == RIVER[0] and src[i + 1] == RIVER[1] and src[i + 2] == RIVER[2]:
            j = (i // 3) * 4
            out[j:j + 4] = b"\xff\xff\xff\xff"
            hits += 1

    OUT.parent.mkdir(parents=True, exist_ok=True)
    write_png(OUT, width, height, out)
    print(f"{OUT.relative_to(ROOT)}: {hits} river pixels, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
