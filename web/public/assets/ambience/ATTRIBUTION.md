# Ambience

The bed a PLACE has, and the sparse sounds a place makes — picked by
`web/app/components/placeAmbience.js`, played on the `ambient` bus. Separate
from `../music/` because these are not music: nobody is meant to listen to them.

## The OpenSourceWeb files — CC BY-SA 3.0

Every file in the first table comes out of
[OpenSourceWeb](https://github.com/SS13-Special-Codebases-Archive/OpenSourceWeb)
at commit `edb003dc8ff5009476a9bcb74e79206039fb3390`, licensed
[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/), by way of
`assets/osw-sounds/` and `scripts/osw/export-sounds.py`.

**Not byte-for-byte copies.** Each is re-encoded by
`scripts/audio/build-assets.sh` to mono Ogg Vorbis at 32 kHz. `pathologic.ogg`
additionally carries a +8.7 dB lift, baked in because its master measures
-42.7 LUFS — quieter than the quietest tier `musicGain.js` has, and turning a
file up in the browser amplifies its own noise floor with it. The masters in
`assets/osw-sounds/` are untouched.

Where each one plays is decided by `docs/sounds.yaml` — Bascinet's own use case for
that file — and wired in `web/app/components/placeAmbience.js`. `track3.ogg`,
`track13.ogg`, `outpost.ogg` and `beyondretrieval.ogg` have moved to `../music/`:
the document calls all four Lobby Music.

| File | Length | Source path | Where it plays |
|---|---|---|---|
| `ambigen6.ogg` | 0:33 | `sound/ambience/ambigen6.ogg` | town and the underfort |
| `loop_altar.ogg` | 0:13 | `sound/machines/loop_altar.ogg` | the underfort |
| `loop_airy1.ogg` | 0:06 | `sound/ambience/loop_airy1.ogg` | the fortress: the Keep, the Town and the Undertown |
| `loop_airy4.ogg` | 0:19 | `sound/ambience/loop_airy4.ogg` | town, when the mood is low |
| `sacred_dagger.ogg` | 4:35 | `sound/music/sacred_dagger.ogg` | the Cathedral; the Order Chambers |
| `to_hell.ogg` | 4:18 | `sound/music/to_hell.ogg` | the Caves and the Black Hills |
| `charon_loop.ogg` | 0:05 | `sound/misc/charon_loop.ogg` | the Charon, on the ground |
| `ambigen11.ogg` | 0:42 | `sound/ambience/ambigen11.ogg` | nowhere: a space station, which does not exist yet |
| `ambigen12.ogg` | 0:43 | `sound/ambience/ambigen12.ogg` | a spot over space |
| `ambimine.ogg` | 1:16 | `sound/ambience/ambimine.ogg` | space |
| `ambi2.ogg` | 0:30 | `sound/ambience/ambi2.ogg` | in pain shock, wherever you are |
| `spookymaint1.ogg` | 0:41 | `sound/ambience/spookymaint1.ogg` | the Caves, the Depths and the Black Hills |
| `spookyspace1.ogg` | 1:40 | `sound/ambience/spookyspace1.ogg` | space (it was the Caves' until the rule that space means space) |
| `spookyspace2.ogg` | 1:41 | `sound/ambience/spookyspace2.ogg` | space (it was the Depths') |
| `ambispace.ogg` | 3:15 | `sound/ambience/ambispace.ogg` | Space |
| `ambieng1.ogg` | 0:38 | `sound/ambience/ambieng1.ogg` | the Godard Factory |
| `shore.ogg` | 0:30 | `sound/ambience/shore.ogg` | the Lake |
| `newfireloop.ogg` | 0:03 | `sound/effects/newfireloop.ogg` | nowhere yet: only for a fire out of control (`docs/sounds.yaml`) |
| `pathologic.ogg` | 2:45 | `sound/music/pathologic.ogg` | the Sanctuary |
| `train_loop.ogg` | 0:21 | `sound/lfwbsounds/train_loop.ogg` | the Depot, while the train is in |
| `ambicha1.ogg` | 0:22 | `sound/ambience/ambicha1.ogg` | a spot over the Cathedral and the Order Chambers |
| `ambicha2.ogg` | 0:10 | `sound/ambience/ambicha2.ogg` | (same) |
| `ambicha3.ogg` | 0:11 | `sound/ambience/ambicha3.ogg` | (same) |
| `ambicha4.ogg` | 0:17 | `sound/ambience/ambicha4.ogg` | (same) |
| `lifeweb2b.ogg` | 0:05 | `sound/ambience/lifeweb2b.ogg` | the Lifeweb |

## Bascinet's own picks — not CC BY-SA

These are tracks Bascinet chose and described in "New Music and Sounds.docx", not
OpenSourceWeb files. **No license is claimed for them here.** Each is a published
recording by the artist named, taken from the YouTube upload whose id is given; the
grant above does not cover them. Their library copies are in `assets/osw-sounds/`,
listed with the same ids in `bascinet-sources.json`, and are served here re-encoded
by `scripts/audio/build-assets.sh` like everything else.

| File | Length | Artist — title | YouTube id | Where it plays |
|---|---|---|---|---|
| `after-the-party.ogg` | 3:21 | After The Party | `OaVkQ6tIYvc` | general: every zone but space |
| `a-curved-blade.ogg` | 6:05 | Atrium Carceri — A Curved Blade | `m6Qv49Aw5qk` | (same) |
| `an-atrementous-city.ogg` | 4:39 | Atrium Carceri & Cities Last Broadcast — An Atrementous City | `aoM7GlnA7Uw` | (same) |
| `floor-6-please.ogg` | 2:59 | Atrium Carceri, Cities Last Broadcast, God Body Disconnect — Floor 6, Please | `czfaKg8eon4` | (same) |
| `sorry-sir-wrong-room.ogg` | 2:40 | Atrium Carceri, Cities Last Broadcast, God Body Disconnect — Sorry Sir, You Are In The Wrong Room | `x_NeqAGR8pA` | (same) |
| `underground-troubles.ogg` | 3:56 | Fallout 1 Soundtrack — Underground Troubles (Caves) | `6Bz3wBuRpEQ` | (same) |
| `there-will-be-lies.ogg` | 3:27 | Flowers for Bodysnatchers — There Will Be Lies | `kkLcO87y-qI` | (same) |
| `restless-dreams.ogg` | 4:57 | Silent Hill — In My Restless Dreams I See That Town (Instrumental) | `UYGIDlywyC0` | (same) |
| `contaminated.ogg` | 5:04 | Resident Evil Remake Soundtrack — Contaminated | `sq3qnC2E7hI` | (same) |
| `heliopolis.ogg` | 4:41 | Sephiroth — Heliopolis | `3WG4SNOdBY4` | (same) |
| `auldale.ogg` | 1:38 | Thief: Deadly Shadows OST — Auldale | `x9FkiNGE9MI` | (same) |
| `the-dark-mother.ogg` | 4:40 | Atrium Carceri — The Dark Mother | `7mONA54WFxs` | the fortress: the Keep, the Town and the Undertown |
| `laudanum.ogg` | 4:29 | Atrium Carceri & Cities Last Broadcast — Laudanum | `kTperX-_ZrM` | (same) |
| `the-great-order-of-things.ogg` | 4:48 | Atrium Carceri & Cities Last Broadcast — The Great Order of Things | `Eyiorm0F8bM` | (same) |
| `dust-are-all-her-beauties.ogg` | 5:40 | Caul — Dust Are All Her Beauties | `nr7ChveMl8Q` | (same) |
| `subway-suspense.ogg` | 0:36 | F.E.A.R. 2 OST — Subway Suspense | `Royup6zcPwk` | (same) |
| `fear2-city-ambience.ogg` | 1:12 | F.E.A.R. 2 OST — City Ambience | `PIns3RutZz0` | (same) |
| `slower.ogg` | 5:30 | Slower | `vJpWCT3hDgA` | the Keep |
| `darkwood-untitled-2.ogg` | 2:21 | Artur Kordas (Darkwood OST) — Untitled 2 | `Wn9hJbqVy_A` | the underfort |
| `fear-insertion.ogg` | 2:07 | F.E.A.R. OST — Insertion | `WzyBsdAkFBM` | (same) |
| `garden-music.ogg` | 1:36 | System Shock 2 — Garden music | `nOzuO-w1Rv8` | (same) |
| `industrial-district.ogg` | 4:35 | Atrium Carceri — Industrial District | `aAwNyv6nyPw` | the underfort, and space |
| `shes-afraid-of-you.ogg` | 2:13 | F.E.A.R. OST — She's Afraid Of You | `tq2BPO_M4wo` | the underfort, the Caves, the Depths and the Black Hills |
| `from-chasms-reborn.ogg` | 4:16 | Atrium Carceri — From Chasms Reborn | `1GVINHRiG2w` | the Caves and the Black Hills |
| `horns-of-eden.ogg` | 4:57 | Randal Collier-Ford — Horns of Eden | `jVmJwfj4YYA` | (same) |
| `introspectre.ogg` | 1:43 | Depeche Mode — Introspectre | `sTYcT_w3DbI` | the Caves, the Depths and the Black Hills |
| `rivers-of-glass.ogg` | 3:59 | Dronny Darko — Rivers of Glass | `P7argRuSus0` | (same) |
| `ager-sonus-lost.ogg` | 14:50 | Ager Sonus — Lost | `N2Qp_n1PV-I` | space |
| `derelict-approach.ogg` | 2:35 | Alien: Isolation Soundtrack — Derelict Approach | `yi2fYdXwIG8` | (same) |
| `departure.ogg` | 6:16 | Emra Grid — Departure | `8RjXB6zhJ3Q` | (same) |
| `the-hierophant.ogg` | 7:22 | Kammarheit — The Hierophant | `xwIBo8NTx1U` | (same) |
| `feast-of-the-night.ogg` | 2:25 | Erang — Feast Of The Night | `ODTWtjyYY48` | the Inn |
| `parhelic-triangle.ogg` | 6:10 | Autechre — Parhelic Triangle | `QGX1nSR5ymw` | while hallucinating, and on ETH-LOD |
| `fools-village.ogg` | 1:01 | Fool's Village OST — Main Theme | `Wfpc_1bK8ao` | while hallucinating, and on Bliss |
| `hishmaliin.ogg` | 3:40 | Dvar — Hishmaliin | `7J5JMJ0JHx4` | on Cave Fungus, and the moment it is taken |
| `mature-raver.ogg` | 2:29 | AFX — (mature raver) | `vHt-0LjZmWM` | on Heroin, and the moment it is taken |
| `oval-sky.ogg` | 2:29 | Oval — Sky (2010) | `oxJ6NCyVsQ4` | on Changa, and the moment it is taken |
| `abyssus-abyssum-invocat.ogg` | 1:46 | Hades — Abyssus Abyssum Invocat | `AijB2f-iCEg` | while wearing the Thanati robes |
| `consciousness-dissolves.ogg` | 9:01 | Consciousness Dissolves into the Emptiness | `Jl7x7VSdpVc` | a ghost |
| `geist.ogg` | 5:00 | Dronny Darko — Geist | `UFNAMoRUZts` | a ghost, and the moment somebody becomes one |
| `we-fear-no-evil.ogg` | 4:53 | Protection, We Fear No Evil | `kRIZyvGRUAU` | a ghost |
| `locus-meropis.ogg` | 8:40 | Locus Meropis | `nhee1IdD-m4` | the Charon's passengers, the moment it lifts off |
