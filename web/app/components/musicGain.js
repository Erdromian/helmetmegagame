"use client";

// How loud each music and ambience file is, measured rather than guessed.
//
// This is sfx.js's GAIN table, for the other engine. The reasoning is the same and the
// number means the same thing: the file's own loudness, and a gain that brings it to the
// level its JOB wants. The difference is only what the jobs are — a cue is a thing that
// happened and is gone; a bed runs for ten minutes under everything else, so it sits a
// good deal lower than anything in sfx.js does.
//
// Measured with `scripts/audio/measure.sh`, which is ffmpeg's ebur128 filter — true
// EBU R128 integrated loudness, not a hand-eyeballed peak. The gain is
//
//     10 ^ ((target - measured) / 20)
//
// clamped to 1, because nothing here is ever turned UP: a file that is already too quiet
// for its tier is a file to re-encode, not to amplify into its own noise floor.
//
// THE TIERS, quietest first. Each is one step of "how much of your attention is this
// entitled to":
//
//   -34 LUFS  a BED. You should be able to forget it is on. If you notice the bed, it
//             is too loud — the test is whether somebody reading a long message in the
//             Depths finds it wearing after ten minutes.
//   -30 LUFS  a SPOT: the Cathedral's organ room, a drip. It arrives out of nothing
//             every few minutes, and a thing that arrives is allowed to be heard.
//   -26 LUFS  MUSIC, and a jukebox or an instrument somebody is playing. This is the
//             loudest thing that is still background.
//   -22 LUFS  an EVENT. A siren is made to be heard, and it is the one layer that is
//             allowed to interrupt.
//
// A file used at two tiers — track3 is a bed here and could be music elsewhere — is
// keyed once, at the tier it is actually used at, and the step's own `gain` trims from
// there.
//
// TO ADD A FILE: drop it in web/public/assets/{music,ambience}/, run
// `scripts/audio/measure.sh`, paste its line in. A file missing from this table plays at
// its step gain alone, which is why the fallback is 1 rather than something cleverer —
// an unmeasured file should be obviously wrong, not quietly almost-right.

