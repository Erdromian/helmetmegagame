// The verbs a character does TO somebody standing here, on Discord: Kiss,
// Search, Learn and Teach, Confess, Attack, Bind, the collar's three, Look at,
// picking somebody up and putting them down, and calling off a watch. Each is
// the Discord twin of a web server action and says which one; the rule itself
// is always the db/lib function that action calls, so the two faces can't
// disagree about who may do what.
//
// Every picker lists BOTH halves of the room — a hood hides who somebody is,
// never that they are standing there (PROXYING.md §5) — and posts a target key,
// never a bare id (db/lib/targetKey.js). A refusal about a hood never names it.
const { resolveTargetKey } = require("@lifeweb/db/lib/targetKey");
const { SFX } = require("@lifeweb/db/lib/sfx");
const { KISS_SELECT, createKissOffer } = require("@lifeweb/db/lib/kiss");
const { SEARCH_SELECT, createSearchOffer } = require("@lifeweb/db/lib/search");
const { LESSON_CATALOG_SELECT, learnableSkills, knownTeachableSkills, createLessonOffer } = require("@lifeweb/db/lib/lessons");
const { confessableTags, createConfessionOffer } = require("@lifeweb/db/lib/confession");
const { BIND_SELECT, isBound, needsNoConsent: bindNeedsNoConsent, applyBind, createBindOffer } = require("@lifeweb/db/lib/bind");
const {
  COLLAR_SELECT,
  wearsCollar,
  needsNoConsent: collarNeedsNoConsent,
  looseCollarsHeld,
  pickLooseCollar,
  applyCollar,
  createCollarOffer,
  unlockCollar,
  unlockRefusal,
  remoteRefusal,
  remoteReading,
  detonateCollar,
} = require("@lifeweb/db/lib/collar");
const { isLockedCollarSlug } = require("@lifeweb/db/lib/collarGlyphs");
const { ATTACK_TAG_SELECT, attackRefusal, fileAttack } = require("@lifeweb/db/lib/attack");
const { attackMoveBlock } = require("@lifeweb/db/lib/combatGate");
const { IDENTITY_SELECT, seenBy } = require("@lifeweb/db/lib/intercept");
const { HERE_FIELDS } = require("@lifeweb/db/lib/presence");
const { VIEWER_SELECT, examineRow } = require("@lifeweb/db/lib/examineRow");
const { examineBlock } = require("@lifeweb/db/lib/examineVision");
const { lastSightings } = require("@lifeweb/db/lib/sightings");
const { knownSubjects } = require("@lifeweb/db/lib/strangers");
const { concealedAlias } = require("@lifeweb/db/lib/concealedIdentity");
const {
  ESCORT_SELECT,
  escortAuthority,
  escortRefusal,
  escortCandidates,
  escortView,
  escortName,
  escortKey,
  partyOf,
  attach,
  detach,
  createEscortOffer,
} = require("@lifeweb/db/lib/escort");
const { syncPartyMembership } = require("@lifeweb/db/lib/partyChat");
const { rosterHere, pickerName } = require("@lifeweb/db/lib/peopleHere");
const { logAudit } = require("@lifeweb/db/lib/auditLog");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { afterInventoryChangeDb, notifyCharacterDb, sendOfferDm } = require("@lifeweb/db/lib/inventoryTail");
const { examineEmbed } = require("../examineEmbed");
const { respond } = require("../respond");
const {
  prisma,
  openTurn,
  done,
  hereTarget,
  pickSomeone,
  pickFrom,
  confirm,
  ackStep,
  picked,
  actorOrRefuse,
} = require("./context");

// --- Kiss and Search: an offer, and the other side says yes (KISS.md, SEARCH.md)

