// TODO(rewire): shout() below is a faithful extraction of
// bot/src/events/interactionCreate.js#handleShoutCommand (around lines
// 1909-2008 at 2f4f79ca), minus the Discord posting loop, which stays with
// its caller. The bot still runs its own copy and its own in-memory cooldown
// Map; it should call shout() instead and post the `heard` lines it hands
// back. Same gates, in the same order, with the same refusal sentences.
//
// One difference the rewiring settles: the bot's cooldown lives in a Map that
// a restart empties and that the web process could never share, so this one is
// a row in AuditLog instead — there is no timestamp column on Character to put
// it in, and this batch adds no migration.

// What a shout sounds like from N places away.
//
// Pure — no prisma, no I/O — so both faces could use it, though only the bot
// does today. db/lib/locationGraph.js#soundRange answers WHO hears; this file
// answers WHAT they hear.
//
// The shape of the rule is that distance takes the words away before it takes
// the direction away. You always learn which way to run. You stop learning
// what was said. Nobody ever learns WHO shouted, at any distance including
// zero — which is what lets a concealed character yell without unmasking.

const { ambientLine } = require("./ambientLine");
const { soundRange } = require("./locationGraph");
const { loadVoiceState } = require("./say");
const { placeKeyForLocation } = require("./placeKey");

// Light, medium, heavy — picked at random per character so a muffled line
// looks like static rather than like a censor bar.
const BLOCKS = ["░", "▒", "▓"];

// Replaces `fraction` of the NON-WHITESPACE characters with a block. Spaces
// survive on purpose: the word shapes are what tells a listener how much they
// missed, and a solid bar of noise reads as no message at all rather than as a
// message they failed to catch.
function muffle(text, fraction) {
  if (fraction <= 0) return text;
  return String(text)
    .split("")
    .map((ch) => {
      if (/\s/.test(ch)) return ch;
      if (Math.random() >= fraction) return ch;
      return BLOCKS[Math.floor(Math.random() * BLOCKS.length)];
    })
    .join("");
}

// How much is lost at each remove. Index IS the hop count, so the table reads
// off the distance directly; index 0 is never reached, because your own
// Location returns above before it gets here. Past the end of the table the
// words are gone entirely and only the direction survives.
const MUFFLE_BY_DISTANCE = [0, 0, 0.4, 0.7];

// The line one Location gets. `viaName` is the hearer's own neighbour toward
// the noise, and is null only at distance 0 (where you are standing in it).
//
// Distance 0 is FULL SIZE and everything beyond it is `-#` subtext — the same
// split /play already makes, where the room hears the performance and the
// street outside only notices it. A shout in your own street is not scenery.
function shoutLine(text, distance, viaName) {
  if (distance === 0) return `You hear someone shout: » ${text}`;
  const parts = shoutParts(text, distance, viaName);
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
function shoutParts(text, distance, viaName) {
  if (distance === 0) return { text: `You hear someone shout: » ${text}`, lines: [] };

  const where = viaName ? ` from the direction of ${viaName}` : " somewhere nearby";

  const fraction = MUFFLE_BY_DISTANCE[distance];
  if (fraction == null) {
    return { text: `You hear someone shout${where}, but you can't make out what they say.`, lines: [] };
  }
  return { text: `You hear someone shout${where}: » ${muffle(text, fraction)}`, lines: [] };
}

// ---------------------------------------------------------------- the shout

// Five minutes between shouts, per character. The bot's number.
const SHOUT_COOLDOWN_MS = 5 * 60_000;

// The AuditLog row IS the cooldown, and it is also the record of the shout.
// `targetCharacterId` is the shouter — a shout has no other party — so the
// read below is keyed on the character rather than on whichever account is
// driving them.
const SHOUT_ACTION = "shout";

// Who hears it, and what they hear.
//
// `character` needs { id, name, locationId, discordUserId }. Returns
//
//   { ok: true, heard: [{ locationId, placeKey, distance, viaName, line,
//                         discordChannelId }] }
//
// or { ok: false, error, retryAfter? } — `retryAfter` in seconds, for a
// caller that wants to count it down rather than print the sentence.
//
// The list is ordered by distance, nearest first, and includes the shouter's
// own Location at distance 0. Posting it — to Discord, to the archive, or to
// both — is the caller's half: the bot posts to channels, the web writes a
// scene row per place AND posts, because the outbox never carries a SYSTEM row.
async function shout(prisma, character, text) {
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, error: "Say something." };
  // 300, the option's own maximum. This goes into a couple of dozen channels
  // and half of them get it with most of the letters knocked out; a paragraph
  // of blocks is not a message anybody reads.
  if (body.length > 300) return { ok: false, error: "A shout is 300 characters at the most. ‡" };

  if (!character?.id) return { ok: false, error: "You don't have a living character. ‡" };
  if (!character.locationId) return { ok: false, error: "You're nowhere." };

  // SPEAK, not ACT — and that distinction is the whole point of this gate.
  // {tag:bound} blocks acting but never speech, so a hostage can still yell
  // for help, which is the one thing being tied up ought to leave you.
  // Checked BEFORE the cooldown is claimed below: a refused shout must not
  // burn the throat timer.
  const voice = await loadVoiceState(prisma, character.id);
  if (voice.block) {
    return { ok: false, error: `You can't get the words out — you're ${voice.block.name}. ‡` };
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
      error: `Your throat needs about ${minutes} more minute${minutes === 1 ? "" : "s"}. ‡`,
    };
  }

  // WHO hears it, before the cooldown is claimed below. Every other refusal in
  // this function already came first for the same reason: a shout that is
  // turned away must not cost the shouter five minutes of throat.
  const range = await soundRange(prisma, character.locationId);
  const heard = range.map((place) => ({
    locationId: place.locationId,
    placeKey: placeKeyForLocation(place.locationId),
    name: place.name,
    discordChannelId: place.discordChannelId,
    distance: place.distance,
    viaName: place.viaName,
    line: shoutLine(body, place.distance, place.viaName),
    // For db/lib/scene.js, which stores the pieces rather than the rendering.
    scene: shoutParts(body, place.distance, place.viaName),
  }));

  // Nobody at all is not an error the player can do anything about, but it is
  // still worth saying rather than answering "you shout" into a void. Still
  // ahead of the claim: an empty street is not a shout that happened.
  if (heard.length === 0) return { ok: false, error: "There's nobody here to hear it. ‡" };

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
        details: { locationId: character.locationId, text: body },
      },
    })
    .catch((err) => console.error("Shout audit log failed:", err.message ?? err));

  return { ok: true, heard, line: "You shout." };
}

module.exports = { shoutLine, shoutParts, shout, SHOUT_COOLDOWN_MS };