export const MUSIC_GAIN = {
  // -34 LUFS — a bed.
  "ambi2.ogg": 0.309,                 //  -23.8 LUFS, 0:30
  "ambieng1.ogg": 0.164,              //  -18.3 LUFS, 0:38
  "ambigen6.ogg": 0.269,              //  -22.6 LUFS, 0:33
  "ambimine.ogg": 0.462,              //  -27.3 LUFS, 1:16
  "ambispace.ogg": 0.432,             //  -26.7 LUFS, 3:15
  "charon_loop.ogg": 0.146,           //  -17.3 LUFS, 0:05
  "loop_airy1.ogg": 0.136,            //  -16.7 LUFS, 0:06
  "loop_airy4.ogg": 0.114,            //  -15.1 LUFS, 0:19
  "loop_altar.ogg": 0.299,            //  -23.5 LUFS, 0:13
  "newfireloop.ogg": 0.582,           //  -29.3 LUFS, 0:03
  "pathologic.ogg": 1.000,            //  -34.0 LUFS, 2:45
  "sacred_dagger.ogg": 0.372,         //  -25.4 LUFS, 4:35
  "shore.ogg": 0.299,                 //  -23.5 LUFS, 0:30
  "song_game.ogg": 0.372,             //  -25.4 LUFS, 3:50
  "spookymaint1.ogg": 0.750,          //  -31.5 LUFS, 0:41
  "spookyspace1.ogg": 1.000,          //  -34.9 LUFS, 1:40
  "spookyspace2.ogg": 1.000,          //  -34.8 LUFS, 1:41
  "to_hell.ogg": 0.108,               //  -14.7 LUFS, 4:18
  "train_loop.ogg": 0.119,            //  -15.5 LUFS, 0:21
  // Bascinet's own picks from the new document: the general, fortress, keep, underfort,
  // caves/depths and space beds, the inn's second track, and what a listener hears
  // hallucinating, robed, dead or on a drug. Geist is also the "becoming a ghost" interrupter,
  // and each drug song is also the sound of taking that drug; both are keyed here, at the
  // tier they spend most of their time at.
  "a-curved-blade.ogg": 0.097,        //  -13.7 LUFS, 6:05
  "abyssus-abyssum-invocat.ogg": 0.086,//  -12.7 LUFS, 1:46
  "after-the-party.ogg": 0.100,       //  -14.0 LUFS, 3:21
  "ager-sonus-lost.ogg": 0.195,       //  -19.8 LUFS, 14:50
  "an-atrementous-city.ogg": 0.184,   //  -19.3 LUFS, 4:39
  "auldale.ogg": 0.186,               //  -19.4 LUFS, 1:38
  "consciousness-dissolves.ogg": 0.204,//  -20.2 LUFS, 9:01
  "contaminated.ogg": 0.313,          //  -23.9 LUFS, 5:04
  "darkwood-untitled-2.ogg": 0.091,   //  -13.2 LUFS, 2:21
  "departure.ogg": 0.130,             //  -16.3 LUFS, 6:16
  "derelict-approach.ogg": 0.269,     //  -22.6 LUFS, 2:35
  "dust-are-all-her-beauties.ogg": 0.186,//  -19.4 LUFS, 5:40
  "fear-insertion.ogg": 0.178,        //  -19.0 LUFS, 2:07
  "fear2-city-ambience.ogg": 0.452,   //  -27.1 LUFS, 1:12
  "feast-of-the-night.ogg": 0.123,    //  -15.8 LUFS, 2:25
  "floor-6-please.ogg": 0.209,        //  -20.4 LUFS, 2:59
  "fools-village.ogg": 0.158,         //  -18.0 LUFS, 1:01
  "from-chasms-reborn.ogg": 0.219,    //  -20.8 LUFS, 4:16
  "garden-music.ogg": 0.135,          //  -16.6 LUFS, 1:36
  "geist.ogg": 0.412,                 //  -26.3 LUFS, 5:00
  "heliopolis.ogg": 0.070,            //  -10.9 LUFS, 4:41
  "hishmaliin.ogg": 0.064,            //  -10.1 LUFS, 3:40
  "horns-of-eden.ogg": 0.347,         //  -24.8 LUFS, 4:57
  "industrial-district.ogg": 0.305,   //  -23.7 LUFS, 4:35
  "introspectre.ogg": 0.151,          //  -17.6 LUFS, 1:43
  "laudanum.ogg": 0.216,              //  -20.7 LUFS, 4:29
  "mature-raver.ogg": 0.088,          //  -12.9 LUFS, 2:29
  "oval-sky.ogg": 0.081,              //  -12.2 LUFS, 2:29
  "parhelic-triangle.ogg": 0.063,     //  -10.0 LUFS, 6:10
  "restless-dreams.ogg": 0.172,       //  -18.7 LUFS, 4:57
  "rivers-of-glass.ogg": 0.245,       //  -21.8 LUFS, 3:59
  "shes-afraid-of-you.ogg": 0.197,    //  -19.9 LUFS, 2:13
  "slower.ogg": 0.138,                //  -16.8 LUFS, 5:30
  "sorry-sir-wrong-room.ogg": 0.240,  //  -21.6 LUFS, 2:40
  "subway-suspense.ogg": 0.324,       //  -24.2 LUFS, 0:36
  "the-dark-mother.ogg": 0.234,       //  -21.4 LUFS, 4:40
  "the-great-order-of-things.ogg": 0.221,//  -20.9 LUFS, 4:48
  "the-hierophant.ogg": 0.095,        //  -13.6 LUFS, 7:22
  "there-will-be-lies.ogg": 0.309,    //  -23.8 LUFS, 3:27
  "underground-troubles.ogg": 0.363,  //  -25.2 LUFS, 3:56
  "we-fear-no-evil.ogg": 0.060,       //   -9.5 LUFS, 4:53

  // -30 LUFS — a spot, laid OVER a bed on the `spot` layer. Four decibels up on the bed is
  // the whole of what makes one audible without ducking the bed under it (music.js's third
  // rule), which is why the winds and ambigen11/12 moved up here from the tier above: they
  // were the bed, and the design document calls every one of them "played atop".
  "ambicha1.ogg": 0.351,              //  -20.9 LUFS, 0:22
  "ambicha2.ogg": 0.282,              //  -19.0 LUFS, 0:10
  "ambicha3.ogg": 0.335,              //  -20.5 LUFS, 0:11
  "ambicha4.ogg": 0.785,              //  -27.9 LUFS, 0:17
  "ambigen11.ogg": 0.211,             //  -16.5 LUFS, 0:42
  "ambigen12.ogg": 0.232,             //  -17.3 LUFS, 0:43
  "lifeweb2b.ogg": 0.394,             //  -21.9 LUFS, 0:05
  "wind_2_1.ogg": 0.955,              //  -29.6 LUFS, 0:05
  // These two measure BELOW the spot tier, so the formula clamps them and they play at
  // their own level. The usual answer is an encode-time lift (see pathologic above), and it
  // is the wrong answer here: the document calls wind_2_2 "VERY quiet wind" and wind_3_1
  // "wind rising in intensity". Being quiet is what they are for. Leave them clamped.
  "wind_2_2.ogg": 1.000,              //  -37.3 LUFS, 0:05
  "wind_3_1.ogg": 1.000,              //  -32.9 LUFS, 0:05
  "wind_4_1.ogg": 0.556,              //  -24.9 LUFS, 0:07
  "wind_4_2.ogg": 0.855,              //  -27.3 LUFS, 0:06
  "wind_5_1.ogg": 0.507,              //  -24.1 LUFS, 0:10

  // -26 LUFS — music, which in-game means nothing at all now: the only track that simply
  // plays is the lobby's. See musicSchedule.js for where the general rotation went.
  //
  // outpost carries a +4.8 dB lift baked in by build-assets.sh, for pathologic's reason: it
  // mastered at -30.8 LUFS, quieter than this tier, and amplifying a quiet file in the
  // browser amplifies its noise floor with it.
  "a-thousand-empty-rooms.ogg": 0.668,//  -22.5 LUFS, 6:20
  "beyondretrieval.ogg": 0.282,       //  -15.0 LUFS, 8:33
  "haruspex.ogg": 1.000,              //  -28.9 LUFS, 7:22
  "holywarlobby.ogg": 0.750,          //  -23.5 LUFS, 4:16
  "newlobby31.ogg": 0.462,            //  -19.3 LUFS, 3:17
  "outpost.ogg": 1.000,               //  -26.0 LUFS, 6:34 (+4.8 dB baked in)
  "the_collective.ogg": 0.617,        //  -21.8 LUFS, 4:50
  "track13.ogg": 0.462,               //  -19.3 LUFS, 7:20
  "track3.ogg": 0.275,                //  -14.8 LUFS, 7:44
  "white_waking.ogg": 0.359,          //  -17.1 LUFS, 6:41
  // The new document's lobby music.
  "conflict-and-climax.ogg": 0.182,   //  -11.2 LUFS, 2:39
  "friction.ogg": 0.372,              //  -17.4 LUFS, 5:08
  "manunkind.ogg": 0.309,             //  -15.8 LUFS, 1:23
  "red-calx.ogg": 0.347,              //  -16.8 LUFS, 8:57
  "stone-in-focus.ogg": 0.151,        //   -9.6 LUFS, 11:03
  // "Sound and ambience that plays immediately after the charon has taken off" — an
  // interrupter, so it arrives at the music tier rather than creeping in under it.
  "locus-meropis.ogg": 0.216,         //  -12.7 LUFS, 8:40

  // -26 LUFS — instruments (the `player`/`room` layers, SOUND.md §3). See
  // db/lib/instrumentSongs.js for what these are named to a player.
  // accordion
  "b1.ogg": 0.525,                    //  -20.4 LUFS, 1:37
  "b2.ogg": 0.380,                    //  -17.6 LUFS, 0:50
  "b3.ogg": 0.537,                    //  -20.6 LUFS, 2:13
  "b4.ogg": 0.269,                    //  -14.6 LUFS, 2:22
  "b5.ogg": 0.556,                    //  -20.9 LUFS, 1:53
  "b6.ogg": 0.214,                    //  -12.6 LUFS, 0:17
  "b7.ogg": 0.207,                    //  -12.3 LUFS, 1:33
  "b8.ogg": 0.513,                    //  -20.2 LUFS, 0:42
  // lute
  "balalaika1.ogg": 0.741,            //  -23.4 LUFS, 1:30
  "bard1.ogg": 0.468,                 //  -19.4 LUFS, 0:38
  "bard2.ogg": 0.407,                 //  -18.2 LUFS, 0:40
  "bard3.ogg": 0.437,                 //  -18.8 LUFS, 0:36
  "bard4.ogg": 0.432,                 //  -18.7 LUFS, 0:25
  "bard5.ogg": 0.759,                 //  -23.6 LUFS, 1:45
  // boombox
  "ainda-e-cedo.ogg": 0.417,          //  -18.4 LUFS, 3:57
  "boate-azul.ogg": 0.299,            //  -15.5 LUFS, 3:20
  "boombox10.ogg": 0.507,             //  -20.1 LUFS, 3:13
  "boombox3.ogg": 0.447,              //  -19.0 LUFS, 2:07
  "boombox4.ogg": 0.468,              //  -19.4 LUFS, 3:22
  "boombox8.ogg": 0.305,              //  -15.7 LUFS, 3:20
  "clouds.ogg": 0.653,                //  -22.3 LUFS, 2:56
  "clown.ogg": 0.473,                 //  -19.5 LUFS, 1:47
  "como-eu-quero.ogg": 0.313,         //  -15.9 LUFS, 4:12
  "cowboy-fora-da-lei.ogg": 0.367,    //  -17.3 LUFS, 3:34
  "csrio.ogg": 0.359,                 //  -17.1 LUFS, 2:46
  "fixacao.ogg": 0.359,               //  -17.1 LUFS, 6:21
  "fuckup.ogg": 0.204,                //  -12.2 LUFS, 5:35
  "indihome.ogg": 0.216,              //  -12.7 LUFS, 0:30
  "metamorfose-ambulante.ogg": 0.501, //  -20.0 LUFS, 3:47
  "newbar3.ogg": 0.302,               //  -15.6 LUFS, 2:45
  "newbar46.ogg": 0.292,              //  -15.3 LUFS, 3:07
  "newbar59.ogg": 0.462,              //  -19.3 LUFS, 3:00
  "newbar9.ogg": 0.288,               //  -15.2 LUFS, 4:02
  "solidao-de-volta.ogg": 0.263,      //  -14.4 LUFS, 2:42
  "space_asshole.ogg": 0.403,         //  -18.1 LUFS, 4:16
  "space_oddity.ogg": 0.403,          //  -18.1 LUFS, 5:18
  "title1.ogg": 0.417,                //  -18.4 LUFS, 2:30

  // -26 LUFS — the Den's jukebox (the `room` layer). See db/lib/jukeboxSongs.js for what
  // these are named to a player. Served 6 dB under their masters (build-assets.sh), so
  // these are the served files' numbers.
  "blue-monday.ogg": 0.320,           //  -16.1 LUFS, 4:33
  "change-in-the-house-of-flies.ogg": 0.257, // -14.2 LUFS, 5:00
  "hardly-wait.ogg": 0.462,           //  -19.3 LUFS, 3:17
  "i-love-you-mary-jane.ogg": 0.610,  //  -21.7 LUFS, 3:52
  "into-the-void.ogg": 0.316,         //  -16.0 LUFS, 3:31
  "it-kills.ogg": 0.339,              //  -16.6 LUFS, 4:28
  "loose-ends.ogg": 0.537,            //  -20.6 LUFS, 2:00
  "lsd-truth.ogg": 0.403,             //  -18.1 LUFS, 4:28
  "navy-light.ogg": 0.417,            //  -18.4 LUFS, 3:09
  "night-creature.ogg": 0.452,        //  -19.1 LUFS, 2:12
  "red-blood.ogg": 0.412,             //  -18.3 LUFS, 4:04
};

/** The measured trim for a file, by URL or bare name. 1 for anything unmeasured. */
export function fileGain(src) {
  if (!src) return 1;
  const name = src.slice(src.lastIndexOf("/") + 1);
  return MUSIC_GAIN[name] ?? 1;
}