// web: character/actions/offers.js#kissRequestImpl. createKissOffer writes its
// own audit row — that row IS the two-hour cooldown.
const kiss = {
  start: (interaction, { character }) =>
    pickSomeone(interaction, character, "kiss", { prompt: "Who do you want to kiss?" }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const { value } = picked(interaction);
      const targetId = await resolveTargetKey(prisma, character, value);
      const target = targetId
        ? await prisma.character.findFirst({ where: { id: targetId, status: "ALIVE" }, select: KISS_SELECT })
        : null;
      if (!target) return done(interaction, "They aren't here.");
      const turn = await openTurn();
      if (!turn) return done(interaction, "No turn is open.");
      const offer = await createKissOffer(prisma, { actor: character, target, turn });
      if (!offer.ok) return done(interaction, offer.reason);
      await sendOfferDm(prisma, offer.dm);
      return done(interaction, "Waiting on response.");
    },
  },
};

// web: character/actions/offers.js#searchRequestImpl. createSearchOffer writes
// the audit row and the SearchAttempt that IS the once-a-turn ration.
const search = {
  start: (interaction, { character }) =>
    pickSomeone(interaction, character, "search", { prompt: "Who do you want to search?" }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const { value } = picked(interaction);
      const targetId = await resolveTargetKey(prisma, character, value);
      const target = targetId
        ? await prisma.character.findFirst({ where: { id: targetId, status: "ALIVE" }, select: SEARCH_SELECT })
        : null;
      if (!target) return done(interaction, "They aren't here.");
      const turn = await openTurn();
      if (!turn) return done(interaction, "No turn is open.");
      const offer = await createSearchOffer(prisma, { actor: character, target, turn });
      if (!offer.ok) return done(interaction, offer.reason);
      // Hands going through your pockets, heard by the person being searched and nobody else.
      await sendOfferDm(prisma, offer.dm, { sfx: SFX.POCKET });
      return done(interaction, "Waiting on response.");
    },
  },
};

// --- Lessons and Confession (LESSONS.md, CONFESSION.md) ----------------------

async function lessonMe(character) {
  const catalog = await prisma.tag.findMany({ select: LESSON_CATALOG_SELECT });
  const me = { id: character.id, tags: character.tags.map((ct) => ({ tagId: ct.tagId, tag: ct.tag })) };
  return { me, catalog };
}

// web: character/actions/offers.js#lessonOfferImpl, reached by learn/teachRequestImpl.
async function sendLessonOffer(interaction, character, { teacherId, learnerId, tagId }) {
  const offer = await createLessonOffer(prisma, { initiatorId: character.id, teacherId, learnerId, tagId });
  if (!offer.ok) return done(interaction, offer.reason);
  await sendOfferDm(prisma, offer.dm);
  await logAudit(prisma, {
    actorDiscordUserId: character.discordUserId,
    actionType: "request_lesson_offer",
    targetCharacterId: offer.offer.responderId,
    details: { offerId: offer.offer.id, teacherId, learnerId, tagId },
  });
  return done(interaction, "Offer sent — the lesson happens if they accept.");
}

function lessonVerb(mode, { prompt, skills, skillPrompt, pair }) {
  return {
    start: (interaction, { character }) => pickSomeone(interaction, character, mode, { prompt }),
    steps: {
      async pick(interaction) {
        await ackStep(interaction);
        const character = await actorOrRefuse(interaction);
        if (!character) return;
        const { value, label } = picked(interaction);
        const { me, catalog } = await lessonMe(character);
        const list = skills(me, catalog);
        return pickFrom(interaction, mode, "skill", {
          prompt: skillPrompt(label ?? "them"),
          payload: value,
          options: list.map((t) => ({ label: t.name, value: t.id })),
          empty: "There's no skill to pass between you.",
        });
      },
      async skill(interaction, payload) {
        await ackStep(interaction);
        const character = await actorOrRefuse(interaction);
        if (!character) return;
        const partnerId = await resolveTargetKey(prisma, character, payload);
        if (!partnerId) return done(interaction, "They aren't here.");
        return sendLessonOffer(interaction, character, { ...pair(character.id, partnerId), tagId: picked(interaction).value });
      },
    },
  };
}

const learn = lessonVerb("learn", {
  prompt: "Who do you want to learn from?",
  skills: learnableSkills,
  skillPrompt: (name) => `What do you want ${name} to teach you?`,
  pair: (me, partner) => ({ teacherId: partner, learnerId: me }),
});

