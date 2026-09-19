# Helms, masks and hoods

Every face-covering piece of headgear in the OpenSourceWeb art, pulled out of
`assets/osw-sprites/` and put in one place. Open helmets, hats, caps, crowns
and wigs are **not** here — a thing is in this folder only if wearing it hides
who you are.

`index.png` is the whole folder drawn at 4x with names under it. Look there
first; it is quicker than opening 99 files at 32 px.

| Folder | What |
|---|---|
| `helms/` | 34 closed helmets — the whole head, face included |
| `masks/` | 43 masks — worn over the face, the skull left open |
| `hoods/` | 7 hoods — they hide the face by shadow rather than by plate |
| `ceremonial/` | 15 gold and silver sunburst masks from Lifeweb's own sheet |

Regenerate with `python3 scripts/osw/export-helms.py <clone>`, and redraw the
index with `python3 scripts/osw/helm-sheet.py`. Both are cheap and repeatable.

## Where these come from

`helms/`, `masks/` and `hoods/` are copies out of `assets/osw-sprites/`, which
came from `icons/obj/clothing/{hats,masks}.dmi`.

`ceremonial/` is new. It comes from **`icons/life/masks.dmi`**, a
Lifeweb-specific sheet the main extractor never walks — `extract-dmi.py` only
takes `icons/obj/` and `icons/monsters/`, so nothing in `icons/life/` has ever
been in this repo. There is a good deal more in that directory (armor,
weapons, crosses, the cult) if it is ever wanted.

Nothing here is modified. Each file is the frame exactly as it came out of the
sheet, south-facing only.

## The ones worth looking at first

If what you want is a masked, piped, faintly technological warrior — the
HighFleet look, a mask with a tube running off it:

- **`helms/soulbreaker0.png`** and **`soulbreaker1.png`** — the closest thing
  in the set. A plated helm with green-lit vents down the face and a hose off
  each side; `soulbreaker1` is the same helm glowing. This is the one to reach
  for.
- **`masks/vchurch0.png`** — a steel breathing mask with two fat gold filter
  canisters at the cheeks. Bronze where soulbreaker is grey.
- **`helms/cespace_helmet.png`** — a gold visor in a gold ring, clean and
  bright. `engspace_helmet` and `anom_hood` are the same shape in orange and
  in teal.
- **`helms/incarn.png`** — a bare gold faceplate, no rim, very little of it.
- **`masks/breath.png`** / **`breathdown.png`** — the plain tube-and-cup
  breathing rig, nothing decorative about it.
- **`helms/welding.png`** — a visor with two hoses hanging off the jaw. Grubby
  industrial rather than heroic.

Elsewhere: `helms/ordinator.png`, `oldordinator`, `vietnamordinator` are the
skull-shaped riot helms; `helms/ahelm`, `castellan`, `openskulliron` and
`masks/death` are the bone ones; `helms/knight`, `knightup`, `siegehelmet`,
`hauberkhood` are the straight medieval kit.

## License

The art is **CC BY-SA 3.0**, from OpenSourceWeb at commit `edb003d`:

https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb

Anything derived from these images — a recolour, a crop, a slice — carries the
same license. Code and CSS that merely reference them do not. Bascinet's
public credit is the Credits section of `docs/handbook.md`. If one of these
ends up on a live surface (`web/public/assets/helms/`, say), that folder needs
its own ATTRIBUTION.md, because it is a redistribution in its own right.
