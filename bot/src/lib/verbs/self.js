// What a character does with their own things and their own body, on Discord:
// Destroy, Poison (lacing a meal), Equip and Unequip, playing a song and
// stopping it, the trumpet and the Deep Beast Horn, Disguise, Break restraints,
// the Stepstone, and their own filed Move. The rule of each is a
// db/lib/verbs/ function the web's action calls too; this file draws the
// pickers and applies the Discord side of the tail.
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  LabelBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require("discord.js");
const {
  destroyHeldTag,
  breakRestraints,
  disguiseSelf,
  stepstone,
  stepstoneTargets,
  equipOneTag,
  unequipOneTag,
  poisonHeldItem,
} = require("@lifeweb/db/lib/verbs/self");
const { soundTrumpet, soundHorn } = require("@lifeweb/db/lib/verbs/roles");
const { destroyableTags, consumableTags } = require("@lifeweb/db/lib/craftRecipes");
const { equippedInstruments, startPerformance, stopPerformance } = require("@lifeweb/db/lib/performance");
const { songsFor } = require("@lifeweb/db/lib/instrumentSongs");
const { playInstrument } = require("@lifeweb/db/lib/instrumentPlay");
const { placeKeyForLocation } = require("@lifeweb/db/lib/placeKey");
const { broadcastTrumpet } = require("@lifeweb/db/lib/trumpet");
const { broadcastDeepBeastHorn } = require("@lifeweb/db/lib/deepBeastHorn");
const { applyLocationMoveSideEffects } = require("@lifeweb/db/lib/locationMove");
const { rollCavingOnArrival } = require("@lifeweb/db/lib/cavingPass");
const { characterRoleAppearance } = require("@lifeweb/db/lib/characterRoleAppearance");
const { formatBareName, NAME_LIMITS } = require("@lifeweb/db/lib/characterName");
const { DISGUISE_TURNS } = require("@lifeweb/db/lib/disguiseMint");
const { moveIsEditable, editMove, withdrawMove } = require("@lifeweb/db/lib/moves");
const { clockStatus } = require("@lifeweb/db/lib/gameState");
const { sendDm } = require("@lifeweb/db/lib/dm");
const { setCombatMode } = require("@lifeweb/db/lib/verbs/combatMode");
const { inCombatMode } = require("@lifeweb/db/lib/combatMode");
const { resolveActingMember } = require("../interactionGuild");
const { ack, respond } = require("../respond");
const {
  prisma,
  openTurn,
  done,
  pickFrom,
  confirm,
  ackStep,
  picked,
  actorOrRefuse,
  finish,
  verbId,
  modalId,
  loadActor,
  actBlock,
} = require("./context");

const qty = (n) => (n > 1 ? ` ×${n}` : "");

// --- Destroy -----------------------------------------------------------------

const destroy = {
  start: (interaction, { character }) =>
    pickFrom(interaction, "destroy", "pick", {
      prompt: "What do you want to destroy?",
      options: destroyableTags(character.tags).map((t) => ({ label: `${t.name}${qty(t.quantity)}`, value: t.id })),
      empty: "You're carrying nothing you could destroy.",
    }),
  steps: {
    // A stack asks how many; a single thing asks to be sure. There is no undo.
    async pick(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const tagId = picked(interaction).value;
      const held = character.tags.find((ct) => ct.tagId === tagId);
      if (!held) return done(interaction, "You don't have that.");
      if (held.tag.stackable && held.quantity > 1) {
        const counts = [...new Set([1, 2, 3, 5, 10, 20, held.quantity].filter((n) => n <= held.quantity))];
        return pickFrom(interaction, "destroy", "go", {
          prompt: `How many ${held.tag.name} do you want to destroy? There's no getting them back.`,
          payload: tagId,
          options: counts.map((n) => ({ label: n === held.quantity ? `All of them (${n})` : String(n), value: String(n) })),
        });
      }
      return confirm(interaction, "destroy", `${tagId}:1`, {
        prompt: `Destroy ${held.tag.name}? There's no getting it back.`,
        label: "Destroy",
        danger: true,
      });
    },
    async go(interaction, payload) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const [tagId, fromButton] = payload.split(":");
      const quantity = interaction.isStringSelectMenu?.() ? picked(interaction).value : fromButton;
      const result = await destroyHeldTag(prisma, {
        character,
        discordUserId: character.discordUserId,
        tagId,
        quantity,
        openTurn: await openTurn(),
      });
      return finish(interaction, result, { text: result.ok ? `${result.name}${qty(result.quantity)} destroyed.` : null });
    },
  },
};

