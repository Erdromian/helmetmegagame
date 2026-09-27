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
const { loadAttack, startFight, interveneFight } = require("@lifeweb/db/lib/verbs/combat");
const {
  COMBAT_JOIN_PREFIX,
  COMBAT_DECLINE_PREFIX,
  COMBAT_WRITE_PREFIX,
  COMBAT_CALL_OFF_PREFIX,
} = require("@lifeweb/db/lib/combat");
const { SURPRISED, DECLINED_ATTACKERS, invitedLine, joinSideLine } = require("@lifeweb/db/lib/combatMode");
const { sendCombatDms } = require("../combatButtons");
const { seenById } = require("@lifeweb/db/lib/intercept");
const { VIEWER_SELECT, examineRow } = require("@lifeweb/db/lib/examineRow");
const { examineBlock } = require("@lifeweb/db/lib/examineVision");
const { lastSightings } = require("@lifeweb/db/lib/sightings");
const { knownSubjects } = require("@lifeweb/db/lib/strangers");
const { concealedAlias, capitalizeFirst } = require("@lifeweb/db/lib/concealedIdentity");
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
  verbId,
  OPTION_LIMIT,
} = require("./context");
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } = require("discord.js");
const { announceFight } = require("@lifeweb/db/lib/combatAnnounce");

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
//
// web: character/attackActions.js and components/actions/AttackDialog.js. The rules are
// db/lib/verbs/combat.js, shared with the web. Three faces, as there: the fight you are in, a fight going
// on here you can join, or a new attack — several targets, and anybody you want with you.
//
// A multi-pick cannot ride in a custom id (Discord caps one at 100 characters, and a hood key alone is
// ~40), so the targets picked on the first select wait in memory under a short nonce until the second
// answers. Fifteen minutes and a few hundred entries at most; a bot restart loses them, and the player is
// told to start again rather than attacking somebody they did not mean to.
const ATTACK_STASH_MS = 15 * 60 * 1000;
const attackStash = new Map();

function stashAttack(entry) {
  const now = Date.now();
  for (const [k, v] of attackStash) if (v.at + ATTACK_STASH_MS < now) attackStash.delete(k);
  while (attackStash.size >= 500) attackStash.delete(attackStash.keys().next().value);
  const nonce = require("crypto").randomBytes(6).toString("hex");
  attackStash.set(nonce, { ...entry, at: now });
  return nonce;
}

function takeStash(nonce, discordUserId) {
  const entry = attackStash.get(nonce);
  if (!entry || entry.discordUserId !== discordUserId || entry.at + ATTACK_STASH_MS < Date.now()) return null;
  return entry;
}

async function sendFightResult(interaction, result) {
  await sendCombatDms(interaction.client, result.dms);
  if (result.announce) {
    await announceFight(prisma, result.announce, { skipIds: result.announce.fighters }).catch((err) =>
      console.error("Attack: announcement failed:", err),
    );
  }
}

// The fight you are in, with the same buttons the fight's DMs carry (bot/src/lib/combatButtons.js).
function fightReply(interaction, view) {
  const names = (list) => list.map((p) => (p.me ? "you" : p.name) + (p.status === "INVITED" ? " (asked to join)" : "")).join(", ");
  const lines = [
    `**${view.fromAmbush ? "An ambush" : "A fight"}${view.locationName ? ` at ${view.locationName}` : ""}**`,
    `Attacking: ${names(view.attackers)}`,
    `Defending: ${names(view.defenders)}`,
  ];
  const buttons = [];
  if (view.status === "INVITED") {
    lines.push(invitedLine(view.inviter));
    if (view.canAnswer) {
      buttons.push({ type: 2, style: 3, custom_id: `${COMBAT_JOIN_PREFIX}${view.participantId}`, label: "Join" });
      buttons.push({ type: 2, style: 2, custom_id: `${COMBAT_DECLINE_PREFIX}${view.participantId}`, label: "Decline" });
    }
  } else {
    lines.push(view.alert ? (view.description ? `» ${view.description}` : "You haven't written what you do yet.") : SURPRISED);
    if (view.canDescribe) buttons.push({ type: 2, style: 1, custom_id: `${COMBAT_WRITE_PREFIX}${view.participantId}`, label: "Write your attack" });
    if (view.calledOff) lines.push(`-# You want to call it off. Waiting on ${view.waitingOn} more on your side.`);
    if (view.canCallOff) buttons.push({ type: 2, style: 4, custom_id: `${COMBAT_CALL_OFF_PREFIX}${view.participantId}`, label: "Call off" });
  }
  return respond(interaction, { content: lines.join("\n"), components: buttons.length ? [{ type: 1, components: buttons }] : [] }, { fleeting: false });
}