const teach = lessonVerb("teach", {
  prompt: "Who do you want to teach?",
  skills: knownTeachableSkills,
  skillPrompt: (name) => `What do you want to teach ${name}?`,
  pair: (me, partner) => ({ teacherId: me, learnerId: partner }),
});

// web: character/actions/offers.js#confessRequestImpl. The chaplains here are
// the dialog's answer, never the button's; the sin is never shown to them.
const confess = {
  async start(interaction, { character }) {
    const { named, hooded } = await rosterHere(prisma, character, {
      select: { id: true, name: true, tags: { select: { tag: { select: { slug: true } } } } },
    });
    const chaplains = [...named, ...hooded].filter((c) => c.tags.some((ct) => ct.tag.slug === "chaplain"));
    return pickFrom(interaction, "confess", "pick", {
      prompt: "Who do you want to confess to?",
      options: chaplains.map((c) => ({ label: c.name, value: c.hooded ? c.id : `character:${c.id}` })),
      empty: "There's no chaplain here to hear you.",
    });
  },
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      return pickFrom(interaction, "confess", "sin", {
        prompt: "What do you want to confess?",
        payload: picked(interaction).value,
        options: confessableTags(character).map((t) => ({ label: t.name, value: t.id })),
        empty: "You have nothing to confess.",
      });
    },
    async sin(interaction, payload) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const chaplainId = await resolveTargetKey(prisma, character, payload);
      if (!chaplainId) return done(interaction, "They aren't here.");
      const tagId = picked(interaction).value;
      const offer = await createConfessionOffer(prisma, { penitentId: character.id, chaplainId, tagId });
      if (!offer.ok) return done(interaction, offer.reason);
      await sendOfferDm(prisma, offer.dm);
      // The audit row DOES name the tag — the chaplain is kept in the dark, not the host.
      await logAudit(prisma, {
        actorDiscordUserId: character.discordUserId,
        actionType: "request_confession_offer",
        targetCharacterId: offer.offer.responderId,
        details: { offerId: offer.offer.id, chaplainId, penitentId: character.id, tagId },
      });
      return done(interaction, "Offer sent — they hear you if they accept.");
    },
  },
};

// --- Attack (ATTACK.md) ------------------------------------------------------

// web: character/attackActions.js#attackCharacterImpl — FULL_SELECT there.
const ATTACK_SELECT = {
  ...IDENTITY_SELECT,
  ...HERE_FIELDS,
  tags: {
    where: { quantity: { gt: 0 } },
    select: {
      equipped: true,
      tag: { select: { ...IDENTITY_SELECT.tags.select.tag.select, ...ATTACK_TAG_SELECT.select.tag.select } },
    },
  },
};

const attack = {
  start: (interaction, { character }) =>
    pickSomeone(interaction, character, "attack", { prompt: "Who do you want to attack?" }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const { value, label } = picked(interaction);
      return confirm(interaction, "attack", value, {
        prompt: `Attack ${label ?? "them"}? You'll both be held here until the turn ends.`,
        label: "Attack",
        danger: true,
      });
    },
    async go(interaction, key) {
      await ackStep(interaction);
      const actor = await actorOrRefuse(interaction);
      if (!actor) return;
      const character = await prisma.character.findUnique({ where: { id: actor.id }, select: ATTACK_SELECT });
      const turn = await openTurn();
      if (!turn) return done(interaction, "There's no turn open right now.");
      // Ahead of the band gate on purpose: somebody who cannot attack at all
      // this turn must not learn, as a consolation prize, that the person they
      // picked was out of their league (COMBAT.md §5).
      const spent = await attackMoveBlock(prisma, character.id, turn.id);
      if (spent) return done(interaction, spent);
      const { target, error } = await hereTarget(character, key, { select: ATTACK_SELECT });
      if (error) return done(interaction, error);
      if (target.id === character.id) return done(interaction, "You can't attack yourself.");
      const refusal = attackRefusal(character.tags, target.tags);
      if (refusal) return done(interaction, refusal);
      const filed = await fileAttack(prisma, { attacker: character, target, openTurn: turn, locationId: character.locationId });
      if (filed.already) return done(interaction, "You're already fighting them.");
      if (filed.cooldownSecondsLeft) {
        const minutes = Math.max(1, Math.ceil(filed.cooldownSecondsLeft / 60));
        return done(
          interaction,
          `You broke that fight off. Give it about ${minutes} more minute${minutes === 1 ? "" : "s"} before going back in.`,
        );
      }
      const seen = await seenBy(prisma, character.id, target);
      await logAudit(prisma, {
        actorDiscordUserId: actor.discordUserId,
        actionType: "request_attack_filed",
        targetCharacterId: target.id,
        turnId: turn.id,
        details: { presented: seen, locationId: character.locationId },
      });
      for (const dm of filed.dms) {
        await sendDm(prisma, dm.discordUserId, dm.content, {
          kind: dm.kind,
          components: dm.components,
          meta: dm.meta,
          allowedMentions: { parse: [] },
          sfx: SFX.BLADE_DRAWN,
        }).catch(() => {});
      }
      return done(interaction, `You attack ${seen}.`);
    },
  },
};

