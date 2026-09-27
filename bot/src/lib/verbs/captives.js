// What a character does to somebody helpless, to the dead, and to the road, on
// Discord: Free, Crucify, Shackle, Brand, Bury, Engrave, Perform Miracle, and
// setting or calling off an Intercept. Each rule is a db/lib/verbs/ function
// the web's action calls too; this file draws the pickers and modals.
const { ModalBuilder, LabelBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, ActionRowBuilder } = require("discord.js");
const { freeCharacter, crucifyCharacter, shackleCharacter, brandCharacter, BRAND_DESCRIPTION_MAX } = require("@lifeweb/db/lib/verbs/captives");
const { buriableBodies, buryCorpse, engraveHeadstone } = require("@lifeweb/db/lib/verbs/bodies");
const { miracleableWounds, performMiracle } = require("@lifeweb/db/lib/verbs/medic");
const { setWatch, stopWatch, setWatchCollaborators } = require("@lifeweb/db/lib/verbs/watch");
const { pickerRows } = require("@lifeweb/db/lib/peopleHere");
const { MAX_NAMES, MESSAGE_LIMIT } = require("@lifeweb/db/lib/intercept");
const { FULL_NAME_LIMIT } = require("@lifeweb/db/lib/characterName");
const { ENGRAVE_RESOURCE_COST } = require("@lifeweb/db/lib/constants");
const { announceInRoom } = require("@lifeweb/db/lib/roomAnnounce");
const { ack, respond } = require("../respond");
const {
  prisma,
  openTurn,
  done,
  pickSomeone,
  pickFrom,
  confirm,
  ackStep,
  picked,
  actorOrRefuse,
  finish,
  modalId,
  verbId,
} = require("./context");

// A verb that picks someone here and then does one thing to them, with an
// optional "are you sure?" between (the ones a misclick would be cruel for).
function onSomeone(mode, { prompt, includeDead = false, sure = null, run }) {
  const act = async (interaction, key) => {
    const character = await actorOrRefuse(interaction);
    if (!character) return;
    const result = await run(character, key);
    return finish(interaction, result);
  };
  return {
    start: (interaction, { character }) => pickSomeone(interaction, character, mode, { prompt, includeDead }),
    steps: {
      async pick(interaction) {
        await ackStep(interaction);
        const { value, label } = picked(interaction);
        if (!sure) return act(interaction, value);
        return confirm(interaction, mode, value, { ...sure(label ?? "them"), danger: true });
      },
      async go(interaction, key) {
        await ackStep(interaction);
        return act(interaction, key);
      },
    },
  };
}

const free = onSomeone("free", {
  prompt: "Who do you cut loose?",
  run: (character, key) => freeCharacter(prisma, { character, discordUserId: character.discordUserId, targetKey: key }),
});

const crucify = onSomeone("crucify", {
  prompt: "Who goes on the cross?",
  sure: (name) => ({ prompt: `Put ${name} on the cross? In a turn they are Dying.`, label: "Crucify" }),
  run: async (character, key) =>
    crucifyCharacter(prisma, { character, discordUserId: character.discordUserId, targetKey: key, openTurn: await openTurn() }),
});

const shackle = onSomeone("shackle", {
  prompt: "Who do you shackle?",
  sure: (name) => ({ prompt: `Shackle ${name}? Only an Escape Artist works shackles loose.`, label: "Shackle" }),
  run: async (character, key) =>
    shackleCharacter(prisma, { character, discordUserId: character.discordUserId, targetKey: key, openTurn: await openTurn() }),
});

// --- Brand: pick them, then say what it marks them with ---------------------------

const BRAND_FIELD = "act:brand:text";

const brand = {
  start: (interaction, { character }) => pickSomeone(interaction, character, "brand", { prompt: "Who do you brand?" }),
  steps: {
    // Opens a modal, so it must NOT be acked first.
    pick(interaction) {
      const { value } = picked(interaction);
      return interaction.showModal(
        new ModalBuilder()
          .setCustomId(modalId("brand", value))
          .setTitle("Brand")
          .addLabelComponents(
            new LabelBuilder()
              .setLabel("What the brand marks them with")
              .setDescription("It never comes off.")
              .setTextInputComponent(
                new TextInputBuilder()
                  .setCustomId(BRAND_FIELD)
                  .setStyle(TextInputStyle.Short)
                  .setMaxLength(BRAND_DESCRIPTION_MAX)
                  .setRequired(true),
              ),
          ),
      );
    },
  },
  async modal(interaction, key) {
    await ack(interaction);
    const character = await actorOrRefuse(interaction);
    if (!character) return;
    const result = await brandCharacter(prisma, {
      character,
      discordUserId: character.discordUserId,
      targetKey: key,
      description: interaction.fields.getTextInputValue(BRAND_FIELD),
      openTurn: await openTurn(),
    });
    return finish(interaction, result, { text: result.ok ? `${result.name} is branded. It'll never come off.` : null });
  },
};

