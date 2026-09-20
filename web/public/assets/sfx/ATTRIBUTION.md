# Sound effects

The Ogg Vorbis files in this folder are from OpenSourceWeb, the open-licensed
archive of the BYOND game Lifeweb / Farweb:

https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb (commit edb003d)

Its README licenses all icons **and sounds** under Creative Commons Attribution-
ShareAlike 3.0 (https://creativecommons.org/licenses/by-sa/3.0/). So:

- Credit the source. This file is that credit, and the public credits line in
  `docs/handbook.md` names it too.
- Anything derived from these sounds (a trim, a re-encode, a mix) carries the
  same license. Code that merely plays them does not.
- Commercial use is allowed.

The same grant already covers `web/public/assets/items/`,
`web/public/assets/helms/` and `web/public/assets/chrome/` — see those folders'
ATTRIBUTION.md files. **The repository's CODE is GPLv3/AGPLv3 and none of it is
used here.** Only the art and the audio are taken, under the separate CC BY-SA
grant its README gives.

## How these got here

They are byte-for-byte copies out of `assets/osw-sounds/`, the curated export
of that repository's `sound/` tree kept in this repo for exactly this. Nothing
is trimmed, converted or normalised, with **one exception**: `radio3.ogg`, the
intercom, is the library's file with 2 seconds taken off the end and the last
2 seconds faded out, because it stopped dead mid-squawk. It was decoded and
re-encoded to do that, so unlike everything else here it is not the source's
own bytes. CC BY-SA 3.0 permits the edit; this paragraph is the notice that
one was made.

This folder holds **only the sounds the game actually plays** — a deploy has no
business carrying 691 files and 67 MB. `web/app/components/sfx.js` maps a game
meaning (`refuse`, `mine`, `gate-open`) to a filename here, and that map is the
list of what belongs in this folder. To add one, copy it out of
`assets/osw-sounds/` and add a line to that map; to hear the rest first, open
`scripts/osw/sound-player.html`.

Files keep their source names rather than their game meaning, the same
convention `assets/items/` uses, so a file here can be traced back to the
library it came from.

A few names here are **.wav** — the dirt and grass footsteps are the only ones
the library never encoded to Ogg. `sfx.js` reads the extension off the name
when one is written, so those work exactly like the rest.

`airlock_open.ogg` and `airlock_open_force.ogg` came in later than the rest,
for the Charon (`docs/systemdocs/CHARON.md`), and are the library's own
`sound/machines/` bytes untouched like everything else. They were added to the
`world` group in `scripts/osw/export-sounds.py` at the same time, so a re-export
against a clone produces them rather than leaving two files here with nothing
naming them.

## One file that is not from OpenSourceWeb

`cathedral-bell.ogg` is **not** from the library above. It is
[BigSoundBank #0135, "Church bell"](https://bigsoundbank.com/detail-0135-church-bell.html),
recorded by Joseph Sardin and released under **CC0** — public domain, no attribution
required, commercial use allowed. It is a different grant from the CC BY-SA 3.0 above, and
a more permissive one, which is why it gets its own paragraph rather than being quietly
filed with the rest.

The original is 17.5 seconds: one toll, a long decay, and faint birdsong under it. What is
in this folder is the first **6.4 seconds**, cut at an Ogg page boundary with the final page
marked end-of-stream — the audio is the source's own bytes, not re-encoded, so nothing is
degraded and no codec was involved. CC0 permits the trim without condition.

The bell used to share the Deep Beast Horn's noise, which meant the one moment it matters
which one you heard — a call to the town, or the Bastard calling something else — sounded
identical. It does not any more.