// --- Poison: lacing a meal or drink you're holding --------------------------------

const poison = {
  start: (interaction, { character }) =>
    pickFrom(interaction, "poison", "pick", {
      prompt: "Which poison?",
      options: consumableTags(character.tags)
        .filter((t) => t.poison)
        .map((t) => ({ label: `${t.name}${qty(t.quantity)}`, value: t.id })),
      empty: "You aren't carrying any poison.",
    }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const food = consumableTags(character.tags).filter(
        (t) => !t.poison && (t.group?.slug === "items-food" || t.group?.slug === "items-drink"),
      );
      return pickFrom(interaction, "poison", "go", {
        prompt: "What do you lace with it?",
        payload: picked(interaction).value,
        options: food.map((t) => ({ label: `${t.name}${qty(t.quantity)}`, value: t.id })),
        empty: "You're holding nothing to put it in.",
      });
    },
    async go(interaction, poisonTagId) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const result = await poisonHeldItem(prisma, {
        character,
        discordUserId: character.discordUserId,
        poisonTagId,
        targetTagId: picked(interaction).value,
        openTurn: await openTurn(),
      });
      return finish(interaction, result, { text: result.ok ? `You lace the ${result.foodName}.` : null });
    },
  },
};

// --- Equip and Unequip -------------------------------------------------------------

const equip = {
  start: (interaction, { character }) =>
    pickFrom(interaction, "equip", "pick", {
      prompt: "What do you put on or take up?",
      options: character.tags
        .filter((ct) => ct.tag?.equippable && (ct.equippedQuantity ?? 0) < (ct.quantity ?? 1))
        .map((ct) => ({ label: `${ct.tag.name}${qty((ct.quantity ?? 1) - (ct.equippedQuantity ?? 0))}`, value: ct.id })),
      empty: "You're carrying nothing to equip.",
    }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await loadActor(interaction);
      if (!character) return done(interaction, "You don't have a living character.");
      const result = await equipOneTag(prisma, { character, characterTagId: picked(interaction).value });
      return finish(interaction, result, { text: result.ok ? `${result.name} is on.` : null });
    },
  },
};

const unequip = {
  start: (interaction, { character }) =>
    pickFrom(interaction, "unequip", "pick", {
      prompt: "What do you take off?",
      options: character.tags
        .filter((ct) => (ct.equippedQuantity ?? 0) > 0 || ct.equipped)
        .map((ct) => ({ label: ct.tag.name, value: ct.id })),
      empty: "You have nothing on.",
    }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await loadActor(interaction);
      if (!character) return done(interaction, "You don't have a living character.");
      const result = await unequipOneTag(prisma, { character, characterTagId: picked(interaction).value });
      return finish(interaction, result, { text: result.ok ? `${result.name} is off.` : null });
    },
  },
};

// --- Playing a song (SOUND.md, "Performances") ----------------------------------------

// The music itself only sounds in a browser; on Discord a performance is the
// line /play posts to the room, and the song running for anyone on the web.
function pickSong(interaction, slug) {
  return pickFrom(interaction, "play", "song", {
    prompt: "What do you play?",
    payload: slug,
    options: songsFor(slug).map((s) => ({ label: s.name, value: s.key })),
    empty: "That instrument knows no songs.",
  });
}

const play = {
  start(interaction, { character }) {
    const instruments = equippedInstruments(character.tags);
    if (instruments.length === 1) return pickSong(interaction, instruments[0]);
    return pickFrom(interaction, "play", "pick", {
      prompt: "Which instrument?",
      options: instruments.map((slug) => ({
        label: character.tags.find((ct) => ct.tag.slug === slug)?.tag.name ?? slug,
        value: slug,
      })),
      empty: "Equip an instrument first.",
    });
  },
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      return pickSong(interaction, picked(interaction).value);
    },
    async song(interaction, slug) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const { value: songKey, label } = picked(interaction);
      const result = await startPerformance(prisma, character, { instrumentSlug: slug, songKey, volume: 1 });
      if (!result.ok) return done(interaction, result.error);
      await playInstrument(prisma, character, placeKeyForLocation(character.locationId)).catch((err) =>
        console.error(`Performance: /play failed for ${character.id}:`, err),
      );
      return done(interaction, `You play ${label ?? "a song"}.`);
    },
  },
};