// --- Bury and Engrave -----------------------------------------------------------------

// A body in your hands or one you can reach — the dialog's answer, never a
// roster of the dead.
const bury = {
  needs: null,
  async start(interaction, { character }) {
    const bodies = await buriableBodies(prisma, character);
    return pickFrom(interaction, "bury", "go", {
      prompt: "Who do you bury? It takes your Move, or half of it with a shovel.",
      options: bodies.map((b) => ({ label: b.tagName, value: `${b.tagId}|${b.sourceKey}` })),
      empty: "There's no body here you could bury.",
    });
  },
  steps: {
    async go(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction, { needs: null });
      if (!character) return;
      const [tagId, sourceKey] = picked(interaction).value.split("|");
      const result = await buryCorpse(prisma, {
        character,
        discordUserId: character.discordUserId,
        tagId,
        sourceKey,
        openTurn: await openTurn(),
      });
      if (result.ok && result.announce) {
        await announceInRoom(result.announce.source, character, result.announce.text).catch(() => {});
      }
      return finish(interaction, result, { text: result.ok ? `${result.name} is buried.` : null });
    },
  },
};

const ENGRAVE_FIELD = "act:engrave:name";

// The name is TYPED, never picked: a dropdown would answer "who is dead?" over
// every corpse in Ravenheart.
const engrave = {
  modalFirst: true,
  start(interaction) {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId("engrave"))
        .setTitle("Engrave a headstone")
        .addLabelComponents(
          new LabelBuilder()
            .setLabel("Whose name")
            .setDescription(`Their whole name. It costs ${ENGRAVE_RESOURCE_COST} ⬢ and your Move.`)
            .setTextInputComponent(
              new TextInputBuilder().setCustomId(ENGRAVE_FIELD).setStyle(TextInputStyle.Short).setMaxLength(FULL_NAME_LIMIT).setRequired(true),
            ),
        ),
    );
  },
  async modal(interaction) {
    await ack(interaction);
    const character = await actorOrRefuse(interaction);
    if (!character) return;
    const result = await engraveHeadstone(prisma, {
      character,
      discordUserId: character.discordUserId,
      name: interaction.fields.getTextInputValue(ENGRAVE_FIELD),
      openTurn: await openTurn(),
    });
    return finish(interaction, result, { text: result.ok ? "The name is cut into the stone." : null });
  },
};

// --- Perform Miracle ---------------------------------------------------------------------

const miracle = {
  start: (interaction, { character }) =>
    pickSomeone(interaction, character, "miracle", { prompt: "Who do you lay hands on?" }),
  steps: {
    async pick(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const key = picked(interaction).value;
      const found = await miracleableWounds(prisma, { character, targetKey: key });
      if (!found.ok) return done(interaction, found.error);
      return pickFrom(interaction, "miracle", "go", {
        prompt: `What do you heal on ${found.name}?`,
        payload: key,
        options: found.wounds.map((w) => ({ label: w.name, value: w.tagId })),
        empty: "There's nothing on them a miracle could touch.",
      });
    },
    async go(interaction, key) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const result = await performMiracle(prisma, {
        character,
        discordUserId: character.discordUserId,
        targetKey: key,
        tagId: picked(interaction).value,
        openTurn: await openTurn(),
      });
      return finish(interaction, result, { text: result.ok ? `${result.name} is healed by a miracle.` : null });
    },
  },
};

// --- Intercept ------------------------------------------------------------------------------

const FIELD = {
  mode: "act:intercept:mode",
  who: "act:intercept:who",
  names: "act:intercept:names",
  options: "act:intercept:options",
  message: "act:intercept:message",
};

