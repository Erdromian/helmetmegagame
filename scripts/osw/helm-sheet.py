#!/usr/bin/env python3
"""Draw assets/osw-helms/index.png: every helm in the folder, 4x, named.

Usage: helm-sheet.py
"""
import os, math
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
OUT = os.path.normpath(os.path.join(ROOT, "assets", "osw-helms"))
S, COLS, LABEL, GAP = 128, 8, 22, 10
BG, INK, HEAD = (26, 25, 28), (206, 200, 190), (226, 190, 120)

try:
    font = ImageFont.load_default(13)
    big = ImageFont.load_default(20)
except TypeError:                       # Pillow < 10
    font = big = ImageFont.load_default()

groups = [(g, sorted(f for f in os.listdir(os.path.join(OUT, g))
                     if f.endswith(".png")))
          for g in sorted(os.listdir(OUT))
          if os.path.isdir(os.path.join(OUT, g))]

cell, rows = S + GAP, 0
for _, files in groups:
    rows += math.ceil(len(files) / COLS)
height = rows * (cell + LABEL) + len(groups) * 44 + 20
img = Image.new("RGB", (COLS * cell + 20, height), BG)
d = ImageDraw.Draw(img)

y = 14
for name, files in groups:
    d.text((10, y), name.upper(), fill=HEAD, font=big)
    y += 34
    for i, f in enumerate(files):
        im = Image.open(os.path.join(OUT, name, f)).convert("RGBA")
        im = im.resize((S, S), Image.NEAREST)
        x = 10 + (i % COLS) * cell
        row = y + (i // COLS) * (cell + LABEL)
        img.paste(im, (x, row), im)
        d.text((x + 2, row + S + 3), f[:-4][:20], fill=INK, font=font)
    y += math.ceil(len(files) / COLS) * (cell + LABEL) + 10

img.save(os.path.join(OUT, "index.png"))
print(os.path.join(OUT, "index.png"), img.size)
