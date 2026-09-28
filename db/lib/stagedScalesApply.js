// Applies one staged row's scale changes (db/lib/stagedScales.js) inside the
// push's own per-row transaction (db/lib/stagedPush.js). See
// docs/systemdocs/ADJUDICATION.md §1b for the rules a GM reads.
//
// A staged change lands the way the same change would if it had happened in
// the world, so each meter's own coded consequences come with it:
//
//   - Hunger: the descriptor tag (Full, Hungry, Starving) moves at once, and
//     dropping INTO Hungry or Starving costs the same mood the nightly pass
//     charges for it (db/lib/hungerPass.js).
//   - Blood: the Vampire's band tags move at once, and crossing INTO
//     Bloodcrazed costs 60 humanity, the one coded humanity loss
//     (VAMPIRE.md §3a).
//   - Humanity: reaching 0 from above makes them Bestial and a Wight for good
//     (VAMPIRE.md §3).
//
// A GM's own figure for a meter is applied AFTER any knock-on to it, so a Set
// is always the number they end on, and a Change moves whatever the knock-on
// left.
//
// Then the rest of the close runs from the new numbers: the hunger, Vampire
// and mood passes all sit after the push in TURN_PASSES, so tonight's decay
// still happens on top.
//
// The player hears what the game says when a meter drops into a worse band —
// the same lines the passes send — and nothing on the way back up: recovery
// shows on their sheet, and the GM's own staged message is the place to say
// how it happened. Mood keeps its own rule (db/lib/mood.js#moodBandDm: the
// three bands that move a Gambit).
//
// Takes `tx` first, the db/lib/tagWrites.js convention. Returns
// { snapshot, notices }: `snapshot` is { [key]: { from, to, … } | { skipped } }
// for the row's appliedEffect, `notices` is [{ discordUserId, content }] — at
// most one, every line the row has for them in a single DM.
const { BESTIAL_SLUG, WIGHT_SLUG } = require("./constants");
const { clampHunger, crossings, hungerDm } = require("./hunger");
const { applyMoodTerms, bandOf: moodBandOf, clampMood, moodBandDm, EVENTS } = require("./mood");
const {
  clampBlood,
  clampHumanity,
  bloodUrgencyBand,
  humanityBand,
  HUMANITY_LOSS_BLOODCRAZED,
  vampireDm,
} = require("./vampire");
const { syncHungerDescriptor } = require("./hungerDescriptor");
const { syncVampireBandsNow } = require("./vampireBands");
const { SCALES, SKIP_REASONS, SCALE_GATE_SLUGS, scaleBlockFor, resolveScale } = require("./stagedScales");

// Best first, so a higher index is a worse band.
const URGENCY_ORDER = ["flush", "satiated", "thirsty", "famished", "bloodcrazed"];
const HUMANITY_ORDER = ["humane", "estranged", "disturbed", "warped"];

function worse(order, from, to) {
  return to !== from && order.indexOf(to) > order.indexOf(from);
}