const stopplay = {
  needs: null,
  async start(interaction, { character }) {
    await stopPerformance(prisma, character.id, "stopped");
    return done(interaction, "You stop playing.");
  },
};

// --- The trumpet and the Deep Beast Horn ------------------------------------------------

// Asks first, in the web's own words (web/app/components/useSoundItem.js): one
// click is heard a long way off and cannot be taken back (COMMANDS.md §2e).
function soundVerb(mode, sound, broadcast, { prompt, label, heard }) {
  return {
    start: (interaction) => confirm(interaction, mode, null, { prompt, label }),
    steps: {
      async go(interaction) {
        await ackStep(interaction);
        const character = await actorOrRefuse(interaction);
        if (!character) return;
        const result = await sound(prisma, { character, discordUserId: character.discordUserId });
        if (!result.ok) return done(interaction, result.error);
        // Post-commit and catch-logged (ARCHITECTURE.md §5).
        await broadcast(result.locationId).catch((err) => console.error("Sound broadcast failed:", err));
        return done(interaction, heard);
      },
    },
  };
}

const trumpet = soundVerb("trumpet", soundTrumpet, (locationId) => broadcastTrumpet(prisma, locationId), {
  prompt: "**Sound the trumpet?**\nIt will be heard for a long way around, and everyone will know something is happening here.",
  label: "Sound it",
  heard: "You sound the trumpet.",
});
const horn = soundVerb("horn", soundHorn, () => broadcastDeepBeastHorn(prisma), {
  prompt: "**Sound the horn?**\nIt will be heard everywhere above ground. Nobody will be able to tell where from.",
  label: "Sound it",
  heard: "You sound the Deep Beast Horn.",
});

// --- Disguise -----------------------------------------------------------------------------

const DISGUISE_TITLE_FIELD = "act:disguise:title";
const DISGUISE_NAME_FIELD = "act:disguise:name";
const DISGUISE_LAST_FIELD = "act:disguise:last";

// A modal first, so it opens inside the three seconds; the kit and every other
// gate are asked on submit. The personal role follows the false name
// (PROXYING.md §6) — best-effort, after the tag is on. The same three parts as
// the web's dialog: a title, a first name and a last name (STRANGERS.md §10).
const disguise = {
  modalFirst: true,
  start(interaction) {
    const field = (id, max, required) =>
      new TextInputBuilder().setCustomId(id).setStyle(TextInputStyle.Short).setMaxLength(max).setRequired(required);
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId("disguise"))
        .setTitle("Disguise")
        .addLabelComponents(
          new LabelBuilder()
            .setLabel("Title")
            .setDescription("Optional. Sir, Lady, Father, Doctor…")
            .setTextInputComponent(field(DISGUISE_TITLE_FIELD, NAME_LIMITS.honorific, false)),
          new LabelBuilder()
            .setLabel("First name")
            .setDescription(`It lasts ${DISGUISE_TURNS} turns.`)
            .setTextInputComponent(field(DISGUISE_NAME_FIELD, NAME_LIMITS.firstName, true)),
          new LabelBuilder()
            .setLabel("Last name")
            .setDescription("Somebody's full name fools the people who know them.")
            .setTextInputComponent(field(DISGUISE_LAST_FIELD, NAME_LIMITS.lastName, false)),
        ),
    );
  },
  async modal(interaction) {
    await ack(interaction);
    const character = await actorOrRefuse(interaction);
    if (!character) return;
    const result = await disguiseSelf(prisma, {
      character,
      discordUserId: character.discordUserId,
      name: {
        honorific: interaction.fields.getTextInputValue(DISGUISE_TITLE_FIELD),
        firstName: interaction.fields.getTextInputValue(DISGUISE_NAME_FIELD),
        lastName: interaction.fields.getTextInputValue(DISGUISE_LAST_FIELD),
      },
      openTurn: await openTurn(),
    });
    if (result.ok && character.discordRoleId) {
      const { guild } = await resolveActingMember(interaction);
      const catatonic = character.tags.some((ct) => ct.tag.slug === "catatonic");
      const want = characterRoleAppearance(formatBareName(character), { catatonic, forcedName: result.name });
      await guild?.roles
        .edit(character.discordRoleId, { name: want.name, color: want.color })
        .catch((err) => console.error("Disguise role rename failed:", err.message ?? err));
    }
    return finish(interaction, result, { text: result.ok ? `You go by ${result.name} now.` : null });
  },
};