// The web dialog, as one modal: Safe or Ambush, who you watch for (names, any
// hood, anyone you can't identify, or anyone), the two narrowings, and what you
// say when they arrive. The modal is full (five components), so an Ambush asks
// for its collaborators in a second step once it is saved.
const intercept = {
  modalFirst: true,
  start(interaction) {
    const select = (id, options, { min = 1, max = 1 } = {}) =>
      new StringSelectMenuBuilder().setCustomId(id).setMinValues(min).setMaxValues(max).addOptions(options);
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId(modalId("intercept"))
        .setTitle("Intercept")
        .addLabelComponents(
          new LabelBuilder()
            .setLabel("How")
            .setStringSelectMenuComponent(
              select(FIELD.mode, [
                { label: "Safe — stop them and talk", value: "SAFE", default: true },
                { label: "Ambush — start a fight with them (needs combat mode)", value: "AMBUSH" },
              ]),
            ),
          new LabelBuilder()
            .setLabel("Who")
            .setStringSelectMenuComponent(
              select(FIELD.who, [
                { label: "Only the names I write below, if I know them", value: "NAMES", default: true },
                { label: "Anyone whose face is hidden", value: "CONCEALED" },
                { label: "Anyone I can't identify", value: "UNIDENTIFIED" },
                { label: "Anyone at all", value: "ANYONE" },
              ]),
            ),
          new LabelBuilder()
            .setLabel("Names")
            .setDescription(`One a line, or split by commas. Up to ${MAX_NAMES}.`)
            .setTextInputComponent(
              new TextInputBuilder().setCustomId(FIELD.names).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000),
            ),
          new LabelBuilder()
            .setLabel("Also")
            .setStringSelectMenuComponent(
              select(
                FIELD.options,
                [
                  { label: "Only people from outside this zone", value: "outsideZoneOnly" },
                  { label: "Search them automatically", value: "autoSearch" },
                ],
                { min: 0, max: 2 },
              ).setRequired(false),
            ),
          new LabelBuilder()
            .setLabel("What you say to them")
            .setTextInputComponent(
              new TextInputBuilder()
                .setCustomId(FIELD.message)
                .setStyle(TextInputStyle.Short)
                .setRequired(false)
                .setMaxLength(MESSAGE_LIMIT),
            ),
        ),
    );
  },
  async modal(interaction) {
    await ack(interaction);
    const character = await actorOrRefuse(interaction);
    if (!character) return;
    const fields = interaction.fields;
    const mode = fields.getStringSelectValues(FIELD.mode)[0] ?? "SAFE";
    const who = fields.getStringSelectValues(FIELD.who)[0] ?? "NAMES";
    const extras = new Set(fields.getStringSelectValues(FIELD.options) ?? []);
    const names = (fields.getTextInputValue(FIELD.names) ?? "")
      .split(/[\n,]/)
      .map((n) => n.trim())
      .filter(Boolean);
    const result = await setWatch(prisma, {
      character,
      discordUserId: character.discordUserId,
      input: {
        mode,
        message: fields.getTextInputValue(FIELD.message) ?? "",
        names,
        anyConcealed: who === "CONCEALED",
        anyUnidentified: who === "UNIDENTIFIED",
        anyPerson: who === "ANYONE",
        outsideZoneOnly: extras.has("outsideZoneOnly"),
        autoSearch: extras.has("autoSearch"),
      },
      openTurn: await openTurn(),
    });
    if (!result.ok || mode !== "AMBUSH") return finish(interaction, result);
    // Who lies in wait with you (optional). Everybody here, both halves, by picker key.
    const rows = (await pickerRows(prisma, character)).slice(0, 25);
    if (rows.length === 0) return finish(interaction, result);
    const menu = new StringSelectMenuBuilder()
      .setCustomId(verbId("intercept", "helpers"))
      .setPlaceholder("Who lies in wait with you? (optional)")
      .setMinValues(0)
      .setMaxValues(rows.length)
      .addOptions(rows.map((row) => ({ label: row.label.slice(0, 100), value: row.key })));
    // Not fleeting, the pickSomeone reason: this message IS the next step, and a self-delete timer would take it.
    return respond(interaction, {
      content: `${result.line}\nAnyone you pick below is asked to join you when it springs, if they're still here.`,
      components: [new ActionRowBuilder().addComponents(menu)],
    }, { fleeting: false });
  },
  steps: {
    async helpers(interaction) {
      await ackStep(interaction);
      const character = await actorOrRefuse(interaction);
      if (!character) return;
      const result = await setWatchCollaborators(prisma, {
        character,
        discordUserId: character.discordUserId,
        keys: interaction.values ?? [],
        openTurn: await openTurn(),
      });
      return finish(interaction, result);
    },
  },
};

const interceptstop = {
  needs: null,
  async start(interaction, { character }) {
    const result = await stopWatch(prisma, { character, discordUserId: character.discordUserId, openTurn: await openTurn() });
    return finish(interaction, result);
  },
};

module.exports = { free, crucify, shackle, brand, bury, engrave, miracle, intercept, interceptstop };
