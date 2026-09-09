// The rewiring the old TODO here asked for is done: bot/src/events/
// interactionCreate.js#handleShoutCommand calls shout() below instead of
// keeping its own copy of the gates, and its in-memory cooldown Map is gone.
// The cooldown is an AuditLog row instead — there is no timestamp column on
// Character to put it in — so it now survives a bot restart and is shared with
// the web, which a process-local Map could never be.

// What a shout sounds like from N places away.
//
// Pure — no prisma, no I/O — so both faces could use it, though only the bot
// does today. db/lib/locationGraph.js#soundRange answers WHO hears; this file
// answers WHAT they hear.
//
// The shape of the rule is that distance takes the words away before it takes
// the direction away. You always learn which way to run. You stop learning
// what was said.
//
// You learn WHO shouted only at distance zero, where you are standing in it and
// could simply look. And it is the PRESENTED name (db/lib/presentedIdentity.js),
// so a hood shouts as "a young man" and a Beast as "Beast" — concealment still
// holds, in the room and everywhere past it. From one hop out nobody is named
// at all, which is the half of the old rule that was doing the work.

const { ambientLine } = require("./ambientLine");
const { soundRange } = require("./locationGraph");
const { loadVoiceState } = require("./say");
const { placeKeyForLocation, parsePlaceKey } = require("./placeKey");
const { muffle } = require("./muffle");
const {
  CONCEALMENT_TAG_FIELDS,
  concealmentFrom,
  forcedNameFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { aliasSubject } = require("./concealedIdentity");

// How much is lost at each remove. Index IS the hop count, so the table reads
// off the distance directly; index 0 is never reached, because your own
// Location returns above before it gets here. Past the end of the table the
// words are gone entirely and only the direction survives.
//
// The 0.7 ring is gone (2026-09-07): at that much static the line was a
// message you failed to catch dressed up as one you half caught, so the last
// audible ring now says only that someone shouted, and which way.
const MUFFLE_BY_DISTANCE = [0, 0, 0.4];

// The line one Location gets. `viaName` is the hearer's own neighbour toward
// the noise, and is null only at distance 0 (where you are standing in it).
//
// `shouterName` and `muffled` are both distance-0 facts and both ignored
// anywhere else — a soundproof room posts nothing past its own thread, and
// nobody outside it is told a name. They ride in an options bag rather than as
// two more positionals so the three-argument calls elsewhere stay honest.
//
// Distance 0 is FULL SIZE and everything beyond it is `-#` subtext — the same
// split /play already makes, where the room hears the performance and the
// street outside only notices it. A shout in your own street is not scenery.
function shoutLine(text, distance, viaName, options = {}) {
  const parts = shoutParts(text, distance, viaName, options);
  if (distance === 0) return parts.text;
  return ambientLine(parts.text, parts.lines);
}

// The same line as STRUCTURE rather than as Discord formatting: `{ text,
// lines }`, exactly the two arguments ambientLine takes.
//
// db/lib/scene.js needs these pieces and not the rendered string, because a
// scene row deliberately stores no `-#` — the web draws a SYSTEM row as
// subtext itself, and storing the marker would put a literal `-#` on the page.
// It signs the row itself too, so nothing here carries a ‡.
//
// The muffling is re-rolled per call, so the archived copy of a distant shout
// is not character-for-character the same static as the Discord copy. That is
// deliberate: both are "you missed most of it", and neither is the canonical
// one to diff the other against.
function shoutParts(text, distance, viaName, { shouterName = null, muffled = false } = {}) {
  if (distance === 0) {
    // No name is the FALLBACK, not a special case: an identity that failed to
    // load leaves the old anonymous line standing, which errs toward hiding
    // somebody who should be visible rather than the other way round.
    const said = shouterName ? `${shouterName} shouts: » ${text}` : `You hear someone shout: » ${text}`;
    // Under four words, so no ‡ — and it trails player-typed text, where a
    // mark would read as part of the shout.
    return { text: muffled ? `${said}, but it's muffled.` : said, lines: [] };
  }

  const where = viaName ? ` from the direction of ${viaName}` : " somewhere nearby";

  const fraction = MUFFLE_BY_DISTANCE[distance];
  if (fraction == null) {
    return { text: `You hear someone shout${where}.`, lines: [] };
  }
  return { text: `You hear someone shout${where}: » ${muffle(text, fraction)}`, lines: [] };
}

// ---------------------------------------------------------------- the shout

// What the room is told to call the shouter.
//
// Everything concealment-shaped is already decided by presentedIdentity(); the
// one choice left here is WHICH string a hood gets. `identity.name` is Title
// Case ("Young Man") because it is a webhook username; mid-sentence that reads
// as somebody actually called Young Man, so a hood takes aliasSubject()'s "A
// young man" instead. A forced name (Beast) and a real name both come straight
// off the identity — those are names, and they read as names.
//
// Pure, and exported for the tests: the whole feature rests on this one
// choice, and it should be pinned somewhere that needs no database.
function shouterNameFor(character, identity) {
  if (!identity) return null;
  if (identity.concealed) return aliasSubject(character ?? {});
  return identity.name || null;
}

// The columns presentedIdentity() reads, plus the tags it resolves against.
// Modelled on db/lib/whosHere.js#PRESENT_SELECT minus the Role and Faction
// halves, which a shout has no business showing — hearing somebody yell tells
// you their name, not who they answer to.
const SHOUTER_SELECT = {
  id: true,
  name: true,
  age: true,
  gender: true,
  concealed: true,
  updatedAt: true,
  tags: {
    where: {
      OR: [{ tag: { forcedName: { not: null } } }, { equipped: true, tag: { concealsIdentity: true } }],
    },
    select: { equipped: true, tag: { select: { forcedName: true, ...CONCEALMENT_TAG_FIELDS } } },
  },
};

// The shouter's own row, re-read here rather than trusted from the caller. The
// web's actor() and the bot's select carry neither age/gender/concealed nor the
// tags, and growing both call sites is exactly the failure CONCEALMENT_TAG_FIELDS
// warns about: miss one and concealment stops working at that surface only.
//
// Any failure returns null, which shoutParts renders as the old anonymous line.
async function loadShouterName(prisma, characterId) {
  try {
    const row = await prisma.character.findUnique({ where: { id: characterId }, select: SHOUTER_SELECT });
    if (!row) return null;
    const identity = presentedIdentity(row, {
      forcedName: forcedNameFrom(row.tags),
      concealment: concealmentFrom(row.tags),
    });
    return shouterNameFor(row, identity);
  } catch (err) {
    console.error("Shout identity load failed:", err.message ?? err);
    return null;
  }
}

// Does this place eat a shout?
//
// A Room may be `soundproof` (docs/zones.yaml), and a Conversation inherits it
// from the Room it hangs under — PlayerThread.roomId is nullable, so one held
// out on the open Location inherits nothing, which is right.
//
// A Location itself never is. Standing in the street outside a vault is not
// being in the vault, and a shout there should carry the way any other does.
async function soundproofAt(prisma, placeKey) {
  const here = parsePlaceKey(placeKey);
  if (!here) return false;
  try {
    if (here.kind === "room") {
      const room = await prisma.room.findUnique({ where: { id: here.id }, select: { soundproof: true } });
      return room?.soundproof === true;
    }
    if (here.kind === "conv") {
      const conv = await prisma.playerThread.findUnique({
        where: { id: here.id },
        select: { room: { select: { soundproof: true } } },
      });
      return conv?.room?.soundproof === true;
    }
  } catch (err) {
    console.error("Shout soundproof lookup failed:", err.message ?? err);
  }
  return false;
}

// Five minutes between shouts, per character. The bot's number.
const SHOUT_COOLDOWN_MS = 5 * 60_000;

// The AuditLog row IS the cooldown, and it is also the record of the shout.
// `targetCharacterId` is the shouter — a shout has no other party — so the
// read below is keyed on the character rather than on whichever account is
// driving them.
const SHOUT_ACTION = "shout";

// Who hears it, and what they hear.
//
// `character` needs { id, locationId, discordUserId }; the name comes off a
// fresh read (loadShouterName), not off this row. `placeKey` is where the
// shout was MADE — the thread, when it was made in one — and is the only way
// this can tell a vault from the street outside it. Returns
//
//   { ok: true, muffled,
//     here:  { line, scene: { text, lines } },
//     heard: [{ locationId, placeKey, name, distance, viaName, line, scene,
//               discordChannelId }] }
//
// or { ok: false, error, retryAfter? } — `retryAfter` in seconds, for a
// caller that wants to count it down rather than print the sentence.
//
// `here` is the distance-0 rendering and is ALWAYS present, even when `heard`
// is empty. In the ordinary case it duplicates heard[0]; from inside a
// soundproof room it is the only thing there is, because nothing leaves the
// thread. Callers post it into the room they are standing in and then walk
// `heard`, which is already ordered by distance, nearest first.
//
// Posting is the caller's half either way: the bot posts to channels, the web
// writes a scene row per place AND posts, because the outbox never carries a
// SYSTEM row.
async function shout(prisma, character, text, { placeKey = null } = {}) {
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, error: "Say something." };
  // 300, the option's own maximum. This goes into a couple of dozen channels
  // and half of them get it with most of the letters knocked out; a paragraph
  // of blocks is not a message anybody reads.
  if (body.length > 300) return { ok: false, error: "A shout is 300 characters at the most." };

  if (!character?.id) return { ok: false, error: "You don't have a living character." };
  if (!character.locationId) return { ok: false, error: "You're nowhere." };

  // SHOUT, not ACT and not SPEAK — and those distinctions are the whole point
  // of this gate. {tag:bound} blocks acting but never the voice, so a hostage
  // can still yell for help, which is the one thing being tied up ought to
  // leave you — it only stops the yell CARRYING, further down, and that is a
  // muffle rather than a refusal; {tag:mute} is the mirror of it, talking
  // normally and refused only here. Checked BEFORE the cooldown is claimed
  // below: a refused shout must not burn the throat timer.
  const voice = await loadVoiceState(prisma, character.id);
  if (voice.shoutBlock) {
    return { ok: false, error: `You can't get the words out — you're ${voice.shoutBlock.name}.` };
  }

  const last = await prisma.auditLog
    .findFirst({
      where: { actionType: SHOUT_ACTION, targetCharacterId: character.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    .catch(() => null);
  const since = Date.now() - (last?.createdAt?.getTime?.() ?? 0);
  if (since < SHOUT_COOLDOWN_MS) {
    const left = SHOUT_COOLDOWN_MS - since;
    const minutes = Math.max(1, Math.ceil(left / 60_000));
    return {
      ok: false,
      retryAfter: Math.ceil(left / 1000),
      error: `Your throat needs about ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
    };
  }

  // Two different things muffle a shout, and they are not the same distance.
  //
  //   sealed — the walls hold it (a soundproof Room). Nothing leaves the
  //            thread at all, not even into the street the door opens onto.
  //   gagged — {tag:bound}. The yell happens and the people standing with you
  //            hear it; it simply does not carry past where you are. Tied up
  //            still is not a refusal (COMMANDS.md §2d), and somebody who can
  //            SEE you being bound can obviously hear you — so this takes the
  //            hops, never the room.
  //
  // Neither is a gate. Everything above this point can still refuse; nothing
  // below it does, because a muffled shout is a shout that happened and it
  // costs the throat like any other.
  const sealed = await soundproofAt(prisma, placeKey);
  const gagged = voice.shoutMuffled === true;
  const muffled = sealed || gagged;
  const shouterName = await loadShouterName(prisma, character.id);

  // The room you are standing in, rendered once. Named, and told about the
  // walls if there are any.
  const here = {
    line: shoutLine(body, 0, null, { shouterName, muffled }),
    scene: shoutParts(body, 0, null, { shouterName, muffled }),
  };

  // WHO hears it, before the cooldown is claimed below. Every other refusal in
  // this function already came first for the same reason: a shout that is
  // turned away must not cost the shouter five minutes of throat.
  //
  // Skipped entirely when the room is soundproof: soundRange is a BFS across
  // the whole Location graph, and there is nowhere for the answer to go. A gag
  // asks the same BFS for nothing but its origin (maxHops 0), rather than
  // walking three hops out and throwing the rest away.
  const range = sealed ? [] : await soundRange(prisma, character.locationId, gagged ? 0 : undefined);
  const heard = range.map((place) => ({
    locationId: place.locationId,
    placeKey: placeKeyForLocation(place.locationId),
    name: place.name,
    discordChannelId: place.discordChannelId,
    distance: place.distance,
    viaName: place.viaName,
    line: shoutLine(body, place.distance, place.viaName, { shouterName, muffled }),
    // For db/lib/scene.js, which stores the pieces rather than the rendering.
    scene: shoutParts(body, place.distance, place.viaName, { shouterName, muffled }),
  }));

  // Nobody at all is not an error the player can do anything about, but it is
  // still worth saying rather than answering "you shout" into a void. Still
  // ahead of the claim: an empty street is not a shout that happened.
  //
  // The `!muffled` guard is load-bearing. A soundproof room empties `heard` by
  // design, and without it every single muffled shout would refuse here.
  if (!muffled && heard.length === 0) return { ok: false, error: "There's nobody here to hear it." };

  // The cooldown, claimed once the shout is certain — and BEFORE the caller's
  // posting loop, not after: that loop is a couple of dozen REST calls and
  // takes real seconds, which is exactly long enough for a second shout to
  // slip past a cooldown claimed at the end.
  //
  // `turnId` is set because this row is the ration the cooldown reads back
  // (REQUESTS.md §1a) — a row without one is a row the next read cannot find.
  const openTurn = await prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true } })
    .catch(() => null);
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "",
        actionType: SHOUT_ACTION,
        targetCharacterId: character.id,
        turnId: openTurn?.id ?? null,
        details: { locationId: character.locationId, text: body, placeKey, muffled, sealed, gagged },
      },
    })
    .catch((err) => console.error("Shout audit log failed:", err.message ?? err));

  // No ‡ on the muffled ack either: it is the same four words the room is
  // shown, and marking one copy and not the other would be worse than neither.
  return { ok: true, muffled, here, heard, line: muffled ? "You shout, but it's muffled." : "You shout." };
}

module.exports = { shoutLine, shoutParts, shouterNameFor, shout, SHOUT_COOLDOWN_MS };