// --- Break restraints ----------------------------------------------------------------------

// NOT gated on ACT: `bound` blocks ACT, and this is the one verb a Bound
// character needs.
const breakrestraints = {
  needs: null,
  async start(interaction, { character }) {
    const result = await breakRestraints(prisma, {
      character,
      discordUserId: character.discordUserId,
      openTurn: await openTurn(),
    });
    return finish(interaction, result);
  },
};

// --- The Stepstone ---------------------------------------------------------------------------

// Two picks, the zone and then the place — the surface has more places than a
// Discord select holds.
const stepstoneVerb = {
  async start(interaction, { character }) {
    const targets = await stepstoneTargets(prisma, character);
    const zones = [...new Set(targets.map((t) => t.zoneName ?? "Elsewhere"))];
    return pickFrom(interaction, "stepstone", "zone", {
      prompt: "Break the stone and stand where?",
      options: zones.map((z) => ({ label: z, value: z })),
      empty: "There's nowhere for the stone to take you.",
    });
  },
  steps: {
    async zone(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const zone = picked(interaction).value;
      const targets = (await stepstoneTargets(prisma, character)).filter((t) => (t.zoneName ?? "Elsewhere") === zone);
      return pickFrom(interaction, "stepstone", "go", {
        prompt: `Where in ${zone}? The stone breaks as you step.`,
        options: targets.map((t) => ({ label: t.name, value: t.id })),
      });
    },
    async go(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const result = await stepstone(prisma, {
        character,
        discordUserId: character.discordUserId,
        locationId: picked(interaction).value,
        openTurn: await openTurn(),
      });
      if (!result.ok) return done(interaction, result.error);
      const { fromLocationId, toLocationId, location } = result.moved;
      await applyLocationMoveSideEffects(prisma, { characterId: character.id, fromLocationId, toLocationId }).catch((err) =>
        console.error("Stepstone: location side effects failed:", err),
      );
      try {
        const moved = await prisma.character.findUnique({ where: { id: character.id } });
        const cavingDm = await rollCavingOnArrival(prisma, moved, location);
        if (cavingDm) await sendDm(prisma, cavingDm.discordUserId, cavingDm.content).catch(() => {});
      } catch (err) {
        console.error("Stepstone: caving roll failed:", err);
      }
      return done(interaction, `The stone breaks. You're in ${result.locationName}.`);
    },
  },
};

// --- My Move ------------------------------------------------------------------------------

const EDIT_FIELD = "act:mymove:text";

// The Move filed this turn, and — while db/lib/moves.js says it is still the
// player's to change — Edit and Withdraw. The same rule the web's turn card reads.
async function myMoveView(character) {
  const turn = await prisma.turn.findFirst({
    where: { status: "OPEN" },
    select: { id: true, number: true, dayNumber: true, turnLengthHours: true, endsAt: true, startedAt: true },
  });
  if (!turn) return { content: "No turn is open.", components: [] };
  const [clock, action] = await Promise.all([
    clockStatus(prisma),
    prisma.action.findFirst({
      where: { characterId: character.id, turnId: turn.id },
      select: {
        id: true,
        moveKind: true,
        description: true,
        playerFiled: true,
        moveReviewStatus: true,
        lockExpiresAt: true,
        diceModifier: true,
      },
    }),
  ]);
  if (!action) return { content: "You haven't filed a Move this turn. /move files one.", components: [] };
  const { editable } = moveIsEditable(action, turn, { clockFrozen: clock.frozen, inSession: clock.inSession });
  const lines = [`**Your Move this turn** — ${action.moveKind === "GAMBIT" ? "a Gambit" : "a Routine"}`, `» ${action.description}`];
  if (!editable) lines.push("-# It's locked in now.");
  const components = editable
    ? [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(verbId("mymove", "edit", action.id)).setLabel("Edit").setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId(verbId("mymove", "withdraw", action.id)).setLabel("Withdraw").setStyle(ButtonStyle.Danger),
        ),
      ]
    : [];
  return { content: lines.join("\n"), components };
}