// The first select: who you attack, several at once. Everybody already fighting is left off — the web greys
// them; a Discord select cannot, and a pick that could only be refused is worse than none.
async function attackTargetPicker(interaction, people) {
  const free = people.filter((p) => !p.fighting).slice(0, OPTION_LIMIT);
  if (free.length === 0) return done(interaction, "There's nobody here you could attack.");
  const menu = new StringSelectMenuBuilder()
    .setCustomId(verbId("attack", "targets"))
    .setPlaceholder("Who are you attacking?")
    .setMinValues(1)
    .setMaxValues(free.length)
    .addOptions(free.map((p) => ({ label: p.name.slice(0, 100), value: p.key })));
  return respond(
    interaction,
    { content: "Who are you attacking? Pick one or more.", components: [new ActionRowBuilder().addComponents(menu)] },
    { fleeting: false },
  );
}

function attackConfirm(interaction, nonce, entry) {
  const who = entry.targets.map((t) => t.name).join(", ");
  const withLine = entry.helpers.length ? ` You'll ask ${entry.helpers.map((h) => h.name).join(", ")} to join you.` : "";
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(verbId("attack", "go", nonce)).setLabel("Attack").setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(verbId("attack", "cancel")).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
  );
  return respond(
    interaction,
    { content: `Attack ${who}?${withLine} Everyone in the fight is held here until it's over.`, components: [row] },
    { fleeting: false },
  );
}

const attack = {
  async start(interaction, { character, openTurn: turn }) {
    const out = await loadAttack(prisma, { characterId: character.id, turn });
    if (!out.ok) return done(interaction, out.error);
    if (out.view) return fightReply(interaction, out.view);
    if (out.blocked) return done(interaction, out.blocked);
    if (out.fights.length === 0) return attackTargetPicker(interaction, out.people);
    // A fight going on here: join a side of it, or start another (the doc). Each side is labelled, and with
    // more than one fight here each row of buttons carries its fight's number.
    const fights = out.fights.slice(0, 4);
    const several = fights.length > 1;
    const rows = fights.map((f, i) => {
      const n = several ? ` (${i + 1})` : "";
      return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(verbId("attack", "side", `A~${f.combatId}`))
          .setLabel(`Join the attackers${n}`)
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(Boolean(f.declined)),
        new ButtonBuilder().setCustomId(verbId("attack", "side", `D~${f.combatId}`)).setLabel(`Join the defenders${n}`).setStyle(ButtonStyle.Secondary),
      );
    });
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(verbId("attack", "new")).setLabel("Start a separate attack").setStyle(ButtonStyle.Danger),
      ),
    );
    const lines = fights.flatMap((f, i) => [
      ...(several ? [`**Fight ${i + 1}**`] : []),
      `Attacking: ${f.attackers.join(", ")}`,
      `Defending: ${f.defenders.join(", ")}`,
      ...(f.declined ? [`-# ${DECLINED_ATTACKERS}`] : []),
    ]);
    const head = several ? "Fights are going on here:" : "A fight is going on here:";
    return respond(interaction, { content: [head, ...lines].join("\n"), components: rows }, { fleeting: false });
  },
  steps: {
    async new(interaction) {
      await ackStep(interaction);
      const actor = await actorOrRefuse(interaction);
      if (!actor) return;
      const out = await loadAttack(prisma, { characterId: actor.id, turn: await openTurn() });
      if (!out.ok) return done(interaction, out.error);
      if (out.blocked) return done(interaction, out.blocked);
      return attackTargetPicker(interaction, out.people);
    },
    async targets(interaction) {
      await ackStep(interaction);
      const actor = await actorOrRefuse(interaction);
      if (!actor) return;
      const labelOf = new Map((interaction.component?.options ?? []).map((o) => [o.value, o.label]));
      const targets = (interaction.values ?? []).map((key) => ({ key, name: labelOf.get(key) ?? "somebody" }));
      const out = await loadAttack(prisma, { characterId: actor.id, turn: await openTurn() });
      const others = (out.people ?? []).filter((p) => !p.fighting && !targets.some((t) => t.key === p.key)).slice(0, OPTION_LIMIT);
      const nonce = stashAttack({ discordUserId: interaction.user.id, targets, helpers: [] });
      if (others.length === 0) return attackConfirm(interaction, nonce, takeStash(nonce, interaction.user.id));
      const menu = new StringSelectMenuBuilder()
        .setCustomId(verbId("attack", "with", nonce))
        .setPlaceholder("Who do you want with you?")
        .setMinValues(1)
        .setMaxValues(others.length)
        .addOptions(others.map((p) => ({ label: p.name.slice(0, 100), value: p.key })));
      const skip = new ButtonBuilder().setCustomId(verbId("attack", "alone", nonce)).setLabel("Nobody — just me").setStyle(ButtonStyle.Secondary);
      return respond(
        interaction,
        {
          content: "Anyone you want with you? They get to choose whether to join.",
          components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(skip)],
        },
        { fleeting: false },
      );
    },
    async with(interaction, nonce) {
      await ackStep(interaction);
      const entry = takeStash(nonce, interaction.user.id);
      if (!entry) return done(interaction, "That picker expired — start again.");
      const labelOf = new Map((interaction.component?.options ?? []).map((o) => [o.value, o.label]));
      entry.helpers = (interaction.values ?? []).map((key) => ({ key, name: labelOf.get(key) ?? "somebody" }));
      return attackConfirm(interaction, nonce, entry);
    },
    async alone(interaction, nonce) {
      await ackStep(interaction);
      const entry = takeStash(nonce, interaction.user.id);
      if (!entry) return done(interaction, "That picker expired — start again.");
      entry.helpers = [];
      return attackConfirm(interaction, nonce, entry);
    },
    async go(interaction, nonce) {
      await ackStep(interaction);
      const entry = takeStash(nonce, interaction.user.id);
      if (!entry) return done(interaction, "That picker expired — start again.");
      attackStash.delete(nonce);
      const actor = await actorOrRefuse(interaction);
      if (!actor) return;
      const turn = await openTurn();
      if (!turn) return done(interaction, "There's no turn open right now.");
      const result = await startFight(prisma, {
        characterId: actor.id,
        discordUserId: interaction.user.id,
        targetKeys: entry.targets.map((t) => t.key),
        collaboratorKeys: entry.helpers.map((h) => h.key),
        turn,
      });
      if (!result.ok) return done(interaction, result.error);
      await sendFightResult(interaction, result);
      return done(interaction, result.line);
    },
    async side(interaction, payload) {
      await ackStep(interaction);
      const [code, combatId] = String(payload ?? "").split("~");
      const side = code === "D" ? "DEFENDER" : "ATTACKER";
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(verbId("attack", "sidego", payload)).setLabel("Join").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(verbId("attack", "cancel")).setLabel("Cancel").setStyle(ButtonStyle.Secondary),
      );
      if (!combatId) return done(interaction, "That fight is over.");
      // Re-read the fight so the confirm can name who they would be beside and against.
      const actor = await actorOrRefuse(interaction);
      if (!actor) return;
      const turn = await openTurn();
      if (!turn) return done(interaction, "There's no turn open right now.");
      const out = await loadAttack(prisma, { characterId: actor.id, turn });
      const fight = out.ok ? out.fights.find((f) => f.combatId === combatId) : null;
      if (!fight) return done(interaction, "That fight is over.");
      return respond(
        interaction,
        {
          content: `Join the ${side === "ATTACKER" ? "attackers" : "defenders"}? ${joinSideLine(fight, side)}`,
          components: [row],
        },
        { fleeting: false },
      );
    },
    async sidego(interaction, payload) {
      await ackStep(interaction);
      const [code, combatId] = String(payload ?? "").split("~");
      const actor = await actorOrRefuse(interaction);
      if (!actor) return;
      const turn = await openTurn();
      if (!turn) return done(interaction, "There's no turn open right now.");
      const result = await interveneFight(prisma, {
        characterId: actor.id,
        discordUserId: interaction.user.id,
        combatId,
        side: code === "D" ? "DEFENDER" : "ATTACKER",
        turn,
      });
      if (!result.ok) return done(interaction, result.error);
      await sendFightResult(interaction, result);
      return done(interaction, result.line);
    },
  },
};