// --- Bind and the collar (LESSONS.md §3, COLLAR.md) --------------------------

// web: character/actions/misc.js#bindCharacterRequestImpl.
const bind = {
  start: (interaction, { character }) =>
    pickSomeone(interaction, character, "bind", { prompt: "Who do you want to tie up?", includeDead: true }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const { value, label } = picked(interaction);
      return confirm(interaction, "bind", value, { prompt: `Tie ${label ?? "them"} up?`, label: "Bind" });
    },
    async go(interaction, key) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      if (!character.locationId) return done(interaction, "You aren't anywhere you could do that.");
      const targetId = await resolveTargetKey(prisma, character, key, { allowDead: true });
      if (targetId === character.id) return done(interaction, "You can't bind yourself.");
      const { target, error } = await hereTarget(character, key, { allowDead: true, select: BIND_SELECT });
      if (error) return done(interaction, error);
      if (isBound(target)) return done(interaction, `${target.name} is already bound.`);
      const turn = await openTurn();
      if (!turn) return done(interaction, "No turn is open.");
      const actor = { id: character.id, name: character.name, discordUserId: character.discordUserId };
      if (!bindNeedsNoConsent(target)) {
        const offer = await createBindOffer(prisma, { actor, target, turn });
        if (!offer.ok) return done(interaction, offer.reason);
        await sendOfferDm(prisma, offer.dm);
        await logAudit(prisma, {
          actorDiscordUserId: character.discordUserId,
          actionType: "request_bind_offer",
          targetCharacterId: target.id,
          details: { offerId: offer.offer.id, targetName: target.name },
        });
        return done(interaction, `${target.name} has to agree first.`);
      }
      await applyBind(prisma, { actor, target, turn });
      await afterInventoryChangeDb(prisma, target.id);
      await notifyCharacterDb(prisma, target, "Someone bound you.");
      return done(interaction, `${target.name} is tied up.`);
    },
  },
};


// web: character/actions/misc.js#collarActorAndTarget.
async function collarTarget(character, key, { allowSelf = false, allowDead = false } = {}) {
  if (!character.locationId) return { error: "You aren't anywhere you could do that." };
  const { target, error } = await hereTarget(character, key, {
    allowDead,
    select: COLLAR_SELECT,
    status: allowDead ? { in: ["ALIVE", "DEAD"] } : "ALIVE",
  });
  if (error) return { error };
  if (!allowSelf && target.id === character.id) return { error: "Pick somebody else." };
  const turn = await openTurn();
  if (!turn) return { error: "No turn is open." };
  return { target, turn, actor: collarActor(character) };
}

function collarActor(character) {
  return {
    id: character.id,
    name: character.name,
    discordUserId: character.discordUserId,
    locationId: character.locationId,
    zoneId: character.zoneId,
  };
}

