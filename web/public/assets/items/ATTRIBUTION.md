# Item sprites

The PNGs in this folder are from OpenSourceWeb, the open-licensed archive of
the BYOND game Lifeweb / Farweb:

https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb (commit edb003d)

Its README licenses all icons and sounds under Creative Commons Attribution-
ShareAlike 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). So:

- Credit the source. This file is that credit, and the public credits line in
  `docs/handbook.md` names it too.
- Anything derived from these images (a recolour, a crop, a slice) carries the
  same license. Code and CSS that merely reference them do not.
- Commercial use is allowed.

The same grant already covers the five chrome textures in
`web/public/assets/chrome/` — see that folder's ATTRIBUTION.md, which explains
why Bascinet relies on the OpenSourceWeb notice rather than the stricter NC-ND
one on the SS13-Source-Archive/Farweb mirror. **The repository's CODE is
GPLv3/AGPLv3 and none of it is used here.** Only the art is taken, under the
separate CC BY-SA grant its README gives.

## How these got here

OpenSourceWeb ships its art as BYOND `.dmi` files, which are PNGs carrying a
zTXt chunk that describes the sprite sheet inside. Each was split into its
individual frames, then filtered down to one canonical frame per subject —
no `_blood` gore variants, no animation frames past the first, and the
south-facing frame only for directional sprites.

Each kept frame was then **cropped to its own content and padded back to a
square**. No pixel is redrawn, recoloured or resampled; only fully transparent
margin is removed. This is the one modification, and it exists because these
are floor sprites: OpenSourceWeb draws a bottle small and low inside a
tile-sized frame, so an icon that mapped the whole frame into 16px rendered it
as a five-pixel speck. The crop is a derivative work and carries the same
CC BY-SA 3.0 terms as the original, which is why it is written down here.

Files are named after the source sprite, not the tag, so several tags that
should look alike — the keys, the untitled books — share one file.

A tag names its file through `sprite:` in `docs/tags.yaml`, which
`db/lib/syncTags.js` checks really exists. Anything without one draws its
TagGroup's lucide glyph instead, exactly as the whole catalog did before.
No font from either repo is shipped. They are third-party and not covered by
the grant.

## One file that is not from OpenSourceWeb

`evil-mask.png` and `bastards-helmet.png` (and their plated twins in
`web/assets/helms/`) came from Bascinet, not from the library above. The Evil Mask was handed over as a large PNG and
downsampled back to its native 31 px grid; the Bastard's Helmet arrived at
32 px and had the strap below row 23 cropped off, so the head fills the frame
the way every other helm's does. No pixel in either is redrawn or recoloured.
Their provenance is not recorded, so **they are not covered by the CC BY-SA
grant this file describes**. If either turns out to be someone else's, that is
the file to pull, and the tag falls back to its group glyph the moment
`sprite:` comes off it.

## One file from RMC-14

`shovel.png` is the `icon` frame of `Objects/Tools/shovel.rsi` from RMC-14
(https://github.com/RMC-14/RMC-14), licensed CC BY-SA 3.0. Its `meta.json`
credits it as "Taken from tgstation and modified by Swept at commit
https://github.com/tgstation/tgstation/commit/c6e3401f2e7e1e55c57060cdf956a98ef1fefc24".
It was cropped and padded to a square the same way as the files above, and
carries the same CC BY-SA 3.0 terms.

## One file from tgstation

`old-coin.png` is the `coin_heads` frame of `icons/obj/economy.dmi` from
tgstation (https://github.com/tgstation/tgstation), licensed CC BY-SA 3.0.
The original is greyscale, since the game tints it by metal; it was tinted
bronze and cropped and padded like the files above, and carries the same
CC BY-SA 3.0 terms.

## Files from Dwarf Fortress

Every `rough-*.png` and `ore-*.png` here (the ores by colour: red, cyan,
bluish, copper, silvery, magenta, dullgrey, gold, darkbrown), and every (citrine, topaz, amethyst, milk quartz, onyx,
moonstone, white jade, fire opal, milk opal, kunzite, star sapphire, black
diamond), is a rough gem or ore sprite from the Steam edition of Dwarf Fortress (Bay 12 Games / Kitfox
Games), taken from https://dwarffortresswiki.org/index.php/Gem and padded to
a square. They are **not** openly licensed and not covered by the CC BY-SA
grant above. If they ever need to come out, pull the files and the tags fall
back to their group glyph.