// --- Bind and the collar (LESSONS.md §3, COLLAR.md) --------------------------

// What `character` calls the person `id`, ready to open a sentence — "A young
// man" for a hood or a stranger (web/lib/hereTarget.js#seenName). The picker
// offered them by token so the reply must not print the name either.
async function seenName(character, id) {
  return capitalizeFirst(await seenById(prisma, character.id, id));
}

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
      const name = await seenName(character, target.id);
      if (isBound(target)) return done(interaction, `${name} is already bound.`);
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
        return done(interaction, `${name} has to agree first.`);
      }
      await applyBind(prisma, { actor, target, turn });
      await afterInventoryChangeDb(prisma, target.id);
      await notifyCharacterDb(prisma, target, "Someone bound you.");
      return done(interaction, `${name} is tied up.`);
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
  const self = target.id === character.id;
  const name = self ? "You" : await seenName(character, target.id);
  if (wearsCollar(target)) return done(interaction, `${name} already ${self ? "have" : "has"} a collar on.`);
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
    return done(interaction, `${name} has to agree first.`);
  }
  const applied = await applyCollar(prisma, { actor, target, turn, collar });
  if (!applied.ok) return done(interaction, applied.reason);
  await afterInventoryChangeDb(prisma, self ? [character.id] : [character.id, target.id]);
  if (!self) await notifyCharacterDb(prisma, target, "Someone put a collar on you.");
  return done(interaction, `${self ? "You have" : `${name} has`} a collar on. It is marked ${applied.glyph}.`);
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
      const name = await seenName(character, target.id);
      if (!wearsCollar(target)) return done(interaction, `${name} doesn't have a collar on.`);
      const unlocked = await unlockCollar(prisma, { actor, target, turn });
      if (!unlocked.ok) return done(interaction, unlocked.reason);
      await afterInventoryChangeDb(prisma, [character.id, target.id]);
      await notifyCharacterDb(prisma, target, "Someone took your collar off.");
      return done(interaction, `${name} is out of the collar, and it's yours. It is marked ${unlocked.glyph}.`);
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