// Both ends of Apply Collar: `collarSlug` is the one picked, or null for the
// first in hand (a blank one before a marked one).
async function applyCollarTo(interaction, key, collarSlug) {
  const character = await actorOrRefuse(interaction);
  if (!character) return;
  const { target, turn, actor, error } = await collarTarget(character, key, { allowSelf: true, allowDead: true });
  if (error) return done(interaction, error);
  const collar = await pickLooseCollar(prisma, character.id, { slug: collarSlug || null });
  if (!collar) return done(interaction, collarSlug ? "You don't have that collar." : "You don't have a collar.");
  if (wearsCollar(target)) return done(interaction, `${target.name} already has a collar on.`);
  const self = target.id === character.id;
  if (!self && !collarNeedsNoConsent(target)) {
    const offer = await createCollarOffer(prisma, { actor, target, turn, collar });
    if (!offer.ok) return done(interaction, offer.reason);
    await sendOfferDm(prisma, offer.dm);
    await logAudit(prisma, {
      actorDiscordUserId: character.discordUserId,
      actionType: "request_collar_offer",
      targetCharacterId: target.id,
      details: { offerId: offer.offer.id, targetName: target.name },
    });
    return done(interaction, `${target.name} has to agree first.`);
  }
  const applied = await applyCollar(prisma, { actor, target, turn, collar });
  if (!applied.ok) return done(interaction, applied.reason);
  await afterInventoryChangeDb(prisma, self ? [character.id] : [character.id, target.id]);
  if (!self) await notifyCharacterDb(prisma, target, "Someone put a collar on you.");
  return done(interaction, `${self ? "You have" : `${target.name} has`} a collar on. It is marked ${applied.glyph}.`);
}

// web: character/actions/misc.js#applyCollarRequestImpl. Two doors, Bind's:
// anybody who could refuse is asked; somebody helpless, or yourself, is
// collared on the spot. The picker lists everybody — never who is collared.
// Holding more than one collar asks which, the web dialog's "Which collar?"
// row, so a marked collar can be moved onto a new neck on purpose.
const applycollar = {
  start: (interaction, { character }) =>
    pickSomeone(interaction, character, "applycollar", {
      prompt: "Whose neck does the collar go round?",
      includeDead: true,
      includeSelf: true,
    }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const { value, label } = picked(interaction);
      const whom = label === "Yourself" ? "yourself" : label ?? "them";
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const collars = await looseCollarsHeld(prisma, character.id);
      if (collars.length > 1) {
        return pickFrom(interaction, "applycollar", "which", {
          prompt: `Which collar goes on ${whom}? Only the Exactor's ring, or the Pusher's, unlocks it.`,
          payload: value,
          options: collars.map((c) => ({ label: c.name, value: c.slug })),
        });
      }
      return confirm(interaction, "applycollar", value, {
        prompt: `Lock the collar on ${whom}? Only the Exactor's ring, or the Pusher's, unlocks it.`,
        label: "Apply Collar",
        danger: true,
      });
    },
    // Picking the collar is the second deliberate click, so it acts at once.
    async which(interaction, key) {
      await ackStep(interaction);
      return applyCollarTo(interaction, key, picked(interaction).value);
    },
    async go(interaction, key) {
      await ackStep(interaction);
      return applyCollarTo(interaction, key, null);
    },
  },
};

// web: character/actions/misc.js#unlockCollarRequestImpl. No consent: a collar
// coming OFF needs nobody's leave.
const unlockcollar = {
  start: (interaction, { character }) =>
    pickSomeone(interaction, character, "unlockcollar", { prompt: "Whose collar do you unlock?", includeDead: true }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const { target, turn, actor, error } = await collarTarget(character, picked(interaction).value, { allowDead: true });
      if (error) return done(interaction, error);
      const refusal = await unlockRefusal(prisma, character.id);
      if (refusal) return done(interaction, refusal);
      if (!wearsCollar(target)) return done(interaction, `${target.name} doesn't have a collar on.`);
      const unlocked = await unlockCollar(prisma, { actor, target, turn });
      if (!unlocked.ok) return done(interaction, unlocked.reason);
      await afterInventoryChangeDb(prisma, [character.id, target.id]);
      await notifyCharacterDb(prisma, target, "Someone took your collar off.");
      return done(interaction, `${target.name} is out of the collar, and it's yours. It is marked ${unlocked.glyph}.`);
    },
  },
};

