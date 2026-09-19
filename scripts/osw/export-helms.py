#!/usr/bin/env python3
"""Pull every face-covering helm, mask and hood out of the sprite library.

Usage: export-helms.py [<path-to-OpenSourceWeb-clone>]

Almost everything comes from assets/osw-sprites/, which is already in the
repo. The one thing that is not is the Lifeweb gold/silver ceremonial masks:
they live in icons/life/masks.dmi, which the main extractor never walks
(it only takes icons/obj/ and icons/monsters/). Pass a clone to get those
too; leave it off and that folder is skipped.

Nothing is modified. Each file is copied byte for byte.
"""
import os, shutil, struct, zlib, sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
SRC = os.path.normpath(os.path.join(ROOT, "assets", "osw-sprites", "other", "clothing"))
OUT = os.path.normpath(os.path.join(ROOT, "assets", "osw-helms"))
CLONE = sys.argv[1] if len(sys.argv) > 1 else None

# Closed helmets: the whole head, face included.
HELMS = """ahelm anom_hood castellan cathelm cerbhelm cespace_helmet
donor_redvent_hood engspace_helmet hauberkhood hero0 hero1 hevhelm incarn
knight knightup lhelmet oldordinator openiron openskulliron ordinator
plaguedoctor policehelm sechelmrookie sechelmtrusted sechelmvet siegehelmet
soulbreaker0 soulbreaker1 space vietnamordinator void welding weldingup
zealot""".split()

# Masks: worn over the face, the skull left open.
MASKS = """arbiter balaclava balaclava-o bee breath breathdown chickenhead
church0 church1 clown death doghead gas_alt gas_mask halfmask horsehead
ironmask jackal jester luchador luchag luchar medical mime monkeymask muzzle
owl pig plaguedoctor practicus rorschach rorscharch s-ninja silvermask
snorkel sterile swat swatclava thief vchurch0 vchurch1 voxmask""".split()

# Hoods: they hide the face by shadow rather than by plate.
HOODS = "blackbag chaplain_hood hood leper misero nun_hood plebhood".split()

# One more mask, worn by the horned skull of a dead animal.
MASKS += ["../hats/chariot"]

DIRNAMES = {1: ["S"], 4: ["S", "N", "E", "W"],
            8: ["S", "N", "E", "W", "SE", "SW", "NE", "NW"]}


def dmi_desc(path):
    data = open(path, "rb").read()
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    i = 8
    while i < len(data):
        ln = struct.unpack(">I", data[i:i + 4])[0]
        typ, body = data[i + 4:i + 8], data[i + 8:i + 8 + ln]
        if typ in (b"zTXt", b"tEXt"):
            kw, rest = body.split(b"\x00", 1)
            if kw == b"Description":
                return (zlib.decompress(rest[1:]) if typ == b"zTXt" else rest
                        ).decode("utf-8", "replace")
        if typ == b"IEND":
            break
        i += 12 + ln
    return None


def split_south(sheet, outdir):
    """Split a .dmi, keeping only the south-facing frame of each state."""
    from PIL import Image
    desc = dmi_desc(sheet)
    if not desc:
        return 0
    w = h = 32
    states, cur = [], None
    for line in desc.splitlines():
        s = line.strip()
        if s.startswith("width"):
            w = int(s.split("=")[1])
        elif s.startswith("height"):
            h = int(s.split("=")[1])
        elif s.startswith("state ="):
            cur = {"name": s.split("=", 1)[1].strip().strip('"'),
                   "dirs": 1, "frames": 1}
            states.append(cur)
        elif cur and s.startswith("dirs"):
            cur["dirs"] = int(s.split("=")[1])
        elif cur and s.startswith("frames"):
            cur["frames"] = int(s.split("=")[1])
    im = Image.open(sheet).convert("RGBA")
    cols = max(1, im.width // w)
    os.makedirs(outdir, exist_ok=True)
    idx = n = 0
    for st in states:
        dn = DIRNAMES.get(st["dirs"], [str(i) for i in range(st["dirs"])])
        for fr in range(st["frames"]):
            for d in range(st["dirs"]):
                x, y = (idx % cols) * w, (idx // cols) * h
                idx += 1
                if y + h > im.height or fr > 0 or dn[d] != "S":
                    continue
                tile = im.crop((x, y, x + w, y + h))
                if not tile.getbbox():
                    continue
                name = "".join(c if c.isalnum() or c in "_-" else "_"
                               for c in st["name"]) or "unnamed"
                tile.save(os.path.join(outdir, name + ".png"))
                n += 1
    return n


def copy_group(names, sub, folder):
    d = os.path.join(OUT, folder)
    os.makedirs(d, exist_ok=True)
    n = 0
    for nm in sorted(set(names)):
        src = os.path.join(SRC, sub, nm + ".png")
        if not os.path.exists(src):
            print("  missing", nm)
            continue
        shutil.copyfile(src, os.path.join(d, os.path.basename(nm) + ".png"))
        n += 1
    print(f"{folder}: {n}")
    return n


total = 0
total += copy_group(HELMS, "hats", "helms")
total += copy_group(MASKS, "masks", "masks")
total += copy_group(HOODS, "hats", "hoods")

if CLONE:
    sheet = os.path.join(CLONE, "icons", "life", "masks.dmi")
    if os.path.exists(sheet):
        n = split_south(sheet, os.path.join(OUT, "ceremonial"))
        print(f"ceremonial: {n}")
        total += n
    else:
        print("no icons/life/masks.dmi in", CLONE)

print("total", total)
