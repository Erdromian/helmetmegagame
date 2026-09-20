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
is trimmed, converted or normalised.

This folder holds **only the sounds the game actually plays** — a deploy has no
business carrying 662 files and 67 MB. `web/app/components/sfx.js` maps a game
meaning (`refuse`, `mine`, `gate-open`) to a filename here, and that map is the
list of what belongs in this folder. To add one, copy it out of
`assets/osw-sounds/` and add a line to that map; to hear the rest first, open
`scripts/osw/sound-player.html`.

Files keep their source names rather than their game meaning, the same
convention `assets/items/` uses, so a file here can be traced back to the
library it came from.