// web: character/actions/misc.js#readRemoteRequestImpl + detonateCollarRequestImpl.
// The remote answers to the Exactor's ring (COLLAR.md §3) and lists every
// collar in the game, in any zone, by glyph; a name goes beside one only for
// somebody standing here, and only the name the holder knows them by. A kill,
// so it takes a confirm on top of the re-checks.
const detonatecollar = {
  async start(interaction, { character }) {
    const refusal = await remoteRefusal(prisma, character.id);
    if (refusal) return done(interaction, refusal);
    const collars = await remoteReading(prisma, collarActor(character));
    const wornHere = new Map();
    if (collars.length) {
      const { named, hooded } = await rosterHere(prisma, character, {
        select: { id: true, name: true, tags: { select: { tag: { select: { slug: true } } } } },
      });
      for (const row of [...named, ...hooded]) {
        for (const ct of row.tags ?? []) {
          if (isLockedCollarSlug(ct.tag.slug)) wornHere.set(ct.tag.slug, pickerName(row));
        }
      }
    }
    return pickFrom(interaction, "detonatecollar", "pick", {
      prompt: "Which collar do you set off?",
      empty: "The remote shows no collars.",
      options: collars.map((c) => ({
        label: wornHere.has(c.slug) ? `Collar ${c.glyph} — ${wornHere.get(c.slug)}` : `Collar ${c.glyph}`,
        value: c.slug,
      })),
    });
  },
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const { value, label } = picked(interaction);
      return confirm(interaction, "detonatecollar", value, {
        prompt: `Set off ${label ?? "that collar"}? There's no taking it back.`,
        label: "Detonate",
        danger: true,
      });
    },
    async go(interaction, collarSlug) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const refusal = await remoteRefusal(prisma, character.id);
      if (refusal) return done(interaction, refusal);
      const turn = await openTurn();
      if (!turn) return done(interaction, "No turn is open.");
      const result = await detonateCollar(prisma, { actor: collarActor(character), collarSlug, turn });
      if (!result.ok) return done(interaction, result.reason);
      await afterInventoryChangeDb(prisma, [result.targetId]);
      return done(interaction, `Collar ${result.glyph} went off.`);
    },
  },
};

// --- Look at (the 🔍 readout, on a command) ----------------------------------

// web: character/examineActions.js#peopleToExamine + examineCharacter. The list
// is who you have HEARD this turn, never a roster of who is standing here, so it
// can't be used as a presence oracle; each row is keyed by the line you heard.
const examine = {
  async start(interaction, { character }) {
    const me = await prisma.character.findUnique({ where: { id: character.id }, select: VIEWER_SELECT });
    const blocked = examineBlock(me.tags);
    if (blocked) return done(interaction, blocked);
    const seen = await lastSightings(prisma, me, { discordUserId: me.discordUserId });
    const known = await knownSubjects(prisma, me.id, [...seen.keys()]);
    const strangers = [...seen.entries()].filter(([id, s]) => !s.concealed && known && !known.has(id)).map(([id]) => id);
    const looks = strangers.length
      ? await prisma.character.findMany({ where: { id: { in: strangers } }, select: { id: true, age: true, gender: true } })
      : [];
    const lookOf = new Map(looks.map((c) => [c.id, c]));
    const people = [...seen.entries()]
      .map(([id, s]) => ({
        value: s.seq,
        label: lookOf.has(id) ? concealedAlias(lookOf.get(id)) : s.name,
        concealed: s.concealed || lookOf.has(id),
      }))
      .sort((a, b) => Number(a.concealed) - Number(b.concealed) || (a.label ?? "").localeCompare(b.label ?? ""));
    return pickFrom(interaction, "examine", "pick", {
      prompt: "Who do you want to look at?",
      options: people,
      empty: "You haven't heard anybody say anything this turn.",
    });
  },
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const actor = await actorOrRefuse(interaction, { needs: null });
      if (!actor) return;
      const me = await prisma.character.findUnique({ where: { id: actor.id }, select: VIEWER_SELECT });
      const blocked = examineBlock(me.tags);
      if (blocked) return done(interaction, blocked);
      const seq = picked(interaction).value;
      const seen = await lastSightings(prisma, me, { discordUserId: me.discordUserId });
      const sighting = [...seen.values()].find((s) => s.seq === seq);
      if (!sighting) return done(interaction, "You haven't heard them say anything.");
      const result = await examineRow(prisma, me, sighting.seq);
      if (!result) return done(interaction, "You can't see them.");
      if (result.blocked) return done(interaction, result.blocked);
      return respond(interaction, { content: "", embeds: [examineEmbed(result.readout)], components: [] });
    },
  },
};