async function applyStagedScalesInTx(tx, { characterId, scales, turn }) {
  const notices = [];
  const keys = SCALES.map((s) => s.key).filter((key) => scales?.[key]);
  if (!keys.length) return { snapshot: null, notices };

  const character = await tx.character.findUnique({
    where: { id: characterId },
    select: {
      status: true,
      discordUserId: true,
      hungerValue: true,
      mood: true,
      vampireBloodLevel: true,
      vampireHumanity: true,
      tags: {
        where: { tag: { slug: { in: [...SCALE_GATE_SLUGS, BESTIAL_SLUG] } } },
        select: { tag: { select: { slug: true } } },
      },
    },
  });

  const snapshot = {};
  // A body has no appetite and no mood to move, and the nightly passes skip it
  // for the same reason. Not a failure: they died before the push got here.
  if (!character || character.status !== "ALIVE") {
    for (const key of keys) snapshot[key] = { skipped: SKIP_REASONS.notAlive };
    return { snapshot, notices };
  }

  const held = new Set(character.tags.map((ct) => ct.tag.slug));
  // The scales this row asked for that this character can't take: recorded,
  // and left alone.
  const want = {};
  for (const key of keys) {
    const blocked = scaleBlockFor(key, held);
    if (blocked) snapshot[key] = { skipped: blocked };
    else want[key] = scales[key];
  }

  // Every line this row has for them, sent as ONE DM at the end — the hunger
  // pass's posture — rather than four notifications for one ruling.
  const lines = [];
  const tell = (content) => {
    if (content) lines.push(content);
  };
  const moodAtStart = clampMood(character.mood ?? 0);

  // ── Hunger ──────────────────────────────────────────────────────────────
  if (want.hunger) {
    const from = clampHunger(character.hungerValue);
    const to = resolveScale("hunger", from, want.hunger);
    await tx.character.update({ where: { id: characterId }, data: { hungerValue: to } });
    // The same helper eating and Feed Them use, so the descriptor and the zero
    // clock can never disagree with the meter.
    await syncHungerDescriptor(tx, characterId, { hungerValue: to, hungerless: false });
    snapshot.hunger = { from, to };

    const cross = crossings(from, to);
    const terms = [];
    if (cross.enteredHungry) terms.push({ kind: "HUNGRY_ONSET", base: EVENTS.HUNGRY_ONSET, ctx: {} });
    if (cross.enteredStarving) terms.push({ kind: "STARVING_ONSET", base: EVENTS.STARVING_ONSET, ctx: {} });
    // A pinned dial (Imperturbable, Changa) takes no onset: the nightly pass
    // holds it where it is.
    if (terms.length && !scaleBlockFor("mood", held)) {
      const moved = await applyMoodTerms(tx, characterId, terms, { notify: false });
      if (moved?.delta) snapshot.mood = { from: moved.before, to: moved.after, onset: moved.delta };
    }
    if (cross.enteredStarving) tell(hungerDm({ kind: "starving" }));
    else if (cross.enteredHungry) tell(hungerDm({ kind: "hungry" }));
  }

  // ── Mood ────────────────────────────────────────────────────────────────
  if (want.mood) {
    const current = snapshot.mood ? snapshot.mood.to : moodAtStart;
    const to = resolveScale("mood", current, want.mood);
    await tx.character.update({ where: { id: characterId }, data: { mood: to } });
    snapshot.mood = {
      from: moodAtStart,
      to,
      ...(snapshot.mood?.onset ? { onset: snapshot.mood.onset } : {}),
    };
  }
  if (snapshot.mood && !snapshot.mood.skipped) {
    tell(moodBandDm(moodBandOf(moodAtStart), moodBandOf(snapshot.mood.to)));
  }

  // ── Blood and humanity ──────────────────────────────────────────────────
  if (want.blood || want.humanity) {
    const bloodFrom = clampBlood(character.vampireBloodLevel);
    const humanityFrom = clampHumanity(character.vampireHumanity);
    const bloodTo = want.blood ? resolveScale("blood", bloodFrom, want.blood) : bloodFrom;

    const urgencyFrom = bloodUrgencyBand(bloodFrom);
    const urgencyTo = bloodUrgencyBand(bloodTo);
    const enteredBloodcrazed = urgencyFrom !== "bloodcrazed" && urgencyTo === "bloodcrazed";
    // The automatic loss first, then the GM's own figure on top of it — a Set
    // on humanity overrides it, a Change adds to it.
    const afterLoss = enteredBloodcrazed ? clampHumanity(humanityFrom - HUMANITY_LOSS_BLOODCRAZED) : humanityFrom;
    const humanityTo = want.humanity ? resolveScale("humanity", afterLoss, want.humanity) : afterLoss;
    const lossCounted = enteredBloodcrazed && want.humanity?.op !== "set";

    const heldBestial = held.has(BESTIAL_SLUG);
    const becameBestial = !heldBestial && humanityFrom > 0 && humanityTo <= 0;

    await tx.character.update({
      where: { id: characterId },
      data: { vampireBloodLevel: bloodTo, vampireHumanity: humanityTo },
    });
    if (becameBestial) {
      // Permanent, no clock, the vampire pass's own grant (db/lib/vampirePass.js).
      // Before the band sync below, which reads Bestial to know the humanity
      // bands are over.
      const permanent = await tx.tag.findMany({
        where: { slug: { in: [BESTIAL_SLUG, WIGHT_SLUG] } },
        select: { id: true },
      });
      await tx.characterTag.createMany({
        data: permanent.map((tag) => ({ characterId, tagId: tag.id, source: "EVENT" })),
        skipDuplicates: true,
      });
    }
    // The next turn is the one these tags land in, the same clock the push's
    // tag grants use.
    await syncVampireBandsNow(tx, characterId, bloodTo, humanityTo, { openTurnNumber: turn.number + 1 });

    if (want.blood) snapshot.blood = { from: bloodFrom, to: bloodTo };
    if (want.humanity || humanityTo !== humanityFrom) {
      snapshot.humanity = {
        from: humanityFrom,
        to: humanityTo,
        ...(lossCounted ? { bloodcrazedLoss: HUMANITY_LOSS_BLOODCRAZED } : {}),
        ...(becameBestial ? { bestial: true } : {}),
      };
    }

    if (worse(URGENCY_ORDER, urgencyFrom, urgencyTo)) tell(vampireDm({ kind: urgencyTo }));
    if (becameBestial) {
      tell(vampireDm({ kind: "bestial" }));
    } else if (!heldBestial) {
      const bandFrom = humanityBand(humanityFrom);
      const bandTo = humanityBand(humanityTo);
      // No band at 0 without Bestial (a GM's hand edit): climbing out of it is not a fall.
      if (bandFrom && bandTo && worse(HUMANITY_ORDER, bandFrom, bandTo)) tell(vampireDm({ kind: bandTo }));
    }
  }

  if (lines.length && character.discordUserId) {
    notices.push({ discordUserId: character.discordUserId, content: lines.join("\n") });
  }
  return { snapshot, notices };
}

module.exports = { applyStagedScalesInTx };
