# OpenSourceWeb sound library

662 sounds, 67 MB, pulled out of OpenSourceWeb's 3,559-file, 484 MB `sound/`
tree and grouped by what a sound is **for** rather than by where the source
filed it.

Same deal as `assets/osw-sprites/`: **a library to pick from, not something
the app serves.** It sits outside `web/public/` on purpose. When a sound is
wanted, copy it into the folder that surface owns and give that folder its own
ATTRIBUTION.md.

| Folder | Files | What |
|---|---|---|
| `ui/` | 52 | clicks, switches, beeps, page turns, coins — a control being used |
| `notify/` | 42 | mail, alarms, knocking at a door, a ring, a radio |
| `ambience/` | 71 | rooms with a sound of their own. Most of these loop |
| `music/` | 42 | 8 tracks, plus the suspense, tension and Thanati stings |
| `weapons/` | 186 | swinging, blocking, hitting mail, hitting a person |
| `labour/` | 49 | the forge, the mine, the bench, the shovel |
| `world/` | 87 | doors, chests, ladders, water, torches, footsteps |
| `body/` | 55 | eating, breathing, hurting, a heartbeat going wrong |
| `lifeweb/` | 41 | the Tower's own noises — grates, keys, a sacrifice |
| `creatures/` | 37 | the rats, strygh, graga, tzanch, matching the sprites |

`manifest.json` maps every file back to its path in the source repo, stamped
with the commit it came from.

Nothing is converted, trimmed or normalised. Each file is a byte-for-byte
copy, almost all Ogg Vorbis.

## What was left out, and why

Most of the source tree is not usable here: 616 vox announcement words, 170
MIDI files, 169 piano notes, 170 violin notes, the in-game radio station
tracks, the gore, the toilet humour, and 229 MB of jukebox music of which this
takes eight tracks. The atmospheric and dungeon-flavoured picks are in
`music/`; the rest is a browse away.

If you want something this filter dropped, it is one command:

```
python3 scripts/osw/export-sounds.py <path-to-OpenSourceWeb-clone>
```

Edit the lists at the top of that script and re-run it — it is a plain copy,
so it is safe to run over this folder again.

## Listening to them

There is a player artifact that streams the whole set straight from GitHub —
grouped, searchable, one click per sound, no download. It reads the same
`manifest.json` shape this script writes.

## License

**CC BY-SA 3.0**, from OpenSourceWeb at commit `edb003d`:

https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb

Its README licenses the icons *and sounds* under that grant. The repository's
code is GPLv3/AGPLv3 and none of it is here. Credit the source; Bascinet's
public credit is the Credits section of `docs/handbook.md`.