// --- Pick somebody up, put them down (MAP.md §3a) ----------------------------

async function escortLeader(interaction) {
  const actor = await actorOrRefuse(interaction);
  if (!actor) return null;
  return prisma.character.findUnique({ where: { id: actor.id }, select: ESCORT_SELECT });
}

// web: chat/actions.js#bringAlong. FORCED and CONSENTED attach at once; anyone
// else is asked.
const bring = {
  async start(interaction, { character }) {
    const leader = await prisma.character.findUnique({ where: { id: character.id }, select: ESCORT_SELECT });
    const turn = await openTurn();
    const candidates = await escortCandidates(prisma, leader, turn?.number ?? null);
    return pickFrom(interaction, "bring", "pick", {
      prompt: "Who do you want to take along?",
      options: candidates
        .filter((c) => !c.attached)
        .map((c) => ({
          label: c.name,
          value: c.id,
          description: c.verdict === "ASK" ? "You'd have to ask them" : c.reason ?? "comes with you",
        })),
      empty: "There's nobody here you could take along.",
    });
  },
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const leader = await escortLeader(interaction);
      if (!leader) return;
      const turn = await openTurn();
      const targetId = await resolveTargetKey(prisma, leader, picked(interaction).value, { allowDead: true });
      const target = targetId
        ? await prisma.character.findUnique({ where: { id: targetId }, select: ESCORT_SELECT })
        : null;
      const verdict = escortAuthority(leader, target, turn?.number ?? null);
      if (!verdict) return done(interaction, escortRefusal(leader, target));
      const view = await escortView(prisma, leader);
      if (verdict === "ASK") {
        if (!turn) return done(interaction, "No turn is open.");
        const offer = await createEscortOffer(prisma, { actor: leader, target, turn });
        if (!offer.ok) return done(interaction, offer.reason);
        await sendOfferDm(prisma, offer.dm);
        return done(interaction, `You asked ${escortName(target, view)} to come with you.`);
      }
      if (!(await attach(prisma, leader.id, target.id, { takeover: verdict === "FORCED" }))) {
        return done(interaction, "Somebody else has them.");
      }
      await syncPartyMembership(prisma, leader.id).catch(() => {});
      return done(interaction, `${escortName(target, view)} is with you.`);
    },
  },
};

// web: chat/actions.js#putDown. Letting go is never gated.
const putdown = {
  async start(interaction, { character }) {
    const leader = await prisma.character.findUnique({ where: { id: character.id }, select: ESCORT_SELECT });
    const [party, view] = await Promise.all([partyOf(prisma, leader.id), escortView(prisma, leader)]);
    return pickFrom(interaction, "putdown", "pick", {
      prompt: "Who do you want to put down?",
      options: party
        .map((row) => ({ label: escortName(row, view), value: escortKey(row, view) }))
        .filter((o) => o.value),
      empty: "Nobody is with you.",
    });
  },
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const actor = await actorOrRefuse(interaction, { needs: null });
      if (!actor) return;
      const leader = await prisma.character.findUnique({ where: { id: actor.id }, select: ESCORT_SELECT });
      const targetId = await resolveTargetKey(prisma, leader, picked(interaction).value, { allowDead: true });
      const target = targetId
        ? await prisma.character.findFirst({ where: { id: targetId, escortedById: leader.id }, select: ESCORT_SELECT })
        : null;
      if (!target) return done(interaction, "They aren't with you.");
      await detach(prisma, target.id);
      await syncPartyMembership(prisma, leader.id).catch(() => {});
      return done(interaction, `You let ${escortName(target, await escortView(prisma, leader))} go.`);
    },
  },
};

module.exports = {
  kiss,
  search,
  learn,
  teach,
  confess,
  attack,
  bind,
  applycollar,
  unlockcollar,
  detonatecollar,
  examine,
  bring,
  putdown,
};