const mymove = {
  needs: null,
  async start(interaction, { character }) {
    const view = await myMoveView(character);
    return respond(interaction, view, { fleeting: view.components.length === 0 });
  },
  steps: {
    // Opens a modal, so it must NOT be acked first.
    async edit(interaction, actionId) {
      const action = await prisma.action.findUnique({ where: { id: actionId }, select: { description: true } });
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(modalId("mymove", actionId))
          .setTitle("Edit your Move")
          .addLabelComponents(
            new LabelBuilder()
              .setLabel("What you do")
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId(EDIT_FIELD)
                  .setStyle(TextInputStyle.Paragraph)
                  .setMaxLength(2000)
                  .setRequired(true)
                  .setValue((action?.description ?? "").slice(0, 2000)),
              ),
          ),
      );
    },
    async withdraw(interaction, actionId) {
      await ackStep(interaction);
      return confirm(interaction, "mymove", actionId, {
        prompt: "Take this Move back? You get the day back to spend on something else.",
        label: "Withdraw",
        danger: true,
      });
    },
    async go(interaction, actionId) {
      await ackStep(interaction);
      const character = await loadActor(interaction);
      if (!character) return done(interaction, "You don't have a living character.");
      const result = await withdrawMove(prisma, { character, actorDiscordUserId: character.discordUserId, actionId });
      if (!result.ok) return done(interaction, result.error);
      for (const dm of result.dms ?? []) await sendDm(prisma, dm.discordUserId, dm.content).catch(() => {});
      return done(interaction, "Your move was canceled.");
    },
  },
  async modal(interaction, actionId) {
    await ack(interaction);
    const character = await loadActor(interaction);
    if (!character) return done(interaction, "You don't have a living character.");
    const blocked = actBlock(character);
    if (blocked) return done(interaction, blocked);
    const result = await editMove(prisma, {
      character,
      actorDiscordUserId: character.discordUserId,
      actionId,
      description: interaction.fields.getTextInputValue(EDIT_FIELD),
    });
    if (!result.ok) return done(interaction, result.error);
    return done(interaction, result.unchanged ? "No change." : "Your move was edited.");
  },
};

// --- Combat mode ---------------------------------------------------------------

// The web's square button, on Discord (docs/systemdocs/COMBAT-MODE.md §2). Off comes off at once —
// the rule refuses it on the turn it went on. On asks first, the web's confirm, because it can't be
// undone until tomorrow. `needs: null`: the rule asks ACT itself, and only for turning it on, since
// coming out of it is never gated.
const combat = {
  needs: null,
  async start(interaction, { character }) {
    if (inCombatMode(character)) {
      const result = await setCombatMode(prisma, { character, discordUserId: character.discordUserId, on: false });
      return done(interaction, result.ok ? result.line : result.error);
    }
    return confirm(interaction, "combat", null, {
      prompt: "Enter combat mode? You can't turn it off until next turn and it will tire you out at turn pass. It is required to attack/intercept and allows you to properly defend yourself. Effects only apply for combat joined/initiated AFTER you have enabled it.",
      label: "Peace was never an option",
      danger: true,
    });
  },
  steps: {
    async go(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction, { needs: null });
      if (!character) return;
      const result = await setCombatMode(prisma, { character, discordUserId: character.discordUserId, on: true });
      return done(interaction, result.ok ? result.line : result.error);
    },
  },
};

module.exports = {
  combat,
  destroy,
  poison,
  equip,
  unequip,
  play,
  stopplay,
  trumpet,
  horn,
  disguise,
  breakrestraints,
  stepstone: stepstoneVerb,
  mymove,
};
